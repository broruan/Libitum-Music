import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect,it } from 'vitest'
import { defaultPeq,peqGraph } from '../../src/shared/peq'
const exec=promisify(execFile)
async function rms(frequency:number,filter:string){
  const {stdout}=await exec('ffmpeg',['-v','error','-f','lavfi','-i',`sine=frequency=${frequency}:duration=0.3:sample_rate=48000`,'-af',filter,'-f','f32le','-'],{encoding:'buffer',maxBuffer:1_000_000})
  let sum=0,count=0;for(let i=4800*4;i<stdout.length;i+=4){sum+=stdout.readFloatLE(i)**2;count++}return Math.sqrt(sum/count)
}
it('produces the expected gain using real FFmpeg peak and shelf filters',async()=>{
  for(const [type,frequency,testTone] of [['PK',1000,1000],['LS',1000,60],['HS',1000,10000]] as const){
    const preset=defaultPeq();preset.enabled=true;preset.bands[0]={enabled:true,type,frequency,gain:-6,q:0.707}
    const baseline=await rms(testTone,'anull'),processed=await rms(testTone,peqGraph(preset))
    expect(20*Math.log10(processed/baseline)).toBeCloseTo(-6,0)
  }
})
