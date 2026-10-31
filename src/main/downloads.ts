import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { link, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { DownloadTask, Quality, Stream, Track } from '../shared/types'
import { QUALITIES } from '../shared/types'
import { MusicError, publicError } from '../shared/errors'
import { JsonStore } from './store'

export function safeFilename(value: string): string { return value.replace(/[\x00-\x1f/\\:*?"<>|]/g, '_').replace(/^\.+/, '').trim().slice(0, 100) || '未知歌曲' }
export function checkDownloadQuality(stream: Stream, requested: Quality) {
  if (stream.trial) throw new MusicError('DOWNLOAD_TRIAL', '当前返回的是试听片段，无法作为完整歌曲下载。')
  if (!stream.quality) throw new MusicError('QUALITY_UNKNOWN', '接口没有返回音质信息，暂时无法确认所选下载音质，请稍后重试。')
  if (stream.quality && stream.quality !== requested) throw new MusicError('QUALITY_UNAVAILABLE', `所选音质不可用，当前可用：${QUALITIES[stream.quality as Quality] || stream.quality}。请更换下载音质后重试。`)
}
export function audioExtension(format: string, contentType: string): string {
  const known: Record<string, string> = { mp3: 'mp3', flac: 'flac', aac: 'aac', m4a: 'm4a', mp4: 'm4a', ogg: 'ogg', opus: 'opus', wav: 'wav' }
  if (known[format]) return known[format]
  if (/flac/.test(contentType)) return 'flac'
  if (/mpeg/.test(contentType)) return 'mp3'
  if (/mp4/.test(contentType)) return 'm4a'
  if (/wav/.test(contentType)) return 'wav'
  throw new MusicError('FORMAT_UNSUPPORTED', '接口返回的音频格式暂不支持导出。')
}
export class Downloads {
  private tasks: DownloadTask[] = []
  private ownerId = ''
  private active = new Map<string, AbortController>()
  private directory = ''
  private lastUpdate = 0
  private saving: ReturnType<typeof setTimeout> | null = null
  constructor(private store: JsonStore<DownloadTask[]>, private resolve: (id: string, quality: Quality) => Promise<Stream>, private emit: (tasks: DownloadTask[]) => void, private report: (message: string) => void) {}
  async init(directory: string) {
    this.directory = directory
    const saved = await this.store.read()
    this.tasks = Array.isArray(saved) ? saved.map(task => ['queued', 'resolving', 'downloading'].includes(task.status) ? { ...task, status: 'interrupted', error: '上次下载被中断，点击重试重新下载。' } : task) : []
  }
  configure(directory: string) { this.directory = directory }
  setOwner(id: string) { this.ownerId = id; this.publish(); this.pump() }
  list() { return structuredClone(this.tasks.filter(task => task.ownerId === this.ownerId)) }
  private publish(persist = true) {
    this.emit(this.list())
    if (persist && !this.saving) this.saving = setTimeout(() => { this.saving = null; void this.store.write(this.tasks).catch(() => this.report('下载记录保存失败，请检查磁盘空间。')) }, 250)
  }
  add(tracks: Track[], quality: Quality) {
    if (!this.ownerId) throw new MusicError('AUTH_REQUIRED', '请先登录后下载。')
    for (const track of tracks) {
      if (this.tasks.some(task => task.ownerId === this.ownerId && task.track.id === track.id && task.quality === quality && ['queued', 'resolving', 'downloading', 'completed'].includes(task.status))) continue
      this.tasks.push({ id: randomUUID(), ownerId: this.ownerId, track, quality, status: 'queued', received: 0, total: 0, createdAt: Date.now() })
    }
    this.publish(); this.pump()
  }
  get(id: string) { const task = this.tasks.find(task => task.id === id && task.ownerId === this.ownerId); if (!task) throw new MusicError('NOT_FOUND', '下载任务不存在。'); return task }
  cancel(id: string) {
    const task = this.get(id)
    if (task.status === 'completed') return
    task.status = 'cancelled'; this.active.get(id)?.abort(); this.publish()
  }
  retry(id: string, quality?: Quality) {
    const task = this.get(id)
    if (this.active.has(id) || ['completed', 'queued'].includes(task.status)) return
    if (quality) task.quality = quality
    task.status = 'queued'; task.received = 0; task.error = undefined; task.path = undefined
    this.publish(); this.pump()
  }
  async clearOwner() {
    const owner = this.ownerId
    this.ownerId = ''
    for (const task of this.tasks.filter(task => task.ownerId === owner)) this.active.get(task.id)?.abort()
    this.tasks = this.tasks.filter(task => task.ownerId !== owner)
    this.publish(); await this.store.write(this.tasks)
  }
  private pump() {
    if (!this.ownerId) return
    for (const task of this.tasks) {
      if (this.active.size >= 2) break
      if (task.ownerId !== this.ownerId || task.status !== 'queued') continue
      const controller = new AbortController()
      this.active.set(task.id, controller); task.status = 'resolving'
      void this.run(task, controller).finally(() => { this.active.delete(task.id); this.publish(); this.pump() })
    }
  }
  private async run(task: DownloadTask, controller: AbortController) {
    let temporary = ''
    const directory = this.directory
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const touch = () => { if (watchdog) clearTimeout(watchdog); watchdog = setTimeout(() => controller.abort(new MusicError('NETWORK', '下载超时，请检查网络后重试。')), 30000) }
    try {
      const stream = await this.resolve(task.track.id, task.quality)
      if (controller.signal.aborted || task.ownerId !== this.ownerId) return
      checkDownloadQuality(stream, task.quality)
      task.actualQuality = stream.quality || task.quality
      await mkdir(directory, { recursive: true })
      touch()
      const response = await fetch(stream.url, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': 'CloudMusicPlayer/0.1.0' } })
      if (!response.ok || !response.body) throw new MusicError('DOWNLOAD_HTTP', response.status === 403 ? '下载链接已过期或账号无下载权限，请重试。' : '下载请求失败，请稍后重试。')
      const contentType = response.headers.get('content-type') || ''
      if (/text\/|json|html/.test(contentType)) throw new MusicError('DOWNLOAD_FORMAT', '服务未返回音频文件，请稍后重试。')
      const extension = audioExtension(stream.format, contentType)
      const base = safeFilename(`${task.track.artists.map(artist => artist.name).join(' & ')} - ${task.track.title}`) + ` [${task.track.id}-${task.quality}]`
      temporary = join(directory, `.${task.id}.part`)
      task.total = Number(response.headers.get('content-length')) || stream.size
      task.received = 0; task.status = 'downloading'; this.publish()
      const progress = new Transform({ transform: (chunk, _encoding, callback) => {
        task.received += chunk.length; touch()
        if (Date.now() - this.lastUpdate > 250) { this.lastUpdate = Date.now(); this.publish(false) }
        callback(null, chunk)
      } })
      await pipeline(Readable.fromWeb(response.body as any), progress, createWriteStream(temporary, { flags: 'wx', mode: 0o644 }), { signal: controller.signal })
      if (!task.received || (task.total > 0 && task.received !== task.total)) throw new MusicError('DOWNLOAD_INCOMPLETE', '文件下载不完整，请重新下载。')
      if (controller.signal.aborted || task.ownerId !== this.ownerId) return
      let target = ''
      for (let index = 0; index < 1000; index++) {
        target = join(directory, `${base}${index ? ` (${index})` : ''}.${extension}`)
        try { await link(temporary, target); break } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || index === 999) throw error }
      }
      task.path = target; task.total = task.received; task.status = 'completed'; task.error = undefined
    } catch (error) {
      if (task.status !== 'cancelled') {
        task.status = 'failed'
        task.error = controller.signal.aborted ? (controller.signal.reason instanceof MusicError ? controller.signal.reason.message : '下载已中断，请重试。') : publicError(error).message
      }
    } finally {
      if (watchdog) clearTimeout(watchdog)
      if (temporary) await rm(temporary, { force: true }).catch(() => {})
    }
  }
  async close() {
    for (const controller of this.active.values()) controller.abort()
    if (this.saving) clearTimeout(this.saving)
    await this.store.write(this.tasks.map(task => ['resolving', 'downloading', 'queued'].includes(task.status) ? { ...task, status: 'interrupted' as const } : task))
  }
}
