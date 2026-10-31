import { expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mpv } from '../../src/main/mpv'

it('switches between two real desktop sinks while preserving a paused silent track', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-music-device-check-'))
  const mpv = new Mpv(directory, () => 'mpv', false)
  try {
    await mpv.start()
    const devices: { name: string; description: string }[] = await mpv.command(['get_property', 'audio-device-list'])
    const sinks = devices.filter(device => device.name.startsWith('pipewire/alsa_output.'))
    const first = sinks.find(device => /DX5/.test(device.description)) || sinks[0]
    const second = sinks.find(device => /Speaker/.test(device.description) && device.name !== first?.name) || sinks.find(device => device.name !== first?.name)
    if (!first || !second) throw new Error('This manual integration check requires two actual PipeWire sinks.')
    const audio = Buffer.alloc(44 + 8000 * 2 * 30)
    audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40)
    const path = join(directory, 'silence.wav'); await writeFile(path, audio)
    await mpv.command(['set_property', 'pause', true]); await mpv.command(['set_property', 'audio-device', first.name])
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('audio load timed out')), 7000)
      const handler = (event: any) => { if (event.event === 'file-loaded') { clearTimeout(timer); mpv.off('event', handler); resolve() } }
      mpv.on('event', handler)
    })
    await mpv.command(['loadfile', path, 'replace']); await loaded
    await mpv.command(['seek', 5, 'absolute+exact'])
    await mpv.command(['set_property', 'audio-device', second.name])
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(await mpv.command(['get_property', 'pause'])).toBe(true)
    expect(await mpv.command(['get_property', 'audio-device'])).toBe(second.name)
    expect(await mpv.command(['get_property', 'current-ao'])).toBe('pipewire')
    expect(await mpv.command(['get_property', 'time-pos'])).toBeCloseTo(5, 0)
    expect(await mpv.command(['get_property', 'audio-out-params'])).toBeTruthy()
    console.log(`Verified paused device switch: ${first.description} -> ${second.description}`)
  } finally { await mpv.stop(); await rm(directory, { recursive: true, force: true }) }
})
