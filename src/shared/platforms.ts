import type { ProviderId, Session } from './types'

export const PROVIDERS: Record<ProviderId, string> = { netease: '网易云音乐', qq: 'QQ音乐' }
export function isProvider(value: unknown): value is ProviderId { return value === 'netease' || value === 'qq' }
export function sessionProvider(session: Session): ProviderId { return session.user && session.provider === 'qq' ? 'qq' : 'netease' }
export function accountKey(provider: ProviderId, userId: string): string { return `${provider}:${userId}` }
