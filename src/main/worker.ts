import { join } from 'node:path'
import { NeteaseProvider, type ApiModule } from './provider'
import { QqMusicProvider } from './qqmusic-provider'
import { createQqMusicRuntime } from './qqmusic-runtime'
import { createQqMusicFixture } from './qqmusic-fixtures'
import { PlatformRouter } from './platform-router'
import { Downloads } from './downloads'
import { JsonStore } from './store'
import { MusicError, publicError } from '../shared/errors'
import type { DownloadTask, ProviderId } from '../shared/types'
import { accountKey } from '../shared/platforms'
import { createFixtureApi } from './test-fixtures'
import { setDefaultResultOrder } from 'node:dns'
import { setDefaultAutoSelectFamily } from 'node:net'
import { createRequire } from 'node:module'
import { runtimeOptions } from './netease-runtime'

const port = process.parentPort!
let platforms: PlatformRouter
let downloads: Downloads
let sessionVersion = 0
let sessionEpoch = 0
function send(value: unknown) { port.postMessage(value) }
async function dispatch(method: string, args: any) {
  if (method === 'init') {
    setDefaultResultOrder('ipv4first')
    setDefaultAutoSelectFamily(true)
    const api = args.testMode ? createFixtureApi(args.testUrl, args.testQrScenario) : require('@neteasecloudmusicapienhanced/api') as ApiModule
    if (!args.testMode) {
      const upstreamRequire = createRequire(require.resolve('@neteasecloudmusicapienhanced/api'))
      upstreamRequire('axios').default.defaults.timeout = 10000
    }
    const credentials = (provider: ProviderId) => (cookie: string, user: unknown) => send({ event: 'credentials', data: { cookie, user, provider, epoch: sessionEpoch } })
    const netease = new NeteaseProvider(api, { ...(args.testMode ? {} : await runtimeOptions(api, args.userData, process.env.TMPDIR!)), onCredentials: credentials('netease') })
    platforms = new PlatformRouter(netease, async () => new QqMusicProvider(args.testMode ? createQqMusicFixture(args.testUrl, args.testQrScenario) : await createQqMusicRuntime(args.userData), { onCredentials: credentials('qq') }))
    downloads = new Downloads(new JsonStore<DownloadTask[]>(join(args.userData, 'downloads.json'), []), async (track, quality) => {
      const version = sessionVersion, epoch = sessionEpoch, provider = platforms.active
      try { return await platforms.run(p => p.resolve(track.id, quality, true), track.provider) }
      catch (error) { if (version === sessionVersion && error instanceof MusicError && error.code === 'AUTH_EXPIRED') send({ event: 'expired', data: { provider, epoch } }); throw error }
    }, tasks => send({ event: 'downloads', data: tasks }), message => send({ event: 'notice', data: message }))
    await downloads.init(args.directory)
    return true
  }
  if (!platforms || !downloads) throw new MusicError('NOT_READY', '后台尚未就绪。')
  switch (method) {
    case 'session.set': {
      const version = ++sessionVersion
      sessionEpoch = args.epoch ?? 0
      const provider = args.provider || 'netease'
      await platforms.setSession(provider, args.cookie, args.user)
      if (version !== sessionVersion) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新登录。')
      downloads.setOwner(args.user ? accountKey(provider, args.user.id) : '')
      return true
    }
    case 'session.clear': sessionVersion++; await platforms.clear(); await downloads.clearOwner(); return true
    case 'auth.qrStart': return (await platforms.candidate(args?.provider || 'netease')).qrStart()
    case 'auth.qrCheck': return (await platforms.candidate(args.provider || 'netease')).qrCheck(args.key)
    case 'auth.qrCancel': return (await platforms.candidate(args.provider || 'netease')).qrCancel(args.key)
    case 'auth.importCookie': return (await platforms.candidate(args.provider || 'netease')).validateSession(args.cookie)
    case 'catalog.search': return platforms.run(p => p.search(args.keywords, args.kind, args.offset))
    case 'catalog.detail': return platforms.run(p => p.detail(args.kind, args.id, args.offset))
    case 'catalog.allTracks': return platforms.run(p => p.allTracks(args.kind, args.id))
    case 'catalog.lyrics': return platforms.run(p => p.lyrics(args.id))
    case 'catalog.artistAlbums': return platforms.run(p => p.artistAlbums(args.id, args.offset))
    case 'catalog.comments': return platforms.run(p => p.comments(args.id, args.offset))
    case 'home.section': return platforms.run(p => p.home(args.section))
    case 'library.list': return platforms.run(p => p.library(args.kind, args.offset))
    case 'library.like': return platforms.run(p => p.like(args.id, args.like))
    case 'library.subscribe': return platforms.run(p => p.subscribe(args.kind, args.id, args.subscribe))
    case 'library.subscription': return platforms.run(p => p.subscription(args.kind, args.id))
    case 'library.writablePlaylists': return platforms.run(p => p.writablePlaylists(args.offset))
    case 'library.addToPlaylist': return platforms.run(p => p.addToPlaylist(args.id, args.trackId))
    case 'library.diagnostics': return platforms.run(p => p.diagnostics())
    case 'resolve': return platforms.run(p => p.resolve(args.id, args.quality), args.provider)
    case 'radio': return platforms.run(p => p.radio(args), args.provider)
    case 'dislike': return platforms.run(p => p.dislike(args.id), args.provider)
    case 'scrobble': return platforms.run(p => p.scrobble(args.id, args.seconds), args.provider)
    case 'downloads.list': return downloads.list()
    case 'downloads.add': {
      if (args.tracks.some((track: DownloadTask['track']) => track.provider !== platforms.active)) throw new MusicError('SESSION_CHANGED', '歌曲所属平台已改变，请重新选择。')
      return downloads.add(args.tracks, args.quality)
    }
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
  const version = sessionVersion, provider = platforms?.active, epoch = sessionEpoch
  try { send({ id, ok: true, data: await dispatch(method, args) }) }
  catch (error) {
    const problem = publicError(error)
    if (version === sessionVersion && problem.code === 'AUTH_EXPIRED' && !method.startsWith('auth.')) send({ event: 'expired', data: { provider, epoch } })
    send({ id, ok: false, error: problem })
  }
})
