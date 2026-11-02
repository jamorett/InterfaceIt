import type { SessionEvent } from '@ci/shared';
import type { ContentPart, OpenAiMessage, OpenAiToolCall } from './client.ts';
import { capToolResult } from './context.ts';

const s = (v: unknown) => (typeof v === 'string' ? v : undefined);
const n = (v: unknown) => (typeof v === 'number' ? v : undefined);

/** Claude's tool calls in the history, written the way the NIM model's own tools are, so it can follow and imitate them. Unknown tools pass through. */
export function toNimCall(name: string, input: unknown): { name: string; input: unknown } {
  if (typeof input !== 'object' || input === null) return { name, input };
  const i = input as Record<string, unknown>;
  switch (name) {
    case 'Read': {
      const offset = n(i.offset);
      const limit = n(i.limit);
      return { name: 'read_file', input: { path: s(i.file_path), ...(offset !== undefined && { startLine: offset }), ...(offset !== undefined && limit !== undefined && { endLine: offset + limit - 1 }) } };
    }
    case 'Write': return { name: 'write_file', input: { path: s(i.file_path), content: s(i.content) } };
    case 'Edit': return { name: 'edit_file', input: { path: s(i.file_path), old_string: s(i.old_string), new_string: s(i.new_string), ...(i.replace_all === true && { replace_all: true }) } };
    case 'Bash': return { name: 'bash', input: { command: s(i.command), ...(n(i.timeout) !== undefined && { timeoutMs: n(i.timeout) }) } };
    case 'WebFetch': return { name: 'web_fetch', input: { url: s(i.url) } };
    case 'Task': case 'Agent': return { name: 'invoke_subagent', input: { role: s(i.subagent_type) ?? s(i.role) ?? 'Agent', description: s(i.description), prompt: s(i.prompt) } };
    case 'Glob': return { name: 'glob', input: { pattern: s(i.pattern), ...(s(i.path) && { path: s(i.path) }) } };
    case 'Grep': return { name: 'grep', input: { query: s(i.pattern), is_regex: true, ...(s(i.path) && { path: s(i.path) }) } };
    default: return { name, input };
  }
}

export function eventsToOpenAiMessages(
  events: SessionEvent[],
  systemPrompt: string
): OpenAiMessage[] {
  const messages: OpenAiMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  let currentAssistantText = '';
  let inAssistantBlock = false;
  const toolInputMap = new Map<string, unknown>();
  const toolNameMap = new Map<string, string>();
  const subBlocks = new Set<string>();
  const subTools = new Set<string>();

  for (const e of events) {
    switch (e.type) {
      case 'user_message': {
        if (inAssistantBlock && currentAssistantText.trim()) {
          messages.push({ role: 'assistant', content: currentAssistantText });
          currentAssistantText = '';
          inAssistantBlock = false;
        }
        if (e.images && e.images.length > 0) {
          const parts: ContentPart[] = [
            { type: 'text', text: e.text },
            ...e.images.map((im) => ({
              type: 'image_url' as const,
              image_url: { url: `data:${im.mediaType};base64,${im.data}` },
            })),
          ];
          messages.push({ role: 'user', content: parts });
        } else {
          messages.push({ role: 'user', content: e.text });
        }
        break;
      }

      case 'block_start': {
        if (e.parentId) { subBlocks.add(e.blockId); break; } // a subagent's own words are not the assistant's
        if (e.kind === 'text') inAssistantBlock = true;
        break;
      }

      case 'text_delta': {
        if (subBlocks.has(e.blockId)) break;
        currentAssistantText += e.text;
        break;
      }

      case 'block_end': {
        // assistant block can continue if next block is text or tool
        break;
      }

      case 'tool_start': {
        if (e.parentId) { subTools.add(e.id); break; } // inside a subagent: the lead only ever saw the subagent's final report
        toolNameMap.set(e.id, e.name);
        break;
      }

      case 'tool_input': {
        if (subTools.has(e.id)) break;
        toolInputMap.set(e.id, e.input);
        break;
      }

      case 'tool_end': {
        if (e.parentId || subTools.has(e.id)) break;
        const { name, input } = toNimCall(toolNameMap.get(e.id) ?? 'unknown', toolInputMap.get(e.id) ?? {});
        const callObj: OpenAiToolCall = {
          id: e.id,
          type: 'function',
          function: {
            name,
            arguments: typeof input === 'string' ? input : JSON.stringify(input),
          },
        };

        // Add assistant message containing the tool call
        messages.push({
          role: 'assistant',
          content: currentAssistantText.trim() ? currentAssistantText : null,
          tool_calls: [callObj],
        });
        currentAssistantText = '';
        inAssistantBlock = false;

        // Add tool result message
        messages.push({
          role: 'tool',
          tool_call_id: e.id,
          content: capToolResult(e.result.text),
        });
        break;
      }

      default:
        break;
    }
  }

  if (inAssistantBlock && currentAssistantText.trim()) {
    messages.push({ role: 'assistant', content: currentAssistantText });
  }

  return messages;
}

