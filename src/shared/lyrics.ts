export interface LyricLine { time: number; text: string }
export function parseLyrics(input: string): LyricLine[] {
  const lines: LyricLine[] = []
  const offset = Number(input.match(/\[offset:([+-]?\d+)\]/)?.[1] || 0) / 1000
  for (const row of input.split('\n')) {
    const stamps = [...row.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]
    const text = row.replace(/\[[^\]]*\]/g, '').trim()
    for (const stamp of stamps) lines.push({ time: Math.max(0, Number(stamp[1]) * 60 + Number(stamp[2]) + offset), text })
  }
  return lines.sort((a, b) => a.time - b.time)
}
