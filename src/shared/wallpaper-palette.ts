export type Rgb = [number, number, number]
export interface WallpaperPalette {
  ink: 'light' | 'dark'; primary: string; secondary: string; accent: string
  veil: string; opacity: number; dominant: Rgb
}
export const SAFE_WALLPAPER_PALETTE: WallpaperPalette = {ink:'dark',primary:'#151923',secondary:'#252b35',accent:'#62303a',veil:'255 255 255',opacity:0.86,dominant:[128,128,128]}
export function luminance(rgb: Rgb) {
  return rgb.map(n=>n/255).map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[0.2126,0.7152,0.0722][i],0)
}
export function contrast(a:Rgb,b:Rgb) { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05) }
export function mix(a:Rgb,b:Rgb,amount:number):Rgb { return a.map((n,i)=>n*(1-amount)+b[i]*amount) as Rgb }
function hue([red,green,blue]:Rgb) {
  const r=red/255,g=green/255,b=blue/255,max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min
  if(d<0.06)return 354
  return ((max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4)*60)%360
}
function hsl(h:number,s:number,l:number):Rgb {
  const a=s*Math.min(l,1-l),f=(n:number)=>{const k=(n+h/30)%12;return Math.round((l-a*Math.max(-1,Math.min(k-3,9-k,1)))*255)}
  return [f(0),f(8),f(4)]
}
const hex=(c:Rgb)=>'#'+c.map(n=>Math.round(n).toString(16).padStart(2,'0')).join('')
/** Only a tiny local frame sample is processed. No image data is persisted or uploaded. */
export function wallpaperPalette(pixels:ArrayLike<number>,brightness:number,overlay:number,previous?:WallpaperPalette,manualColor?:string):WallpaperPalette {
  if(!Number.isFinite(brightness)||!Number.isFinite(overlay))return SAFE_WALLPAPER_PALETTE
  const samples:Rgb[]=[],buckets=new Map<number,{count:number;sum:Rgb}>()
  for(let i=0;i+3<pixels.length;i+=4){
    const alpha=pixels[i+3]/255
    const raw=mix([22,25,35],[pixels[i],pixels[i+1],pixels[i+2]],alpha)
    samples.push(mix(raw.map(n=>Math.min(255,n*brightness)) as Rgb,[21,26,45],overlay))
    const key=(Math.floor(raw[0]/32)<<6)+(Math.floor(raw[1]/32)<<3)+Math.floor(raw[2]/32),bucket=buckets.get(key)||{count:0,sum:[0,0,0] as Rgb}
    bucket.count++;bucket.sum=bucket.sum.map((n,j)=>n+raw[j]) as Rgb;buckets.set(key,bucket)
  }
  if(!samples.length)return SAFE_WALLPAPER_PALETTE
  const top=[...buckets.values()].sort((a,b)=>b.count-a.count)[0],dominant=top.sum.map(n=>Math.round(n/top.count)) as Rgb
  const candidates=(['light','dark'] as const).map(ink=>{
    const custom=manualColor&&/^#[0-9a-f]{6}$/i.test(manualColor)?[1,3,5].map(i=>parseInt(manualColor.slice(i,i+2),16)) as Rgb:null
    const foreground:Rgb=custom||(ink==='light'?[250,251,255]:[21,25,35]),secondary:Rgb=custom||(ink==='light'?[235,238,244]:[37,43,53])
    const accent=custom||hsl(hue(dominant),ink==='light'?0.7:0.55,ink==='light'?0.84:0.23),veil:Rgb=ink==='light'?[12,17,25]:[255,255,255]
    const values=[foreground,secondary,accent].map(luminance),min=Math.min(...values),max=Math.max(...values)
    const works=(opacity:number)=>samples.every(sample=>{const bg=luminance(mix(sample,veil,opacity));return ink==='light'?(min+0.05)/(bg+0.05)>=4.5:(bg+0.05)/(max+0.05)>=4.5})
    let low=0.06,high=1
    if(!works(low)){for(let i=0;i<8;i++){const middle=(low+high)/2;if(works(middle))high=middle;else low=middle}}else high=low
    const opacity=Math.min(1,Math.ceil(high*100)/100)
    return {ink,primary:hex(foreground),secondary:hex(secondary),accent:hex(accent),veil:veil.join(' '),opacity:opacity,dominant}
  })
  const best=candidates[0].opacity<candidates[1].opacity?candidates[0]:candidates[1],old=candidates.find(c=>c.ink===previous?.ink)
  return !manualColor&&old&&old.opacity<=best.opacity+0.1?old:best
}
