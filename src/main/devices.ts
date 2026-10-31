import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AudioDevice } from '../shared/types'
const exec = promisify(execFile)
export interface RawDevice { name: string; description: string }
export function groupDevices(raw: RawDevice[], stable = new Map<string, string>()): AudioDevice[] {
  const names = new Set<string>(), entries = raw.filter(d => d && typeof d.name === 'string' && d.name !== 'auto' && !names.has(d.name) && !!names.add(d.name))
  const backend = (name: string) => name.split('/')[0]
  const outputs=entries.filter(d => !/^Default\s*\(/i.test(d.description || '') && !/^(?:pipewire|pulse|alsa)(?:\/(?:default|auto))?$/.test(d.name))
  const preferred = ['pipewire', 'pulse', 'alsa'].find(b => outputs.some(d => backend(d.name) === b))
  return [{ id: 'auto', key: 'auto', label: '跟随系统默认', backend: 'auto', advanced: false }, ...outputs.map(d => ({ id: d.name, key: stable.get(d.name) || d.name, label: d.description || d.name, backend: backend(d.name), advanced: backend(d.name) !== preferred || /^alsa\/(?!hw:|plughw:)/.test(d.name) }))]
}
export async function resolveDevices(raw: RawDevice[]): Promise<AudioDevice[]> {
  const stable = new Map<string, string>()
  if (raw?.some(d => /^pipewire\/\d+$/.test(d.name))) {
    try {
      const { stdout } = await exec('pw-dump', [], { timeout: 1800, maxBuffer: 8_000_000 })
      for (const node of JSON.parse(stdout)) {
        const p = node.info?.props
        if (p?.['media.class'] !== 'Audio/Sink' || !p['node.name']) continue
        for (const id of [node.id, p['object.serial']]) stable.set(`pipewire/${id}`, `pipewire/${p['node.name']}`)
      }
    } catch { /* A backend without metadata can still expose its native identifiers. */ }
  }
  return groupDevices(raw || [], stable)
}
