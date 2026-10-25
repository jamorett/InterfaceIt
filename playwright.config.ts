import { defineConfig } from '@playwright/test';
import { TOKEN } from './e2e/token.ts';

const PORT = '4318'; // not 4317, so e2e never collides with a bridge the user has running

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  // Edge ships with Windows, so no browser download is needed
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: 'msedge' },
  webServer: {
    // plain tsx, not `npm run dev`: `tsx watch` hangs when stdin is a pipe, which is how Playwright starts it
    command: 'npx tsx bridge/src/main.ts --dev --no-open',
    url: `http://127.0.0.1:${PORT}`,
    env: { CLAUDEINTERFACE_PORT: PORT, CLAUDEINTERFACE_TOKEN: TOKEN },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
