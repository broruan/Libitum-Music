import { MusicError } from '../shared/errors'

/** Keep upstream status semantics without exposing raw messages or credentials. */
export function neteaseError(value: unknown): MusicError {
  const source = value as any
  const body = source?.body ?? source?.response?.data ?? source ?? {}
  const code = Number(body?.code ?? source?.status ?? source?.response?.status)
  const message = typeof body?.message === 'string' ? body.message : typeof body?.msg === 'string' ? body.msg : ''
  if ([403, 405, 429, -460, -462].includes(code) || /风控|环境异常|操作.{0,12}拦截|操作.{0,6}频繁|访问.{0,6}频繁|行为.{0,6}异常|too many requests|device.{0,20}blocked/i.test(message)) {
    return new MusicError('RISK_BLOCKED', '网易云限制了本次操作。请暂停重复尝试，并按官方 App 的提示处理；客户端无法解除此限制。')
  }
  if (code === 301 || code === 401) return new MusicError('AUTH_EXPIRED', '登录已失效，请重新登录。')
  if (!Number.isFinite(code) || code >= 500) return new MusicError('NETWORK', '连接网易云失败，请检查网络后重试。')
  return new MusicError('UPSTREAM', '网易云暂未能完成此请求，请稍后重试。')
}

/** Set-Cookie attributes must never be sent as request cookies. */
export function mergeCookies(base: string, incoming: string | string[] | undefined): string {
  const cookies = new Map<string, string>()
  const add = (part: string) => {
    const separator = part.indexOf('=')
    if (separator < 1) return
    const name = part.slice(0, separator).trim(), value = part.slice(separator + 1).trim()
    if (!/^[\w.-]+$/.test(name) || /^(?:path|domain|expires|max-age|samesite|secure|httponly|priority)$/i.test(name) || /[\r\n\x00]/.test(value)) return
    cookies.set(name, value)
  }
  base.split(';').forEach(add)
  if (Array.isArray(incoming)) incoming.forEach(line => add(line.split(';')[0]))
  else if (typeof incoming === 'string') incoming.split(';').forEach(add)
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
}
