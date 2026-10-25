import { defineConfig } from '@playwright/test';
import { PORT } from './e2e/server.ts';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  globalSetup: './e2e/server.ts', // starts (and in its teardown kills) the bridge
  // Edge ships with Windows, so no browser download is needed
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: 'msedge' },
});
