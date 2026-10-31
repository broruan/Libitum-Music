import {describe,expect,it} from 'vitest'
import {contrast,minimumContrast,mix,parseColor,wallpaperPalette,paletteForSamples,type Rgb} from '../../src/shared/wallpaper-palette'
const pixels=(colors:Rgb[])=>Uint8ClampedArray.from(colors.flatMap(c=>[...c,255]))
describe('local foreground-only wallpaper analysis',()=>{
 it('uses dark ink on white and light ink on black without a veil',()=>{
  for(const [color,ink] of [[[255,255,255],'dark'],[[0,0,0],'light']] as [Rgb,string][]){const p=wallpaperPalette(pixels([color]),1,0);expect(p.ink).toBe(ink);expect(p.samples).toEqual([color]);expect(p).not.toHaveProperty('veil');for(const c of [p.primary,p.secondary,p.accent])expect(minimumContrast(c,p.samples)).toBeGreaterThanOrEqual(4.5)}
 })
 it('retains the dominant hue when it is readable',()=>{
  const p=wallpaperPalette(pixels([[30,80,180],[30,80,180]]),1,0)
  expect(p.dominant).toEqual([30,80,180]);expect(parseColor(p.accent)[2]).toBeGreaterThan(parseColor(p.accent)[0])
 })
 it('leaves mixed backgrounds unchanged even when one foreground cannot reach 4.5 everywhere',()=>{
  const colors:Rgb[]=[[0,0,0],[255,255,255]],p=wallpaperPalette(pixels(colors),1,0)
  expect(p.samples).toEqual(colors);expect(minimumContrast(p.primary,p.samples)).toBeLessThan(4.5)
 })
 it('only accounts for explicit brightness and overlay, and handles panel compositing separately',()=>{
  const p=wallpaperPalette(pixels([[200,100,50]]),.5,.2)
  expect(p.samples[0]).toEqual(mix([100,50,25],[21,26,45],.2))
  const panel=paletteForSamples(p.samples.map(s=>mix(s,[255,255,255],.96)),p.dominant)
  expect(panel.ink).toBe('dark');expect(p.ink).toBe('light')
  expect(contrast(parseColor('#ffffff'),[255,255,255])).toBe(1)
 })
 it('provides a sample fallback and hysteresis without persisting or synthesizing pixels',()=>{
  expect(wallpaperPalette([],1,0).samples).toEqual([[22,25,35]])
  const first=wallpaperPalette(pixels([[50,60,70]]),1,0)
  expect(wallpaperPalette(pixels([[55,65,75]]),1,0,first).ink).toBe(first.ink)
 })
})
