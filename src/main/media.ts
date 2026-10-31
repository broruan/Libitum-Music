import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, rename, rm, stat, chmod } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { basename, extname, join } from 'node:path'
import type { MediaImportState, Wallpaper } from '../shared/types'
import { MusicError } from '../shared/errors'
const exec = promisify(execFile)
const images = new Set(['.jpg','.jpeg','.png','.webp','.gif','.bmp','.avif'])
const videos = new Set(['.mp4','.webm','.mov','.mkv','.avi'])
export class MediaLibrary {
  private child: ChildProcess | null = null
  private active = false
  private cancelled = false
  constructor(private directory: string, private emit: (state: MediaImportState) => void, private commit: (value: Wallpaper) => Promise<void>) {}
  async import(path: string) {
    if (this.active) throw new MusicError('IMPORT_BUSY', '请等待当前导入完成或先取消。')
    this.active = true; this.cancelled = false
    let temporary = '', target = '', committed = false
    this.emit({ status: 'working', progress: 0 })
    try {
      const suffix = extname(path).toLowerCase(), image = images.has(suffix)
      if (!image && !videos.has(suffix)) throw new MusicError('MEDIA_FORMAT', '不支持此文件格式。')
      const source = await stat(path)
      if (!source.isFile() || source.size > (image ? 64 * 1024 ** 2 : 4 * 1024 ** 3)) throw new MusicError('MEDIA_SIZE', image ? '图片最大支持 64 MB。' : '视频最大支持 4 GB。')
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const id = `${randomUUID()}${image ? suffix === '.jpeg' ? '.jpg' : suffix : '.mp4'}`
      target = join(this.directory, id); temporary = target + '.part'
      if (image) {
        const file = await open(path, 'r'), header = Buffer.alloc(64)
        try { await file.read(header, 0, 64, 0) } finally { await file.close() }
        const valid = header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || header[0] === 255 && header[1] === 216 || /^(GIF8|BM)/.test(header.toString('ascii')) || header.toString('ascii',0,4) === 'RIFF' && header.toString('ascii',8,12) === 'WEBP' || header.toString('ascii',4,8)==='ftyp' && /avif|avis/.test(header.toString('ascii',8,64))
        if (!valid) throw new MusicError('MEDIA_FORMAT', '文件内容不是支持的图片。')
        await copyFile(path, temporary); await chmod(temporary, 0o600)
      } else {
        const info = await this.probe(path), duration = Number(info.format?.duration)
        if (!info.streams?.some((s: any) => s.codec_type === 'video') || !Number.isFinite(duration) || duration <= 0) throw new MusicError('MEDIA_FORMAT', '视频缺少可用画面或时长。')
        if (this.cancelled) throw new MusicError('CANCELLED', '导入已取消。')
        await new Promise<void>((resolve, reject) => {
          const child = spawn('ffmpeg', ['-nostdin','-v','error','-i',path,'-map','0:v:0','-an','-vf',"scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",'-r','30','-c:v','libx264','-preset','veryfast','-crf','25','-pix_fmt','yuv420p','-movflags','+faststart','-f','mp4','-progress','pipe:3','-y',temporary], { stdio: ['ignore','ignore','ignore','pipe'], shell: false })
          this.child = child
          let buffer = ''
          child.stdio[3]?.on('data', chunk => {
            buffer += chunk.toString()
            const lines = buffer.split('\n'); buffer = lines.pop() || ''
            for (const line of lines) if (line.startsWith('out_time_us=')) this.emit({ status: 'working', progress: Math.max(0,Math.min(99,Number(line.slice(12)) / 1e6 / duration * 100)) })
          })
          child.once('error', () => reject(new MusicError('FFMPEG_MISSING', '无法启动 FFmpeg，请安装 ffmpeg。')))
          child.once('close', code => { this.child = null; if (this.cancelled) reject(new MusicError('CANCELLED', '导入已取消。')); else if (code === 0) resolve(); else reject(new MusicError('MEDIA_CONVERT', '视频转换失败，请检查文件和磁盘空间。')) })
        })
        await chmod(temporary, 0o600)
        const converted = await this.probe(temporary)
        if (Math.abs(Number(converted.format?.duration) - duration) > Math.max(1,duration * 0.01)) throw new MusicError('MEDIA_CONVERT', '转换后的视频不完整。')
      }
      if (this.cancelled) throw new MusicError('CANCELLED', '导入已取消。')
      await rename(temporary, target)
      await this.commit({ id, kind: image ? 'image' : 'video', name: basename(path) })
      committed = true; this.emit({ status: 'completed', progress: 100 })
    } catch (error) {
      const problem = error instanceof MusicError ? error : new MusicError('MEDIA_IMPORT', '导入失败，请检查文件权限与磁盘空间。')
      this.emit({ status: this.cancelled ? 'cancelled' : 'failed', progress: 0, error: problem.message })
      throw problem
    } finally {
      if (temporary) await rm(temporary, { force: true }).catch(() => {})
      if (target && !committed) await rm(target, { force: true }).catch(() => {})
      this.active = false; this.child = null
    }
  }
  private async probe(path: string) {
    const task = exec('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',path],{ timeout: 15000, maxBuffer: 1_000_000 })
    this.child = task.child
    try { const { stdout } = await task; return JSON.parse(stdout) }
    catch { throw new MusicError(this.cancelled ? 'CANCELLED' : 'MEDIA_PROBE', this.cancelled ? '导入已取消。' : '无法读取视频，请确认文件有效并已安装 ffmpeg。') }
    finally { if (this.child === task.child) this.child = null }
  }
  cancel() { this.cancelled = true; this.child?.kill('SIGTERM') }
  async remove(id: string) { if (/^[a-f0-9-]{36}\.[a-z0-9]+$/.test(id)) await rm(join(this.directory,id),{ force: true }) }
  async serve(request: Request, id: string): Promise<Response> {
    if (!/^[a-f0-9-]{36}\.(?:png|jpg|webp|gif|bmp|avif|mp4)$/.test(id) || !['GET','HEAD'].includes(request.method)) return new Response(null,{status:403})
    try {
      const path = join(this.directory,id), info = await stat(path)
      let start = 0, end = info.size - 1, partial = false
      const range = request.headers.get('Range')
      if (range) {
        const match = range.match(/^bytes=(\d*)-(\d*)$/)
        if (!match || !match[1] && !match[2]) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${info.size}`}})
        start = match[1] ? Number(match[1]) : Math.max(0,info.size-Number(match[2])); end = match[1] && match[2] ? Math.min(Number(match[2]),end) : end
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${info.size}`}})
        partial = true
      }
      const extension = extname(id).slice(1), type = extension === 'mp4' ? 'video/mp4' : extension === 'jpg' ? 'image/jpeg' : `image/${extension}`
      const headers: Record<string,string> = { 'Content-Type':type, 'Accept-Ranges':'bytes', 'Content-Length':String(end-start+1), 'X-Content-Type-Options':'nosniff', 'Cache-Control':'private, max-age=3600' }
      if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`
      return new Response(request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(path,{start,end})) as ReadableStream,{ status:partial ? 206 : 200, headers })
    } catch { return new Response(null,{status:404}) }
  }
}
