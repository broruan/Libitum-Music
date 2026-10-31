import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/integration/audio.test.ts'], testTimeout: 15000, environment: 'node' } })
