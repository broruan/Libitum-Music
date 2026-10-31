import { MusicError } from '../shared/errors'

/** Keep upstream status semantics without exposing raw messages or credentials. */
export function neteaseError(value: unknown): MusicError {
  const source = value as any
  const body = source?.body ?? source?.response?.data ?? source ?? {}
  const code = Number(body?.code ?? source?.status ?? source?.response?.status)
  const message = typeof body?.message === 'string' ? body.message : typeof body?.msg === 'string' ? body.msg : ''
  const problem = (kind: string, text: string) => new MusicError(kind, text, Number.isFinite(code) ? code : undefined)
  if (/csrf|认证字段|令牌缺失/i.test(message)) return problem('AUTH_INCOMPLETE', '认证字段不完整，请重新扫码登录后再试。')
  if ([429, 405].includes(code) || /操作.{0,6}频繁|访问.{0,6}频繁|too many requests/i.test(message)) return problem('RATE_LIMITED', '操作过于频繁，请稍后再试；本次不会自动重复提交。')
  if ([-460, -462].includes(code) || /风控|环境异常|操作.{0,12}拦截|行为.{0,6}异常|device.{0,20}blocked/i.test(message)) {
    return problem('RISK_BLOCKED', '网易云限制了本次操作。请暂停重复尝试，并按官方 App 的提示处理；客户端无法解除此限制。')
  }
  if (code === 301 || code === 401) return problem('AUTH_EXPIRED', '登录已失效，请重新登录。')
  if (code === 403) return problem('ACCESS_DENIED', '网易云拒绝了此操作（403）。请检查登录状态；本次不会自动重复提交。')
  if (!Number.isFinite(code) || [502, 503, 504].includes(code) || /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timeout|socket hang up/i.test(message)) return problem('NETWORK', '连接网易云失败，请检查网络后重试。')
  return problem('UPSTREAM', `网易云暂未能完成此请求${Number.isFinite(code) ? `（${code}）` : ''}，请稍后重试。`)
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
