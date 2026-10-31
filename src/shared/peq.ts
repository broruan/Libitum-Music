import type { PeqBand, PeqSettings } from './types'
export function defaultPeq(): PeqSettings {
  return { enabled: false, preamp: 0, bands: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map(frequency => ({ enabled: true, type: 'PK', frequency, gain: 0, q: 1 })) }
}
export function validPeq(value: any): value is PeqSettings {
  const range = (n: unknown, a: number, b: number) => typeof n === 'number' && Number.isFinite(n) && n >= a && n <= b
  return !!value && typeof value.enabled === 'boolean' && range(value.preamp, -30, 12) && Array.isArray(value.bands) && value.bands.length === 10 && value.bands.every((b: any) => b && typeof b.enabled === 'boolean' && ['PK', 'LS', 'HS'].includes(b.type) && range(b.frequency, 20, 20000) && range(b.gain, -24, 24) && range(b.q, 0.1, 20))
}
export function parsePeq(text: string): PeqSettings {
  if (text.length > 65536) throw new Error('预设超过 64 KB。')
  let preamp = 0
  const bands: PeqBand[] = []
  const number = '([-+]?\\d+(?:\\.\\d+)?)'
  for (const [index, raw] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = raw.replace(/[#;].*$/, '').trim()
    if (!line) continue
    const pre = line.match(new RegExp(`^Preamp:\\s*${number}\\s*dB$`, 'i'))
    if (pre) { preamp = Number(pre[1]); continue }
    const apo = line.match(new RegExp(`^Filter\\s+\\d+:\\s*(ON|OFF)\\s+(PK|PEQ|LSC?|HSC?)\\s+Fc\\s+${number}\\s*Hz\\s+Gain\\s+${number}\\s*dB\\s+Q\\s+${number}$`, 'i'))
    if (apo) bands.push({ enabled: apo[1].toUpperCase() === 'ON', type: apo[2].toUpperCase().startsWith('LS') ? 'LS' : apo[2].toUpperCase().startsWith('HS') ? 'HS' : 'PK', frequency: Number(apo[3]), gain: Number(apo[4]), q: Number(apo[5]) })
    else {
      const cells = line.split(/[\s,]+/)
      if (/^(frequency|freq|频率)/i.test(line) && !bands.length) continue
      if (cells.length !== 3 || cells.some(c => !/^[-+]?\d+(\.\d+)?$/.test(c))) throw new Error(`第 ${index + 1} 行不是支持的 PEQ 格式。`)
      bands.push({ enabled: true, type: 'PK', frequency: Number(cells[0]), gain: Number(cells[1]), q: Number(cells[2]) })
    }
    if (bands.length > 10) throw new Error('预设超过十段，请先精简后再导入。')
  }
  if (!bands.length) throw new Error('没有找到滤波器。')
  while (bands.length < 10) bands.push({ ...defaultPeq().bands[bands.length], enabled: false })
  const result = { enabled: true, preamp, bands }
  if (!validPeq(result)) throw new Error('参数超出范围：频率 20–20000 Hz，增益 ±24 dB，Q 0.1–20，前级 -30–12 dB。')
  return result
}
/** Numeric-only graph; imported text is never interpreted as a filter command. */
export function peqGraph(settings: PeqSettings, sampleRate = 48000): string {
  if (!validPeq(settings)) throw new Error('PEQ 参数无效。')
  const filters = [`volume=${settings.preamp}dB`]
  for (const band of settings.bands) {
    if (!band.enabled || !band.gain || band.frequency >= sampleRate / 2) continue
    const filter = band.type === 'LS' ? 'bass' : band.type === 'HS' ? 'treble' : 'equalizer'
    filters.push(`${filter}=f=${band.frequency}:t=q:w=${band.q}:g=${band.gain}`)
  }
  return filters.join(',')
}
