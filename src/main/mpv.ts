import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { MusicError } from '../shared/errors'

export class Mpv extends EventEmitter {
  private process: ChildProcess | null = null
  private socket: Socket | null = null
  private directory = ''
  private sequence = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private starting: Promise<void> | null = null
  private stopping = false
  constructor(private runtimeDirectory: string, private executable: () => string, private headless = false) { super() }
  get running() { return !!this.socket && !this.socket.destroyed }
  async start(): Promise<void> {
    if (this.running) return
    if (this.starting) return this.starting
    this.starting = this.launch().finally(() => { this.starting = null })
    return this.starting
  }
  private async launch() {
    this.stopping = false
    await mkdir(this.runtimeDirectory, { recursive: true, mode: 0o700 })
    this.directory = await mkdtemp(join(this.runtimeDirectory, 'mpv-'))
    const socketPath = join(this.directory, 'ipc')
    const args = ['--no-config', '--idle=yes', '--vid=no', '--audio-display=no', '--no-terminal', '--load-scripts=no', '--ytdl=no', '--input-default-bindings=no', `--input-ipc-server=${socketPath}`]
    if (this.headless) args.push('--ao=null')
    const child = spawn(this.executable() || 'mpv', args, { stdio: ['ignore', 'ignore', 'ignore'], shell: false })
    this.process = child
    let spawnFailed = false
    child.on('error', () => { spawnFailed = true })
    child.once('exit', () => {
      if (this.process !== child) return
      this.socket?.destroy(); this.socket = null; this.process = null
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new MusicError('MPV_EXIT', 'mpv 已退出，请点击重新检测播放器。')) }
      this.pending.clear()
      if (!this.stopping) this.emit('crashed')
    })
    for (let attempt = 0; attempt < 60; attempt++) {
      if (spawnFailed || child.exitCode !== null) break
      const socket = await new Promise<Socket | null>(resolve => {
        const socket = connect(socketPath)
        socket.once('connect', () => resolve(socket))
        socket.once('error', () => { socket.destroy(); resolve(null) })
      })
      if (socket) {
        this.socket = socket
        this.read(socket)
        for (const [index, property] of ['time-pos', 'duration', 'pause', 'volume', 'audio-device-list'].entries()) await this.command(['observe_property', index + 1, property])
        return
      }
      await new Promise(resolve => setTimeout(resolve, 75))
    }
    await this.stop()
    throw new MusicError('MPV_MISSING', '无法启动 mpv。Ubuntu 可运行 sudo apt install mpv，然后在设置中重新检测。')
  }
  private read(socket: Socket) {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('error', () => {})
    socket.on('data', chunk => {
      buffer += chunk
      if (buffer.length > 8_000_000) { buffer = ''; return }
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        try {
          const value = JSON.parse(line)
          if (typeof value.request_id === 'number') {
            const item = this.pending.get(value.request_id)
            if (item) {
              clearTimeout(item.timer); this.pending.delete(value.request_id)
              if (value.error === 'success') item.resolve(value.data)
              else item.reject(new MusicError('MPV_COMMAND', '播放器未能执行操作，请重试。'))
            }
          }
          if (value.event) this.emit('event', value)
        } catch { /* A malformed mpv event must not break subsequent replies. */ }
      }
    })
  }
  command(command: unknown[]): Promise<any> {
    if (!this.running) return Promise.reject(new MusicError('MPV_UNAVAILABLE', '播放器尚未就绪，请在设置中检测 mpv。'))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new MusicError('MPV_TIMEOUT', '播放器响应超时，请重试。')) }, 12000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket!.write(JSON.stringify({ command, request_id: id }) + '\n', error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(new MusicError('MPV_EXIT', '播放器连接已断开。')) }
      })
    })
  }
  async stop() {
    this.stopping = true
    const child = this.process
    if (this.running) await this.command(['quit']).catch(() => {})
    if (child && child.exitCode === null) child.kill('SIGTERM')
    this.socket?.destroy(); this.socket = null; this.process = null
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new MusicError('MPV_EXIT', '播放器已关闭。')) }
    this.pending.clear()
    if (this.directory) await rm(this.directory, { recursive: true, force: true }).catch(() => {})
  }
}
