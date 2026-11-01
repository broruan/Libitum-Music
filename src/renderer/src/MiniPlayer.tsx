import { useEffect, useLayoutEffect, useState } from 'react'
import { Heart, Maximize2, Pause, Play, Power, SkipBack, SkipForward, X } from 'lucide-react'
import type { MiniState } from '../../shared/types'
import { experienceDefaults } from '../../shared/preferences'
import { SAFE_WALLPAPER_PALETTE } from '../../shared/wallpaper-palette'
import { Cover, IconButton, time } from './components'
import { usePlaybackSeek } from './usePlaybackSeek'
import { useAppearance } from './appearance'
import { WallpaperBackground } from './WallpaperBackground'
import { request } from './state'

const fallback={...experienceDefaults(),theme:'system' as const}
export function MiniPlayer(){
  const [state,setState]=useState<MiniState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[volume,setVolume]=useState<number|null>(null)
  const [palette,setPalette]=useState(SAFE_WALLPAPER_PALETTE)
  const settings=state?.appearance||fallback,wallpaperActive=settings.visualMode==='wallpaper'&&!!settings.wallpaper
  const appearance=useAppearance(settings,{},palette,wallpaperActive)
  useLayoutEffect(()=>{document.documentElement.classList.add('mini-window');return()=>document.documentElement.classList.remove('mini-window')},[])
  useEffect(()=>{
    let live=true,received=false
    const off=window.music.onEvent(e=>{if(e.type==='mini'){received=true;setState(e.data)}})
    void request('mini.bootstrap').then(data=>{if(live&&!received)setState(data)}).catch(e=>{if(live)setError(e.message)})
    return()=>{live=false;off()}
  },[])
  const run=async(action:Promise<unknown>)=>{setBusy(true);setError('');try{await action}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const track=state?.track
  const progress=usePlaybackSeek(state?.position||0,state?.duration||0,`${track?.id||''}:${state?.status==='loading'}`,seconds=>run(request('player.seek',{seconds})))
  return <div className="mini-player" style={appearance.style}>
    <div className="mini-background" style={{opacity:settings.floatingOpacity}} aria-hidden="true"><WallpaperBackground settings={settings} status={state?.status||'idle'} active={wallpaperActive} onPalette={setPalette}/></div>
    <div className="mini-content">
      <div className="mini-art"><Cover url={track?.coverUrl} title={track?.title||'Libitum music'} id={track?.id||'mini'} size="tiny"/></div>
      <div className="mini-song"><strong title={track?.title}>{track?.title||'Libitum music'}</strong><span title={error||track?.artists.map(a=>a.name).join(' / ')} role={error?'status':undefined} className={error?'mini-error':''}>{error||track?.artists.map(a=>a.name).join(' / ')||'等待音乐响起'}</span></div>
      <IconButton title="喜欢当前歌曲" disabled={!track||busy} active={state?.liked} onClick={()=>void run(request('mini.like'))}><Heart size={13} fill={state?.liked?'currentColor':'none'}/></IconButton>
      <IconButton title="返回主窗口" onClick={()=>void run(request('window.restore'))}><Maximize2 size={12}/></IconButton>
      <IconButton title="关闭悬浮卡片" onClick={()=>void run(request('mini.close'))}><X size={13}/></IconButton>
    </div>
    <div className="mini-controls">
      <span title="播放时间">{time(state?.position||0)} / {time(state?.duration||0)}</span>
      <IconButton title="上一首" disabled={!track||busy} onClick={()=>void run(request('player.previous'))}><SkipBack size={13}/></IconButton>
      <IconButton title={state?.status==='playing'?'暂停播放':'开始播放'} disabled={!track||busy||state?.status==='loading'} onClick={()=>void run(request('player.toggle'))}>{state?.status==='playing'?<Pause size={14}/>:<Play size={14}/>}</IconButton>
      <IconButton title="下一首" disabled={!track||busy} onClick={()=>void run(request('player.next'))}><SkipForward size={13}/></IconButton>
      <input className="mini-volume" aria-label="悬浮音量" type="range" min="0" max="100" value={volume??state?.volume??60} onChange={e=>setVolume(Number(e.target.value))} onPointerUp={e=>{void run(request('player.volume',{volume:Number(e.currentTarget.value)}));setVolume(null)}} onKeyUp={e=>{void run(request('player.volume',{volume:Number(e.currentTarget.value)}));setVolume(null)}}/>
      <IconButton title="退出应用" onClick={()=>void run(request('app.quit'))}><Power size={12}/></IconButton>
    </div>
    <input className="mini-seek" aria-label="悬浮播放进度" type="range" min="0" max={state?.duration||1} step="0.1" value={progress.value} disabled={!track||busy} {...progress.handlers}/>
  </div>
}
