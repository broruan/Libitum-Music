import { defineConfig } from 'vitest/config'
export default defineConfig({test:{include:['tests/integration/media.test.ts','tests/integration/peq.test.ts'],testTimeout:30000,environment:'node'}})
