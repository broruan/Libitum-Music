import { MusicError } from '../shared/errors'
import { isProvider } from '../shared/platforms'
import type { ProviderId, User } from '../shared/types'
import type { MusicProvider } from './provider'

/** Keep login candidates separate from the account serving catalog/playback calls. */
export class PlatformRouter {
  private instances = new Map<ProviderId, Promise<MusicProvider>>()
  private revision = 0
  active: ProviderId = 'netease'
  constructor(netease: MusicProvider, private createQq: () => Promise<MusicProvider>) {
    this.instances.set('netease', Promise.resolve(netease))
  }
  candidate(id: ProviderId = 'netease'): Promise<MusicProvider> {
    if (!isProvider(id)) return Promise.reject(new MusicError('INVALID_ARGUMENT', '音乐平台无效。'))
    let provider = this.instances.get(id)
    if (!provider) {
      provider = this.createQq().catch(error => { this.instances.delete(id); throw error })
      this.instances.set(id, provider)
    }
    return provider
  }
  async setSession(id: ProviderId, cookie: string, user: User | null) {
    const revision = ++this.revision, previous = this.active
    const target = await this.candidate(id)
    if (revision !== this.revision) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新登录。')
    if (previous !== id) (await this.candidate(previous)).setSession('', null)
    if (revision !== this.revision) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新登录。')
    target.setSession(cookie, user)
    this.active = id
  }
  async clear() {
    // Invalidate reads before awaiting either provider's cleanup.
    const revision = ++this.revision, previous = this.active
    this.active = 'netease'
    const provider = await this.candidate(previous)
    if (revision !== this.revision) return
    provider.setSession('', null)
    if (previous !== 'netease') {
      const netease = await this.candidate('netease')
      if (revision === this.revision) netease.setSession('', null)
    }
  }
  async run<T>(operation: (provider: MusicProvider) => Promise<T> | T, expected?: ProviderId): Promise<T> {
    const revision = this.revision, active = this.active
    if (expected !== undefined && expected !== active) throw new MusicError('SESSION_CHANGED', '歌曲所属平台已改变，请重新选择。')
    const provider = await this.candidate(active)
    if (revision !== this.revision) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新加载。')
    try {
      const result = await operation(provider)
      if (revision !== this.revision) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新加载。')
      return result
    } catch (error) {
      if (revision !== this.revision) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新加载。')
      throw error
    }
  }
}
