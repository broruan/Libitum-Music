import { parentPort } from 'node:worker_threads'
import { spectrum } from './spectrum-fft'
let pending = Buffer.alloc(0), last = 0
parentPort!.on('message',(value: Uint8Array)=>{
  pending = Buffer.concat([pending,Buffer.from(value)])
  if (pending.length > 65536) pending = pending.subarray(pending.length-65536)
  if (pending.length < 16384 || Date.now()-last<33) return
  const samples = new Float32Array(4096), start=pending.length-16384
  for(let i=0;i<4096;i++) samples[i]=pending.readFloatLE(start+i*4)
  pending=pending.subarray(pending.length-12288); last=Date.now()
  parentPort!.postMessage(spectrum(samples))
})
