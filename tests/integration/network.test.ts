import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { getDefaultResultOrder, setDefaultResultOrder } from 'node:dns'
import { getDefaultAutoSelectFamily, setDefaultAutoSelectFamily } from 'node:net'
import { expect, it, vi } from 'vitest'
import { NeteaseProvider, type ApiModule } from '../../src/main/provider'
import { runtimeOptions } from '../../src/main/netease-runtime'

// Explicitly opt in: public catalog and an unscanned QR only. No real account.
it('opens real homepage playlists, initializes playback, and polls one unscanned QR', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'libitum-network-')), runtime = join(directory, 'runtime')
  const previousTmp = process.env.TMPDIR, previousOrder = getDefaultResultOrder(), previousFamily = getDefaultAutoSelectFamily()
  const spies = ['log', 'error', 'warn', 'info', 'debug'].map(name => vi.spyOn(console, name as 'log').mockImplementation(() => {}))
  const report = { playlistsOpened: 0, searchSongs: 0, streamsResolved: 0, artistAlbums:0, qrWaiting: false, upstreamCalls: 0, transientFailures: 0 }
  try {
    await mkdir(runtime, { mode: 0o700 }); process.env.TMPDIR = runtime
    setDefaultResultOrder('ipv4first'); setDefaultAutoSelectFamily(true)
    const require = createRequire(import.meta.url), original = require('@neteasecloudmusicapienhanced/api') as ApiModule
    createRequire(require.resolve('@neteasecloudmusicapienhanced/api'))('axios').default.defaults.timeout = 10000
    const api = new Proxy(original, { get(target, name: string) {
      if (typeof target[name] !== 'function') return target[name]
      return async (params: Record<string, unknown>) => {
        report.upstreamCalls++
        try { return await target[name](params) }
        catch (error: any) { if (Number(error?.body?.code) >= 500 || !error?.body?.code) report.transientFailures++; throw error }
      }
    } })
    const provider = new NeteaseProvider(api, await runtimeOptions(api, directory, runtime))
    const recommended = await provider.home('recommended')
    expect(recommended.collections.length).toBeGreaterThanOrEqual(3)
    // Different IDs bypass the successful-response cache, matching homepage navigation.
    for (const playlist of recommended.collections.slice(0, 5)) {
      const detail = await provider.detail('playlist', playlist.id)
      expect(detail.tracks.length).toBeGreaterThan(0); report.playlistsOpened++
    }
    report.searchSongs = (await provider.search('周杰伦', 'song', 0)).tracks.length
    expect(report.searchSongs).toBeGreaterThan(0)
    const albums=await provider.artistAlbums('6452',0);expect(albums.albums.length).toBeGreaterThan(0);report.artistAlbums=albums.albums.length
    const comments=await provider.comments('33894312',0)
    expect(comments.total).toBeGreaterThan(0);expect(comments.items.length+comments.hot.length).toBeGreaterThan(0)
    // This public song is queried under normal anonymous permissions; no audio is downloaded.
    const stream = await provider.resolve('33894312', 'standard')
    expect(Boolean(stream.url)).toBe(true); report.streamsResolved++
    const qr = await provider.qrStart()
    expect(qr.dataUrl.startsWith('data:image/')).toBe(true)
    report.qrWaiting = (await provider.qrCheck(qr.key)).state === 'waiting'
    provider.qrCancel(qr.key); expect(report.qrWaiting).toBe(true)
  } finally {
    for (const spy of spies) spy.mockRestore()
    if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp
    setDefaultResultOrder(previousOrder); setDefaultAutoSelectFamily(previousFamily)
    await rm(directory, { recursive: true, force: true })
    console.log('Public NetEase check (no credentials):', JSON.stringify(report))
  }
})
