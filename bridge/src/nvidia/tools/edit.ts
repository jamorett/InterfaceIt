import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import type { CheckpointManager } from '../checkpoint.ts';
import { withFileLock } from './filelock.ts';
import { resolveSafePath } from './read.ts';

export interface EditToolInput {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface EditToolResult {
  text: string;
  isError: boolean;
  replacements?: number;
}

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, '\n');
}

/** Where `target` is in `source`: exactly (after newline normalisation), or line by line ignoring trailing spaces. */
function findMatch(source: string, target: string): { count: number; fuzzy: boolean } {
  const exact = source.split(target).length - 1;
  if (exact > 0) return { count: exact, fuzzy: false };
  return { count: trimmedMatches(source.split('\n'), target.split('\n')).length, fuzzy: true };
}

/** Start lines where the lines of `target` appear in `lines`, comparing without trailing whitespace. */
function trimmedMatches(lines: string[], target: string[]): number[] {
  const want = target.map((l) => l.trimEnd());
  const at: number[] = [];
  for (let i = 0; i + want.length <= lines.length; i++) {
    if (want.every((w, k) => lines[i + k]!.trimEnd() === w)) { at.push(i); i += want.length - 1; }
  }
  return at;
}

/** The few lines of the file nearest to what the model asked to replace, so it can correct its old_string at once instead of guessing again. */
function closestRegion(content: string, oldStr: string): string {
  const lines = content.split('\n');
  const probe = oldStr.split('\n').map((l) => l.trim()).find((l) => l.length > 3)?.toLowerCase() ?? '';
  if (!probe) return '';
  const words = new Set(probe.split(/\W+/).filter(Boolean));
  let best = -1;
  let bestScore = 0;
  lines.forEach((l, i) => {
    const t = l.trim().toLowerCase();
    let score = t === probe ? 100 : t.includes(probe) ? 50 : 0;
    if (!score && words.size) {
      const have = new Set(t.split(/\W+/).filter(Boolean));
      score = ([...words].filter((w) => have.has(w)).length / words.size) * 10;
    }
    if (score > bestScore) { bestScore = score; best = i; }
  });
  if (best < 0 || bestScore < 4) return '';
  const from = Math.max(0, best - 2);
  const to = Math.min(lines.length, best + 5);
  return `\nThe closest text in the file is around line ${best + 1} (copy from here):\n${lines.slice(from, to).map((l, k) => `${from + k + 1}→${l}`).join('\n')}`;
}

export async function executeEdit(
  input: EditToolInput,
  cwd: string,
  addDirs: string[] = [],
  checkpoint?: CheckpointManager
): Promise<EditToolResult> {
  const safePath = resolveSafePath(cwd, input.path, addDirs);

  if (!existsSync(safePath)) {
    return {
      text: `Error: File not found: ${input.path}`,
      isError: true,
    };
  }

  try {
    // read, change and write as one step: another agent editing the same file waits its turn and sees this edit
    return await withFileLock(safePath, async (): Promise<EditToolResult> => {
      if (checkpoint) await checkpoint.snapshotFile(safePath);
      const rawContent = await readFile(safePath, 'utf-8');
      const isCrLf = rawContent.includes('\r\n');
      const content = normalizeNewlines(rawContent);
      const oldStr = normalizeNewlines(input.old_string);
      const newStr = normalizeNewlines(input.new_string);

      if (oldStr.length === 0) return { text: 'Error: old_string cannot be empty.', isError: true };

      const match = findMatch(content, oldStr);

      if (match.count === 0) {
        return {
          text: `Error: old_string not found in ${input.path}. It must match the file exactly, including indentation (copy it from read_file without the line-number prefix). The file may also have been changed by another agent since you read it.${closestRegion(content, oldStr)}`,
          isError: true,
        };
      }

      if (match.count > 1 && !input.replace_all) {
        return {
          text: `Error: old_string matched ${match.count} times in ${input.path}. Please include more surrounding lines to uniquely identify the section to replace, or set replace_all.`,
          isError: true,
        };
      }

      let updated: string;
      if (!match.fuzzy) {
        updated = input.replace_all ? content.split(oldStr).join(newStr) : content.replace(oldStr, () => newStr);
      } else {
        // the text only matched ignoring trailing spaces: replace those lines themselves, not a string that is not in the file
        const lines = content.split('\n');
        const at = trimmedMatches(lines, oldStr.split('\n'));
        const span = oldStr.split('\n').length;
        for (const i of (input.replace_all ? at : at.slice(0, 1)).reverse()) lines.splice(i, span, ...newStr.split('\n'));
        updated = lines.join('\n');
      }
      const replacements = input.replace_all ? match.count : 1;

      await writeFile(safePath, isCrLf ? updated.replace(/\n/g, '\r\n') : updated, 'utf-8');

      return {
        text: `Successfully updated ${input.path} (${replacements} replacement${replacements > 1 ? 's' : ''}, -${oldStr.split('\n').length} +${newStr.split('\n').length} lines).`,
        isError: false,
        replacements,
      };
    });
  } catch (err) {
    return {
      text: `Error editing file: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}
