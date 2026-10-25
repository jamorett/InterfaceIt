import { spawn } from 'node:child_process';
import { TOKEN } from './token.ts';

export const PORT = '4318'; // not 4317, so e2e never collides with a bridge the user has running

// Playwright's own `webServer` starts the command through a shell; on Windows killing that shell orphans the real
// node process, which then keeps Playwright's pipes open and the run never exits. Spawning node directly avoids it.
export default async function globalSetup() {
  const child = spawn(process.execPath, ['--import', 'tsx', 'bridge/src/main.ts', '--dev', '--no-open', '--fake'], {
    env: { ...process.env, CLAUDEINTERFACE_PORT: PORT, CLAUDEINTERFACE_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  const exited = new Promise<never>((_, reject) => child.once('exit', (c) => reject(new Error(`bridge exited early (${c})`))));
  const ready = (async () => {
    for (let i = 0; i < 150; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return; } catch { /* not listening yet */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('bridge did not start within 30 s');
  })();
  try {
    await Promise.race([ready, exited]);
  } catch (e) {
    child.kill();
    throw e;
  }
  return () => { child.kill(); };
}
