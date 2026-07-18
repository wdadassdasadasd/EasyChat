import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/electron',
  timeout: 30000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure'
  }
})
