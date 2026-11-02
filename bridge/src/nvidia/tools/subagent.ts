import { randomUUID } from 'node:crypto';
import { NvidiaClient, type OpenAiMessage } from '../client.ts';
import { DEFAULT_NVIDIA_MODEL, getNvidiaModel, NVIDIA_MODELS } from '../models.ts';
import { CORE_TOOLS } from './definitions.ts';
import type { CheckpointManager } from '../checkpoint.ts';
import { capToolResult } from '../context.ts';
import { executeTool } from './index.ts';

export interface SubagentInput {
  role: string;
  description: string;
  prompt: string;
  model?: string;
  tools?: string[];
  maxTurns?: number;
}

export interface SubagentCallbacks {
  onProgress?: (event: {
    taskId: string;
    subagentType: string;
    state: 'running' | 'completed' | 'failed';
    summary?: string;
    toolUses?: number;
  }) => void;
}

/** What the parent lends a subagent: its permission gate, its folders and its checkpoint, so nothing runs unchecked. */
export interface SubagentContext {
  authorize(toolName: string, input: Record<string, unknown>): Promise<{ ok: true; input: Record<string, unknown> } | { ok: false; message: string }>;
  addDirs: string[];
  checkpoint?: CheckpointManager;
}

export interface SubagentResult {
  taskId: string;
  role: string;
  modelUsed: string;
  text: string;
  isError: boolean;
  toolUses: number;
}

export const SUBAGENT_READ_ONLY = ['read_file', 'glob', 'grep', 'web_fetch'];

const SUBAGENT_ALLOWED_TOOLS = [
  'read_file',
  'glob',
  'grep',
  'bash',
  'write_file',
  'edit_file',
  'web_fetch',
];

/**
 * Executes a focused subagent with its own prompt, tool loop, and chosen NVIDIA model.
 * Subagents can run on a fast model (Nemotron Lightning) or a larger one (Nemotron Ultra, Mistral Large)
 * while reporting progress back to the orchestrator.
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

  callbacks?.onProgress?.({
    taskId,
    subagentType: input.role,
    state: 'running',
    summary: input.description,
    toolUses: 0,
  });

  const client = new NvidiaClient();
  const modelInfo = getNvidiaModel(modelToUse);

  const subagentSystemPrompt = `You are a specialized subagent (${input.role}) working on a delegated task within workspace ${cwd}.
Role: ${input.role}
Task Description: ${input.description}
Model Engine: ${modelToUse}

OPERATING DISCIPLINE:
- Focus solely on the delegated task. Be direct and concise.
- Use tools to gather facts or produce results.
- When done, summarize your findings or modifications clearly and conclude your turn.`;

  const messages: OpenAiMessage[] = [
    { role: 'system', content: subagentSystemPrompt },
    { role: 'user', content: input.prompt },
  ];

  let toolUses = 0;
  let turns = 0;
  const maxTurns = input.maxTurns ?? 10;
  let finalSummary = '';

  try {
    const allowed = input.tools?.length ? SUBAGENT_ALLOWED_TOOLS.filter((t) => input.tools!.includes(t)) : SUBAGENT_ALLOWED_TOOLS;
    const subagentTools = CORE_TOOLS.filter((t) => allowed.includes(t.function.name));

    while (turns < maxTurns) {
      turns++;
      if (signal?.aborted) throw new Error('Subagent execution was aborted by parent orchestrator.');

      const res = await client.streamChat(
        {
          model: modelToUse,
          messages,
          tools: subagentTools,
          enableThinking: modelInfo.supportsThinking,
          signal,
        },
        {}
      );

      messages.push({
        role: 'assistant',
        content: res.text.trim() ? res.text : null,
        tool_calls: res.toolCalls.length > 0 ? res.toolCalls : undefined,
      });

      if (res.toolCalls.length === 0) {
        finalSummary = res.text;
        break;
      }

      for (const call of res.toolCalls) {
        toolUses++;
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(call.function.arguments || '{}');
        } catch {
          parsedArgs = { raw: call.function.arguments };
        }

        callbacks?.onProgress?.({
          taskId,
          subagentType: input.role,
          state: 'running',
          summary: `Using ${call.function.name}`,
          toolUses,
        });

        let out: string;
        if (!allowed.includes(call.function.name)) {
          out = `Error: tool "${call.function.name}" is not available to subagents.`;
        } else {
          const auth = await ctx.authorize(call.function.name, parsedArgs);
          out = auth.ok
            ? (await executeTool(call.function.name, auth.input, cwd, ctx.addDirs, signal, ctx.checkpoint)).text
            : auth.message;
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: capToolResult(out),
        });
      }
    }

    // turns ran out in the middle of tool use: ask once, without tools, for what it found
    if (!finalSummary && !signal?.aborted) {
      messages.push({ role: 'user', content: 'You are out of turns. Reply now with a concise summary of what you found or changed, and what is left.' });
      finalSummary = (await client.streamChat({ model: modelToUse, messages, signal }, {})).text;
    }

    callbacks?.onProgress?.({
      taskId,
      subagentType: input.role,
      state: 'completed',
      summary: finalSummary.slice(0, 120),
      toolUses,
    });

    return {
      taskId,
      role: input.role,
      modelUsed: modelToUse,
      text: finalSummary || '(Subagent finished with no text output)',
      isError: false,
      toolUses,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    callbacks?.onProgress?.({
      taskId,
      subagentType: input.role,
      state: 'failed',
      summary: errMsg.slice(0, 120),
      toolUses,
    });

    return {
      taskId,
      role: input.role,
      modelUsed: modelToUse,
      text: `Subagent failed: ${errMsg}`,
      isError: true,
      toolUses,
    };
  }
}

