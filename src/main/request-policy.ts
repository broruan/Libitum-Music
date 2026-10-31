import { MusicError } from '../shared/errors'

const READS = new Set(['cloudsearch', 'search', 'playlist_detail', 'song_detail', 'album', 'artists', 'album_detail_dynamic', 'toplist', 'album_new', 'personalized', 'lyric', 'likelist', 'user_playlist', 'album_sublist', 'recommend_resource', 'recommend_songs', 'user_detail', 'song_url_v1', 'song_download_url_v1'])
const CACHE_MS: Record<string, number> = { cloudsearch: 30000, search: 30000, playlist_detail: 60000, song_detail: 120000, album: 60000, artists: 60000, toplist: 120000, album_new: 120000, personalized: 60000, lyric: 300000 }
export function requestPolicy(name: string, params: Record<string, unknown>) {
  const playlist = name === 'api' && params.uri === '/api/v6/playlist/detail'
  return { retry: READS.has(name) || playlist, cacheMs: playlist ? 60000 : CACHE_MS[name] || 0 }
}
export interface RequestPolicyOptions {
  now?: () => number
  wait?: (ms: number) => Promise<void>
}
/** Retries only explicit reads; credentials, mutations and radio consumption are excluded. */
export class ReadRequests<T> {
  private cache = new Map<string, { expires: number; value: T }>()
  private pending = new Map<string, Promise<T>>()
  private epoch = 0
  private now: () => number
  private wait: (ms: number) => Promise<void>
  constructor(options: RequestPolicyOptions = {}) {
    this.now = options.now || Date.now
    this.wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  }
  clear() { this.epoch++; this.cache.clear(); this.pending.clear() }
  run(key: string, policy: { retry: boolean; cacheMs: number }, operation: () => Promise<T>): Promise<T> {
    if (!policy.retry) return operation()
    const cached = this.cache.get(key)
    if (cached && cached.expires > this.now()) return Promise.resolve(structuredClone(cached.value))
    if (cached) this.cache.delete(key)
    const inflight = this.pending.get(key)
    if (inflight) return inflight.then(value => structuredClone(value))
    const epoch = this.epoch
    const task = (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const value = await operation()
          if (epoch === this.epoch && policy.cacheMs) {
            if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!)
            this.cache.set(key, { value: structuredClone(value), expires: this.now() + policy.cacheMs })
          }
          return value
        } catch (error) {
          if (epoch !== this.epoch || attempt >= 2 || !(error instanceof MusicError) || error.code !== 'NETWORK') throw error
          await this.wait([400, 1000][attempt])
          if (epoch !== this.epoch) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新加载。')
        }
      }
    })()
    this.pending.set(key, task)
    void task.finally(() => { if (this.pending.get(key) === task) this.pending.delete(key) }).catch(() => {})
    return task.then(value => structuredClone(value))
  }
}
