import type { AppError } from './types'
export class MusicError extends Error {
  constructor(public code: string, message: string, public upstreamCode?: number) { super(message); this.name = 'MusicError' }
}
export function publicError(error: unknown): AppError {
  if (error instanceof MusicError) return { code: error.code, message: error.message, ...(Number.isFinite(error.upstreamCode) ? { upstreamCode: error.upstreamCode } : {}) }
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ENOSPC') return { code, message: '磁盘空间不足，请释放空间后重试。' }
  if (code === 'EACCES' || code === 'EPERM') return { code, message: '没有访问权限，请检查目录或系统权限。' }
  if (code === 'ENOENT') return { code, message: '文件或程序不存在，请检查设置。' }
  return { code: 'INTERNAL', message: '操作失败，请重试；若持续出现，请重新启动应用。' }
}
