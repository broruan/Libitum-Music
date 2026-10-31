import { MusicError } from '../shared/errors'
import type { CollectionKind, Detail, HomeResult, HomeSection, LibraryKind, LibraryResult, Lyrics, Quality, RadioSpec, SearchKind, SearchResult, Stream, Track, User } from '../shared/types'
import { normalizeCollection, normalizeStream, normalizeTrack } from './normalize'
import { mergeCookies, neteaseError } from './netease-errors'
import { createHash } from 'node:crypto'
import { ReadRequests, requestPolicy, type RequestPolicyOptions } from './request-policy'

type ApiResult = { body: Record<string, any>; cookie?: string[]; status?: number }
export type ApiModule = Record<string, (params: Record<string, unknown>) => Promise<ApiResult>>
export interface ProviderOptions extends RequestPolicyOptions { clientCookie?: string; beforeRequest?: (name: string) => Promise<void> }
export interface MusicProvider {
  search(keywords: string, kind: SearchKind, offset: number): Promise<SearchResult>
  detail(kind: CollectionKind, id: string, offset: number): Promise<Detail>
  allTracks(kind: CollectionKind, id: string): Promise<Track[]>
  home(section: HomeSection): Promise<HomeResult>
  library(kind: LibraryKind, offset: number): Promise<LibraryResult>
  resolve(id: string, quality: Quality, download?: boolean): Promise<Stream>
  radio(spec: RadioSpec): Promise<Track[]>
}
export class NeteaseProvider implements MusicProvider {
  private cookie = ''
  private user: User | null = null
  private likes: string[] | null = null
  private generation = 0
  private qr: { key: string; cookie: string; expiresAt: number; candidate?: string } | null = null
  private qrStarting: Promise<{ key: string; dataUrl: string }> | null = null
  private qrChecking: { key: string; promise: Promise<any> } | null = null
  private qrStartAfter = 0
  private reads: ReadRequests<ApiResult>
  private guestCookie: string
  constructor(private api: ApiModule, private options: ProviderOptions = {}) {
    this.reads = new ReadRequests(options)
    this.guestCookie = options.clientCookie || ''
  }
  setSession(cookie: string, user: User | null) { this.generation++; this.reads.clear(); this.cookie = cookie; this.user = user; this.likes = null; this.qr = null }
  private requireUser() { if (!this.user) throw new MusicError('AUTH_REQUIRED', '请先登录网易云音乐账号。'); return this.user }
  async request(name: string, params: Record<string, unknown> = {}, options: { auth?: boolean; cookie?: string; raw?: boolean } = {}): Promise<ApiResult> {
    if (options.auth) this.requireUser()
    if (typeof this.api[name] !== 'function') throw new MusicError('UNSUPPORTED', '当前接口版本不支持此功能。')
    const cookie = mergeCookies(this.options.clientCookie || '', options.cookie ?? (this.cookie || this.guestCookie))
    const policy = requestPolicy(name, params)
    const key = JSON.stringify([this.generation, name, params, options.raw, createHash('sha256').update(options.cookie ?? this.cookie).digest('hex')])
    return this.reads.run(key, policy, () => this.requestOnce(name, params, options, cookie))
  }
  private async requestOnce(name: string, params: Record<string, unknown>, options: { cookie?: string; raw?: boolean }, cookie: string): Promise<ApiResult> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (this.options.beforeRequest) await this.options.beforeRequest(name)
      const result = await Promise.race([
        this.api[name]({ ...params, cookie, timestamp: Date.now(), timeout: 6000 }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new MusicError('NETWORK', '请求超时，请稍后重试。')), 8000) })
      ])
      const code = Number(result.body?.code ?? result.status ?? 200)
      if (!options.raw && code !== 200) {
        throw neteaseError(result)
      }
      if (!this.user && options.cookie === undefined && Array.isArray(result.cookie)) this.guestCookie = mergeCookies(this.guestCookie, result.cookie.filter(value => !/^\s*(?:MUSIC_U|__csrf)=/i.test(value)))
      return result
    } catch (error) {
      if (error instanceof MusicError) throw error
      throw neteaseError(error)
    } finally { if (timer) clearTimeout(timer) }
  }
  async validateCookie(cookie: string): Promise<User> {
    const { body } = await this.request('login_status', {}, { cookie })
    const data = body.data || body
    let profile = data.profile
    if (!profile && data.account?.id) profile = (await this.request('user_detail', { uid: data.account.id }, { cookie })).body.profile
    if (!profile?.userId) throw new MusicError('AUTH_EXPIRED', 'Cookie 无效或已经过期，请重新导入。')
    return { id: String(profile.userId), nickname: profile.nickname || '网易云用户', avatarUrl: String(profile.avatarUrl || '').replace(/^http:/, 'https:') }
  }
  qrStart() {
    if (this.qrStarting) return this.qrStarting
    if (Date.now() < this.qrStartAfter) return Promise.reject(new MusicError('LOGIN_COOLDOWN', '请稍等片刻再生成二维码，避免频繁登录。'))
    this.qrStartAfter = Date.now() + 10000
    this.qr = null
    this.qrStarting = this.createQr().finally(() => { this.qrStarting = null })
    return this.qrStarting
  }
  private async createQr() {
    const { body: keyBody, cookie: cookies } = await this.request('login_qr_key', {}, { cookie: '' })
    const key = String(keyBody.data?.unikey || keyBody.unikey || '')
    if (!key) throw new MusicError('UPSTREAM', '暂时无法生成登录二维码，请重试。')
    const cookie = mergeCookies('', cookies)
    const { body } = await this.request('login_qr_create', { key, qrimg: true }, { cookie })
    const dataUrl = body.data?.qrimg || body.qrimg
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) throw new MusicError('UPSTREAM', '二维码生成失败，请重试。')
    this.qr = { key, cookie, expiresAt: Date.now() + 180000 }
    return { key, dataUrl }
  }
  qrCancel(key: string) { if (this.qr?.key === key) this.qr = null }
  qrCheck(key: string) {
    if (this.qrChecking?.key === key) return this.qrChecking.promise
    const promise = this.checkQr(key).catch(error => {
      if (error instanceof MusicError && error.code === 'RISK_BLOCKED') {
        this.qrCancel(key)
        this.qrStartAfter = Math.max(this.qrStartAfter, Date.now() + 60000)
      }
      throw error
    }).finally(() => { if (this.qrChecking?.promise === promise) this.qrChecking = null })
    this.qrChecking = { key, promise }
    return promise
  }
  private async checkQr(key: string) {
    const flow = this.qr
    if (!flow || flow.key !== key || flow.expiresAt <= Date.now()) return { state: 'expired' as const }
    if (flow.candidate) return this.finishQr(flow, flow.candidate)
    // The dependency's login_qr_check catch block references an out-of-scope
    // variable. Use its supported generic API wrapper for this fixed endpoint.
    const { body, cookie: responseCookies } = await this.request('api', { uri: '/api/login/qrcode/client/login', data: { key, type: 3 } }, { cookie: flow.cookie, raw: true })
    if (this.qr !== flow) return { state: 'expired' as const }
    flow.cookie = mergeCookies(flow.cookie, responseCookies)
    const code = Number(body.code)
    if (code === 800) { this.qr = null; return { state: 'expired' as const } }
    if (code === 801) return { state: 'waiting' as const }
    if (code === 802) return { state: 'confirm' as const }
    if (code !== 803) throw neteaseError({ body })
    const cookie = mergeCookies(flow.cookie, typeof body.cookie === 'string' ? body.cookie : undefined)
    if (!/(?:^|;\s*)MUSIC_U=.+/.test(cookie)) throw new MusicError('UPSTREAM', '登录凭证未返回，请稍后重试。')
    flow.candidate = cookie
    return this.finishQr(flow, cookie)
  }
  private async finishQr(flow: NonNullable<NeteaseProvider['qr']>, cookie: string) {
    const user = await this.validateCookie(cookie)
    if (this.qr !== flow) return { state: 'expired' as const }
    this.qr = null
    return { state: 'success' as const, cookie, user }
  }
  async search(keywords: string, kind: SearchKind, offset: number): Promise<SearchResult> {
    const types = { song: 1, album: 10, artist: 100, playlist: 1000 }
    const args = { keywords, type: types[kind], limit: 30, offset }
    let response: ApiResult
    try { response = await this.request('cloudsearch', args) }
    catch (error) {
      if (!(error instanceof MusicError) || !['NETWORK', 'UPSTREAM'].includes(error.code) || typeof this.api.search !== 'function') throw error
      response = await this.request('search', args)
    }
    const { body } = response
    const result = body.result || {}
    const total = Number(result.songCount ?? result.albumCount ?? result.artistCount ?? result.playlistCount ?? 0)
    return { tracks: (result.songs || []).map(normalizeTrack), collections: (result.albums || result.artists || result.playlists || []).map((raw: any) => normalizeCollection(raw, kind === 'song' ? 'album' : kind, this.user?.id)), total }
  }
  async detail(kind: CollectionKind, id: string, offset = 0): Promise<Detail> {
    if (kind === 'album') {
      const { body } = await this.request('album', { id })
      const dynamic = this.user ? (await this.request('album_detail_dynamic', { id }, { auth: true })).body : null
      return { collection: normalizeCollection({ ...body.album, subscribed: Boolean(dynamic?.isSub) }, kind, this.user?.id), tracks: (body.songs || []).map(normalizeTrack), total: body.songs?.length || 0 }
    }
    if (kind === 'artist') {
      const { body } = await this.request('artists', { id })
      return { collection: normalizeCollection(body.artist, kind), tracks: (body.hotSongs || []).map(normalizeTrack), total: body.hotSongs?.length || 0 }
    }
    // Request only the first page's tracks; full IDs remain available for pagination.
    const { body } = await this.request('api', { uri: '/api/v6/playlist/detail', crypto: 'weapi', data: { id, n: 100, s: 0 } })
    const playlist = body.playlist
    if (!playlist) throw new MusicError('UNAVAILABLE', '歌单不存在或无法访问。')
    const ids = (playlist.trackIds || []).slice(offset, offset + 100).map((t: any) => t.id)
    const included = new Map<string, any>((playlist.tracks || []).map((track: any) => [String(track.id), track]))
    const missing = ids.filter((trackId: string | number) => !included.has(String(trackId)))
    if (missing.length) for (const track of (await this.request('song_detail', { ids: missing.join(',') })).body.songs || []) included.set(String(track.id), track)
    const tracks = ids.length ? ids.map((trackId: string | number) => included.get(String(trackId))).filter(Boolean) : (playlist.tracks || []).slice(offset, offset + 100)
    return { collection: normalizeCollection(playlist, kind, this.user?.id), tracks: tracks.map(normalizeTrack), total: Number(playlist.trackCount || playlist.trackIds?.length || tracks.length) }
  }
  async allTracks(kind: CollectionKind, id: string): Promise<Track[]> {
    const first = await this.detail(kind, id, 0)
    const tracks = first.tracks
    if (kind === 'playlist') {
      for (let offset = 100; offset < first.total; offset += 100) {
        const page = await this.detail(kind, id, offset)
        if (!page.tracks.length) break
        tracks.push(...page.tracks)
      }
    }
    return [...new Map(tracks.map(track => [track.id, track])).values()]
  }
  async home(section: HomeSection): Promise<HomeResult> {
    if (section === 'daily') {
      const { body } = await this.request('recommend_songs', {}, { auth: true })
      return { tracks: (body.data?.dailySongs || body.recommend || []).map(normalizeTrack), collections: [] }
    }
    if (section === 'recommended') {
      const { body } = this.user ? await this.request('recommend_resource', {}, { auth: true }) : await this.request('personalized', { limit: 10 })
      return { tracks: [], collections: (body.recommend || body.result || []).slice(0, 10).map((raw: any) => normalizeCollection(raw, 'playlist', this.user?.id)) }
    }
    const { body } = await this.request(section === 'charts' ? 'toplist' : 'album_new', { limit: 10 })
    return { tracks: [], collections: (body.list || body.albums || []).slice(0, 10).map((raw: any) => normalizeCollection(raw, section === 'charts' ? 'playlist' : 'album', this.user?.id)) }
  }
  private async likedIds() {
    const user = this.requireUser()
    const generation = this.generation
    if (!this.likes) {
      const response = await this.request('likelist', { uid: user.id }, { auth: true })
      if (generation !== this.generation) throw new MusicError('SESSION_CHANGED', '账号已改变，请重新加载。')
      this.likes = (response.body.ids || []).map(String)
    }
    return this.likes!
  }
  async library(kind: LibraryKind, offset: number): Promise<LibraryResult> {
    const user = this.requireUser()
    if (kind === 'likes') {
      const ids = await this.likedIds()
      const page = ids.slice(offset, offset + 50)
      const { body } = page.length ? await this.request('song_detail', { ids: page.join(',') }) : { body: { songs: [] } }
      const songs = new Map<string, Track>((body.songs || []).map((s: any) => { const track = normalizeTrack(s); return [track.id, track] }))
      return { tracks: page.map(id => songs.get(id)).filter((t): t is Track => !!t), collections: [], total: ids.length, likedIds: ids }
    }
    const { body } = await this.request(kind === 'albums' ? 'album_sublist' : 'user_playlist', { uid: user.id, limit: 50, offset }, { auth: true })
    const raw = body.data || body.playlist || []
    return { tracks: [], collections: raw.map((item: any) => normalizeCollection({ ...item, subscribed: kind === 'albums' || Boolean(item.subscribed) }, kind === 'albums' ? 'album' : 'playlist', user.id)), total: Number(body.count || (body.more ? offset + 51 : offset + raw.length)), likedIds: await this.likedIds() }
  }
  async like(id: string, like: boolean) {
    await this.request('like', { id, like }, { auth: true })
    this.reads.clear()
    if (this.likes) this.likes = like ? [...new Set([id, ...this.likes])] : this.likes.filter(value => value !== id)
  }
  async subscribe(kind: 'album' | 'playlist', id: string, subscribe: boolean) {
    await this.request(kind === 'album' ? 'album_sub' : 'playlist_subscribe', { id, t: subscribe ? 1 : 2 }, { auth: true })
    this.reads.clear()
  }
  async resolve(id: string, quality: Quality, download = false): Promise<Stream> {
    const { body } = await this.request(download ? 'song_download_url_v1' : 'song_url_v1', { id, level: quality, unblock: 'false' }, { auth: download })
    return normalizeStream(Array.isArray(body.data) ? body.data[0] : body.data)
  }
  async lyrics(id: string): Promise<Lyrics> {
    const { body } = await this.request('lyric', { id })
    return { original: body.lrc?.lyric || '', translated: body.tlyric?.lyric || '' }
  }
  async radio(spec: RadioSpec): Promise<Track[]> {
    const { body } = await this.request(spec.mode === 'FM' ? 'personal_fm' : 'personal_fm_mode', spec.mode === 'FM' ? {} : { mode: spec.mode, submode: spec.scene, limit: 5 }, { auth: true })
    const raw = Array.isArray(body.data) ? body.data : body.data?.songs || body.data?.resources || body.songs || []
    const tracks = raw.map((entry: any) => normalizeTrack(entry.song || entry)).filter((track: Track) => track.id && track.id !== 'undefined')
    if (!tracks.length) throw new MusicError('UNAVAILABLE', '当前推荐模式暂未返回歌曲，请稍后重试或选择其他模式。')
    return tracks
  }
  async dislike(id: string) { await this.request('fm_trash', { id }, { auth: true }) }
  async scrobble(id: string, seconds: number) { if (this.user && seconds >= 10) await this.request('scrobble', { id, time: Math.floor(seconds), sourceid: 0 }, { auth: true }) }
}
