// Optional public, logged-out API check. Never reads or prints user credentials.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-music-public-check-'))
process.env.TMPDIR = runtime
delete process.env.NETEASE_COOKIE
process.chdir(runtime)
const api = require('@neteasecloudmusicapienhanced/api')
async function check(name, args, summarize) {
  try {
    const value = await api[name]({ ...args, cookie: '', timeout: 12000, timestamp: Date.now() })
    console.log(JSON.stringify({ check: name, code: value.body?.code, ...summarize(value.body || {}) }))
  } catch (error) { console.log(JSON.stringify({ check: name, error: 'Request failed', code: error?.body?.code || error?.status || error?.code || null })); process.exitCode = 1 }
}
async function main() {
  await check('cloudsearch', { keywords: '音乐', type: 1, limit: 1 }, body => ({ returnedSongs: body.result?.songs?.length || 0 }))
  await check('search', { keywords: '音乐', type: 1, limit: 1 }, body => ({ returnedSongs: body.result?.songs?.length || 0 }))
  await check('toplist', {}, body => ({ returnedCharts: body.list?.length || 0 }))
  await check('login_qr_key', { noCookie: true }, body => ({ hasQrKey: Boolean(body.data?.unikey || body.unikey) }))
}
main().finally(() => { fs.rmSync(runtime, { recursive: true, force: true }) })
