const { _electron: electron } = require('@playwright/test')
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path')
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-music-package-check-'))
  let instance
  try {
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.CLOUD_MUSIC_TEST
    instance = await electron.launch({ executablePath: path.resolve('release/linux-unpacked/cloud-music-player'), args: ['--no-sandbox', '--disable-gpu', '--ozone-platform=headless', '--password-store=basic', `--user-data-dir=${directory}`], env })
    const page = await instance.firstWindow()
    await page.waitForSelector('.app-shell', { timeout: 30000 })
    await page.waitForFunction(async () => (await window.music.invoke('app.bootstrap')).data?.player.available, { timeout: 15000 })
    const packaged = await instance.evaluate(({ app }) => app.isPackaged)
    const result = await page.evaluate(() => window.music.invoke('app.bootstrap'))
    if (!packaged || !result.ok || !result.data.player.available) throw new Error('Packaged startup failed')
    const report = { version: await instance.evaluate(({ app }) => app.getVersion()), packaged, playerAvailable: result.data.player.available, devices: result.data.player.devices.length, fixtureDisabled: result.data.session.user === null }
    if (process.argv.includes('--network')) {
      const home = await page.evaluate(() => window.music.invoke('home.section', { section: 'recommended' }))
      if (!home.ok || !home.data.collections.length) throw new Error('Packaged public homepage failed')
      const detail = await page.evaluate(id => window.music.invoke('catalog.detail', { kind: 'playlist', id, offset: 0 }), home.data.collections[0].id)
      if (!detail.ok || !detail.data.tracks.length) throw new Error('Packaged public playlist failed')
      report.homeCollections = home.data.collections.length; report.playlistTracks = detail.data.tracks.length
    }
    console.log(JSON.stringify(report))
  } finally { if (instance) await instance.close(); await fs.rm(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
