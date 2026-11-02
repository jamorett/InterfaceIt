import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import type { CheckpointManager } from '../checkpoint.ts';
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

/**
 * Searches for target in source with fallback fuzzy matching:
 * 1. Exact match.
 * 2. Newline-normalized match.
 * 3. Line-trimmed match (ignores trailing spaces on each line).
 */
function findMatch(source: string, target: string): { found: boolean; count: number; index: number; matchedText?: string } {
  // 1. Exact match
  if (source.includes(target)) {
    const parts = source.split(target);
    return { found: true, count: parts.length - 1, index: source.indexOf(target), matchedText: target };
  }

  // 2. Newline normalized
  const normSource = normalizeNewlines(source);
  const normTarget = normalizeNewlines(target);
  if (normSource.includes(normTarget)) {
    const count = normSource.split(normTarget).length - 1;
    return { found: true, count, index: normSource.indexOf(normTarget), matchedText: normTarget };
  }

  // 3. Trailing-whitespace normalized per line
  const stripTrailing = (t: string) => t.split('\n').map((l) => l.trimEnd()).join('\n');
  const strippedSource = stripTrailing(normSource);
  const strippedTarget = stripTrailing(normTarget);
  if (strippedSource.includes(strippedTarget)) {
    const count = strippedSource.split(strippedTarget).length - 1;
    return { found: true, count, index: strippedSource.indexOf(strippedTarget), matchedText: strippedTarget };
  }

  return { found: false, count: 0, index: -1 };
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
    if (checkpoint) {
      await checkpoint.snapshotFile(safePath);
    }
    const rawContent = await readFile(safePath, 'utf-8');
    const isCrLf = rawContent.includes('\r\n');
    const content = normalizeNewlines(rawContent);
    const oldStr = normalizeNewlines(input.old_string);
    const newStr = normalizeNewlines(input.new_string);

    if (oldStr.length === 0) {
      return {
        text: 'Error: old_string cannot be empty.',
        isError: true,
      };
    }

    const match = findMatch(content, oldStr);

    if (!match.found) {
      return {
        text: `Error: old_string not found in ${input.path}. Ensure you provide exact surrounding context lines from read_file.`,
        isError: true,
      };
    }

    if (match.count > 1 && !input.replace_all) {
      return {
        text: `Error: old_string matched ${match.count} times in ${input.path}. Please include more surrounding lines to uniquely identify the section to replace.`,
        isError: true,
      };
    }

    let updated: string;
    let replacements = 0;

    if (input.replace_all) {
      updated = content.split(oldStr).join(newStr);
      replacements = match.count;
    } else {
      updated = content.replace(oldStr, () => newStr);
      replacements = 1;
    }

    const finalContent = isCrLf ? updated.replace(/\n/g, '\r\n') : updated;
    await writeFile(safePath, finalContent, 'utf-8');

    const oldLines = oldStr.split('\n').length;
    const newLines = newStr.split('\n').length;

    return {
      text: `Successfully updated ${input.path} (${replacements} replacement${replacements > 1 ? 's' : ''}, -${oldLines} +${newLines} lines).`,
      isError: false,
      replacements,
    };
  } catch (err) {
    return {
      text: `Error editing file: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

