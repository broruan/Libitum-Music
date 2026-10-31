import type { RepeatMode } from '../shared/types'
export function nextIndex(index: number, length: number, repeat: RepeatMode, ended: boolean, random = Math.random): number {
  if (!length) return -1
  if (repeat === 'one' && ended) return index
  if (repeat === 'shuffle' && length > 1) return (index + 1 + Math.floor(random() * (length - 1))) % length
  return (index + 1) % length
}
