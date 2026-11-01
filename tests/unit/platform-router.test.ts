import { describe, expect, it, vi } from 'vitest'
import { PlatformRouter } from '../../src/main/platform-router'
import { NeteaseProvider } from '../../src/main/provider'
import { createFixtureApi } from '../../src/main/test-fixtures'
import { isTrack, validateCommand } from '../../src/main/validation'
import { accountKey, sessionProvider } from '../../src/shared/platforms'
import { MusicError } from '../../src/shared/errors'
import type { SearchResult } from '../../src/shared/types'

const user = { id: '42', nickname: '示例听众', avatarUrl: '' }
function providers() {
  const netease = new NeteaseProvider(createFixtureApi()), qq = new NeteaseProvider(createFixtureApi())
  const factory = vi.fn(async () => qq)
  return { netease, qq, factory, router: new PlatformRouter(netease, factory) }
}
describe('active music platform routing', () => {
  it('defaults to NetEase and does not initialize QQ until it is needed', async () => {
    const { router, factory, netease } = providers(), home = vi.spyOn(netease, 'home')
    await router.run(p => p.home('recommended'))
    expect(home).toHaveBeenCalledWith('recommended'); expect(factory).not.toHaveBeenCalled(); expect(router.active).toBe('netease')
  })
  it('keeps a QQ login candidate separate until login is committed', async () => {
    const { router, netease, qq, factory } = providers()
    expect(await router.candidate('qq')).toBe(qq)
    expect(await router.candidate('qq')).toBe(qq); expect(factory).toHaveBeenCalledTimes(1)
    expect(await router.run(p => p)).toBe(netease)
    const previous = vi.spyOn(netease, 'setSession')
    await router.setSession('qq', 'qqmusic_session=fixture', user)
    expect(previous).toHaveBeenCalledWith('', null); expect(await router.run(p => p)).toBe(qq)
    await router.clear(); expect(router.active).toBe('netease'); expect(await router.run(p => p)).toBe(netease)
  })
  it('does not deliver an old catalog response after switching accounts', async () => {
    const { router } = providers()
    let finish!: (value: SearchResult) => void
    const result = router.run(() => new Promise<SearchResult>(resolve => { finish = resolve }))
    await vi.waitFor(() => expect(finish).toBeDefined())
    await router.setSession('qq', 'qqmusic_session=fixture', user)
    finish({ tracks: [], collections: [], total: 0 })
    await expect(result).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
  })
  it('rejects a stale track before resolving it on the new platform', async () => {
    const { router, qq } = providers(), resolve = vi.spyOn(qq, 'resolve')
    await router.setSession('qq', 'qqmusic_session=fixture', user)
    await expect(router.run(p => p.resolve('1001', 'standard'), 'netease')).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
    expect(resolve).not.toHaveBeenCalled()
  })
  it('discards an old authentication error after changing platform', async () => {
    const { router } = providers()
    let fail!: (reason: Error) => void
    const result = router.run(() => new Promise((_, reject) => { fail = reject }))
    await vi.waitFor(() => expect(fail).toBeDefined())
    await router.setSession('qq', 'qqmusic_session=fixture', user)
    fail(new MusicError('AUTH_EXPIRED', '旧账号已经失效'))
    await expect(result).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
  })
  it('does not commit an obsolete login whose platform is still initializing', async () => {
    const { netease, qq } = providers()
    let ready!: (value: NeteaseProvider) => void
    const router = new PlatformRouter(netease, () => new Promise(resolve => { ready = resolve }))
    const pending = router.setSession('qq', 'qqmusic_session=old', user)
    await router.setSession('netease', 'MUSIC_U=fixture', user)
    ready(qq)
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
    expect(router.active).toBe('netease')
  })
})
describe('platform identifiers at the IPC interface', () => {
  it('accepts QQ mids without accepting path fragments or unknown platforms', async () => {
    const track = (await new NeteaseProvider(createFixtureApi()).search('音乐', 'song', 0)).tracks[0]
    const qq = { ...track, provider: 'qq', id: '003aAYrm3GE0Ac', artists: track.artists.map(artist => ({ ...artist, provider: 'qq', id: '0025NhlN2yWrP4' })) }
    expect(isTrack(qq)).toBe(true)
    expect(() => validateCommand('player.play', { tracks: [qq] })).not.toThrow()
    expect(() => validateCommand('catalog.detail', { kind: 'artist', id: '0025NhlN2yWrP4', offset: 0 })).not.toThrow()
    expect(isTrack({ ...qq, id: '../secrets' })).toBe(false)
    expect(isTrack({ ...qq, provider: 'unknown' })).toBe(false)
    expect(() => validateCommand('auth.qrStart', { provider: 'unknown' })).toThrow()
  })
  it('does not use a QQ credential as a NetEase login, and keeps old sessions on NetEase', () => {
    expect(() => validateCommand('auth.importCookie', { cookie: 'qqmusic_session=fixture' })).toThrow()
    expect(() => validateCommand('auth.importCookie', { provider: 'qq', cookie: 'MUSIC_U=fixture' })).toThrow()
    expect(() => validateCommand('auth.importCookie', { provider: 'qq', cookie: 'qqmusic_session=fixture' })).not.toThrow()
    expect(sessionProvider({ user, persistent: true })).toBe('netease')
    expect(sessionProvider({ user: null, provider: 'qq', persistent: false })).toBe('netease')
    expect(accountKey('qq', '42')).not.toBe(accountKey('netease', '42'))
  })
})
