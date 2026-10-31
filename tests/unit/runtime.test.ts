import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { loadClientIdentity, runtimeOptions } from '../../src/main/netease-runtime'

let directory = ''
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })
it('keeps one private client identity across restarts', async () => {
  directory = await mkdtemp(join(tmpdir(), 'libitum-runtime-'))
  const identity = await loadClientIdentity(directory)
  expect(await loadClientIdentity(directory)).toEqual(identity)
  expect(identity.deviceId).toMatch(/^[A-F0-9]{52}$/)
  expect((await stat(join(directory, 'client.json'))).mode & 0o777).toBe(0o600)
})
it('initializes the required playback key once and reuses its private cache', async () => {
  directory = await mkdtemp(join(tmpdir(), 'libitum-runtime-'))
  const api = { register_xeapikey: vi.fn(async () => ({ body: { sk: 'test-only-key', version: 1 } })) }
  const options = await runtimeOptions(api, directory, join(directory, 'runtime'))
  await options.beforeRequest!('cloudsearch'); expect(api.register_xeapikey).not.toHaveBeenCalled()
  await Promise.all([options.beforeRequest!('song_url_v1'), options.beforeRequest!('song_url_v1')])
  expect(api.register_xeapikey).toHaveBeenCalledTimes(1)
  expect(JSON.parse(await readFile(join(directory, 'runtime', 'xeapi_public_key'), 'utf8')).sk).toBe('test-only-key')
  expect((await stat(join(directory, 'runtime', 'xeapi_public_key'))).mode & 0o777).toBe(0o600)
  const restarted = await runtimeOptions(api, directory, join(directory, 'runtime'))
  await restarted.beforeRequest!('song_url_v1'); expect(api.register_xeapikey).toHaveBeenCalledTimes(1)
  expect(restarted.clientCookie).toBe(options.clientCookie)
})
