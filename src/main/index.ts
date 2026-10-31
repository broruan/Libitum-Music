import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron'
import { mkdir, access } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { WorkerBackend } from './backend'
import { JsonStore } from './store'
import { Mpv } from './mpv'
import { Player, type SavedQueue } from './player'
import { isTrack, validateCommand } from './validation'
import { MusicError, publicError } from '../shared/errors'
import { QUALITIES, type AppEvent, type Bootstrap, type Command, type DownloadTask, type Session, type Settings, type User } from '../shared/types'

app.setName('cloud-music-player')
if (process.platform === 'linux') app.setDesktopName('cloud-music-player.desktop')
const testMode = !app.isPackaged && process.env.CLOUD_MUSIC_TEST === '1'
const explicitDataDirectory = app.commandLine.getSwitchValue('user-data-dir')
if (explicitDataDirectory.startsWith('/')) app.setPath('userData', explicitDataDirectory)
if (testMode && process.env.CLOUD_MUSIC_TEST_DIR) app.setPath('userData', process.env.CLOUD_MUSIC_TEST_DIR)
protocol.registerSchemesAsPrivileged([{ scheme: 'music-app', privileges: { secure: true, standard: true, supportFetchAPI: true } }])
const locked = app.requestSingleInstanceLock()
if (!locked) app.quit()
let window: BrowserWindow | null = null
let backend: WorkerBackend
let player: Player
let session: Session = { user: null, persistent: false }
let settings: Settings
let settingsStore: JsonStore<Settings>
let queueStore: JsonStore<SavedQueue>
let sessionStore: JsonStore<{ encrypted: string; user: User } | null>
let tasks: DownloadTask[] = []
let queueTimer: ReturnType<typeof setTimeout> | null = null
let exiting = false
let clearing: Promise<void> | null = null
let authEpoch = 0
const send = (event: AppEvent) => { if (window && !window.isDestroyed()) window.webContents.send('music:event', event) }
const notice = (message: string) => send({ type: 'notice', data: message })
function saveSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch }
  void settingsStore.write(settings).catch(() => notice('设置保存失败，请检查磁盘空间。'))
  send({ type: 'settings', data: settings })
}
function saveQueue() {
  if (queueTimer) clearTimeout(queueTimer)
  queueTimer = setTimeout(() => { queueTimer = null; void queueStore.write(player.saved()).catch(() => notice('播放队列保存失败。')) }, 500)
}
async function establish(cookie: string, user: User): Promise<Session> {
  authEpoch++
  await backend.call('session.set', { cookie, user })
  const persistent = safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text'
  session = { user, persistent, message: persistent ? undefined : '系统密钥环不可用，登录仅在本次运行中保留。' }
  await sessionStore.write(persistent ? { encrypted: safeStorage.encryptString(cookie).toString('base64'), user } : null)
  send({ type: 'session', data: session }); send({ type: 'library', data: null })
  return session
}
async function logout(expired = false) {
  if (clearing) return clearing
  clearing = (async () => {
    authEpoch++
    session = { user: null, persistent: false, message: expired ? '登录已失效，请重新登录。' : undefined }
    await player.stop()
    await backend.call('session.clear').catch(() => {})
    await sessionStore.write(null).catch(() => sessionStore.remove())
    tasks = []; send({ type: 'session', data: session }); send({ type: 'downloads', data: [] }); send({ type: 'library', data: null })
  })().finally(() => { clearing = null })
  return clearing
}
async function handle(command: Command, args: any): Promise<any> {
  switch (command) {
    case 'app.bootstrap': return { session, settings, player: player.snapshot(), downloads: tasks, version: app.getVersion() } satisfies Bootstrap
    case 'auth.qrStart': return backend.call(command)
    case 'auth.qrCancel': return backend.call(command, args)
    case 'auth.qrCheck': {
      const result = await backend.call(command, args)
      if (result.state === 'success') return { state: 'success', session: await establish(result.cookie, result.user) }
      return { state: result.state }
    }
    case 'auth.importCookie': { const result = await backend.call(command, args); return establish(result.cookie, result.user) }
    case 'auth.logout': return logout()
    case 'library.like': case 'library.subscribe': { await backend.call(command, args); send({ type: 'library', data: null }); return }
    case 'catalog.search': case 'catalog.detail': case 'catalog.allTracks': case 'catalog.lyrics': case 'home.section': case 'library.list': {
      const epoch = authEpoch
      const value = await backend.call(command, args)
      if (epoch !== authEpoch) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新加载。')
      return value
    }
    case 'player.play': return player.play(args.tracks, args.index, args.append)
    case 'player.toggle': return player.toggle()
    case 'player.next': return player.next()
    case 'player.previous': return player.previous()
    case 'player.seek': return player.seek(args.seconds)
    case 'player.volume': return player.volume(args.volume)
    case 'player.repeat': return player.repeat(args.mode)
    case 'player.quality': return player.quality(args.quality)
    case 'player.device': return player.device(args.id)
    case 'player.refreshDevices': return player.refreshDevices()
    case 'player.remove': return player.remove(args.index)
    case 'player.radio': return player.radio(args)
    case 'player.dislike': return player.dislike()
    case 'downloads.add': case 'downloads.cancel': case 'downloads.retry': return backend.call(command, args)
    case 'downloads.reveal': case 'downloads.play': {
      const task = await backend.call<DownloadTask>('downloads.get', args)
      if (task.status !== 'completed' || !task.path) throw new MusicError('FILE_UNAVAILABLE', '下载尚未完成。')
      await access(task.path)
      if (command === 'downloads.reveal') { shell.showItemInFolder(task.path); return }
      return player.playDownload(task)
    }
    case 'settings.update': {
      const changedMpv = args.mpvPath && args.mpvPath !== settings.mpvPath
      saveSettings(args)
      if (changedMpv) await player.restart()
      return settings
    }
    case 'settings.pickDirectory': {
      const result = await dialog.showOpenDialog(window!, { title: '选择音乐下载目录', defaultPath: settings.downloadDirectory, properties: ['openDirectory', 'createDirectory'] })
      if (!result.canceled && result.filePaths[0]) { saveSettings({ downloadDirectory: result.filePaths[0] }); await backend.call('settings.directory', { directory: settings.downloadDirectory }) }
      return settings
    }
    case 'app.openExternal': return shell.openExternal(args.url)
  }
}
async function initialize() {
  const userData = app.getPath('userData'), runtime = join(userData, 'runtime')
  await mkdir(runtime, { recursive: true, mode: 0o700 })
  const defaults: Settings = { quality: 'exhigh', downloadQuality: 'exhigh', downloadDirectory: join(testMode ? userData : app.getPath('music'), 'Libitum music 下载'), deviceId: 'auto', volume: 60, theme: 'system', mpvPath: 'mpv' }
  settingsStore = new JsonStore(join(userData, 'settings.json'), defaults)
  const stored = await settingsStore.read()
  settings = { ...defaults, ...stored }
  if (!Object.hasOwn(QUALITIES, settings.quality)) settings.quality = defaults.quality
  if (!Object.hasOwn(QUALITIES, settings.downloadQuality)) settings.downloadQuality = defaults.downloadQuality
  if (!['system', 'light', 'dark'].includes(settings.theme)) settings.theme = 'system'
  if (!Number.isFinite(settings.volume)) settings.volume = defaults.volume
  settings.volume = Math.max(0, Math.min(100, settings.volume))
  if (typeof settings.deviceId !== 'string') settings.deviceId = 'auto'
  if (typeof settings.downloadDirectory !== 'string' || !settings.downloadDirectory.startsWith('/')) settings.downloadDirectory = defaults.downloadDirectory
  if (typeof settings.mpvPath !== 'string' || !(settings.mpvPath === 'mpv' || settings.mpvPath.startsWith('/'))) settings.mpvPath = 'mpv'
  queueStore = new JsonStore<SavedQueue>(join(userData, 'queue.json'), { queue: [], index: -1, position: 0, repeat: 'list' })
  sessionStore = new JsonStore(join(userData, 'session.json'), null)
  backend = new WorkerBackend()
  backend.on('downloads', data => { tasks = data; send({ type: 'downloads', data }) })
  backend.on('notice', notice)
  backend.on('expired', () => { if (session.user) void logout(true).catch(() => notice('登录失效，请重新启动应用后登录。')) })
  backend.on('failed', () => { notice('网易云后台已退出，请重新启动应用。'); void player.stop(false) })
  backend.start(runtime)
  await backend.call('init', { userData, directory: settings.downloadDirectory, testMode, testUrl: testMode ? process.env.CLOUD_MUSIC_TEST_URL : undefined, testQrScenario: testMode ? process.env.CLOUD_MUSIC_TEST_QR : undefined })
  player = new Player(new Mpv(runtime, () => settings.mpvPath, testMode), backend, settings, data => send({ type: 'player', data }), saveQueue, saveSettings)
  const saved = await queueStore.read()
  if (saved && Array.isArray(saved.queue) && saved.queue.every(isTrack)) player.restore(saved)
  const credentials = await sessionStore.read()
  let restoring: { cookie: string; user: User } | null = null
  if (credentials && safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text') {
    try {
      const cookie = safeStorage.decryptString(Buffer.from(credentials.encrypted, 'base64'))
      await backend.call('session.set', { cookie, user: credentials.user })
      session = { user: credentials.user, persistent: true, message: '正在验证登录状态…' }
      restoring = { cookie, user: credentials.user }
    } catch { await sessionStore.remove(); session.message = '上次登录无法恢复，请重新登录。' }
  }
  ipcMain.handle('music:invoke', async (event, command: unknown, args: unknown) => {
    try {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new MusicError('FORBIDDEN', '请求来源无效。')
      validateCommand(command, args)
      return { ok: true, data: await handle(command, args) }
    } catch (error) { return { ok: false, error: publicError(error) } }
  })
  protocol.handle('music-app', async request => {
    const url = new URL(request.url)
    const base = resolve(__dirname, '../renderer')
    let pathname: string
    try { pathname = decodeURIComponent(url.pathname) } catch { return new Response('Bad request', { status: 400 }) }
    const file = resolve(base, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (url.hostname !== 'bundle' || !file.startsWith(base + sep)) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
  createWindow()
  void player.initialize()
  if (restoring) {
    const epoch = authEpoch, savedSession = restoring
    void backend.call('auth.importCookie', { cookie: savedSession.cookie }).then(async result => {
      if (epoch === authEpoch) await establish(savedSession.cookie, result.user)
    }).catch(async error => {
      if (epoch !== authEpoch) return
      if (error instanceof MusicError && error.code === 'AUTH_EXPIRED') await logout(true)
      else { session = { ...session, message: '暂时无法验证登录，已保留本机会话；联网后可重试。' }; send({ type: 'session', data: session }) }
    }).catch(() => notice('登录状态恢复失败，请重新登录。'))
  }
  const checkpoint = setInterval(() => { void queueStore.write(player.saved()).catch(() => {}) }, 10000)
  checkpoint.unref()
}
function createWindow() {
  window = new BrowserWindow({ width: 1440, height: 940, minWidth: 1000, minHeight: 680, show: false, title: 'Libitum music', backgroundColor: '#f7f8fa', autoHideMenuBar: true, icon: join(app.getAppPath(), 'resources/icon.png'), webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const dev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL
    const csp = `default-src 'self'; script-src 'self'${dev ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'${dev ? ' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*' : ''}; object-src 'none'; frame-src 'none'; base-uri 'none'`
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
  })
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => { window = null })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadURL('music-app://bundle/index.html')
}
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus() } })
app.on('window-all-closed', () => app.quit())
app.on('before-quit', event => {
  if (exiting || !player) return
  event.preventDefault(); exiting = true
  if (queueTimer) clearTimeout(queueTimer)
  void (async () => {
    await queueStore.write(player.saved()).catch(() => {})
    await player.dispose()
    await backend.close()
    await settingsStore.flush().catch(() => {})
    app.quit()
  })()
})
if (locked) void app.whenReady().then(initialize).catch(error => { console.error('Libitum music初始化失败', publicError(error)); dialog.showErrorBox('Libitum music启动失败', '无法初始化应用数据或音乐服务，请检查数据目录权限后重试。'); exiting = true; app.quit() })
