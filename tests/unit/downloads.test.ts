import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Downloads, safeFilename } from '../../src/main/downloads'
import { JsonStore } from '../../src/main/store'
import { normalizeTrack } from '../../src/main/normalize'
import type { DownloadTask, Stream } from '../../src/shared/types'
const song = (id: number) => normalizeTrack({ id, name: '同名歌曲', artists: [{ id: 3, name: '歌手' }] })
const stream = (id: string, quality = 'exhigh'): Stream => ({ url: `https://example.com/${id}`, quality, bitrate: 320000, format: 'mp3', size: 4, trial: false })
const response = () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'audio/mpeg', 'content-length': '4' } })
describe('download lifecycle', () => {
  let directory: string, manager: Downloads
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'music-download-')); vi.stubGlobal('fetch', vi.fn(async () => response())) })
  afterEach(async () => { if (manager) await manager.close(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }) })
  async function create(resolve: (id: string, quality: any) => Promise<Stream>) {
    manager = new Downloads(new JsonStore<DownloadTask[]>(join(directory, 'tasks.json'), []), resolve, () => {}, () => {})
    await manager.init(directory); manager.setOwner('42'); return manager
  }
  it('never overwrites an existing audio file and removes the temporary file after completion', async () => {
    const dm = await create(async id => stream(id))
    const existing = join(directory, safeFilename('歌手 - 同名歌曲') + ' [1-exhigh].mp3')
    await writeFile(existing, 'existing file')
    dm.add([song(1)], 'exhigh')
    await vi.waitFor(() => expect(dm.list()[0].status).toBe('completed'))
    expect(await readFile(existing, 'utf8')).toBe('existing file')
    expect(await readFile(dm.list()[0].path!)).toEqual(Buffer.from([1, 2, 3, 4]))
    expect((await readdir(directory)).some(name => name.endsWith('.part'))).toBe(false)
    dm.add([song(1)], 'exhigh'); expect(dm.list()).toHaveLength(1)
  })
  it('fails a downgraded stream before writing bytes, then retries with the newly chosen quality', async () => {
    const dm = await create(async id => stream(id, 'standard'))
    dm.add([song(1)], 'lossless')
    await vi.waitFor(() => expect(dm.list()[0].status).toBe('failed'))
    expect(dm.list()[0].error).toContain('所选音质不可用'); expect(fetch).not.toHaveBeenCalled()
    dm.retry(dm.list()[0].id, 'standard')
    await vi.waitFor(() => expect(dm.list()[0].status).toBe('completed'))
    expect(dm.list()[0].quality).toBe('standard')
  })
  it('limits concurrent resolution to two jobs and cancellation prevents stale download starts', async () => {
    const releases: Array<() => void> = []
    const resolver = vi.fn((id: string) => new Promise<Stream>(resolve => releases.push(() => resolve(stream(id)))))
    const dm = await create(resolver)
    dm.add([song(1), song(2), song(3)], 'exhigh')
    expect(resolver).toHaveBeenCalledTimes(2)
    const first = dm.list()[0].id; dm.cancel(first); releases[0]()
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(3))
    expect(dm.list()[0].status).toBe('cancelled'); expect(fetch).not.toHaveBeenCalled()
    releases[1](); releases[2]()
    await vi.waitFor(() => expect(dm.list().filter(task => task.status === 'completed')).toHaveLength(2))
  })
})
