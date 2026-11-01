import { createContext, useCallback, useContext, useEffect, useRef, useState, type DependencyList, type ReactNode, type Dispatch, type SetStateAction } from 'react'
import appIcon from '../../../resources/icon.png'
import type { Bootstrap, CollectionKind, Command, CommandMap, MediaImportState, ProviderId, Quality, Session, Settings, Track } from '../../shared/types'
import { PROVIDERS, accountKey as scopedAccountKey, sessionProvider } from '../../shared/platforms'

export const platformName = (provider: ProviderId = 'netease') => PROVIDERS[provider]
export const accountKey = (session?: Session) => scopedAccountKey(session ? sessionProvider(session) : 'netease', session?.user?.id || '')
let accountRevision = 0

export type Page = { type: 'home' } | { type: 'search'; query: string } | { type: 'detail'; kind: CollectionKind; id: string } | { type: 'library'; kind: 'likes' | 'playlists' | 'albums' } | { type: 'daily' } | { type: 'radio'; fm: boolean } | { type: 'downloads' } | { type: 'nowPlaying' } | { type: 'settings'; section?: string }
export async function request<K extends Command>(command: K, args?: CommandMap[K]['args']): Promise<CommandMap[K]['result']> {
  if (!window.music) throw new Error('请通过桌面应用启动Libitum music。')
  const revision = accountRevision
  const result = await window.music.invoke(command, args)
  if (revision !== accountRevision && /^(catalog\.|home\.|library\.|downloads\.|player\.(?:play|radio|dislike)$)/.test(command)) throw Object.assign(new Error('账号状态已改变，请重新加载。'), { code: 'SESSION_CHANGED' })
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code, upstreamCode:result.error.upstreamCode })
  if(command==='player.seek')window.dispatchEvent(new Event('music:seek'))
  return result.data
}
export function useResource<T>(load: () => Promise<T>, dependencies: DependencyList, enabled = true) {
  const scope = accountKey(useContext(Context)?.data.session)
  const [value, setValue] = useState<{ scope: string; data: T | null; error: string; loading: boolean }>({ scope, data: null, error: '', loading: enabled }), [revision, setRevision] = useState(0)
  const loader = useRef(load); loader.current = load
  useEffect(() => {
    let alive = true
    setValue({ scope, data: null, error: '', loading: enabled })
    if (enabled) void loader.current().then(data => { if (alive) setValue({ scope, data, error: '', loading: false }) }).catch(error => { if (alive) setValue({ scope, data: null, error: error.code === 'SESSION_CHANGED' ? '' : error.message || '加载失败，请重试。', loading: false }) })
    return () => { alive = false }
  }, [...dependencies, scope, revision, enabled])
  return { data: value.scope === scope ? value.data : null, error: value.scope === scope ? value.error : '', loading: value.scope === scope ? value.loading : enabled, reload: () => setRevision(value => value + 1) }
}
export type VisualPreview = Partial<Pick<Settings, 'wallpaperBlur' | 'panelBlur' | 'panelOpacity'>>
interface State {
  visualPreview: VisualPreview; setVisualPreview: Dispatch<SetStateAction<VisualPreview>>
  data: Bootstrap; page: Page; navigate: (page: Page) => void; back: () => void; canBack: boolean
  login: () => void; loginOpen: boolean; setLoginOpen: (open: boolean) => void
  toast: (message: string) => void; toasts: { id: number; message: string }[]
  act: (action: Promise<unknown>, message?: string) => Promise<void>
  download: (tracks: Track[]) => void; downloadTracks: Track[] | null; setDownloadTracks: (tracks: Track[] | null) => void
  libraryRevision: number; likedIds: Set<string>; toggleLike: (track: Track) => Promise<void>; liking: Set<string>
  panel: 'queue' | 'lyrics' | null; setPanel: (panel: 'queue' | 'lyrics' | null) => void
  playlistTrack: Track | null; setPlaylistTrack: (track: Track | null) => void; addToPlaylist: (track: Track) => void
  peqOpen: boolean; setPeqOpen: (open: boolean) => void; mediaImport: MediaImportState
}
const Context = createContext<State | null>(null)
export function useApp() { const value = useContext(Context); if (!value) throw new Error('应用尚未初始化'); return value }
export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Bootstrap | null>(null), [failure, setFailure] = useState('')
  const [page, setPage] = useState<Page>({ type: 'home' }), [history, setHistory] = useState<Page[]>([])
  const [loginOpen, setLoginOpen] = useState(false), [downloadTracks, setDownloadTracks] = useState<Track[] | null>(null)
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]), [libraryRevision, setLibraryRevision] = useState(0)
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set()), [liking, setLiking] = useState<Set<string>>(new Set())
  const [panel, setPanel] = useState<'queue' | 'lyrics' | null>(null)
  const [playlistTrack,setPlaylistTrack]=useState<Track|null>(null),[peqOpen,setPeqOpen]=useState(false)
  const [mediaImport,setMediaImport]=useState<MediaImportState>({status:'idle',progress:0})
  const [visualPreview,setVisualPreview]=useState<VisualPreview>({})
  const toastId = useRef(0), sessionScope = useRef<string | null>(null)
  const toast = useCallback((message: string) => { const id = ++toastId.current; setToasts(list => [...list.slice(-2), { id, message }]); setTimeout(() => setToasts(list => list.filter(item => item.id !== id)), 5500) }, [])
  useEffect(() => {
    if (!window.music) { setFailure('请使用桌面客户端启动Libitum music：npm run dev'); return }
    const updateScope = (session: Session) => {
      const next = accountKey(session)
      if (sessionScope.current !== null && sessionScope.current !== next) {
        accountRevision++
        setPage({ type: 'home' }); setHistory([]); setPanel(null); setDownloadTracks(null); setPlaylistTrack(null); setPeqOpen(false)
        setLikedIds(new Set()); setLiking(new Set()); setToasts([])
      }
      sessionScope.current = next
    }
    const off = window.music.onEvent(event => {
      if (event.type === 'notice') { toast(event.data); return }
      if (event.type === 'mediaImport') { setMediaImport(event.data); return }
      if (event.type === 'library') { setLibraryRevision(value => value + 1); return }
      if (event.type === 'session') updateScope(event.data)
      setData(current => {
        if (!current) return current
        if (event.type === 'session') return { ...current, session: event.data }
        if (event.type === 'player') return { ...current, player: event.data }
        if (event.type === 'downloads') return { ...current, downloads: event.data }
        if (event.type === 'settings') return { ...current, settings: event.data }
        return current
      })
    })
    void request('app.bootstrap').then(value => { updateScope(value.session); setData(value) }).catch(error => setFailure(error.message))
    return off
  }, [toast])
  useEffect(() => { document.documentElement.dataset.theme = data?.settings.theme || 'system' }, [data?.settings.theme])
  const scope = accountKey(data?.session)
  useEffect(() => { if (data?.session.user) setLoginOpen(false) }, [scope])
  useEffect(() => {
    let alive = true
    if (data?.session.user) {
      void request('library.list', { kind: 'likes', offset: 0 }).then(result => { if (alive) setLikedIds(new Set(result.likedIds)) }).catch(() => {})
    }
    return () => { alive = false }
  }, [scope, libraryRevision])
  const act = async (action: Promise<unknown>, message?: string) => { const revision = accountRevision; try { await action; if (message && revision === accountRevision) toast(message) } catch (error) { const problem = error as Error & { code?: string }; if (revision !== accountRevision || problem.code === 'SESSION_CHANGED') return; if (['AUTH_REQUIRED','AUTH_EXPIRED','AUTH_INCOMPLETE'].includes(problem.code || '')) setLoginOpen(true); toast(problem.message) } }
  if (failure) return <div className="boot-screen"><h1>Libitum music暂时无法启动</h1><p>{failure}</p><button className="button primary" onClick={() => location.reload()}>重试</button></div>
  if (!data) return <div className="boot-screen"><img className="brand-mark large app-icon" src={appIcon} alt=""/><h1>Libitum music</h1><p>正在准备你的音乐空间…</p><div className="spinner" /></div>
  const navigate = (target: Page) => { setHistory(list => [...list.slice(-29), page]); setPage(target) }
  const toggleLike = async (track: Track) => {
    if (!data.session.user) { setLoginOpen(true); return }
    if (liking.has(track.id)) return
    const revision = accountRevision
    setLiking(ids => new Set([...ids, track.id]))
    try { const like = !likedIds.has(track.id); await request('library.like', { id: track.id, like }); if (revision === accountRevision) setLikedIds(ids => { const next = new Set(ids); if (like) next.add(track.id); else next.delete(track.id); return next }) }
    catch (error) { if (revision === accountRevision && (error as Error & { code?: string }).code !== 'SESSION_CHANGED') toast((error as Error).message) }
    finally { if (revision === accountRevision) setLiking(ids => { const next = new Set(ids); next.delete(track.id); return next }) }
  }
  return <Context.Provider value={{ data, page, navigate, back: () => { if (history.length) { setPage(history[history.length - 1]); setHistory(list => list.slice(0, -1)) } }, canBack: !!history.length, login: () => setLoginOpen(true), loginOpen, setLoginOpen, toast, toasts, act, download: tracks => { if (!data.session.user) setLoginOpen(true); else if (tracks.length) setDownloadTracks(tracks) }, downloadTracks, setDownloadTracks, libraryRevision, likedIds, toggleLike, liking, panel, setPanel,playlistTrack,setPlaylistTrack,addToPlaylist:track=>{if(!data.session.user)setLoginOpen(true);else setPlaylistTrack(track)},peqOpen,setPeqOpen,mediaImport,visualPreview,setVisualPreview }}>{children}</Context.Provider>
}
export function qualityName(quality: string) { const names: Record<string, string> = { standard: '标准', higher: '较高', exhigh: '极高', lossless: '无损', hires: 'Hi-Res' }; return names[quality] || quality }
