import {createContext,useLayoutEffect,useState,type CSSProperties} from 'react'
import type {AppearanceSettings} from '../../shared/types'
import {contrast,minimumContrast,mix,paletteForSamples,parseColor,type Rgb,type WallpaperPalette} from '../../shared/wallpaper-palette'
import type {VisualPreview} from './state'

export const AppearanceContext=createContext({contrastRatio:21})
function readTheme(){
  const css=getComputedStyle(document.documentElement),get=(key:string)=>css.getPropertyValue(key).trim()
  return {text:get('--text'),secondary:get('--secondary'),muted:get('--muted'),bg:get('--bg'),panel:get('--panel-rgb').split(/\s+/).map(Number) as Rgb}
}
export function useAppearance(s:AppearanceSettings,preview:VisualPreview,palette:WallpaperPalette,wallpaperActive:boolean){
  const [theme,setTheme]=useState(readTheme)
  useLayoutEffect(()=>{
    const update=()=>{document.documentElement.dataset.theme=s.theme;setTheme(readTheme())}
    const system=matchMedia('(prefers-color-scheme: dark)');update();system.addEventListener('change',update)
    return()=>system.removeEventListener('change',update)
  },[s.theme])
  const samples=wallpaperActive?palette.samples:[parseColor(s.backgroundColor||theme.bg)],opacity=preview.panelOpacity??s.panelOpacity
  const panelSamples=samples.map(sample=>mix(sample,theme.panel,opacity)),panelPalette=paletteForSamples(panelSamples,palette.dominant)
  const auto=wallpaperActive&&s.autoWallpaperText
  const manual=s.fontColor||(s.backgroundColor&&!wallpaperActive?(contrast([21,25,35],samples[0])>=contrast([250,251,255],samples[0])?'#151923':'#fafbff'):'')
  const canvas={primary:auto?palette.primary:manual||theme.text,secondary:auto?palette.secondary:manual||theme.secondary,muted:auto?palette.secondary:manual||theme.muted}
  const panel={primary:auto?panelPalette.primary:s.fontColor||theme.text,secondary:auto?panelPalette.secondary:s.fontColor||theme.secondary,muted:auto?panelPalette.secondary:s.fontColor||theme.muted}
  const contrastRatio=Math.min(...Object.values(canvas).map(c=>minimumContrast(c,samples)),...Object.values(panel).map(c=>minimumContrast(c,panelSamples)))
  const style={fontFamily:s.fontFamily||undefined,'--bg':s.backgroundColor||undefined,
    '--text':canvas.primary,'--secondary':canvas.secondary,'--muted':canvas.muted,
    '--panel-text':panel.primary,'--panel-secondary':panel.secondary,'--panel-muted':panel.muted,
    '--panel-opacity':opacity,'--panel-accent':auto?panelPalette.accent:'var(--theme-accent)',
    '--accent':auto?palette.accent:'var(--theme-accent)',
    '--wallpaper-blur':`${preview.wallpaperBlur??s.wallpaperBlur}px`,'--panel-blur':`${preview.panelBlur??s.panelBlur}px`
  } as CSSProperties
  return {style,contrastRatio}
}
