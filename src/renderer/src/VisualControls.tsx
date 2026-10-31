import { useEffect, useId, useRef, useState } from 'react'
import { request, useApp, type VisualPreview } from './state'

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
export function BlurControls(){return <div className="blur-controls"><BlurSlider field="wallpaperBlur" label="壁纸模糊" max={40}/><BlurSlider field="panelBlur" label="面板模糊" max={30}/><p className="muted small-text">拖动即时预览，松开保存。面板模糊在使用壁纸时生效，文字保持清晰。</p></div>}
