import { executeBash, type BashToolInput } from './bash.ts';
import { executeEdit, type EditToolInput } from './edit.ts';
import { executeGlob, type GlobToolInput } from './glob.ts';
import { executeGrep, type GrepToolInput } from './grep.ts';
import { executeRead, type ReadToolInput } from './read.ts';
import { executeWrite, type WriteToolInput } from './write.ts';
import { executeWebFetch, type WebFetchInput } from './web.ts';
import { executeAnalyzeImage, executeDetectObjects } from './vision.ts';
import { executeScreenshot, type ScreenshotInput } from './screenshot.ts';
import { executeSubagent, type SubagentInput, type SubagentCallbacks } from './subagent.ts';
import type { CheckpointManager } from '../checkpoint.ts';
export { CORE_TOOLS, type OpenAiToolDefinition } from './definitions.ts';
export { resolveShell, type ResolvedShell } from './shellResolver.ts';
export { executeSubagent, type SubagentInput, type SubagentCallbacks, type SubagentContext } from './subagent.ts';

export interface ToolExecutionResult {
  text: string;
  isError: boolean;
  truncated?: boolean;
  /** images to show on the card next to the text (the picture a vision tool looked at) */
  imageData?: { mediaType: string; data: string }[];
}

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
  addDirs: string[] = [],
  signal?: AbortSignal,
  checkpoint?: CheckpointManager
): Promise<ToolExecutionResult> {
  switch (toolName) {
    case 'read_file':
      return executeRead(input as unknown as ReadToolInput, cwd, addDirs);

    case 'write_file':
      return executeWrite(input as unknown as WriteToolInput, cwd, addDirs, checkpoint);

    case 'edit_file':
      return executeEdit(input as unknown as EditToolInput, cwd, addDirs, checkpoint);

    case 'bash':
      return executeBash(input as unknown as BashToolInput, cwd, signal);

    case 'glob':
      return executeGlob(input as unknown as GlobToolInput, cwd, addDirs);

    case 'grep':
      return executeGrep(input as unknown as GrepToolInput, cwd, addDirs);

    case 'screenshot':
      return executeScreenshot(input as unknown as ScreenshotInput, cwd, addDirs, signal);

    case 'analyze_image':
      return executeAnalyzeImage(input as unknown as { path: string; question?: string }, cwd, addDirs, signal);

    case 'detect_objects':
      return executeDetectObjects(input as unknown as { path: string; query?: string; mode?: string }, cwd, addDirs, signal);

    case 'web_fetch':
      return executeWebFetch(input as unknown as WebFetchInput, signal);

    default:
      return {
        text: `Error: Unknown tool "${toolName}"`,
        isError: true,
      };
  }
}

