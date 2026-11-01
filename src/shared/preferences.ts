import type { ExperienceSettings } from './types'
import { defaultPeq, validPeq } from './peq'
export function experienceDefaults(): ExperienceSettings {
  return { commentsEnabled: true, autoWallpaperText: false, backgroundColor: '', fontColor: '', fontFamily: '', rotateCover: false, visualMode: 'cover', wallpaperScope: 'player', wallpaper: null, wallpaperBrightness: 0.45, wallpaperOverlay: 0.2, wallpaperBlur: 12, panelBlur: 12, panelOpacity: 0.96, floatingOpacity: 0.96, floatingEnabled: false, peq: defaultPeq(), spectrum: { enabled: false, color: '#ef6079', secondaryColor: '#9975e8', gradient: true } }
}
export function normalizeExperience(value: any): ExperienceSettings {
  const defaults = experienceDefaults(), result = { ...defaults }
  for (const key of ['commentsEnabled', 'autoWallpaperText', 'rotateCover', 'floatingEnabled'] as const) if (typeof value?.[key] === 'boolean') result[key] = value[key]
  for(const key of ['backgroundColor','fontColor'] as const) if(typeof value?.[key]==='string'&&(/^#[a-f0-9]{6}$/i.test(value[key])||value[key]==='')) result[key]=value[key]
  if(typeof value?.fontFamily==='string'&&value.fontFamily.length<=120&&/^[\p{L}\p{N} .,_'-]*$/u.test(value.fontFamily)) result.fontFamily=value.fontFamily
  if (['cover', 'wallpaper'].includes(value?.visualMode)) result.visualMode = value.visualMode
  if (['player', 'app'].includes(value?.wallpaperScope)) result.wallpaperScope = value.wallpaperScope
  if (Number.isFinite(value?.wallpaperBrightness)) result.wallpaperBrightness = Math.max(0.1, Math.min(1, value.wallpaperBrightness))
  if (Number.isFinite(value?.wallpaperOverlay)) result.wallpaperOverlay = Math.max(0, Math.min(0.9, value.wallpaperOverlay))
  if (Number.isFinite(value?.wallpaperBlur)) result.wallpaperBlur = Math.max(0, Math.min(40, value.wallpaperBlur))
  if (Number.isFinite(value?.panelBlur)) result.panelBlur = Math.max(0, Math.min(30, value.panelBlur))
  if (Number.isFinite(value?.panelOpacity)) result.panelOpacity = Math.max(0, Math.min(1, value.panelOpacity))
  if (Number.isFinite(value?.floatingOpacity)) result.floatingOpacity = Math.max(0, Math.min(1, value.floatingOpacity))
  if (value?.wallpaper && /^[a-f0-9-]{36}\.(?:png|jpg|webp|gif|bmp|avif|mp4)$/.test(value.wallpaper.id) && ['image', 'video'].includes(value.wallpaper.kind) && typeof value.wallpaper.name === 'string') result.wallpaper = value.wallpaper
  if (validPeq(value?.peq)) result.peq = value.peq
  if (value?.spectrum && typeof value.spectrum.enabled === 'boolean' && typeof value.spectrum.gradient === 'boolean' && /^#[0-9a-f]{6}$/i.test(value.spectrum.color) && /^#[0-9a-f]{6}$/i.test(value.spectrum.secondaryColor)) result.spectrum = value.spectrum
  const b = value?.floatingBounds
  if (b && ['x','y','width','height'].every(k => Number.isFinite(b[k])) && b.width >= 280 && b.width <= 800 && b.height >= 64 && b.height <= 500) result.floatingBounds = b
  return result
}
