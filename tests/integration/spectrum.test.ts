import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp,writeFile,rm } from 'node:fs/promises'
import { join,resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { expect,it } from 'vitest'
import { Mpv } from '../../src/main/mpv'
import { SpectrumService } from '../../src/main/spectrum'
import type { SpectrumFrame } from '../../src/shared/types'
const exec=promisify(execFile)
function wav(frequency:number){
  const rate=48000,buffer=Buffer.alloc(44+rate*2*15);buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(buffer.length-44,40)
  for(let i=0;i<rate*15;i++)buffer.writeInt16LE(Math.round(0.3*32767*Math.sin(i*2*Math.PI*frequency/rate)),44+i*2)
  return buffer
}
it('reads only its own playback stream, excluding a second app in the same virtual sink',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'libitum-spectrum-')),name=`libitum_test_${process.pid}`
  const first=new Mpv(join(directory,'one'),()=> 'mpv'),second=new Mpv(join(directory,'two'),()=> 'mpv')
  let module='',frame:SpectrumFrame={status:'idle',bins:[]}
  const spectrum=new SpectrumService(value=>{frame=value},resolve('out/main/spectrum-worker.js'))
  try{
    const result=await exec('pactl',['load-module','module-null-sink',`sink_name=${name}`,'sink_properties=device.description=Libitum-test\ priority.session=-1000']);module=result.stdout.trim()
    for(const [mpv,frequency,label] of [[first,1000,'one'],[second,4000,'two']] as const){
      const path=join(directory,`${label}.wav`);await writeFile(path,wav(frequency));await mpv.start();await mpv.command(['set_property','audio-device',`pulse/${name}`]);await mpv.command(['loadfile',path,'replace'])
    }
    spectrum.update(true,first.pid,`pulse/${name}`,'test-tone')
    await expect.poll(()=>frame.status,{timeout:10000}).toBe('active')
    const band=(hz:number)=>Math.floor(Math.log(hz/20)/Math.log(1000)*64)
    const nearby=(hz:number)=>Math.max(...frame.bins.slice(band(hz)-1,band(hz)+2))
    expect(nearby(1000)).toBeGreaterThan(0.4);expect(nearby(4000)).toBeLessThan(nearby(1000)-0.25)
    console.log('Own-stream FFT verified; unrelated stream excluded; no PCM saved.')
  }finally{
    spectrum.stop();await first.stop();await second.stop();if(module)await exec('pactl',['unload-module',module]).catch(()=>{});await rm(directory,{recursive:true,force:true})
  }
},20000)
