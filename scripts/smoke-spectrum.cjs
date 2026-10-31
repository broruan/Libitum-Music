// Packaged application test with only a generated tone and a private virtual output.
const {_electron:electron}=require('@playwright/test')
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path')
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),exec=promisify(execFile)
async function main(){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'libitum-spectrum-package-')),sink=`libitum_package_${process.pid}`
 let instance,module
 try{
  module=(await exec('pactl',['load-module','module-null-sink',`sink_name=${sink}`,'sink_properties=device.description=Libitum-test\ priority.session=-1000'])).stdout.trim()
  const tone=path.join(directory,'tone.wav')
  await exec('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=1000:duration=15','-ar','48000',tone])
  const track={provider:'netease',id:'1',title:'合成测试信号',artists:[{provider:'netease',id:'1',name:'自动验证',coverUrl:''}],album:{id:'1',title:'本地测试'},coverUrl:'',durationMs:15000}
  await fs.writeFile(path.join(directory,'settings.json'),JSON.stringify({version:1,data:{deviceId:`pipewire/${sink}`,commentsEnabled:false,spectrum:{enabled:true,color:'#ef6079',secondaryColor:'#9975e8',gradient:true}}}))
  await fs.writeFile(path.join(directory,'downloads.json'),JSON.stringify({version:1,data:[{id:'generated-tone',ownerId:'',track,quality:'standard',status:'completed',received:0,total:0,createdAt:0,path:tone}]}))
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.CLOUD_MUSIC_TEST
  instance=await electron.launch({executablePath:path.resolve('release/linux-unpacked/cloud-music-player'),args:['--no-sandbox','--disable-gpu','--ozone-platform=headless','--password-store=basic',`--user-data-dir=${directory}`],env})
  const page=await instance.firstWindow();await page.waitForSelector('.app-shell')
  await page.waitForFunction(async()=>{const r=await window.music.invoke('app.bootstrap');return r.ok&&r.data.player.available})
  await page.evaluate(()=>{window.__spectrum=null;window.music.onEvent(e=>{if(e.type==='spectrum')window.__spectrum=e.data})})
  const played=await page.evaluate(()=>window.music.invoke('downloads.play',{id:'generated-tone'}));if(!played.ok)throw new Error(played.error.code)
  await page.evaluate(()=>window.music.invoke('spectrum.subscribe',{active:true}))
  await page.waitForFunction(()=>window.__spectrum?.status==='active'&&Math.max(...window.__spectrum.bins)>0.3,{},{timeout:10000})
  console.log(JSON.stringify({packaged:await instance.evaluate(({app})=>app.isPackaged),backend:'native-pipewire',spectrum:'active',audio:'generated-tone-in-virtual-output',pcmSaved:false}))
 }finally{if(instance)await instance.close();if(module)await exec('pactl',['unload-module',module]).catch(()=>{});await fs.rm(directory,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
