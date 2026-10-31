import { describe, expect, it, vi } from 'vitest'
import { NeteaseProvider } from '../../src/main/provider'
import { createFixtureApi } from '../../src/main/test-fixtures'
import { mergeCookies, neteaseError } from '../../src/main/netease-errors'
import { qrRetryDelay, transientLoginError } from '../../src/shared/login'

describe('QR login error recovery', () => {
  it('uses the fixed generic endpoint instead of the dependency helper with the broken catch block', async () => {
    const api = createFixtureApi()
    api.login_qr_check = vi.fn(async () => { throw new ReferenceError('result is not defined') })
    const raw = vi.fn(async () => ({ body: { code: 801 } }))
    api.api = raw
    const provider = new NeteaseProvider(api), qr = await provider.qrStart()
    expect(await provider.qrCheck(qr.key)).toEqual({ state: 'waiting' })
    expect(raw).toHaveBeenCalledWith(expect.objectContaining({ uri: '/api/login/qrcode/client/login', data: { key: qr.key, type: 3 } }))
    expect(api.login_qr_check).not.toHaveBeenCalled()
  })
  it('retains server cookies across the key, image, and status requests', async () => {
    const api = createFixtureApi()
    api.login_qr_key = async () => ({ body: { code: 200, data: { unikey: 'key' } }, cookie: ['NMTID=anonymous; Path=/; HttpOnly', 'MUSIC_A=guest; Secure'] })
    const originalCreate = api.login_qr_create
    api.login_qr_create = vi.fn(originalCreate)
    api.api = vi.fn(async () => ({ body: { code: 802 } }))
    const provider = new NeteaseProvider(api), qr = await provider.qrStart()
    expect(await provider.qrCheck(qr.key)).toEqual({ state: 'confirm' })
    const expected = expect.objectContaining({ cookie: 'NMTID=anonymous; MUSIC_A=guest' })
    expect(api.login_qr_create).toHaveBeenCalledWith(expected); expect(api.api).toHaveBeenCalledWith(expected)
  })
  it('can recover from a transport failure without regenerating or losing the QR session', async () => {
    const api = createFixtureApi()
    api.login_qr_key = vi.fn(api.login_qr_key)
    api.api = vi.fn().mockRejectedValueOnce({ body: { code: 502, msg: 'read ECONNRESET' } }).mockResolvedValueOnce({ body: { code: 801 } })
    const provider = new NeteaseProvider(api), qr = await provider.qrStart()
    await expect(provider.qrCheck(qr.key)).rejects.toMatchObject({ code: 'NETWORK' })
    expect(await provider.qrCheck(qr.key)).toEqual({ state: 'waiting' }); expect(api.login_qr_key).toHaveBeenCalledTimes(1)
  })
  it('classifies rejected risk responses separately and never exposes their raw content', async () => {
    const api = createFixtureApi()
    api.api = async () => { throw { body: { code: -460, message: '设备环境异常 MUSIC_U=private' } } }
    const provider = new NeteaseProvider(api), qr = await provider.qrStart()
    await expect(provider.qrCheck(qr.key)).rejects.toMatchObject({ code: 'RISK_BLOCKED' })
    const problem = neteaseError({ body: { code: 403, msg: 'private data' } })
    expect(problem.message).not.toContain('private'); expect(transientLoginError(problem.code)).toBe(false)
  })
  it('classifies a resolved rate limit separately', async () => {
    const api = createFixtureApi(); api.api = async () => ({ body: { code: 405, message: '操作频繁' } })
    const provider = new NeteaseProvider(api), qr = await provider.qrStart()
    await expect(provider.qrCheck(qr.key)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })
  it('does not finalize an in-flight QR login after its dialog was cancelled', async () => {
    let release: (value: any) => void = () => {}
    const api = createFixtureApi(); api.login_status = vi.fn(api.login_status)
    api.api = () => new Promise(resolve => { release = resolve })
    const provider = new NeteaseProvider(api), qr = await provider.qrStart(), checking = provider.qrCheck(qr.key)
    provider.qrCancel(qr.key); release({ body: { code: 803 }, cookie: ['MUSIC_U=fixture; HttpOnly'] })
    expect(await checking).toEqual({ state: 'expired' }); expect(api.login_status).not.toHaveBeenCalled()
  })
  it('keeps a confirmed credential if profile validation temporarily fails, avoiding repeated QR status requests', async () => {
    const api = createFixtureApi(), original = api.login_status
    api.login_status = vi.fn().mockRejectedValueOnce({ body: { code: 502 } }).mockImplementation(original)
    api.api = vi.fn(async () => ({ body: { code: 803 }, cookie: ['MUSIC_U=fixture; Path=/; HttpOnly'] }))
    const provider = new NeteaseProvider(api), qr = await provider.qrStart()
    await expect(provider.qrCheck(qr.key)).rejects.toMatchObject({ code: 'NETWORK' })
    expect(await provider.qrCheck(qr.key)).toMatchObject({ state: 'success', user: { id: '42' }, cookie: 'MUSIC_U=fixture; __csrf=fixture-csrf' })
    expect(api.api).toHaveBeenCalledTimes(1)
  })
  it('stops polling an expired QR locally', async () => {
    const api = createFixtureApi(); api.api = vi.fn(async () => ({ body: { code: 800 } }))
    const provider = new NeteaseProvider(api), qr = await provider.qrStart()
    expect(await provider.qrCheck(qr.key)).toEqual({ state: 'expired' })
    expect(await provider.qrCheck(qr.key)).toEqual({ state: 'expired' }); expect(api.api).toHaveBeenCalledTimes(1)
  })
  it('coalesces concurrent status checks and limits rapid key generation', async () => {
    const api = createFixtureApi(); let release: (value: any) => void = () => {}
    api.api = vi.fn(() => new Promise<any>(resolve => { release = resolve }))
    const provider = new NeteaseProvider(api)
    const [one, two] = await Promise.all([provider.qrStart(), provider.qrStart()]); expect(one.key).toBe(two.key)
    await expect(provider.qrStart()).rejects.toMatchObject({ code: 'LOGIN_COOLDOWN' })
    const first = provider.qrCheck(one.key), second = provider.qrCheck(one.key)
    release({ body: { code: 801 } }); expect(await first).toEqual(await second); expect(api.api).toHaveBeenCalledTimes(1)
  })
  it('bounds automatic retries and filters cookie attributes', () => {
    expect([1, 2, 3, 4].map(qrRetryDelay)).toEqual([4000, 8000, 16000, null])
    expect(mergeCookies('NMTID=old', ['NMTID=new; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly', 'MUSIC_U=value; Secure'])).toBe('NMTID=new; MUSIC_U=value')
    expect(mergeCookies('', 'MUSIC_U=value; Path=/; SameSite=Lax')).toBe('MUSIC_U=value')
  })
})
