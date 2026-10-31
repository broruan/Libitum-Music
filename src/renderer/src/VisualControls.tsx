import { useContext, useEffect, useId, useRef, useState } from 'react'
import { request, useApp, useResource, type VisualPreview } from './state'
import {AppearanceContext} from './appearance'

function BlurSlider({field,label,max}:{field:keyof VisualPreview;label:string;max:number}) {
  const {data,visualPreview,setVisualPreview,toast}=useApp(),id=useId()
  const [saving,setSaving]=useState(false),pending=useRef<number|undefined>(undefined),busy=useRef(false)
  const clear=()=>setVisualPreview(current=>{const next={...current};delete next[field];return next})
  useEffect(()=>()=>{clear()},[field])
  const commit=async()=>{
    const value=pending.current
    if(value===undefined||busy.current)return
    pending.current=undefined;busy.current=true;setSaving(true)
    try{await request('settings.update',{[field]:value})}
    catch(error){toast((error as Error).message)}
    finally{clear();busy.current=false;setSaving(false)}
  }
  const stored=visualPreview[field]??data.settings[field],value=field==='panelOpacity'?Math.round((1-stored)*100):stored
  const cancel=()=>{pending.current=undefined;clear()}
  return <div className="setting-row blur-setting"><label htmlFor={id}>{label}</label><div><input id={id} aria-label={label} type="range" min="0" max={max} step="1" value={value} disabled={saving} onChange={e=>{const ui=Number(e.target.value),next=field==='panelOpacity'?(100-ui)/100:ui;pending.current=next;setVisualPreview(current=>({...current,[field]:next}))}} onPointerDown={e=>e.currentTarget.setPointerCapture(e.pointerId)} onPointerUp={()=>void commit()} onLostPointerCapture={()=>void commit()} onPointerCancel={cancel} onKeyDown={e=>{if(e.key==='Escape')cancel()}} onKeyUp={()=>void commit()} onBlur={()=>void commit()}/><output htmlFor={id}>{value}{field==='panelOpacity'?'%':' px'}</output></div></div>
}
export function BlurControls(){return <div className="blur-controls"><AutoTextControl/><BlurSlider field="wallpaperBlur" label="壁纸模糊" max={40}/><BlurSlider field="panelBlur" label="面板模糊" max={30}/><BlurSlider field="panelOpacity" label="面板透明度" max={100}/><p className="muted small-text">拖动即时预览，松开保存。透明度 0% 为不透明，100% 为完全透明；模糊与文字不受透明度影响。</p><ContrastNotice/></div>}
function ContrastNotice(){
  const {contrastRatio}=useContext(AppearanceContext),{act}=useApp()
  if(contrastRatio>=4.5)return null
  return <div className="contrast-notice" role="status"><p>部分区域文字对比度约 {contrastRatio.toFixed(1)}:1，低于 4.5:1。可调整字色、遮罩或面板透明度；背景不会自动改变。</p><button className="text-link" onClick={()=>void act(request('settings.update',{fontColor:'',autoWallpaperText:false}))}>恢复主题字色</button></div>
}

function AutoTextControl(){
  const {data,act}=useApp(),[checked,setChecked]=useState(data.settings.autoWallpaperText),[busy,setBusy]=useState(false)
  useEffect(()=>setChecked(data.settings.autoWallpaperText),[data.settings.autoWallpaperText])
  const change=async(value:boolean)=>{setChecked(value);setBusy(true);try{await request('settings.update',{autoWallpaperText:value})}catch(error){setChecked(data.settings.autoWallpaperText);await act(Promise.reject(error))}finally{setBusy(false)}}
  return <div className="setting-row"><div><strong>壁纸文字自动配色</strong><p>可选：依据背景明暗和主色调整文字，不改变壁纸或遮罩。</p></div><label className="switch"><input type="checkbox" aria-label="壁纸文字自动配色" checked={checked} disabled={busy} onChange={e=>void change(e.target.checked)}/><span/></label></div>
}
export function AppearanceControls(){
  const {data,act}=useApp(),s=data.settings
  const [background,setBackground]=useState(s.backgroundColor),[color,setColor]=useState(s.fontColor),[font,setFont]=useState(s.fontFamily),[busy,setBusy]=useState(false),manual=useRef(false)
  const fonts=useResource(()=>request('settings.fonts'),[])
  useEffect(()=>{setBackground(s.backgroundColor);setColor(s.fontColor);setFont(s.fontFamily)},[s.backgroundColor,s.fontColor,s.fontFamily])
  const save=async()=>{setBusy(true);await act(request('settings.update',{backgroundColor:background,fontColor:color,fontFamily:font,...(manual.current||color!==s.fontColor?{autoWallpaperText:false}:{})}),'外观已更新');manual.current=false;setBusy(false)}
  return <section className="custom-appearance"><h3>自定义配色与字体</h3><div className="setting-row"><div><strong>背景颜色</strong><p>无壁纸时使用的底色。</p></div><div className="color-controls"><input aria-label="自定义背景颜色" type="color" value={background||'#f7f8fa'} onChange={e=>setBackground(e.target.value)}/><button className="text-link" onClick={()=>setBackground('')}>跟随主题</button></div></div><div className="setting-row"><div><strong>文字颜色</strong><p>应用后使用手动字色，覆盖设置、播放页和菜单的普通文字。</p></div><div className="color-controls"><input aria-label="自定义文字颜色" type="color" value={color||'#272b36'} onChange={e=>{manual.current=true;setColor(e.target.value)}}/><button className="text-link" onClick={()=>{manual.current=true;setColor('')}}>跟随主题</button></div></div><div className="setting-row"><label htmlFor="appearance-font">界面字体</label><input id="appearance-font" className="input font-choice" list="system-fonts" value={font} maxLength={120} placeholder="系统默认，或填写已安装字体" onChange={e=>setFont(e.target.value)}/><datalist id="system-fonts">{fonts.data?.map(name=><option key={name} value={name}/>)}</datalist></div><div className="editor-actions"><button className="button subtle" onClick={()=>{setBackground('');setColor('');setFont('');manual.current=true}}>重置预览</button><button className="button primary" disabled={busy} onClick={()=>void save()}>应用外观</button></div></section>
}
