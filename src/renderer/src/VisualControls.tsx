import { useEffect, useId, useRef, useState } from 'react'
import { request, useApp, useResource, type VisualPreview } from './state'

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
  const value=visualPreview[field]??data.settings[field]
  return <div className="setting-row blur-setting"><label htmlFor={id}>{label}</label><div><input id={id} aria-label={label} type="range" min="0" max={max} step="1" value={value} disabled={saving} onChange={e=>{const next=Number(e.target.value);pending.current=next;setVisualPreview(current=>({...current,[field]:next}))}} onPointerUp={()=>void commit()} onKeyUp={()=>void commit()} onBlur={()=>void commit()}/><output htmlFor={id}>{value} px</output></div></div>
}
export function BlurControls(){return <div className="blur-controls"><AutoTextControl/><BlurSlider field="wallpaperBlur" label="壁纸模糊" max={40}/><BlurSlider field="panelBlur" label="面板模糊" max={30}/><p className="muted small-text">拖动即时预览，松开保存。面板模糊在使用壁纸时生效，文字保持清晰。</p></div>}

function AutoTextControl(){
  const {data,act}=useApp(),[checked,setChecked]=useState(data.settings.autoWallpaperText),[busy,setBusy]=useState(false)
  useEffect(()=>setChecked(data.settings.autoWallpaperText),[data.settings.autoWallpaperText])
  const change=async(value:boolean)=>{setChecked(value);setBusy(true);try{await request('settings.update',{autoWallpaperText:value})}catch(error){setChecked(data.settings.autoWallpaperText);await act(Promise.reject(error))}finally{setBusy(false)}}
  return <div className="setting-row"><div><strong>壁纸文字自动配色</strong><p>可选：依据壁纸明暗和主色配色，保留安全遮罩。</p></div><label className="switch"><input type="checkbox" aria-label="壁纸文字自动配色" checked={checked} disabled={busy} onChange={e=>void change(e.target.checked)}/><span/></label></div>
}
export function AppearanceControls(){
  const {data,act}=useApp(),s=data.settings
  const [background,setBackground]=useState(s.backgroundColor),[color,setColor]=useState(s.fontColor),[font,setFont]=useState(s.fontFamily),[busy,setBusy]=useState(false)
  const fonts=useResource(()=>request('settings.fonts'),[])
  useEffect(()=>{setBackground(s.backgroundColor);setColor(s.fontColor);setFont(s.fontFamily)},[s.backgroundColor,s.fontColor,s.fontFamily])
  const save=async()=>{setBusy(true);await act(request('settings.update',{backgroundColor:background,fontColor:color,fontFamily:font}),'外观已更新');setBusy(false)}
  return <section className="custom-appearance"><h3>自定义配色与字体</h3><div className="setting-row"><div><strong>背景颜色</strong><p>无壁纸时使用的底色。</p></div><div className="color-controls"><input aria-label="自定义背景颜色" type="color" value={background||'#f7f8fa'} onChange={e=>setBackground(e.target.value)}/><button className="text-link" onClick={()=>setBackground('')}>跟随主题</button></div></div><div className="setting-row"><div><strong>文字颜色</strong><p>关闭自动配色时，用于壁纸与底色区域。</p></div><div className="color-controls"><input aria-label="自定义文字颜色" type="color" value={color||'#272b36'} onChange={e=>setColor(e.target.value)}/><button className="text-link" onClick={()=>setColor('')}>跟随主题</button></div></div><div className="setting-row"><label htmlFor="appearance-font">界面字体</label><input id="appearance-font" className="input font-choice" list="system-fonts" value={font} maxLength={120} placeholder="系统默认，或填写已安装字体" onChange={e=>setFont(e.target.value)}/><datalist id="system-fonts">{fonts.data?.map(name=><option key={name} value={name}/>)}</datalist></div><div className="editor-actions"><button className="button subtle" onClick={()=>{setBackground('');setColor('');setFont('')}}>重置预览</button><button className="button primary" disabled={busy} onClick={()=>void save()}>应用外观</button></div></section>
}
