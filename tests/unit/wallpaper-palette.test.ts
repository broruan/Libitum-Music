import {describe,expect,it} from 'vitest'
import {contrast,mix,wallpaperPalette,type Rgb} from '../../src/shared/wallpaper-palette'
const pixels=(colors:Rgb[])=>Uint8ClampedArray.from(colors.flatMap(c=>[...c,255]))
const rgb=(s:string):Rgb=>[1,3,5].map(i=>parseInt(s.slice(i,i+2),16)) as Rgb
function readable(colors:Rgb[],brightness=1,overlay=0,manual?:string){
 const palette=wallpaperPalette(pixels(colors),brightness,overlay,undefined,manual),veil=palette.veil.split(' ').map(Number) as Rgb
 for(const source of colors){const visible=mix(mix(source.map(n=>n*brightness) as Rgb,[21,26,45],overlay),veil,palette.opacity);for(const color of [palette.primary,palette.secondary,palette.accent])expect(contrast(rgb(color),visible)).toBeGreaterThanOrEqual(4.5)}
 return palette
}
describe('local wallpaper color analysis',()=>{
 it('uses dark ink on bright pictures and light ink on dark pictures',()=>{
  expect(readable([[255,255,255]]).ink).toBe('dark');expect(readable([[0,0,0]]).ink).toBe('light')
 })
 it('derives an accent from the dominant color with readable contrast',()=>{
  const palette=readable([[30,80,180],[30,80,180],[240,240,255]])
  expect(palette.dominant).toEqual([30,80,180]);expect(rgb(palette.accent)[2]).toBeGreaterThan(rgb(palette.accent)[0])
 })
 it('protects text over mixed, bright and dark areas after brightness and overlay',()=>{
  const colors:Rgb[]=[[255,255,255],[0,0,0],[255,0,0],[0,255,0],[0,0,255],[200,160,30]]
  readable(colors);readable(colors,.45,.2)
 })
 it('keeps a manually chosen foreground and adds an appropriate contrast veil',()=>{
  expect(readable([[0,0,0],[255,255,255]],1,0,'#e0e5ef').primary).toBe('#e0e5ef')
  expect(readable([[255,255,255]],1,0,'#202535').primary).toBe('#202535')
 })
 it('retains a safe palette for empty samples and avoids unnecessary mode switches',()=>{
  expect(wallpaperPalette([],1,0).opacity).toBeGreaterThan(.8)
  const first=wallpaperPalette(pixels([[50,60,70]]),1,0)
  expect(wallpaperPalette(pixels([[55,65,75]]),1,0,first).ink).toBe(first.ink)
 })
})
