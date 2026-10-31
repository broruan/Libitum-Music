import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent } from 'react'
/** A draft exists only during a gesture or an in-flight seek; lost events cannot pin it. */
export function usePlaybackSeek(position:number,duration:number,trackKey:string,onSeek:(seconds:number)=>Promise<unknown>){
  const [draft,setDraft]=useState<number|null>(null),pending=useRef<number|null>(null),dragging=useRef(false),revision=useRef(0)
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null),seek=useRef(onSeek);seek.current=onSeek
  const clearTimer=()=>{if(timer.current)clearTimeout(timer.current);timer.current=null}
  const cancel=()=>{clearTimer();pending.current=null;dragging.current=false;revision.current++;setDraft(null)}
  const commit=async()=>{
    clearTimer();dragging.current=false
    const value=pending.current;if(value===null)return
    pending.current=null;const request=++revision.current
    try{await seek.current(value)}finally{if(request===revision.current)setDraft(null)}
  }
  const latestCommit=useRef(commit);latestCommit.current=commit
  useEffect(()=>{cancel()},[trackKey])
  useEffect(()=>{
    const end=()=>{if(dragging.current)void latestCommit.current().catch(()=>{})}
    const hidden=()=>{if(document.hidden)cancel()}
    window.addEventListener('pointerup',end);window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',hidden)
    return()=>{clearTimer();window.removeEventListener('pointerup',end);window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',hidden)}
  },[])
  const value=Math.max(0,Math.min(draft??position,duration||1))
  return {value,handlers:{
    onChange:(event:ChangeEvent<HTMLInputElement>)=>{revision.current++;pending.current=Number(event.currentTarget.value);setDraft(pending.current);if(!dragging.current){clearTimer();timer.current=setTimeout(()=>void latestCommit.current().catch(()=>{}),120)}},
    onPointerDown:(event:PointerEvent<HTMLInputElement>)=>{revision.current++;dragging.current=true;try{event.currentTarget.setPointerCapture(event.pointerId)}catch{}},
    onPointerUp:()=>{void commit().catch(()=>{})},onPointerCancel:cancel,
    onLostPointerCapture:()=>{if(dragging.current)void commit().catch(()=>{})},onBlur:()=>{void commit().catch(()=>{})},
    onKeyUp:(event:KeyboardEvent<HTMLInputElement>)=>{if(['ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key))void commit().catch(()=>{})},
    onKeyDown:(event:KeyboardEvent<HTMLInputElement>)=>{if(event.key==='Escape')cancel()}
  }}
}
