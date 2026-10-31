import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Serialized atomic writes: a slow earlier save must never replace a newer one. */
export class JsonStore<T> {
  private tail: Promise<void> = Promise.resolve()
  constructor(private path: string, private fallback: T) {}
  async read(): Promise<T> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'))
      return parsed.version === 1 ? parsed.data as T : this.fallback
    } catch { return this.fallback }
  }
  write(value: T): Promise<void> {
    const serialized = JSON.stringify({ version: 1, data: value })
    const next = this.tail.catch(() => {}).then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      const temporary = `${this.path}.tmp`
      await writeFile(temporary, serialized, { mode: 0o600 })
      await rename(temporary, this.path)
    })
    this.tail = next
    return next
  }
  async flush() { await this.tail }
  remove(): Promise<void> {
    const next = this.tail.catch(() => {}).then(() => rm(this.path, { force: true }))
    this.tail = next
    return next
  }
}
