import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp,rm,readdir } from 'node:fs/promises'
import { join,resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { expect,it } from 'vitest'
import { MediaLibrary } from '../../src/main/media'
import type { Wallpaper,MediaImportState } from '../../src/shared/types'
const exec=promisify(execFile)
it('imports an image privately and serves bounded byte ranges only',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'libitum-media-'));let wallpaper:Wallpaper|null=null
  try{
    const library=new MediaLibrary(dir,()=>{},async value=>{wallpaper=value})
    await library.import(resolve('resources/icon.png'))
    expect(wallpaper).toBeTruthy()
    const response=await library.serve(new Request('https://local.invalid/',{headers:{Range:'bytes=0-7'}}),(wallpaper as unknown as Wallpaper).id)
    expect(response.status).toBe(206);expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([137,80,78,71,13,10,26,10]))
    expect((await library.serve(new Request('https://local.invalid/'),'../session.json')).status).toBe(403)
    expect((await readdir(dir)).some(p=>p.endsWith('.part'))).toBe(false)
  }finally{await rm(dir,{recursive:true,force:true})}
})
it('converts a real video into a silent background and keeps the old selection on cancellation',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'libitum-video-'));let wallpaper:Wallpaper|null=null;const events:MediaImportState[]=[]
  try{
    const source=join(dir,'source.mkv')
    await exec('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=160x90:d=1','-f','lavfi','-i','sine=frequency=1000:duration=1','-c:v','libx264','-c:a','aac','-shortest',source])
    const library=new MediaLibrary(join(dir,'assets'),value=>events.push(value),async value=>{wallpaper=value})
    await library.import(source)
    const first=wallpaper as unknown as Wallpaper
    expect(first.kind).toBe('video')
    const {stdout}=await exec('ffprobe',['-v','error','-show_entries','stream=codec_type,width,height','-of','json',join(dir,'assets',first.id)])
    const streams=JSON.parse(stdout).streams;expect(streams.map((s:any)=>s.codec_type)).toEqual(['video']);expect(streams[0].width).toBeLessThanOrEqual(1920)
    const pending=library.import(source);library.cancel();await expect(pending).rejects.toMatchObject({code:'CANCELLED'})
    expect(wallpaper).toEqual(first);expect(events.at(-1)?.status).toBe('cancelled');expect((await readdir(join(dir,'assets'))).filter(p=>p.endsWith('.part'))).toHaveLength(0)
  }finally{await rm(dir,{recursive:true,force:true})}
})
