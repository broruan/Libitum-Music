import {useEffect,useRef} from 'react'
import type {AppearanceSettings,PlayerState} from '../../shared/types'
import {SAFE_WALLPAPER_PALETTE,wallpaperPalette,type WallpaperPalette} from '../../shared/wallpaper-palette'

export function WallpaperBackground({settings,status,active,onPalette}:{settings:AppearanceSettings;status:PlayerState['status'];active:boolean;onPalette:(palette:WallpaperPalette)=>void}) {
  const video=useRef<HTMLVideoElement>(null),image=useRef<HTMLImageElement>(null),background=useRef<HTMLDivElement>(null),last=useRef<WallpaperPalette>(SAFE_WALLPAPER_PALETTE)
  const src=settings.wallpaper?`music-app://bundle/user-media/${settings.wallpaper.id}`:''
  useEffect(()=>{
    const update=()=>{const element=video.current;if(!element)return;if(active&&!document.hidden&&status==='playing')void element.play().catch(()=>{});else element.pause()}
    update();document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update)
  },[active,src,status])
  useEffect(()=>{
    if(!active)return
    const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32
    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return
    const sample=()=>{
      if(document.hidden)return
      const media=video.current||image.current,box=background.current?.getBoundingClientRect()
      const width=video.current?.videoWidth||image.current?.naturalWidth||0,height=video.current?.videoHeight||image.current?.naturalHeight||0
      if(!media||!box||!width||!height)return
      try{
        const scale=Math.max(box.width/width,box.height/height)*1.08,sw=box.width/scale,sh=box.height/scale
        context.clearRect(0,0,32,32);context.drawImage(media,(width-sw)/2,(height-sh)/2,sw,sh,0,0,32,32)
        const palette=wallpaperPalette(context.getImageData(0,0,32,32).data,settings.wallpaperBrightness,settings.wallpaperOverlay,last.current)
        if(JSON.stringify(palette)!==JSON.stringify(last.current)){last.current=palette;onPalette(palette)}
      }catch{onPalette(SAFE_WALLPAPER_PALETTE)}
    }
    const media=video.current||image.current
    media?.addEventListener('load',sample);media?.addEventListener('loadeddata',sample);media?.addEventListener('seeked',sample)
    const system=matchMedia('(prefers-color-scheme: dark)');system.addEventListener('change',sample)
    window.addEventListener('resize',sample);document.addEventListener('visibilitychange',sample)
    sample();const timer=setInterval(sample,2000)
    return()=>{clearInterval(timer);media?.removeEventListener('load',sample);media?.removeEventListener('loadeddata',sample);media?.removeEventListener('seeked',sample);system.removeEventListener('change',sample);window.removeEventListener('resize',sample);document.removeEventListener('visibilitychange',sample)}
  },[active,src,settings.wallpaperBrightness,settings.wallpaperOverlay,onPalette])
  if(!active)return null
  return <div ref={background} className="music-background" aria-hidden="true" style={{'--wallpaper-brightness':settings.wallpaperBrightness,'--wallpaper-overlay':settings.wallpaperOverlay} as React.CSSProperties}>{settings.wallpaper!.kind==='video'?<video ref={video} src={src} muted loop playsInline preload="auto"/>:<img ref={image} src={src} alt=""/>}<div className="wallpaper-shade"/></div>
}
