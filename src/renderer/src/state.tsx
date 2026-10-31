import { createContext, useCallback, useContext, useEffect, useRef, useState, type DependencyList, type ReactNode } from 'react'
import type { Bootstrap, CollectionKind, Command, CommandMap, Quality, Track } from '../../shared/types'

export type Page = { type: 'home' } | { type: 'search'; query: string } | { type: 'detail'; kind: CollectionKind; id: string } | { type: 'library'; kind: 'likes' | 'playlists' | 'albums' } | { type: 'daily' } | { type: 'radio'; fm: boolean } | { type: 'downloads' } | { type: 'settings' }
export async function request<K extends Command>(command: K, args?: CommandMap[K]['args']): Promise<CommandMap[K]['result']> {
  if (!window.music) throw new Error('请通过桌面应用启动Libitum music。')
  const result = await window.music.invoke(command, args)
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
  return result.data
}
export function useResource<T>(load: () => Promise<T>, dependencies: DependencyList, enabled = true) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(enabled), [revision, setRevision] = useState(0)
  const loader = useRef(load); loader.current = load
  useEffect(() => {
    let alive = true
    setData(null); setError(''); setLoading(enabled)
    if (enabled) void loader.current().then(value => { if (alive) setData(value) }).catch(error => { if (alive) setError(error.message || '加载失败，请重试。') }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [...dependencies, revision, enabled])
  return { data, error, loading, reload: () => setRevision(value => value + 1) }
}
interface State {
  data: Bootstrap; page: Page; navigate: (page: Page) => void; back: () => void; canBack: boolean
  login: () => void; loginOpen: boolean; setLoginOpen: (open: boolean) => void
  toast: (message: string) => void; toasts: { id: number; message: string }[]
  act: (action: Promise<unknown>, message?: string) => Promise<void>
  download: (tracks: Track[]) => void; downloadTracks: Track[] | null; setDownloadTracks: (tracks: Track[] | null) => void
  libraryRevision: number; likedIds: Set<string>; toggleLike: (track: Track) => Promise<void>; liking: Set<string>
  panel: 'queue' | 'lyrics' | null; setPanel: (panel: 'queue' | 'lyrics' | null) => void
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
  const toastId = useRef(0)
  const toast = useCallback((message: string) => { const id = ++toastId.current; setToasts(list => [...list.slice(-2), { id, message }]); setTimeout(() => setToasts(list => list.filter(item => item.id !== id)), 5500) }, [])
  useEffect(() => {
    if (!window.music) { setFailure('请使用桌面客户端启动Libitum music：npm run dev'); return }
    const off = window.music.onEvent(event => {
      if (event.type === 'notice') { toast(event.data); return }
      if (event.type === 'library') { setLibraryRevision(value => value + 1); return }
      setData(current => {
        if (!current) return current
        if (event.type === 'session') return { ...current, session: event.data }
        if (event.type === 'player') return { ...current, player: event.data }
        if (event.type === 'downloads') return { ...current, downloads: event.data }
        if (event.type === 'settings') return { ...current, settings: event.data }
        return current
      })
    })
    void request('app.bootstrap').then(setData).catch(error => setFailure(error.message))
    return off
  }, [toast])
  useEffect(() => { document.documentElement.dataset.theme = data?.settings.theme || 'system' }, [data?.settings.theme])
  useEffect(() => { setLikedIds(new Set()) }, [data?.session.user?.id])
  useEffect(() => {
    let alive = true
    if (data?.session.user) {
      setLoginOpen(false)
      void request('library.list', { kind: 'likes', offset: 0 }).then(result => { if (alive) setLikedIds(new Set(result.likedIds)) }).catch(() => {})
    }
    return () => { alive = false }
  }, [data?.session.user?.id, libraryRevision])
  const act = async (action: Promise<unknown>, message?: string) => { try { await action; if (message) toast(message) } catch (error) { const problem = error as Error & { code?: string }; if (problem.code === 'AUTH_REQUIRED' || problem.code === 'AUTH_EXPIRED') setLoginOpen(true); toast(problem.message) } }
  if (failure) return <div className="boot-screen"><h1>Libitum music暂时无法启动</h1><p>{failure}</p><button className="button primary" onClick={() => location.reload()}>重试</button></div>
  if (!data) return <div className="boot-screen"><div className="brand-mark large">♪</div><h1>Libitum music</h1><p>正在准备你的音乐空间…</p><div className="spinner" /></div>
  const navigate = (target: Page) => { setHistory(list => [...list.slice(-29), page]); setPage(target) }
  const toggleLike = async (track: Track) => {
    if (!data.session.user) { setLoginOpen(true); return }
    if (liking.has(track.id)) return
    setLiking(ids => new Set([...ids, track.id]))
    try { const like = !likedIds.has(track.id); await request('library.like', { id: track.id, like }); setLikedIds(ids => { const next = new Set(ids); if (like) next.add(track.id); else next.delete(track.id); return next }) }
    catch (error) { toast((error as Error).message) }
    finally { setLiking(ids => { const next = new Set(ids); next.delete(track.id); return next }) }
  }
  return <Context.Provider value={{ data, page, navigate, back: () => { if (history.length) { setPage(history[history.length - 1]); setHistory(list => list.slice(0, -1)) } }, canBack: !!history.length, login: () => setLoginOpen(true), loginOpen, setLoginOpen, toast, toasts, act, download: tracks => { if (!data.session.user) setLoginOpen(true); else if (tracks.length) setDownloadTracks(tracks) }, downloadTracks, setDownloadTracks, libraryRevision, likedIds, toggleLike, liking, panel, setPanel }}>{children}</Context.Provider>
}
export function qualityName(quality: string) { const names: Record<string, string> = { standard: '标准', higher: '较高', exhigh: '极高', lossless: '无损', hires: 'Hi-Res' }; return names[quality] || quality }
