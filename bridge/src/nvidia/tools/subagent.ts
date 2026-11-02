import { randomUUID } from 'node:crypto';
import { NvidiaClient, type OpenAiMessage } from '../client.ts';
import type { Effort } from '@ci/shared';
import { DEFAULT_NVIDIA_MODEL, getNvidiaModel, NVIDIA_MODELS, thinkingParams } from '../models.ts';
import { CORE_TOOLS } from './definitions.ts';
import type { CheckpointManager } from '../checkpoint.ts';
import { capToolResult } from '../context.ts';
import { BACKGROUND_REFUSAL, FailureTracker, startsBackgroundProcess } from '../guard.ts';
import type { BackgroundJobs } from './background.ts';
import { executeTool } from './index.ts';

export interface SubagentInput {
  role: string;
  description: string;
  prompt: string;
  model?: string;
  maxTurns?: number;
  /** reasoning on or off for this subagent (default on) and how much */
  thinking?: boolean;
  effort?: Effort;
  /** the files or folders only this agent may create or change */
  files?: string[];
  /** a command that proves the work; the agent must run it before it reports */
  check?: string;
}

/** What a subagent does while it works, so the UI can show it (the same shape of events the main agent produces). */
export type SubagentEvent =
  | { kind: 'block_start'; blockId: string; block: 'text' | 'thinking' }
  | { kind: 'delta'; blockId: string; block: 'text' | 'thinking'; text: string }
  | { kind: 'block_end'; blockId: string }
  | { kind: 'tool_start'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool_end'; id: string; text: string; isError: boolean };

export interface SubagentCallbacks {
  onProgress?: (event: {
    taskId: string;
    subagentType: string;
    state: 'running' | 'completed' | 'failed';
    summary?: string;
    toolUses?: number;
    tokens?: number;
    lastTool?: string;
  }) => void;
  onEvent?: (taskId: string, event: SubagentEvent) => void;
}

/** What the parent lends a subagent: its permission gate, its folders and its checkpoint, so nothing runs unchecked. */
export interface SubagentContext {
  authorize(toolName: string, input: Record<string, unknown>): Promise<{ ok: true; input: Record<string, unknown> } | { ok: false; message: string }>;
  addDirs: string[];
  checkpoint?: CheckpointManager;
  /** called before a write or edit: a refusal text when the file is not this agent's, or another agent already took it */
  guardWrite?(path: string): string | undefined;
  /** the session's background commands: a server an agent starts must be one of these, so it is stopped with the session */
  jobs?: BackgroundJobs;
}

export interface SubagentResult {
  taskId: string;
  role: string;
  modelUsed: string;
  text: string;
  isError: boolean;
  toolUses: number;
  /** the files it really changed */
  modified: string[];
}

// a subagent works like the main agent but cannot start subagents, ask the user, or change the plan
const SUBAGENT_ALLOWED_TOOLS = [
  'read_file',
  'glob',
  'grep',
  'bash',
  'write_file',
  'edit_file',
  'web_fetch',
  'analyze_image',
  'detect_objects',
  'screenshot',
  'bash_output',
  'bash_kill',
];

/** bash with run_in_background, bash_output and bash_kill, handled with the session's jobs (undefined: not one of those calls) */
function runBackground(jobs: BackgroundJobs | undefined, name: string, input: Record<string, unknown>, cwd: string): { text: string; isError: boolean } | undefined {
  if (!jobs) return undefined;
  const id = String(input.id ?? '');
  if (name === 'bash' && input.run_in_background === true) {
    const st = jobs.start(String(input.command ?? ''), cwd);
    return 'error' in st ? { text: st.error, isError: true } : { text: `Started in the background as ${st.id}. Read its output with bash_output, stop it with bash_kill.`, isError: false };
  }
  if (name === 'bash_output') {
    const r = jobs.read(id);
    return r ? { text: `${r.text || '(no new output)'}
[${r.running ? 'still running' : `finished, exit code ${r.exitCode ?? 0}`}]`, isError: false } : { text: `Error: no background command "${id}".`, isError: true };
  }
  if (name === 'bash_kill') return jobs.kill(id) ? { text: 'Stopped.', isError: false } : { text: `Error: no background command "${id}".`, isError: true };
  return undefined;
}

const DEFAULT_TURNS = 50;
const MAX_TURNS = 100;

/**
 * Executes a focused subagent with its own prompt, tool loop, and chosen NVIDIA model.
 * It does real work (edits, commands) under the parent's permission mode, and reports every step through the callbacks.
 */
export async function executeSubagent(
  input: SubagentInput,
  cwd: string,
  callbacks: SubagentCallbacks | undefined,
  signal: AbortSignal | undefined,
  ctx: SubagentContext
): Promise<SubagentResult> {
  const taskId = `task_${randomUUID()}`;
  const modelToUse = input.model && NVIDIA_MODELS.some((m) => m.value === input.model)
    ? input.model
    : DEFAULT_NVIDIA_MODEL;

  let toolUses = 0;
  let tokens = 0;
  const progress = (state: 'running' | 'completed' | 'failed', summary?: string, lastTool?: string) =>
    callbacks?.onProgress?.({ taskId, subagentType: input.role, state, summary, toolUses, tokens, lastTool });
  progress('running', input.description);

  const client = new NvidiaClient();
  const modelInfo = getNvidiaModel(modelToUse);

  const subagentSystemPrompt = `You are Polar, working as a subagent (${input.role}) for the lead Polar agent in the workspace ${cwd}. If asked who you are, say you are Polar. You have tools to read and search files, edit and create files, run commands and fetch web pages.
Your task: ${input.description}
Paths in your tools are relative to that workspace folder: write data.js, never <folder name>/data.js, and no absolute paths. Throwaway test files go in .tmp/scratch/.

HOW TO WORK:
- Do the work yourself, with your tools. Never reply with only an acknowledgement or a plan: if the task asks for code, a fix or a check, make the change or run the check.
- ${input.files?.length ? `Your files, the ONLY ones you may create or change: ${input.files.join(', ')}.` : 'Change only the files your task names, or that it clearly needs.'} Other agents are working at the same time on other files and you cannot see their work. If you need a change anywhere else, do not make it and do not work around it: finish what you own and put the exact change needed in your report under BLOCKED.
- Your brief is the contract. Use exactly the names, signatures, ids, class names and file layout it gives, so that your part fits with the others. If it leaves open something you must decide, write your assumption down in the report.
- Verify what you did before you report${input.check ? `: run ${input.check}` : ': run the typecheck, build, tests or the program, whichever applies'}, and fix what you broke. If your part has a result you can see or operate (a page, a keypad, a form), check it with the screenshot tool: its actions click and type, and read reports what the page shows. Never say you checked something you did not run.
- Finish with a short report in this form. STATUS: DONE or BLOCKED. FILES: the files you changed. CHECKS: each command you ran and what it printed or whether it passed. ASSUMPTIONS: what you decided on your own. NEEDS FROM LEAD: anything blocked or outside your files.`;

  const messages: OpenAiMessage[] = [
    { role: 'system', content: subagentSystemPrompt },
    { role: 'user', content: input.prompt },
  ];

  let turns = 0;
  const maxTurns = Math.min(Math.max(Math.trunc(input.maxTurns ?? DEFAULT_TURNS), 1), MAX_TURNS);
  let finalSummary = '';
  let nudged = false;
  const modified = new Set<string>();
  const refused: string[] = [];
  const failures = new FailureTracker();
  const tools = CORE_TOOLS.filter((t) => SUBAGENT_ALLOWED_TOOLS.includes(t.function.name));

  try {
    while (turns < maxTurns) {
      turns++;
      if (signal?.aborted) throw new Error('Subagent execution was aborted by parent orchestrator.');

      // one text block and one thinking block per model call, opened by the first delta
      const open: Record<'text' | 'thinking', string | undefined> = { text: undefined, thinking: undefined };
      const delta = (block: 'text' | 'thinking') => (text: string) => {
        if (!open[block]) {
          open[block] = `${taskId}:${block}${turns}`;
          callbacks?.onEvent?.(taskId, { kind: 'block_start', blockId: open[block]!, block });
        }
        callbacks?.onEvent?.(taskId, { kind: 'delta', blockId: open[block]!, block, text });
      };

      let res;
      try {
        res = await client.streamChat(
          {
            model: modelToUse,
            messages,
            tools,
            ...thinkingParams(modelInfo, input.thinking ?? true, input.effort ?? 'medium'),
            temperature: modelInfo.sampling.temperature,
            top_p: modelInfo.sampling.topP,
            signal,
          },
          { onReasoning: delta('thinking'), onContent: delta('text') },
        );
      } finally {
        for (const id of [open.thinking, open.text]) if (id) callbacks?.onEvent?.(taskId, { kind: 'block_end', blockId: id });
      }
      if (res.usage) tokens += res.usage.promptTokens + res.usage.completionTokens;

      const cutOff = res.finishReason === 'length';
      messages.push({
        role: 'assistant',
        content: res.text.trim() ? res.text : null,
        tool_calls: res.toolCalls.length > 0 ? res.toolCalls : undefined,
      });

      if (res.toolCalls.length === 0) {
        // a model that only says "understood" has done nothing: one nudge to actually do the task
        if (!nudged && toolUses === 0 && res.text.trim().length < 400) {
          nudged = true;
          messages.push({ role: 'user', content: 'You answered without using any tool, so nothing has been done yet. Do the task now with your tools (read and edit files, run commands), then report what you changed and what you verified.' });
          progress('running', 'Starting the work');
          continue;
        }
        finalSummary = res.text;
        break;
      }

      for (const call of res.toolCalls) {
        toolUses++;
        let parsedArgs: Record<string, unknown> = {};
        let badJson = false;
        try {
          parsedArgs = JSON.parse(call.function.arguments || '{}');
        } catch {
          parsedArgs = { raw: call.function.arguments };
          badJson = true;
        }

        const uiId = `${taskId}:${call.id}`; // two subagents can both get a call "call_0"
        callbacks?.onEvent?.(taskId, { kind: 'tool_start', id: uiId, name: call.function.name, input: parsedArgs });
        progress('running', `Using ${call.function.name}`, call.function.name);

        let out: string;
        let isError = false;
        if (badJson) {
          out = cutOff ? 'Error: Your reply hit the output limit while you were writing this call, so it was cut off and nothing ran. Do not resend the same big call: write the file in smaller pieces (create it with a short first version, then add the rest with edit_file), or split the work.' : `Error: the arguments of "${call.function.name}" were not valid JSON. Send the call again with valid JSON arguments.`;
          isError = true;
        } else if (!SUBAGENT_ALLOWED_TOOLS.includes(call.function.name)) {
          out = `Error: tool "${call.function.name}" is not available to subagents.`;
          isError = true;
        } else {
          const blocked = failures.before(call.function.name, parsedArgs);
          const writes = call.function.name === 'write_file' || call.function.name === 'edit_file';
          const refusal = writes ? ctx.guardWrite?.(String(parsedArgs.path ?? '')) : undefined;
          if (blocked) {
            out = blocked;
            isError = true;
          } else if (call.function.name === 'bash' && parsedArgs.run_in_background !== true && startsBackgroundProcess(String(parsedArgs.command ?? ''))) {
            out = BACKGROUND_REFUSAL;
            isError = true;
          } else if (refusal) {
            out = refusal;
            isError = true;
            refused.push(String(parsedArgs.path));
          } else {
            const auth = await ctx.authorize(call.function.name, parsedArgs);
            if (auth.ok) {
              const r = runBackground(ctx.jobs, call.function.name, auth.input, cwd) ?? await executeTool(call.function.name, auth.input, cwd, ctx.addDirs, signal, ctx.checkpoint);
              out = r.text;
              isError = r.isError;
              if (!r.isError && writes) modified.add(String(auth.input.path));
            } else {
              out = auth.message;
              isError = true;
            }
          }
        }
        if (!badJson) out += failures.after(call.function.name, parsedArgs, isError) ?? '';

        callbacks?.onEvent?.(taskId, { kind: 'tool_end', id: uiId, text: out, isError });
        messages.push({ role: 'tool', tool_call_id: call.id, content: capToolResult(out) });
      }
    }

    // turns ran out in the middle of tool use: ask once, without tools, for what it found
    if (!finalSummary && !signal?.aborted) {
      messages.push({ role: 'user', content: 'You are out of turns. Reply now with a concise report of what you changed, what you verified, and what is left.' });
      finalSummary = (await client.streamChat({ model: modelToUse, messages, signal }, {})).text;
    }

    // what the lead can trust: the files that really changed, whatever the report claims
    const changed = (modified.size ? `\n\n[Files modified by this subagent: ${[...modified].join(', ')}]` : '\n\n[This subagent modified no files.]')
      + (refused.length ? `\n[Writes refused because the files were not its own or another agent had them: ${[...new Set(refused)].join(', ')}. Make those changes yourself.]` : '');
    progress('completed', finalSummary.slice(0, 120));

    return {
      taskId,
      role: input.role,
      modelUsed: modelToUse,
      text: `${finalSummary || '(Subagent finished with no text output)'}${changed}`,
      isError: false,
      toolUses,
      modified: [...modified],
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    progress('failed', errMsg.slice(0, 120));

    return {
      taskId,
      role: input.role,
      modelUsed: modelToUse,
      text: `Subagent failed: ${errMsg}${modified.size ? `\n\n[Files modified before it failed: ${[...modified].join(', ')}]` : ''}`,
      isError: true,
      toolUses,
      modified: [...modified],
    };
  }
}
