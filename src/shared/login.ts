export const QR_POLL_INTERVAL_MS = 4000
export function qrRetryDelay(failures: number): number | null {
  return [4000, 8000, 16000][failures - 1] ?? null
}
export function transientLoginError(code: string | undefined): boolean { return code === 'NETWORK' || code === 'TIMEOUT' }
