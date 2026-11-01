import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

let instance: ElectronApplication | undefined, directory: string
async function openLogin(scenario: string): Promise<Page> {
  directory = await mkdtemp(join(tmpdir(), 'libitum-login-test-'))
  const env: Record<string, string> = { ...process.env, CLOUD_MUSIC_TEST: '1', CLOUD_MUSIC_TEST_DIR: directory, CLOUD_MUSIC_TEST_QR: scenario }
  delete env.ELECTRON_RUN_AS_NODE
  instance = await electron.launch({ args: [resolve('out/main/index.js'), '--no-sandbox', '--disable-gpu', '--ozone-platform=headless', '--password-store=basic'], env })
  const page = await instance.firstWindow()
  await page.getByRole('button', { name: '登录音乐账号 同步你的专属音乐库' }).click()
  await expect(page.getByAltText('网易云登录二维码')).toBeVisible()
  return page
}
test.afterEach(async () => { if (instance) await instance.close(); instance = undefined; if (directory) await rm(directory, { recursive: true, force: true }) })
test('recovers a transient status failure using the same QR, without requesting a new key', async () => {
  const page = await openLogin('transient'), image = page.getByAltText('网易云登录二维码')
  const original = await image.getAttribute('src')
  await expect(page.getByText('连接暂时中断，正在重新检查同一张二维码，无需重新扫码。')).toBeVisible({ timeout: 7000 })
  await expect(page.getByText('连接暂时中断，正在重新检查同一张二维码，无需重新扫码。')).toHaveCount(0, { timeout: 7000 })
  await expect(page.getByText('使用网易云音乐 App 扫码', { exact: true })).toBeVisible()
  expect(await image.getAttribute('src')).toBe(original)
})
test('shows a risk block without a retry button and offers an existing-session import', async () => {
  const page = await openLogin('blocked')
  await expect(page.getByText('本次登录已被网易云音乐限制', { exact: true })).toBeVisible({ timeout: 7000 })
  await expect(page.getByRole('button', { name: '重新加载', exact: true })).toHaveCount(0)
  await expect(page.getByText('连接网易云失败，请检查网络后重试。', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/login-blocked.png', animations: 'disabled' })
  await page.getByRole('button', { name: '使用已有 Cookie', exact: true }).click()
  await expect(page.getByLabel('登录 Cookie')).toBeVisible()
  await expect(page.getByRole('button', { name: '打开网易云音乐网页版', exact: true })).toBeVisible()
})
test('completes a confirmed QR session through the main process without returning credentials to the renderer', async () => {
  const page = await openLogin('success')
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 7000 })
  await expect(page.getByRole('heading', { name: '测试听众，今天想听点什么？' })).toBeVisible()
  const result = await page.evaluate(() => window.music.invoke('app.bootstrap'))
  expect(JSON.stringify(result)).not.toContain('MUSIC_U=')
})
