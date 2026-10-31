import { describe, expect, it, vi } from 'vitest'
import { NeteaseProvider } from '../../src/main/provider'
import { createFixtureApi } from '../../src/main/test-fixtures'
describe('NetEase provider contract', () => {
  it('recovers a playlist connection reset without requiring a page refresh', async () => {
    const api = createFixtureApi(), original = api.api
    api.api = vi.fn().mockRejectedValueOnce({ body: { code: 502, msg: 'read ECONNRESET' } }).mockImplementation(original)
    const provider = new NeteaseProvider(api, { wait: async () => {} })
    expect((await provider.detail('playlist', '2001')).tracks.length).toBeGreaterThan(0)
    expect(api.api).toHaveBeenCalledTimes(2)
  })
  it('uses the embedded playlist page and caches it despite anonymous cookie updates', async () => {
    const api = createFixtureApi()
    api.api = vi.fn(async () => ({ body: { code: 200, playlist: { id: 1, name: 'list', trackCount: 2, trackIds: [{ id: 2 }, { id: 1 }], tracks: [{ id: 1, name: 'first' }, { id: 2, name: 'second' }] } }, cookie: ['NMTID=guest; Path=/'] }))
    api.song_detail = vi.fn(api.song_detail)
    const provider = new NeteaseProvider(api)
    expect((await provider.detail('playlist', '1')).tracks.map(t => t.id)).toEqual(['2', '1'])
    await provider.detail('playlist', '1')
    expect(api.api).toHaveBeenCalledTimes(1); expect(api.song_detail).not.toHaveBeenCalled()
    expect(api.api).toHaveBeenCalledWith(expect.objectContaining({ crypto: 'weapi', data: { id: '1', n: 100, s: 0 } }))
  })
  it('fetches only missing playlist songs and preserves their order', async () => {
    const api = createFixtureApi()
    api.api = async () => ({ body: { code: 200, playlist: { id: 1, trackIds: [{ id: 2 }, { id: 1 }], tracks: [{ id: 1, name: 'first' }] } } })
    api.song_detail = vi.fn(async () => ({ body: { code: 200, songs: [{ id: 2, name: 'second' }] } }))
    const provider = new NeteaseProvider(api)
    expect((await provider.detail('playlist', '1')).tracks.map(t => t.id)).toEqual(['2', '1'])
    expect(api.song_detail).toHaveBeenCalledWith(expect.objectContaining({ ids: '2' }))
  })
  it('validates a login candidate without changing the active session', async () => {
    const provider = new NeteaseProvider(createFixtureApi())
    await expect(provider.validateCookie('MUSIC_U=bad')).rejects.toMatchObject({ code: 'AUTH_EXPIRED' })
    const user = await provider.validateCookie('MUSIC_U=fixture')
    expect(user).toMatchObject({ id: '42', nickname: '测试听众' })
    await expect(provider.library('likes', 0)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })
  it('queries all search types and keeps the selected tab response shape', async () => {
    const provider = new NeteaseProvider(createFixtureApi())
    for (const kind of ['song', 'album', 'artist', 'playlist'] as const) {
      const result = await provider.search('音乐', kind, 0)
      expect(result.total).toBeGreaterThan(0)
      expect(kind === 'song' ? result.tracks.length : result.collections.length).toBeGreaterThan(0)
    }
  })
  it('synchronizes likes only after the upstream mutation succeeds', async () => {
    const provider = new NeteaseProvider(createFixtureApi())
    provider.setSession('MUSIC_U=fixture', await provider.validateCookie('MUSIC_U=fixture'))
    await provider.like('1002', true); expect((await provider.library('likes', 0)).likedIds).toContain('1002')
    await provider.like('1002', false); expect((await provider.library('likes', 0)).likedIds).not.toContain('1002')
  })
  it('uses separate playback and download requests with requested quality', async () => {
    const provider = new NeteaseProvider(createFixtureApi('https://example.com/audio.wav'))
    provider.setSession('MUSIC_U=fixture', await provider.validateCookie('MUSIC_U=fixture'))
    expect(await provider.resolve('1001', 'lossless')).toMatchObject({ quality: 'lossless', trial: false })
    expect(await provider.resolve('1001', 'hires', true)).toMatchObject({ quality: 'hires' })
  })
  it('loads both recommendation modes without substituting a local recommendation engine', async () => {
    const provider = new NeteaseProvider(createFixtureApi())
    provider.setSession('MUSIC_U=fixture', await provider.validateCookie('MUSIC_U=fixture'))
    expect((await provider.radio({ mode: 'FM' })).length).toBe(6)
    expect((await provider.radio({ mode: 'SCENE_RCMD', scene: 'FOCUS' })).length).toBe(6)
  })
  it('redacts raw upstream errors and propagates expired authentication', async () => {
    const provider = new NeteaseProvider({ cloudsearch: async () => { throw new Error('secret MUSIC_U=private') } })
    await expect(provider.search('音乐', 'song', 0)).rejects.toMatchObject({ code: 'NETWORK', message: '连接网易云失败，请检查网络后重试。' })
    const expired = new NeteaseProvider({ cloudsearch: async () => ({ body: { code: 301 } }) })
    await expect(expired.search('音乐', 'song', 0)).rejects.toMatchObject({ code: 'AUTH_EXPIRED' })
  })
  it('falls back to the alternate NetEase search endpoint on transport failures', async () => {
    const api = createFixtureApi()
    const provider = new NeteaseProvider({ ...api, cloudsearch: async () => { throw new Error('reset') }, search: api.cloudsearch })
    expect((await provider.search('音乐', 'song', 0)).tracks).toHaveLength(6)
  })
})
