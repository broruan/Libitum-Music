import { MusicError } from '../shared/errors'
import type { Album, CollectionKind, CommentPage, Detail, Diagnostic, HomeResult, HomeSection, LibraryKind, LibraryResult, Lyrics, Playlist, Quality, RadioSpec, SearchKind, SearchResult, Stream, SubscriptionResult, Track, User } from '../shared/types'
import { normalizeCollection, normalizeStream, normalizeTrack } from './normalize'
import { mergeCookies, neteaseError } from './netease-errors'
import { createHash } from 'node:crypto'
import { ReadRequests, requestPolicy, type RequestPolicyOptions } from './request-policy'

type ApiResult = { body: Record<string, any>; cookie?: string[]; status?: number }
export type ApiModule = Record<string, (params: Record<string, unknown>) => Promise<ApiResult>>
export interface ProviderOptions extends RequestPolicyOptions { clientCookie?: string; beforeRequest?: (name: string) => Promise<void>; onCredentials?: (cookie: string, user: User) => void }
export interface MusicProvider {
  search(keywords: string, kind: SearchKind, offset: number): Promise<SearchResult>
  detail(kind: CollectionKind, id: string, offset: number): Promise<Detail>
  allTracks(kind: CollectionKind, id: string): Promise<Track[]>
  home(section: HomeSection): Promise<HomeResult>
  library(kind: LibraryKind, offset: number): Promise<LibraryResult>
  resolve(id: string, quality: Quality, download?: boolean): Promise<Stream>
  radio(spec: RadioSpec): Promise<Track[]>
  comments(id: string, offset: number): Promise<CommentPage>
  artistAlbums(id:string,offset:number):Promise<{albums:Album[];more:boolean}>
  writablePlaylists(offset: number): Promise<{ collections: Playlist[]; more: boolean }>
  addToPlaylist(id: string, trackId: string): Promise<{ alreadyPresent: boolean }>
  subscribe(kind: 'album' | 'playlist', id: string, subscribe: boolean): Promise<SubscriptionResult>
  subscription(kind: 'album' | 'playlist', id: string): Promise<SubscriptionResult>
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
  private mutations = new Map<string, Promise<SubscriptionResult>>()
  private uncertain = new Set<string>()
  private diagnosticRecords: Diagnostic[] = []
  private transportWrites = new Map<string, Promise<ApiResult>>()
  private freshRequest(name: string, params: Record<string, unknown>) {
    return this.requestOnce(name, params, {}, mergeCookies(this.options.clientCookie || '', this.cookie))
  }
  constructor(private api: ApiModule, private options: ProviderOptions = {}) {
    this.reads = new ReadRequests(options)
    this.guestCookie = options.clientCookie || ''
  }
  setSession(cookie: string, user: User | null) { this.generation++; this.reads.clear(); this.cookie = cookie; this.user = user; this.likes = null; this.qr = null; this.mutations.clear(); this.uncertain.clear(); this.diagnosticRecords = [] }
  private updateCredentials(cookie: string, generation: number) {
    if (generation !== this.generation || !this.user || cookie === this.cookie) return
    this.cookie = cookie; this.options.onCredentials?.(cookie, this.user)
  }
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
    const generation = this.generation, accountRequest = !!this.user && options.cookie === undefined
    try {
      if (this.options.beforeRequest) await this.options.beforeRequest(name)
      const write = ['album_sub', 'playlist_subscribe', 'like'].includes(name) || name === 'api' && ['/api/playlist/manipulate/tracks','/api/playlist/subscribe','/api/playlist/unsubscribe'].includes(String(params.uri))
      const writeKey = JSON.stringify([generation, name, params])
      let operation = write ? this.transportWrites.get(writeKey) : undefined
      if (!operation) {
        operation = this.api[name]({ ...params, cookie, timestamp: Date.now(), timeout: 6000 })
        if(accountRequest) void operation.then(result=>{if(generation===this.generation)this.updateCredentials(mergeCookies(this.cookie,result.cookie),generation)}).catch(()=>{})
        if (write) {
          this.transportWrites.set(writeKey, operation)
          const current = operation
          void current.finally(() => { if (this.transportWrites.get(writeKey) === current) this.transportWrites.delete(writeKey) }).catch(() => {})
        }
      }
      const result = await Promise.race([
        operation,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new MusicError('NETWORK', '请求超时，请稍后重试。')), 8000) })
      ])
      if (accountRequest && generation === this.generation) this.updateCredentials(mergeCookies(this.cookie, result.cookie), generation)
      const code = Number(result.body?.code ?? result.status ?? 200)
      if (!options.raw && code !== 200) {
        throw neteaseError(result)
      }
      if (!this.user && options.cookie === undefined && Array.isArray(result.cookie)) this.guestCookie = mergeCookies(this.guestCookie, result.cookie.filter(value => !/^\s*(?:MUSIC_U|__csrf)=/i.test(value)))
      return result
    } catch (error) {
      if(accountRequest && generation===this.generation && !(error instanceof MusicError)) this.updateCredentials(mergeCookies(this.cookie,(error as any)?.cookie),generation)
      if (error instanceof MusicError) throw error
      throw neteaseError(error)
    } finally { if (timer) clearTimeout(timer) }
  }
  async validateSession(cookie: string): Promise<{ user: User; cookie: string }> {
    const response = await this.request('login_status', {}, { cookie })
    const body = response.body
    cookie = mergeCookies(cookie, response.cookie)
    const data = body.data || body
    let profile = data.profile
    if (!profile && data.account?.id) {
      const details = await this.request('user_detail', { uid: data.account.id }, { cookie })
      profile = details.body.profile; cookie = mergeCookies(cookie, details.cookie)
    }
    if (!profile?.userId) throw new MusicError('AUTH_EXPIRED', 'Cookie 无效或已经过期，请重新导入。')
    return { cookie, user: { id: String(profile.userId), nickname: profile.nickname || '网易云用户', avatarUrl: String(profile.avatarUrl || '').replace(/^http:/, 'https:') } }
  }
  async validateCookie(cookie: string): Promise<User> { return (await this.validateSession(cookie)).user }
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
      if (error instanceof MusicError && ['RISK_BLOCKED', 'RATE_LIMITED'].includes(error.code)) {
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
    const validated = await this.validateSession(cookie)
    if (this.qr !== flow) return { state: 'expired' as const }
    this.qr = null
    return { state: 'success' as const, ...validated }
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
  async artistAlbums(id:string,offset:number):Promise<{albums:Album[];more:boolean}> {
    const {body}=await this.request('artist_album',{id,offset,limit:30})
    return {albums:(body.hotAlbums||[]).map((album:any)=>normalizeCollection({...album,artist:album.artist||body.artist},'album',this.user?.id) as Album),more:Boolean(body.more)}
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
  diagnostics() { return structuredClone(this.diagnosticRecords) }
  async subscription(kind: 'album' | 'playlist', id: string, acknowledge = true): Promise<SubscriptionResult> {
    this.requireUser()
    const generation = this.generation
    const { body } = kind === 'album' ? await this.freshRequest('album_detail_dynamic', { id }) : await this.freshRequest('api', { uri: '/api/v6/playlist/detail', crypto: 'weapi', data: { id, n: 0, s: 0 } })
    if (generation !== this.generation) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新加载。')
    const value = kind === 'album' ? body.isSub : body.playlist?.subscribed
    if (typeof value !== 'boolean' && ![0, 1].includes(value)) return { subscribed: null, confirmed: false }
    const key = `${generation}:${kind}:${id}`
    if (acknowledge && this.uncertain.has(key)) {
      if (this.transportWrites.size) return { subscribed: null, confirmed: false }
      this.uncertain.delete(key)
    }
    return { subscribed: Boolean(value), confirmed: true }
  }
  subscribe(kind: 'album' | 'playlist', id: string, subscribe: boolean): Promise<SubscriptionResult> {
    this.requireUser()
    const key = `${this.generation}:${kind}:${id}`, pending = this.mutations.get(key)
    if (pending) return pending
    const generation=this.generation
    const task = this.changeSubscription(kind, id, subscribe, key).catch(error=>{
      if(generation===this.generation) {
        const problem=error instanceof MusicError?error:neteaseError(error)
        this.diagnosticRecords=[...this.diagnosticRecords.slice(-19),{operation:subscribe?'subscribe':'unsubscribe',endpoint:kind==='album'?'album_sub':'playlist_subscribe:web',code:problem.upstreamCode===undefined?problem.code:`${problem.code}:${problem.upstreamCode}`,hasCredential:/(?:^|;\s*)MUSIC_U=\S+/.test(this.cookie),hasCsrf:/(?:^|;\s*)__csrf=\S+/.test(this.cookie),time:Date.now()}]
      }
      throw error
    }).finally(() => { if (this.mutations.get(key) === task) this.mutations.delete(key) })
    this.mutations.set(key, task)
    return task
  }
  private async changeSubscription(kind: 'album' | 'playlist', id: string, subscribe: boolean, key: string): Promise<SubscriptionResult> {
    const generation = this.generation
    const endpoint = kind === 'album' ? 'album_sub' : 'api'
    const current = await this.subscription(kind, id, false)
    if (current.confirmed && current.subscribed === subscribe) return current
    if (this.uncertain.has(key)) return { subscribed: null, confirmed: false }
    if (!current.confirmed) throw new MusicError('STATE_UNKNOWN', '暂时无法确认收藏状态，请重新加载后再操作。')
    if (!/(?:^|;\s*)__csrf=\S+/.test(this.cookie)) {
      const validated = await this.validateSession(this.cookie)
      if (generation !== this.generation || validated.user.id !== this.user?.id) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新登录。')
      this.updateCredentials(validated.cookie, generation)
      if (!/(?:^|;\s*)__csrf=\S+/.test(this.cookie)) throw new MusicError('AUTH_INCOMPLETE', '扫码会话缺少 CSRF 字段，请重新扫码登录后再收藏。')
    }
    try {
      // Use the normal web session protocol for both collection types. The
      // dependency's playlist wrapper forces a synthetic anti-cheat SDK flow.
      // Never fall back to another protocol after sending a write.
      await this.request(endpoint, kind==='album'?{id,t:subscribe?1:2}:{uri:`/api/playlist/${subscribe?'subscribe':'unsubscribe'}`,crypto:'weapi',data:{id}}, { auth: true })
    } catch (error) {
      if (generation !== this.generation) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新加载。')
      const problem = error instanceof MusicError ? error : neteaseError(error)
      if (!['NETWORK', 'TIMEOUT'].includes(problem.code)) throw problem
      this.diagnosticRecords=[...this.diagnosticRecords.slice(-19),{operation:subscribe?'subscribe':'unsubscribe',endpoint,code:problem.code,hasCredential:true,hasCsrf:true,time:Date.now()}]
      this.uncertain.add(key)
    }
    if (generation !== this.generation) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新加载。')
    this.reads.clear()
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const confirmed = await this.subscription(kind, id, false)
        if (confirmed.confirmed && confirmed.subscribed === subscribe) { this.uncertain.delete(key); return confirmed }
      } catch (error) {
        if (error instanceof MusicError && ['AUTH_EXPIRED', 'SESSION_CHANGED'].includes(error.code)) throw error
      }
      if (!attempt) await (this.options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms))))(400)
    }
    this.uncertain.add(key)
    return { subscribed: null, confirmed: false }
  }
  async writablePlaylists(offset: number): Promise<{ collections: Playlist[]; more: boolean }> {
    const user = this.requireUser()
    const { body } = await this.request('user_playlist', { uid: user.id, offset, limit: 50 }, { auth: true })
    return { collections: (body.playlist || []).filter((p: any) => String(p.creator?.userId) === user.id && p.specialType !== 5).map((p: any) => normalizeCollection(p, 'playlist', user.id) as Playlist), more: Boolean(body.more) }
  }
  async addToPlaylist(id: string, trackId: string): Promise<{ alreadyPresent: boolean }> {
    const user = this.requireUser(), generation = this.generation
    const { body } = await this.freshRequest('api', { uri: '/api/v6/playlist/detail', crypto: 'weapi', data: { id, n: 0, s: 0 } })
    if (generation !== this.generation) throw new MusicError('SESSION_CHANGED', '账号状态已改变。')
    if (String(body.playlist?.creator?.userId) !== user.id || body.playlist?.specialType === 5) throw new MusicError('FORBIDDEN', '只能加入本人创建的可编辑歌单。')
    if ((body.playlist?.trackIds || []).some((t: any) => String(t.id) === trackId)) return { alreadyPresent: true }
    await this.request('api', { uri: '/api/playlist/manipulate/tracks', crypto: 'weapi', data: { op: 'add', pid: id, trackIds: JSON.stringify([trackId]), imme: true } }, { auth: true })
    if (generation !== this.generation) throw new MusicError('SESSION_CHANGED', '账号状态已改变。')
    this.reads.clear()
    return { alreadyPresent: false }
  }
  async comments(id: string, offset: number): Promise<CommentPage> {
    const { body } = await this.request('comment_music', { id, offset, limit: 20 })
    const normalize = (c: any) => ({ id: String(c.commentId), content: String(c.content || ''), author: String(c.user?.nickname || '音乐听众'), avatarUrl: String(c.user?.avatarUrl || '').replace(/^http:/, 'https:'), time: Number(c.time || 0), likes: Number(c.likedCount || 0), replies: (c.beReplied || []).map((r: any) => ({ author: String(r.user?.nickname || '音乐听众'), content: String(r.content || '') })) })
    return { hot: offset === 0 ? (body.hotComments || []).map(normalize) : [], items: (body.comments || []).map(normalize), total: Number(body.total || 0), more: Boolean(body.more) }
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
