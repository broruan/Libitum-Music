import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { handleRequest } from '@yakult-green-tea/qq-music-api/serverless'
import { createMqttListenOver, type MqttConnect, type QrEvent, type QrEventListener } from '@yakult-green-tea/qq-music-api/mqtt'
import { JsonStore } from './store'

export interface QqMusicRequest {
  query?: Record<string, string | number | boolean>
  token?: string
  method?: 'GET' | 'POST'
  body?: unknown
}
export interface QqMusicResponse { status: number; body: Record<string, any>; cookie?: string }
export interface QqMusicTransport {
  request(path: string, options?: QqMusicRequest): Promise<QqMusicResponse>
  close?(): void
}

/** The library's public request handler runs inside the worker: no listening HTTP server. */
export async function createQqMusicRuntime(userData: string): Promise<QqMusicTransport> {
  const store = new JsonStore<{ seed: string } | null>(join(userData, 'qqmusic-device.json'), null)
  const saved = await store.read()
  const seed = saved && /^[a-f0-9]{64}$/.test(saved.seed) ? saved.seed : randomBytes(32).toString('hex')
  if (!saved || seed !== saved.seed) await store.write({ seed })
  const connect: MqttConnect = (url, protocol, handlers) => new Promise((resolve, reject) => {
    const socket = new WebSocket(url, protocol)
    socket.binaryType = 'arraybuffer'
    let opened = false
    const timeout = setTimeout(() => { socket.close(); reject(new Error('QQ MQTT connection timeout')) }, 12000)
    socket.addEventListener('message', event => handlers.message(event.data))
    socket.addEventListener('error', () => { clearTimeout(timeout); const error = new Error('QQ MQTT connection failed'); handlers.error(error); reject(error) })
    socket.addEventListener('close', () => { clearTimeout(timeout); handlers.close(); if (!opened) reject(new Error('QQ MQTT connection closed before opening')) })
    socket.addEventListener('open', () => {
      opened = true
      clearTimeout(timeout)
      resolve({ send: data => socket.send(Uint8Array.from(data)), close: () => socket.close() })
    }, { once: true })
  })
  const listen = createMqttListenOver(connect)
  const entries = new Map<string, { image: string; events: QrEvent[]; listener: QrEventListener; timer: ReturnType<typeof setTimeout> }>()
  const close = async (id: string) => {
    const entry = entries.get(id)
    if (entry) { clearTimeout(entry.timer); entry.listener.close(); entries.delete(id) }
  }
  const relay = {
    open: async (id: string, image: string, ttl: number) => {
      const existing = entries.get(id)
      if (existing) { await existing.listener.ready; return }
      const events: QrEvent[] = []
      const listener = listen(id, event => { events.push(event) }, ttl)
      const timer = setTimeout(() => { void close(id) }, Math.min(ttl + 5000, 300000)); timer.unref()
      entries.set(id, { image, events, listener, timer })
      void listener.done.catch(() => { events.push({ type: 'expired', payload: null }) })
      try { await listener.ready } catch (error) { await close(id); throw error }
    },
    image: async (id: string) => entries.get(id)?.image || '',
    // Preserve the complete event list: the public handler replays QR state each call.
    poll: async (id: string, _budgetMs: number) => entries.get(id)?.events.slice() || [],
    close
  }
  return {
    async request(path, options = {}) {
      const url = new URL(path, 'https://libitum-qq.invalid')
      for (const [key, value] of Object.entries(options.query || {})) url.searchParams.set(key, String(value))
      const headers = new Headers()
      if (options.token) headers.set('X-QQ-Session', options.token)
      if (options.body !== undefined) headers.set('Content-Type', 'application/json')
      const response = await handleRequest(new Request(url, { method: options.method || 'GET', headers, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) }), { QQ_SESSION_SECRET: seed, QQ_PTLOGIN_HTTP_ENABLED: '0' }, { qqRelay: relay })
      return { status: response.status, body: await response.json() as Record<string, any>, cookie: response.headers.get('set-cookie') || undefined }
    },
    close() { for (const id of entries.keys()) void close(id) }
  }
}
