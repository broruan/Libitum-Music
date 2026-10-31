import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { SpectrumFrame } from '../shared/types'
const exec = promisify(execFile)
export class SpectrumService {
  private key = ''
  private revision = 0
  private capture: ChildProcess | null = null
  private worker: Worker | null = null
  constructor(private emit: (frame: SpectrumFrame) => void, private workerPath=join(__dirname,'spectrum-worker.js')) {}
  update(active: boolean, pid: number | undefined, device: string, trackId: string) {
    const key = active && pid ? `${pid}:${device}:${trackId}` : ''
    if (key === this.key) return
    this.stop(); this.key=key
    if (!key) { this.emit({ status:'idle', bins:[] }); return }
    if (device.startsWith('alsa/')) { this.emit({ status:'unavailable', bins:[], reason:'ALSA 直通输出不支持此频谱监听，请选择系统音频输出。' }); return }
    const revision=this.revision
    void this.start(pid!,revision).catch(()=>{ if(revision===this.revision) this.emit({status:'unavailable',bins:[],reason:'无法监听本应用的播放流。请安装 pulseaudio-utils，并确认 PulseAudio 或 PipeWire 兼容服务可用。'}) })
  }
  private async list(kind: string) { const {stdout}=await exec('pactl',['-f','json','list',kind],{timeout:2000,maxBuffer:4_000_000}); return JSON.parse(stdout) }
  private async start(pid: number, revision: number) {
    let input: any
    for(let attempt=0;attempt<8;attempt++) {
      if(revision!==this.revision) return
      input=(await this.list('sink-inputs')).find((i:any)=>String(i.properties?.['application.process.id'])===String(pid))
      if(input) break
      await new Promise(resolve=>setTimeout(resolve,150))
    }
    if(!input) throw new Error('Own stream not found')
    const sink=(await this.list('sinks')).find((s:any)=>s.index===input.sink)
    const monitor=sink?.monitor_source_name || (typeof sink?.monitor_source==='string' ? sink.monitor_source : sink?.name ? `${sink.name}.monitor` : '')
    if(!monitor || revision!==this.revision) return
    const worker=new Worker(this.workerPath); this.worker=worker
    const child=spawn('parec',[`--monitor-stream=${input.index}`,`--device=${monitor}`,'--raw','--format=float32le','--rate=48000','--channels=1','--latency-msec=50'],{stdio:['ignore','pipe','ignore'],shell:false}); this.capture=child
    let failed=false
    const fail=()=>{ if(revision!==this.revision || failed) return; failed=true; child.kill('SIGTERM'); void worker.terminate(); this.emit({status:'unavailable',bins:[],reason:'本应用播放流监听已中断；重新开启频谱可重试。'}) }
    child.once('error',fail); child.once('close',fail); worker.once('error',fail)
    child.stdout!.on('data',(data:Buffer)=>{ if(revision===this.revision && !failed) worker.postMessage(data) })
    worker.on('message',(bins:number[])=>{ if(revision===this.revision && !failed) this.emit({status:'active',bins}) })
  }
  stop() { this.revision++; this.capture?.kill('SIGTERM'); this.capture=null; if(this.worker) void this.worker.terminate(); this.worker=null; this.key='' }
}
