import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CheckpointManager } from '../checkpoint.ts';
import { resolveSafePath } from './read.ts';

export interface WriteToolInput {
  path: string;
  content: string;
}

export interface WriteToolResult {
  text: string;
  isError: boolean;
  bytesWritten?: number;
}

export async function executeWrite(
  input: WriteToolInput,
  cwd: string,
  addDirs: string[] = [],
  checkpoint?: CheckpointManager
): Promise<WriteToolResult> {
  const safePath = resolveSafePath(cwd, input.path, addDirs);

  try {
    if (checkpoint) {
      await checkpoint.snapshotFile(safePath);
    }
    await mkdir(dirname(safePath), { recursive: true });
    await writeFile(safePath, input.content, 'utf-8');
    const lines = input.content.split(/\r?\n/).length;
    const bytes = Buffer.byteLength(input.content, 'utf-8');

    return {
      text: `Successfully wrote ${bytes} bytes (${lines} lines) to ${input.path}`,
      isError: false,
      bytesWritten: bytes,
    };
  } catch (err) {
    return {
      text: `Error writing file: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

