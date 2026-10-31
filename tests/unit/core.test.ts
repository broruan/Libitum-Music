import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeCollection, normalizeStream, normalizeTrack } from '../../src/main/normalize'
import { nextIndex } from '../../src/main/queue'
import { lyricGroups,lyricIndex,parseLyrics } from '../../src/shared/lyrics'
import { validateCommand } from '../../src/main/validation'
import { checkDownloadQuality, safeFilename } from '../../src/main/downloads'
import { JsonStore } from '../../src/main/store'
import { MusicError } from '../../src/shared/errors'

describe('provider normalization and availability', () => {
  it('normalizes both legacy FM and search songs without losing artist/album identifiers', () => {
    const modern = normalizeTrack({ id: 1, name: '音乐', dt: 5000, ar: [{ id: 2, name: '歌手' }], al: { id: 3, name: '专辑', picUrl: 'http://p1.music.126.net/a.jpg' } })
    const legacy = normalizeTrack({ id: 1, name: '音乐', duration: 5000, artists: [{ id: 2, name: '歌手' }], album: { id: 3, name: '专辑', picUrl: 'http://p1.music.126.net/a.jpg' } })
    expect(modern).toEqual(legacy); expect(modern.coverUrl).toMatch(/^https:/); expect(modern.album.id).toBe('3')
  })
  it('distinguishes owned and subscribed playlists', () => { expect(normalizeCollection({ id: 1, creator: { userId: 42 }, subscribed: false }, 'playlist', '42')).toMatchObject({ owned: true, subscribed: false }) })
  it('does not fabricate a stream for unavailable or local-file URLs', () => { expect(() => normalizeStream({ url: null })).toThrow(MusicError); expect(() => normalizeStream({ url: 'file:///etc/passwd' })).toThrow(MusicError) })
  it('keeps actual quality and trial restrictions', () => { expect(normalizeStream({ url: 'https://example.com/audio', level: 'standard', br: 128000, freeTrialInfo: { start: 0, end: 30 } })).toMatchObject({ quality: 'standard', trial: true, bitrate: 128000 }) })
})
describe('queue progression', () => {
  it('repeats only on natural end in single repeat mode', () => { expect(nextIndex(2, 4, 'one', true)).toBe(2); expect(nextIndex(2, 4, 'one', false)).toBe(3) })
  it('wraps lists and never shuffles to the currently playing track', () => { expect(nextIndex(3, 4, 'list', true)).toBe(0); for (let i = 0; i < 100; i++) expect(nextIndex(2, 4, 'shuffle', false)).not.toBe(2) })
  it('handles empty and one-song queues', () => { expect(nextIndex(-1, 0, 'list', true)).toBe(-1); expect(nextIndex(0, 1, 'shuffle', true)).toBe(0) })
})
describe('lyrics', () => {
  it('supports repeated timestamps, decimal formats, offsets and metadata', () => { expect(parseLyrics('[ar:歌手]\n[offset:500]\n[00:02.5][00:01.00]歌词')).toEqual([{ time: 1.5, text: '歌词' }, { time: 3, text: '歌词' }]) })
})
describe('download safety', () => {
  const stream = { url: 'https://example.com/music', quality: 'standard', bitrate: 128000, format: 'mp3', size: 100, trial: false }
  it('requires a new choice if the requested quality differs', () => { expect(() => checkDownloadQuality(stream, 'hires')).toThrow(/所选音质不可用/); expect(() => checkDownloadQuality(stream, 'standard')).not.toThrow() })
  it('rejects trial clips as full downloads', () => { expect(() => checkDownloadQuality({ ...stream, trial: true }, 'standard')).toThrow(/试听/) })
  it('removes path traversal and control characters from filenames', () => { const value = safeFilename('../../a/曲目\u0000'); expect(value).not.toContain('/'); expect(value).not.toContain('\u0000'); expect(value.startsWith('.')).toBe(false) })
})
describe('IPC boundary', () => {
  it('rejects arbitrary commands, invalid quality and nonfinite seeks', () => {
    expect(() => validateCommand('run', { command: 'sh' })).toThrow()
    expect(() => validateCommand('player.quality', { quality: 'admin' })).toThrow()
    expect(() => validateCommand('player.seek', { seconds: Infinity })).toThrow()
  })
  it('does not let the renderer overwrite the download directory directly', () => { expect(() => validateCommand('settings.update', { downloadDirectory: '/etc' })).toThrow() })
  it('rejects arbitrary external URLs and malformed cookies', () => { expect(() => validateCommand('app.openExternal', { url: 'file:///etc/passwd' })).toThrow(); expect(() => validateCommand('auth.importCookie', { cookie: 'MUSIC_U=x\r\nInjected:y' })).toThrow() })
})
describe('atomic persistence', () => {
  let directory: string
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })
  it('serializes concurrent writes and stores files with private permissions', async () => {
    directory = await mkdtemp(join(tmpdir(), 'music-store-'))
    const path = join(directory, 'state.json'), store = new JsonStore(path, { value: 0 })
    await Promise.all(Array.from({ length: 25 }, (_, value) => store.write({ value })))
    expect(await store.read()).toEqual({ value: 24 }); expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(1)
  })
})

it('groups duplicate lyric timestamps with translations and locates before/after a seek',()=>{
 const groups=lyricGroups('[offset:500]\n[00:01.00]第一句\n[00:01.00]合唱\n[00:05.00][00:09.00]重复句','[00:01.50]译文')
 expect(groups.map(g=>g.time)).toEqual([1.5,5.5,9.5]);expect(groups[0]).toMatchObject({text:'第一句\n合唱',translation:'译文'})
 expect(lyricIndex(groups,1)).toBe(-1);expect(lyricIndex(groups,5.5)).toBe(1);expect(lyricIndex(groups,2)).toBe(0);expect(lyricIndex([],20)).toBe(-1)
})
