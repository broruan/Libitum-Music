import { describe, expect, it, vi } from 'vitest'
import { ReadRequests, requestPolicy } from '../../src/main/request-policy'
import { MusicError } from '../../src/shared/errors'

const read = { retry: true, cacheMs: 1000 }
describe('read request recovery', () => {
  it('retries transient reads with bounded backoff and never caches failure', async () => {
    const wait = vi.fn(async () => {}), requests = new ReadRequests({ wait })
    const operation = vi.fn().mockRejectedValueOnce(new MusicError('NETWORK', 'temporary')).mockResolvedValue({ ok: true })
    expect(await requests.run('a', read, operation)).toEqual({ ok: true })
    expect(operation).toHaveBeenCalledTimes(2); expect(wait).toHaveBeenCalledWith(400)
    const failing = vi.fn(async () => { throw new MusicError('NETWORK', 'temporary') })
    await expect(requests.run('b', read, failing)).rejects.toMatchObject({ code: 'NETWORK' })
    expect(failing).toHaveBeenCalledTimes(3)
    await expect(requests.run('b', read, async () => 'recovered')).resolves.toBe('recovered')
  })
  it('does not repeat risk responses, authentication, writes, QR or radio requests', async () => {
    const requests = new ReadRequests({ wait: async () => {} })
    for (const code of ['RISK_BLOCKED', 'AUTH_EXPIRED']) {
      const operation = vi.fn(async () => { throw new MusicError(code, 'blocked') })
      await expect(requests.run(code, read, operation)).rejects.toMatchObject({ code })
      expect(operation).toHaveBeenCalledTimes(1)
    }
    for (const name of ['like', 'playlist_subscribe', 'login_qr_key', 'api', 'login_status', 'personal_fm']) {
      const operation = vi.fn(async () => { throw new MusicError('NETWORK', 'temporary') })
      await expect(requests.run(name, requestPolicy(name, {}), operation)).rejects.toMatchObject({ code: 'NETWORK' })
      expect(operation).toHaveBeenCalledTimes(1)
    }
  })
  it('coalesces concurrent reads and isolates cached values and expiration', async () => {
    let now = 1, release!: (value: { list: number[] }) => void
    const requests = new ReadRequests<{ list: number[] }>({ now: () => now })
    const operation = vi.fn(() => new Promise<{ list: number[] }>(resolve => { release = resolve }))
    const first = requests.run('a', read, operation), second = requests.run('a', read, operation)
    release({ list: [1] })
    const value = await first; value.list.push(2)
    expect(await second).toEqual({ list: [1] })
    expect(await requests.run('a', read, operation)).toEqual({ list: [1] }); expect(operation).toHaveBeenCalledTimes(1)
    now += 1001
    expect(await requests.run('a', read, async () => ({ list: [3] }))).toEqual({ list: [3] })
  })
  it('does not repopulate a cleared account cache from an old in-flight response', async () => {
    let release!: (value: string) => void
    const requests = new ReadRequests<string>()
    const old = requests.run('a', read, () => new Promise(resolve => { release = resolve }))
    requests.clear()
    expect(await requests.run('a', read, async () => 'new')).toBe('new')
    release('old'); await old
    expect(await requests.run('a', read, async () => 'unexpected')).toBe('new')
  })
})
