import { join } from 'node:path'
import { NeteaseProvider, type ApiModule } from './provider'
import { Downloads } from './downloads'
import { JsonStore } from './store'
import { MusicError, publicError } from '../shared/errors'
import type { DownloadTask } from '../shared/types'
import { createFixtureApi } from './test-fixtures'
import { setDefaultResultOrder } from 'node:dns'
import { setDefaultAutoSelectFamily } from 'node:net'
import { createRequire } from 'node:module'
import { runtimeOptions } from './netease-runtime'

const port = process.parentPort!
let provider: NeteaseProvider
let downloads: Downloads
let sessionVersion = 0
let sessionEpoch = 0
function send(value: unknown) { port.postMessage(value) }
async function dispatch(method: string, args: any) {
  if (method === 'init') {
    // Prefer the working IPv4 route on dual-stack hosts, retaining IPv6 fallback.
    setDefaultResultOrder('ipv4first')
    setDefaultAutoSelectFamily(true)
    const api = args.testMode ? createFixtureApi(args.testUrl, args.testQrScenario) : require('@neteasecloudmusicapienhanced/api') as ApiModule
    if (!args.testMode) {
      const upstreamRequire = createRequire(require.resolve('@neteasecloudmusicapienhanced/api'))
      upstreamRequire('axios').default.defaults.timeout = 10000
    }
    provider = new NeteaseProvider(api, { ...(args.testMode ? {} : await runtimeOptions(api, args.userData, process.env.TMPDIR!)), onCredentials: (cookie, user) => send({ event: 'credentials', data: { cookie, user, epoch: sessionEpoch } }) })
    downloads = new Downloads(new JsonStore<DownloadTask[]>(join(args.userData, 'downloads.json'), []), async (id, quality) => {
      const version = sessionVersion
      try { return await provider.resolve(id, quality, true) }
      catch (error) { if (version === sessionVersion && error instanceof MusicError && error.code === 'AUTH_EXPIRED') send({ event: 'expired' }); throw error }
    }, tasks => send({ event: 'downloads', data: tasks }), message => send({ event: 'notice', data: message }))
    await downloads.init(args.directory)
    return true
  }
  if (!provider || !downloads) throw new MusicError('NOT_READY', '后台尚未就绪。')
  switch (method) {
    case 'session.set': sessionVersion++; sessionEpoch = args.epoch ?? 0; provider.setSession(args.cookie, args.user); downloads.setOwner(args.user?.id || ''); return true
    case 'session.clear': sessionVersion++; provider.setSession('', null); await downloads.clearOwner(); return true
    case 'auth.qrStart': return provider.qrStart()
    case 'auth.qrCheck': return provider.qrCheck(args.key)
    case 'auth.qrCancel': return provider.qrCancel(args.key)
    case 'auth.importCookie': return provider.validateSession(args.cookie)
    case 'catalog.search': return provider.search(args.keywords, args.kind, args.offset)
    case 'catalog.detail': return provider.detail(args.kind, args.id, args.offset)
    case 'catalog.allTracks': return provider.allTracks(args.kind, args.id)
    case 'catalog.lyrics': return provider.lyrics(args.id)
    case 'catalog.artistAlbums': return provider.artistAlbums(args.id,args.offset)
    case 'catalog.comments': return provider.comments(args.id, args.offset)
    case 'home.section': return provider.home(args.section)
    case 'library.list': return provider.library(args.kind, args.offset)
    case 'library.like': return provider.like(args.id, args.like)
    case 'library.subscribe': return provider.subscribe(args.kind, args.id, args.subscribe)
    case 'library.subscription': return provider.subscription(args.kind, args.id)
    case 'library.writablePlaylists': return provider.writablePlaylists(args.offset)
    case 'library.addToPlaylist': return provider.addToPlaylist(args.id, args.trackId)
    case 'library.diagnostics': return provider.diagnostics()
    case 'resolve': return provider.resolve(args.id, args.quality)
    case 'radio': return provider.radio(args)
    case 'dislike': return provider.dislike(args.id)
    case 'scrobble': return provider.scrobble(args.id, args.seconds)
    case 'downloads.list': return downloads.list()
    case 'downloads.add': return downloads.add(args.tracks, args.quality)
    case 'downloads.cancel': return downloads.cancel(args.id)
    case 'downloads.retry': return downloads.retry(args.id, args.quality)
    case 'downloads.get': return downloads.get(args.id)
    case 'settings.directory': downloads.configure(args.directory); return true
    case 'close': await downloads.close(); return true
    default: throw new MusicError('INVALID_COMMAND', '后台操作不受支持。')
  }
}
port.on('message', async ({ data }) => {
  const { id, method, args } = data
  const version = sessionVersion
  try { send({ id, ok: true, data: await dispatch(method, args) }) }
  catch (error) { const problem = publicError(error); if (version === sessionVersion && problem.code === 'AUTH_EXPIRED' && !method.startsWith('auth.')) send({ event: 'expired' }); send({ id, ok: false, error: problem }) }
})
