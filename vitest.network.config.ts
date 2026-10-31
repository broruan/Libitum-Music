import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/integration/network.test.ts'], testTimeout: 180000, environment: 'node' } })
