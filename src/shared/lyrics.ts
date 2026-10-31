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
export interface LyricGroup extends LyricLine { translation: string }
export function lyricGroups(original:string,translation:string):LyricGroup[] {
  const groups:LyricGroup[]=[],translated=parseLyrics(translation)
  for(const line of parseLyrics(original)){
    const previous=groups.at(-1)
    if(previous?.time===line.time)previous.text+='\n'+line.text
    else groups.push({...line,translation:translated.filter(t=>Math.abs(t.time-line.time)<0.3).map(t=>t.text).join('\n')})
  }
  return groups
}
export function lyricIndex(lines:LyricLine[],position:number){
  let low=0,high=lines.length
  while(low<high){const mid=(low+high)>>>1;if(lines[mid].time<=position)low=mid+1;else high=mid}
  return low-1
}
