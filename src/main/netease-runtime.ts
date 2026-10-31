import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { JsonStore } from './store'
import type { ApiModule, ProviderOptions } from './provider'
import { neteaseError } from './netease-errors'
import { MusicError } from '../shared/errors'

interface ClientIdentity { deviceId: string; nuid: string; createdAt: number }
/** A single installation keeps its own client identity; retries never rotate it. */
export async function loadClientIdentity(userData: string): Promise<ClientIdentity> {
  const store = new JsonStore<ClientIdentity | null>(join(userData, 'client.json'), null)
  const saved = await store.read()
  if (saved && /^[A-F0-9]{52}$/.test(saved.deviceId) && /^[a-f0-9]{32}$/.test(saved.nuid) && Number.isFinite(saved.createdAt)) return saved
  const identity = { deviceId: randomBytes(26).toString('hex').toUpperCase(), nuid: randomBytes(16).toString('hex'), createdAt: Date.now() }
  await store.write(identity)
  return identity
}

export async function runtimeOptions(api: ApiModule, userData: string, runtime: string): Promise<ProviderOptions> {
  const identity = await loadClientIdentity(userData)
  ;(globalThis as typeof globalThis & { deviceId: string }).deviceId = identity.deviceId
  const clientCookie = `deviceId=${identity.deviceId}; _ntes_nuid=${identity.nuid}; _ntes_nnid=${identity.nuid},${identity.createdAt}`
  const keyPath = join(runtime, 'xeapi_public_key')
  let keyReady = false, keyRequest: Promise<void> | null = null
  const prepareKey = async () => {
    let cached: Record<string, any> | null = null
    try { const value = JSON.parse(await readFile(keyPath, 'utf8')); if (value.deviceId === identity.deviceId && typeof value.sk === 'string' && value.sk) cached = value } catch { /* First use. */ }
    if (cached) { keyReady = true; return }
    try {
      const result = await api.register_xeapikey({ deviceId: identity.deviceId, currentKeyVersion: '' })
      if (!result.body?.sk || typeof result.body.sk !== 'string') throw new MusicError('SERVICE_INIT', '网易云播放协议初始化失败，请稍后重试。')
      await mkdir(runtime, { recursive: true, mode: 0o700 })
      await writeFile(keyPath + '.tmp', JSON.stringify({ ...result.body, deviceId: identity.deviceId }), { mode: 0o600 })
      await rename(keyPath + '.tmp', keyPath)
      keyReady = true
    } catch (error) { if (error instanceof MusicError) throw error; throw neteaseError(error) }
  }
  return {
    clientCookie,
    beforeRequest: async name => {
      if (name !== 'song_url_v1' || keyReady) return
      if (!keyRequest) keyRequest = prepareKey().finally(() => { keyRequest = null })
      await keyRequest
    }
  }
}
