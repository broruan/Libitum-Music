import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/integration/audio.test.ts','tests/integration/spectrum.test.ts'], testTimeout: 25000, environment: 'node', fileParallelism:false } })
