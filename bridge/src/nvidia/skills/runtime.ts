import { existsSync, opendirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ClaudeSkill {
  name: string;
  description: string;
  instructions: string;
  sourcePath: string;
  isGlobal: boolean;
}

function parseSkillMd(filePath: string, isGlobal: boolean): ClaudeSkill | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);

    let name = '';
    let description = '';
    let instructions = raw;

    if (fmMatch) {
      const frontmatter = fmMatch[1]!;
      instructions = fmMatch[2]!.trim();

      for (const line of frontmatter.split(/\r?\n/)) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim().toLowerCase();
          const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
          if (key === 'name') name = val;
          else if (key === 'description') description = val;
        }
      }
    }

    if (!name) {
      // Derive name from parent directory name
      const parentDir = filePath.replace(/[\\/][^\\/]+$/, '');
      name = parentDir.slice(parentDir.lastIndexOf(parentDir.includes('\\') ? '\\' : '/') + 1);
    }

    return {
      name,
      description: description || 'Claude Code skill',
      instructions,
      sourcePath: filePath,
      isGlobal,
    };
  } catch {
    return null;
  }
}

function scanDir(dir: string, isGlobal: boolean): ClaudeSkill[] {
  if (!existsSync(dir)) return [];
  const skills: ClaudeSkill[] = [];

  try {
    const handle = opendirSync(dir);
    try {
      let entry;
      while ((entry = handle.readSync())) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const skillMd = join(dir, entry.name, 'SKILL.md');
          if (existsSync(skillMd)) {
            const skill = parseSkillMd(skillMd, isGlobal);
            if (skill) skills.push(skill);
          }
        }
      }
    } finally {
      handle.closeSync();
    }
  } catch {
    // ignore unreadable dirs
  }

  return skills;
}

export class SkillRuntime {
  private skills = new Map<string, ClaudeSkill>();

  constructor(private cwd: string) {
    this.reload();
  }

  reload(): void {
    this.skills.clear();

    // 1. Global skills (~/.claude/skills)
    const globalDir = join(homedir(), '.claude', 'skills');
    for (const skill of scanDir(globalDir, true)) {
      this.skills.set(skill.name, skill);
    }

    // 2. Project skills (<cwd>/.claude/skills) - overrides global if collision
    const projectDir = join(this.cwd, '.claude', 'skills');
    for (const skill of scanDir(projectDir, false)) {
      this.skills.set(skill.name, skill);
    }
  }

  listSkills(): ClaudeSkill[] {
    return [...this.skills.values()];
  }

  getSkill(name: string): ClaudeSkill | undefined {
    return this.skills.get(name);
  }

  formatCatalog(): string {
    const list = this.listSkills();
    if (list.length === 0) return '(No additional Claude skills currently installed)';

    return list.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  }
}

