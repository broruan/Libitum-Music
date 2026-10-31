import type { Collection, CollectionKind, Stream, Track } from '../shared/types'
import { MusicError } from '../shared/errors'

type Raw = Record<string, any>
export function imageUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href.replace(/^http:/, 'https:') : '' } catch { return '' }
}
export function normalizeTrack(raw: Raw): Track {
  const album = raw.al || raw.album || {}
  return {
    provider: 'netease', id: String(raw.id), title: raw.name || '未知歌曲',
    artists: (raw.ar || raw.artists || []).map((artist: Raw) => ({ provider: 'netease', id: String(artist.id), name: artist.name || '未知歌手', coverUrl: imageUrl(artist.picUrl) })),
    album: { id: String(album.id || ''), title: album.name || '未知专辑' },
    coverUrl: imageUrl(album.picUrl || raw.picUrl), durationMs: Number(raw.dt || raw.duration || 0)
  }
}
export function normalizeCollection(raw: Raw, kind: CollectionKind, userId = ''): Collection {
  const creator = raw.creator || raw.artist || {}
  return {
    provider: 'netease', id: String(raw.id), kind, title: raw.name || '未命名',
    coverUrl: imageUrl(raw.coverImgUrl || raw.picUrl || raw.img1v1Url), description: raw.description || raw.briefDesc || '',
    creatorName: creator.nickname || creator.name || (raw.artists || []).map((a: Raw) => a.name).join(' / '),
    trackCount: Number(raw.trackCount || raw.size || raw.musicSize || 0), subscribed: Boolean(raw.subscribed),
    owned: Boolean(userId && String(raw.creator?.userId) === userId)
  }
}
export function normalizeStream(raw: Raw | null | undefined): Stream {
  if (!raw?.url) throw new MusicError('UNAVAILABLE', '这首歌曲暂时无法获取音频，可能需要会员或受版权限制。')
  let url: URL
  try { url = new URL(raw.url) } catch { throw new MusicError('UNAVAILABLE', '音频地址无效，请重试。') }
  if (!['https:', 'http:'].includes(url.protocol)) throw new MusicError('UNAVAILABLE', '音频地址协议不受支持。')
  return { url: url.href, quality: String(raw.level || ''), bitrate: Number(raw.br || 0), format: String(raw.type || '').toLowerCase(), size: Number(raw.size || 0), trial: Boolean(raw.freeTrialInfo && raw.freeTrialInfo !== 'null') }
}
