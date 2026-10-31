import { test,expect,_electron as electron,type ElectronApplication,type Page } from '@playwright/test'
import { createServer,type Server } from 'node:http'
import { mkdtemp,rm,writeFile,readFile,mkdir,rename } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
const exec=promisify(execFile)
let instance:ElectronApplication,page:Page,server:Server,directory:string
const commentRequests:{id:string;offset:number}[]=[]
let commentDelay=0
test.describe.configure({mode:'serial'})
test.beforeAll(async()=>{
  directory=await mkdtemp(join(tmpdir(),'libitum-experience-'))
  const audio=Buffer.alloc(44+8000*2*120);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(16000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40)
  server=createServer((req,res)=>{if(req.url?.startsWith('/comments')){const url=new URL(req.url,'http://localhost');commentRequests.push({id:url.searchParams.get('id')||'',offset:Number(url.searchParams.get('offset'))});setTimeout(()=>{res.writeHead(204);res.end()},commentDelay);return}res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':audio.length});res.end(audio)})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as any).port
  const env:Record<string,string>={...process.env,CLOUD_MUSIC_TEST:'1',CLOUD_MUSIC_TEST_DIR:directory,CLOUD_MUSIC_TEST_URL:`http://127.0.0.1:${port}/audio.wav`};delete env.ELECTRON_RUN_AS_NODE
  instance=await electron.launch({args:[resolve('out/main/index.js'),'--no-sandbox','--disable-gpu','--ozone-platform=headless','--password-store=basic'],env})
  page=await instance.firstWindow();await expect(page.locator('.app-shell')).toBeVisible()
  const login=await page.evaluate(()=>window.music.invoke('auth.importCookie',{cookie:'MUSIC_U=fixture'}));expect(login.ok).toBe(true)
  await page.getByLabel('搜索音乐').fill('晚风');await page.getByLabel('搜索音乐').press('Enter');await page.getByRole('button',{name:'播放 晚风经过',exact:true}).click();await expect(page.getByRole('button',{name:'暂停播放',exact:true})).toBeVisible();await page.getByRole('button',{name:'暂停播放',exact:true}).click()
})
test.afterAll(async()=>{if(instance)await instance.close();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));if(directory)await rm(directory,{recursive:true,force:true})})
test('opens comments on demand with independent scrolling, paging and keyboard close',async()=>{
  await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,680))
  await page.getByRole('button',{name:'打开当前歌曲播放详情'}).click()
  await expect(page.getByRole('heading',{name:'晚风经过',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'评论',exact:true})).toHaveAttribute('aria-expanded','false')
  expect(commentRequests).toHaveLength(0)
  await page.getByRole('button',{name:'评论',exact:true}).click()
  await expect(page.getByText('愿每一段旋律都带来好心情。',{exact:true})).toBeVisible()
  await expect.poll(()=>commentRequests.length).toBe(1)
  await expect.poll(async()=>{const a=await page.locator('.song-comments').boundingBox(),b=await page.locator('.listening-stage').boundingBox();return Math.abs(a!.width-b!.width)}).toBeLessThan(2)
  const cover=await page.locator('.album-disc').boundingBox()
  await page.locator('.comments-scroll').hover();await page.mouse.wheel(0,700)
  await expect.poll(()=>page.locator('.comments-scroll').evaluate(e=>e.scrollTop)).toBeGreaterThan(100)
  expect((await page.locator('.album-disc').boundingBox())!.y).toBe(cover!.y)
  expect(await page.locator('.content-scroll').evaluate(e=>e.scrollTop)).toBe(0)
  await page.getByRole('button',{name:'下一页',exact:true}).click()
  await expect.poll(()=>commentRequests.at(-1)?.offset).toBe(20)
  await page.evaluate(()=>window.music.invoke('player.next'))
  await expect(page.getByRole('heading',{name:'海岸线',exact:true})).toBeVisible()
  await expect.poll(()=>commentRequests.at(-1)).toEqual({id:'1002',offset:0})
  await page.getByRole('button',{name:'歌词',exact:true}).click()
  await page.getByRole('button',{name:'切换实时频谱',exact:true}).click()
  await expect(page.locator('#listening-lyrics')).toBeVisible()
  expect(await page.locator('.content-scroll').evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true)
  expect((await page.locator('.album-disc').boundingBox())!.height).toBeGreaterThan(70)
  await page.screenshot({path:'test-results/listening-split.png',animations:'disabled'})
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'评论',exact:true})).toHaveAttribute('aria-expanded','false')
  await expect(page.getByRole('button',{name:'评论',exact:true})).toBeFocused()
  commentDelay=250;const before=commentRequests.length
  await page.getByRole('button',{name:'评论',exact:true}).click();await expect.poll(()=>commentRequests.length).toBe(before+1)
  await page.getByRole('button',{name:'关闭评论',exact:true}).click();await page.waitForTimeout(300)
  await expect(page.getByRole('complementary',{name:'歌曲评论'})).toHaveCount(0)
  expect(commentRequests.length).toBe(before+1);commentDelay=0
  await page.evaluate(()=>window.music.invoke('settings.update',{spectrum:{enabled:false,color:'#ef6079',secondaryColor:'#9975e8',gradient:true}}))
  await page.evaluate(()=>window.music.invoke('player.previous'))
  await page.getByRole('button',{name:'暂停播放',exact:true}).click()
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'外观与播放页',exact:true}).click()
  await page.getByRole('checkbox',{name:'启用歌曲评论',exact:true}).uncheck()
  await page.getByRole('button',{name:'打开当前歌曲播放详情'}).click();await expect(page.getByRole('button',{name:'评论',exact:true})).toHaveCount(0)
  await page.evaluate(()=>window.music.invoke('settings.update',{commentsEnabled:true}))
  await expect(page.getByRole('button',{name:'评论',exact:true})).toHaveAttribute('aria-expanded','false')
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'打开当前歌曲播放详情'}).click()
  await expect(page.getByRole('button',{name:'评论',exact:true})).toHaveAttribute('aria-expanded','false')
  await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,940))
})
test('adds the playing song to an editable playlist and handles an existing entry',async()=>{
  await page.locator('.listening-actions').getByRole('button',{name:'加入歌单',exact:true}).click()
  await page.getByRole('button',{name:'我的测试歌单 0 首',exact:true}).click()
  await expect(page.getByRole('dialog',{name:'加入歌单'})).toHaveCount(0)
  await page.locator('.listening-actions').getByRole('button',{name:'加入歌单',exact:true}).click()
  await page.getByRole('button',{name:'我的测试歌单 1 首',exact:true}).click()
  await expect(page.getByText('这首歌已在该歌单中。',{exact:true})).toBeVisible()
  const detail=await page.evaluate(()=>window.music.invoke('catalog.detail',{kind:'playlist',id:'102',offset:0}));expect(detail.ok&&detail.data.tracks.map(t=>t.id)).toEqual(['1001'])
})
test('confirms album subscription and cancellation against the refreshed library',async()=>{
  await page.getByLabel('搜索音乐').fill('一起听见');await page.getByLabel('搜索音乐').press('Enter')
  await page.locator('.tabs').getByRole('button',{name:'专辑',exact:true}).click()
  await page.getByRole('button',{name:'一起听见 Libitum music测试歌手',exact:true}).click()
  await page.locator('.detail-info').getByRole('button',{name:'收藏专辑',exact:true}).click();await expect(page.getByRole('button',{name:'已收藏',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'收藏专辑',exact:true}).click()
  await expect(page.getByRole('button',{name:'一起听见 Libitum music测试歌手',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'一起听见 Libitum music测试歌手',exact:true}).click()
  await page.getByRole('button',{name:'已收藏',exact:true}).click();await expect(page.locator('.detail-info').getByRole('button',{name:'收藏专辑',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'打开当前歌曲播放详情'}).click()
})
test('imports and applies a real PEQ preset while paused without losing progress',async()=>{
  await page.evaluate(()=>window.music.invoke('player.seek',{seconds:7}))
  await page.waitForTimeout(250)
  const before=await page.evaluate(()=>window.music.invoke('app.bootstrap'));const originalPosition=before.ok?before.data.player.position:0
  expect(originalPosition).toBeGreaterThan(6.5)
  const preset=join(directory,'preset.txt');await writeFile(preset,'Preamp: -4 dB\nFilter 1: ON PK Fc 1000 Hz Gain -3 dB Q 1\n')
  await instance.evaluate(({dialog},path)=>{(dialog as any).showOpenDialog=async()=>({canceled:false,filePaths:[path]})},preset)
  await page.locator('.playback-options').getByRole('button',{name:'十段 PEQ',exact:true}).click()
  await page.getByRole('button',{name:'导入 TXT',exact:true}).click();await expect(page.getByText('已载入预览，尚未应用到播放。',{exact:true})).toBeVisible()
  await expect(page.getByLabel('第 1 段增益',{exact:true})).toHaveValue('-3')
  await page.getByRole('button',{name:'应用 PEQ',exact:true}).click()
  await expect.poll(async()=>{const result=await page.evaluate(()=>window.music.invoke('app.bootstrap'));return result.ok&&result.data.settings.peq.enabled}).toBe(true)
  const result=await page.evaluate(()=>window.music.invoke('app.bootstrap'));expect(result.ok&&result.data.player.status).toBe('paused');expect(Math.abs((result.ok?result.data.player.position:0)-originalPosition)).toBeLessThan(0.1)
  await page.screenshot({path:'test-results/peq.png',animations:'disabled'})
  await page.getByRole('button',{name:'关闭对话框',exact:true}).click()
})
test('imports image and silent video backgrounds using the local resource protocol',async()=>{
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'外观与播放页',exact:true}).click()
  await instance.evaluate(({dialog},path)=>{(dialog as any).showOpenDialog=async()=>({canceled:false,filePaths:[path]})},resolve('resources/icon.png'))
  await page.getByRole('button',{name:'选择壁纸',exact:true}).click()
  await expect.poll(async()=>{const r=await page.evaluate(()=>window.music.invoke('app.bootstrap'));return r.ok&&r.data.settings.wallpaper?.kind}).toBe('image')
  await page.getByLabel('壁纸范围',{exact:true}).selectOption('app');await expect(page.locator('.music-background img')).toBeVisible()
  await expect.poll(()=>page.locator('.music-background img').evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0)).toBe(true)
  const response=await page.evaluate(async()=>{const r=await window.music.invoke('app.bootstrap');if(!r.ok||!r.data.settings.wallpaper)return null;const res=await fetch(`music-app://bundle/user-media/${r.data.settings.wallpaper.id}`,{headers:{Range:'bytes=0-7'}});return {status:res.status,bytes:Array.from(new Uint8Array(await res.arrayBuffer()))}})
  expect(response).toEqual({status:206,bytes:[137,80,78,71,13,10,26,10]})
  const video=join(directory,'background.mkv');await exec('ffmpeg',['-v','error','-f','lavfi','-i','color=c=0x304b69:s=320x180:d=1','-f','lavfi','-i','sine=frequency=1000:duration=1','-c:v','libx264','-c:a','aac','-shortest',video])
  await instance.evaluate(({dialog},path)=>{(dialog as any).showOpenDialog=async()=>({canceled:false,filePaths:[path]})},video)
  await page.getByRole('button',{name:'选择壁纸',exact:true}).click()
  await expect.poll(async()=>{const r=await page.evaluate(()=>window.music.invoke('app.bootstrap'));return r.ok&&r.data.settings.wallpaper?.kind},{timeout:15000}).toBe('video')
  await expect(page.locator('.music-background video')).toBeVisible();expect(await page.locator('.music-background video').evaluate((v:HTMLVideoElement)=>v.muted)).toBe(true)
  await expect.poll(()=>page.locator('.music-background video').evaluate((v:HTMLVideoElement)=>v.readyState>=2&&!v.error)).toBe(true)
  await page.getByRole('button',{name:'清除',exact:true}).click();await expect(page.locator('.music-background')).toHaveCount(0)
})
test('keeps one player across the mini card and main window with restricted IPC',async()=>{
  await page.getByRole('button',{name:'悬浮卡片',exact:true}).click()
  const opened=instance.waitForEvent('window');await page.getByRole('checkbox',{name:'启用悬浮卡片',exact:true}).check();const card=await opened
  await expect(card.locator('.mini-song strong')).toBeVisible()
  const denied=await card.evaluate(()=>window.music.invoke('app.bootstrap'));expect(denied.ok).toBe(false)
  await card.getByRole('button',{name:'开始播放',exact:true}).click();await expect(page.getByRole('button',{name:'暂停播放',exact:true})).toBeVisible();await card.getByRole('button',{name:'暂停播放',exact:true}).click()
  await instance.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('#mini'))!.close()})
  expect(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('#mini'))!.isVisible())).toBe(false)
  await card.screenshot({path:'test-results/mini-player.png',animations:'disabled'})
  await card.getByRole('button',{name:'关闭悬浮卡片',exact:true}).click()
  await expect.poll(()=>instance.windows().length).toBe(1)
  expect(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
  const settings=JSON.parse(await readFile(join(directory,'settings.json'),'utf8'));expect(settings.data.floatingEnabled).toBe(false)
})

async function checkTextContrast(selector:string){
  await expect.poll(async()=>page.locator(selector).evaluateAll(elements=>{
    const rgb=(s:string)=>{const n=s.match(/[\d.]+/g)!.map(Number);return [n[0],n[1],n[2],n[3]??1]}
    const lum=(v:number[])=>v.slice(0,3).map(c=>c/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4).reduce((a,c,i)=>a+c*[0.2126,0.7152,0.0722][i],0)
    return elements.filter(e=>e.getBoundingClientRect().height>0&&e.textContent?.trim()).map(e=>{
      const foreground=rgb(getComputedStyle(e).color),layers:number[][]=[];let node:Element|null=e
      while(node){layers.push(rgb(getComputedStyle(node).backgroundColor));if(node.matches('.settings-card,.settings-nav,.song-comments,.listening-meta,.immersive-heading,.modal'))break;node=node.parentElement}
      const ratio=Math.min(...[0,255].map(under=>{
        let bg=[under,under,under]
        for(const layer of [...layers].reverse())bg=bg.map((c,i)=>layer[i]*layer[3]+c*(1-layer[3]))
        const a=lum(foreground),b=lum(bg);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)
      }))
      return {ratio,element:e.tagName,classes:e.className,color:getComputedStyle(e).color}
    }).filter(r=>r.ratio<4.5)
  })).toEqual([])
}
async function previewRange(label:string,value:number){
  await page.getByLabel(label,{exact:true}).evaluate((element,value)=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,String(value))
    element.dispatchEvent(new Event('input',{bubbles:true}))
  },value)
}
test('keeps wallpaper text legible in each theme and persists independent blur controls',async()=>{
  test.setTimeout(90000)
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'外观与播放页',exact:true}).click()
  const sources=[]
  for(const color of ['white','black']){
    const image=join(directory,`${color}.png`);await exec('ffmpeg',['-v','error','-f','lavfi','-i',`color=c=${color}:s=320x180`,'-frames:v','1',image]);sources.push(image)
  }
  sources.push(join(directory,'background.mkv'))
  for(const source of sources){
    await instance.evaluate(({dialog},path)=>{(dialog as any).showOpenDialog=async()=>({canceled:false,filePaths:[path]})},source)
    await page.getByRole('button',{name:'选择壁纸',exact:true}).click()
    await expect.poll(async()=>{const r=await page.evaluate(()=>window.music.invoke('app.bootstrap'));return r.ok&&r.data.settings.wallpaper?.name}).toBe(source.split('/').pop())
    for(const [theme,system,expected] of [['light','light','light'],['dark','light','dark'],['system','light','light'],['system','dark','dark']] as const){
      await page.emulateMedia({colorScheme:system})
      await page.evaluate(theme=>window.music.invoke('settings.update',{theme}),theme)
      await expect.poll(()=>page.locator('.app-shell').evaluate(e=>getComputedStyle(e).colorScheme)).toBe(expected)
      await checkTextContrast('.settings-card strong,.settings-card p,.settings-card label,.settings-nav button')
      await page.getByRole('button',{name:'打开当前歌曲播放详情'}).click();await page.getByRole('button',{name:'评论',exact:true}).click()
      await expect(page.locator('.music-comment').first()).toBeVisible()
      await checkTextContrast('.immersive-heading .eyebrow,.music-comment p,.comment-author span,.comment-author time,.comment-author small,.listening-meta h1,.listening-meta p')
      await page.locator('.playback-options').getByRole('button',{name:'十段 PEQ',exact:true}).click()
      await checkTextContrast('.modal-heading h2,.modal-heading p,.peq-editor .muted')
      await page.getByRole('button',{name:'关闭对话框',exact:true}).click()
      await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'外观与播放页',exact:true}).click()
    }
  }
  await page.evaluate(()=>window.music.invoke('settings.update',{theme:'light'}))
  await previewRange('壁纸模糊',23)
  await expect.poll(()=>page.locator('.music-background video').evaluate(e=>getComputedStyle(e).filter)).toContain('blur(23px)')
  let before=await page.evaluate(()=>window.music.invoke('app.bootstrap'));expect(before.ok&&before.data.settings.wallpaperBlur).not.toBe(23)
  await page.getByLabel('壁纸模糊',{exact:true}).dispatchEvent('pointerup')
  await expect.poll(async()=>{const r=await page.evaluate(()=>window.music.invoke('app.bootstrap'));return r.ok&&r.data.settings.wallpaperBlur}).toBe(23)
  await page.getByRole('button',{name:'打开当前歌曲播放详情'}).click();await page.getByRole('button',{name:'视觉设置',exact:true}).click()
  await previewRange('面板模糊',7)
  await expect.poll(()=>page.locator('.visual-popover').evaluate(e=>getComputedStyle(e).backdropFilter)).toBe('blur(7px)')
  before=await page.evaluate(()=>window.music.invoke('app.bootstrap'));expect(before.ok&&before.data.settings.panelBlur).toBe(12)
  await page.getByLabel('面板模糊',{exact:true}).dispatchEvent('pointerup')
  await expect.poll(async()=>{const r=await page.evaluate(()=>window.music.invoke('app.bootstrap'));return r.ok&&r.data.settings.panelBlur}).toBe(7)
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'评论',exact:true}).click()
  await page.screenshot({path:'test-results/wallpaper-light.png',animations:'disabled'})
  await page.getByRole('button',{name:'视觉设置',exact:true}).click()
  const settingsPath=join(directory,'settings.json'),backup=join(directory,'settings.backup')
  await rename(settingsPath,backup);await mkdir(settingsPath)
  try{
    await previewRange('面板模糊',20);await page.getByLabel('面板模糊',{exact:true}).dispatchEvent('pointerup')
    await expect(page.getByText('设置保存失败，已恢复原值，请检查磁盘空间。',{exact:true})).toBeVisible()
    await expect(page.getByLabel('面板模糊',{exact:true})).toHaveValue('7')
  }finally{await rm(settingsPath,{recursive:true,force:true});await rename(backup,settingsPath)}
  await page.keyboard.press('Escape')
  expect(await page.locator('.brand .app-icon').evaluate((e:HTMLImageElement)=>e.complete&&e.naturalWidth===512)).toBe(true)
  await instance.close()
  const port=(server.address() as any).port,env:Record<string,string>={...process.env,CLOUD_MUSIC_TEST:'1',CLOUD_MUSIC_TEST_DIR:directory,CLOUD_MUSIC_TEST_URL:`http://127.0.0.1:${port}/audio.wav`};delete env.ELECTRON_RUN_AS_NODE
  instance=await electron.launch({args:[resolve('out/main/index.js'),'--no-sandbox','--disable-gpu','--ozone-platform=headless','--password-store=basic'],env})
  page=await instance.firstWindow();await expect(page.locator('.app-shell')).toBeVisible()
  const restored=await page.evaluate(()=>window.music.invoke('app.bootstrap'))
  expect(restored.ok&&[restored.data.settings.wallpaperBlur,restored.data.settings.panelBlur,restored.data.settings.theme]).toEqual([23,7,'light'])
})
