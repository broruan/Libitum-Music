import { utilityProcess, type UtilityProcess } from 'electron'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { MusicError } from '../shared/errors'

export class WorkerBackend extends EventEmitter {
  private child: UtilityProcess | null = null
  private sequence = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private closing = false
  start(runtime: string) {
    this.child = utilityProcess.fork(join(__dirname, 'worker.js'), [], { serviceName: 'Libitum music · 网易云服务', env: { ...process.env, TMPDIR: runtime }, stdio: 'ignore' })
    this.child.on('message', message => {
      if (message.event) { this.emit(message.event, message.data); return }
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer); this.pending.delete(message.id)
      if (message.ok) pending.resolve(message.data)
      else pending.reject(new MusicError(message.error.code, message.error.message))
    })
    this.child.on('exit', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new MusicError('WORKER_EXIT', '音乐服务已退出，请重新启动应用。')) }
      this.pending.clear(); this.child = null
      if (!this.closing) this.emit('failed')
    })
  }
  call<T = any>(method: string, args?: any): Promise<T> {
    if (!this.child) return Promise.reject(new MusicError('WORKER_EXIT', '音乐服务不可用，请重新启动应用。'))
    const id = ++this.sequence
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new MusicError('TIMEOUT', '操作超时，请稍后重试。')) }, method === 'catalog.allTracks' ? 300000 : 45000)
      this.pending.set(id, { resolve, reject, timer }); this.child!.postMessage({ id, method, args })
    })
  }
  async close() {
    this.closing = true
    await this.call('close').catch(() => {})
    this.child?.kill()
  }
}
