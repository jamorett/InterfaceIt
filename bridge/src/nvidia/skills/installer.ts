import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync, opendirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

export interface InstallSkillResult {
  success: boolean;
  name: string;
  targetPath?: string;
  message: string;
}

function findSkillMdDir(startDir: string): string | null {
  if (existsSync(join(startDir, 'SKILL.md'))) return startDir;

  try {
    const handle = opendirSync(startDir);
    try {
      let entry;
      while ((entry = handle.readSync())) {
        if (entry.isDirectory() && entry.name !== '.git') {
          const sub = join(startDir, entry.name);
          if (existsSync(join(sub, 'SKILL.md'))) return sub;
        }
      }
    } finally {
      handle.closeSync();
    }
  } catch {
    // ignore
  }

  return null;
}

export async function installSkillFromRepo(
  repoUrl: string,
  suggestedName?: string,
  isGlobal = false,
  cwd = process.cwd()
): Promise<InstallSkillResult> {
  const tempDir = join(tmpdir(), `skill_clone_${randomBytes(8).toString('hex')}`);

  try {
    // 1. Clone repo into temp dir
    // no shell: the URL is an argument, never part of a command line
    if (!/^(https:\/\/|git@)[^\s"'`$;&|<>]+$/.test(repoUrl.trim())) {
      return { success: false, name: suggestedName ?? 'unknown', message: 'Only https:// or git@ repository URLs without spaces or shell characters are accepted.' };
    }
    const cloneResult = await new Promise<{ code: number | null; error?: string }>((resolve) => {
      const p = spawn('git', ['clone', '--depth', '1', '--', repoUrl.trim(), tempDir], { windowsHide: true });
      let errOut = '';
      p.stderr?.on('data', (d: Buffer) => { errOut += d.toString('utf-8'); });
      p.on('close', (code) => resolve({ code, error: errOut }));
      p.on('error', (err) => resolve({ code: -1, error: err.message }));
    });

    if (cloneResult.code !== 0) {
      return {
        success: false,
        name: suggestedName ?? 'unknown',
        message: `Failed to clone repository: ${cloneResult.error || 'git clone failed'}`,
      };
    }

    // 2. Locate folder containing SKILL.md
    const skillSourceDir = findSkillMdDir(tempDir);
    if (!skillSourceDir) {
      return {
        success: false,
        name: suggestedName ?? 'unknown',
        message: `Repository does not contain a SKILL.md file.`,
      };
    }

    // 3. Derive destination name
    let name = suggestedName;
    if (!name) {
      // derive from repo url or directory name
      const cleanUrl = repoUrl.replace(/\.git$/, '').replace(/\/+$/, '');
      name = cleanUrl.slice(cleanUrl.lastIndexOf('/') + 1);
    }
    name = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

    const baseDir = isGlobal ? join(homedir(), '.claude', 'skills') : join(cwd, '.claude', 'skills');
    const targetDir = join(baseDir, name);

    await mkdir(baseDir, { recursive: true });
    // Copy skill folder
    await cp(skillSourceDir, targetDir, { recursive: true });

    return {
      success: true,
      name,
      targetPath: targetDir,
      message: `Successfully installed skill "${name}" into ${targetDir}`,
    };
  } catch (err) {
    return {
      success: false,
      name: suggestedName ?? 'unknown',
      message: `Error installing skill: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    // Cleanup temp dir
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

