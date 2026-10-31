import type { ExperienceSettings } from './types'
import { defaultPeq, validPeq } from './peq'
export function experienceDefaults(): ExperienceSettings {
  return { commentsEnabled: true, rotateCover: false, visualMode: 'cover', wallpaperScope: 'player', wallpaper: null, wallpaperBrightness: 0.45, wallpaperOverlay: 0.2, wallpaperBlur: 12, floatingEnabled: false, peq: defaultPeq(), spectrum: { enabled: false, color: '#ef6079', secondaryColor: '#9975e8', gradient: true } }
}
export function normalizeExperience(value: any): ExperienceSettings {
  const defaults = experienceDefaults(), result = { ...defaults }
  for (const key of ['commentsEnabled', 'rotateCover', 'floatingEnabled'] as const) if (typeof value?.[key] === 'boolean') result[key] = value[key]
  if (['cover', 'wallpaper'].includes(value?.visualMode)) result.visualMode = value.visualMode
  if (['player', 'app'].includes(value?.wallpaperScope)) result.wallpaperScope = value.wallpaperScope
  if (Number.isFinite(value?.wallpaperBrightness)) result.wallpaperBrightness = Math.max(0.1, Math.min(1, value.wallpaperBrightness))
  if (Number.isFinite(value?.wallpaperOverlay)) result.wallpaperOverlay = Math.max(0, Math.min(0.9, value.wallpaperOverlay))
  if (Number.isFinite(value?.wallpaperBlur)) result.wallpaperBlur = Math.max(0, Math.min(40, value.wallpaperBlur))
  if (value?.wallpaper && /^[a-f0-9-]{36}\.(?:png|jpg|webp|gif|bmp|avif|mp4)$/.test(value.wallpaper.id) && ['image', 'video'].includes(value.wallpaper.kind) && typeof value.wallpaper.name === 'string') result.wallpaper = value.wallpaper
  if (validPeq(value?.peq)) result.peq = value.peq
  if (value?.spectrum && typeof value.spectrum.enabled === 'boolean' && typeof value.spectrum.gradient === 'boolean' && /^#[0-9a-f]{6}$/i.test(value.spectrum.color) && /^#[0-9a-f]{6}$/i.test(value.spectrum.secondaryColor)) result.spectrum = value.spectrum
  const b = value?.floatingBounds
  if (b && ['x','y','width','height'].every(k => Number.isFinite(b[k])) && b.width >= 300 && b.width <= 800 && b.height >= 120 && b.height <= 500) result.floatingBounds = b
  return result
}
