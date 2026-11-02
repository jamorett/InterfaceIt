import { randomUUID } from 'node:crypto';
import type { Effort, ImageData, PermissionMode, SessionEventBody } from '@ci/shared';
import { SessionCore, type Decision } from '../core.ts';
import type { EventLog } from '../eventlog.ts';
import type { SessionSpec } from '../session.ts';
import { CheckpointManager } from './checkpoint.ts';
import { NvidiaClient, type ContentPart, type OpenAiMessage, type OpenAiToolCall } from './client.ts';
import { eventsToOpenAiMessages } from './handoff.ts';
import { DEFAULT_NVIDIA_MODEL, getNvidiaModel, NVIDIA_MODELS } from './models.ts';
import { capToolResult, estimateTokens, shrinkOldToolResults, SHRINK_AT, summaryCut, SUMMARIZE_AT, transcriptForSummary } from './context.ts';
import { decide, ruleKey } from './permissions.ts';
import { buildSystemPrompt } from './prompt.ts';
import { installSkillFromRepo } from './skills/installer.ts';
import { SkillRuntime } from './skills/runtime.ts';
import { CORE_TOOLS, executeTool, executeSubagent } from './tools/index.ts';
import { Hooks } from './hooks.ts';
import { McpManager } from './mcp.ts';
import { BackgroundJobs } from './tools/background.ts';
import { SUBAGENT_READ_ONLY } from './tools/subagent.ts';
import { resolveShell } from './tools/shellResolver.ts';

type Auth = { ok: true; input: Record<string, unknown> } | { ok: false; message: string };

const MAX_TURNS = 25;
// 3 is a cautious default (API rate limits, one permission card per subagent); CLAUDEINTERFACE_MAX_SUBAGENTS raises it up to 8
const MAX_PARALLEL_SUBAGENTS = Math.min(Math.max(Math.trunc(Number(process.env.CLAUDEINTERFACE_MAX_SUBAGENTS)) || 3, 1), 8);

export class NvidiaSession extends SessionCore {
  private client: NvidiaClient;
  private skills: SkillRuntime;
  private model: string;
  private mode: PermissionMode = 'default';
  private effort: Effort = 'medium';
  private messages: OpenAiMessage[] = [];
  private activeAbortController?: AbortController;
  private loopRunning = false;
  /** the user pressed Stop during this turn */
  private aborted = false;
  private checkpoint = new CheckpointManager();
  private addDirs: string[] = [];
  /** "always allow" answers for this session (see permissions.ruleKey) */
  private remembered = new Set<string>();
  /** what compaction kept of the messages it removed; it rides in the system prompt */
  private summary = '';
  private jobs = new BackgroundJobs();
  private mcp = new McpManager();
  private hooks: Hooks;

  constructor(spec: SessionSpec, id: string = randomUUID(), log?: EventLog) {
    super(id, spec.cwd, log);
    this.model = spec.model && spec.model !== 'default' ? spec.model : DEFAULT_NVIDIA_MODEL;
    if (spec.mode) this.mode = this.allowedMode(spec.mode);
    if (spec.effort) this.effort = spec.effort;
    if (spec.addDirs) this.addDirs = spec.addDirs;

    this.client = new NvidiaClient();
    this.skills = new SkillRuntime(spec.cwd);
    this.hooks = new Hooks(spec.cwd, id);

    this.ingest([
      this.initEvent(),
      {
        type: 'models',
        models: NVIDIA_MODELS.map((m) => ({
          value: m.value,
          label: m.label,
          description: m.description,
          efforts: m.efforts,
          fast: m.fast,
          provider: 'nvidia' as const,
        })),
      },
      {
        type: 'sdk_state',
        state: 'idle',
      },
    ]);

    // Setup initial system prompt
    this.messages.push({ role: 'system', content: this.systemText() });
    void this.startMcp();
  }

  /** MCP servers start in the background: the session is usable at once and learns their tools when they are up. */
  private async startMcp(): Promise<void> {
    await this.mcp.start(this.cwd).catch(() => undefined);
    if (this.ended) return this.mcp.closeAll();
    if (this.mcp.servers.length) this.ingest([this.initEvent()]);
  }

  private allTools() {
    return [...CORE_TOOLS, ...this.mcp.definitions()];
  }

  private systemText(): string {
    const base = buildSystemPrompt(this.cwd, this.skills.formatCatalog(), this.effort);
    return this.summary ? `${base}\n\nSUMMARY OF THE EARLIER CONVERSATION (those messages were removed to fit the context window):\n${this.summary}` : base;
  }

  /** Keeps the prompt inside the model's window: cut huge outputs, then drop old tool output, then summarise the old conversation. */
  private async fitContext(signal: AbortSignal): Promise<void> {
    const window = getNvidiaModel(this.model).contextWindow;
    if (estimateTokens(this.messages) < window * SHRINK_AT) return;
    shrinkOldToolResults(this.messages);
    if (estimateTokens(this.messages) < window * SUMMARIZE_AT) return;
    const cut = summaryCut(this.messages);
    if (cut < 0) return;

    this.ingest([{ type: 'status', compacting: true }]);
    try {
      const old = this.messages.slice(1, cut);
      const res = await this.client.streamChat(
        {
          model: this.model,
          messages: [
            { role: 'system', content: 'You condense a coding conversation so work can continue. Keep: the user\'s goals and constraints, decisions made, files changed and why, commands run and their outcome, open problems. Be factual and under 600 words.' },
            { role: 'user', content: `${this.summary ? `Earlier summary:\n${this.summary}\n\n` : ''}Conversation to condense:\n${transcriptForSummary(old)}` },
          ],
          max_tokens: 2000,
          temperature: 0.2,
          signal,
        },
        {},
      );
      if (res.text.trim()) {
        this.summary = res.text.trim();
        this.messages.splice(1, cut - 1);
        this.messages[0] = { role: 'system', content: this.systemText() };
        this.announceNotice('The conversation was long: older messages were summarised to stay inside the model\'s context window.');
      }
    } finally {
      this.ingest([{ type: 'status', compacting: false }]);
    }
  }

  /** The header reads model and mode from the latest session_init, so every change to them re-sends it. */
  private initEvent(): Extract<SessionEventBody, { type: 'session_init' }> {
    const shell = resolveShell();
    return {
      type: 'session_init',
      sdkSessionId: this.id,
      cwd: this.cwd,
      model: this.model,
      mode: this.mode,
      version: `nvidia-nim/1.0.0 (${shell.type})`,
      authMode: 'apikey',
      tools: this.allTools().map((t) => t.function.name),
      slashCommands: ['rewind'],
      agents: [],
      skills: this.skills.listSkills().map((s) => s.name),
      mcpServers: this.mcp.statuses(),
      outputStyle: 'default',
      capabilities: ['thinking', 'tools', 'skills'],
      addDirs: this.addDirs,
      provider: 'nvidia',
      activeShell: shell.path,
      effort: this.effort,
    };
  }

  /** Bypass needs the same opt-in as on the Claude side. */
  private allowedMode(mode: PermissionMode): PermissionMode {
    return mode === 'bypassPermissions' && process.env.CLAUDEINTERFACE_ALLOW_BYPASS !== '1' ? 'default' : mode;
  }

  /** Seeds messages converted from an existing Claude session log */
  handoffFromEvents(events: Parameters<typeof eventsToOpenAiMessages>[0]): void {
    this.messages = eventsToOpenAiMessages(events, this.systemText());
  }

  protected async deliver(id: string, text: string, images?: ImageData[]): Promise<void> {
    if (this.ended) return;

    if (text.trim() === '/rewind') {
      const { restored, deleted } = await this.rollbackLastTurn();
      const msg = restored.length || deleted.length
        ? `Rolled back changes: restored ${restored.length} file(s), deleted ${deleted.length} created file(s).`
        : 'No file modifications to rewind in recent checkpoints.';
      // "running" first: it is what frees the prompt queue, "idle" is what sends the next one
      this.ingest([{ type: 'sdk_state', state: 'running' }, { type: 'notice', level: 'info', text: msg }, { type: 'sdk_state', state: 'idle' }]);
      return;
    }

    this.checkpoint.startTurn(id, text.slice(0, 50));

    const modelInfo = getNvidiaModel(this.model);
    if (images && images.length > 0 && modelInfo.supportsVision) {
      const parts: ContentPart[] = [
        { type: 'text', text },
        ...images.map((im) => ({
          type: 'image_url' as const,
          image_url: { url: `data:${im.mediaType};base64,${im.data}` },
        })),
      ];
      this.messages.push({ role: 'user', content: parts });
    } else {
      this.messages.push({ role: 'user', content: text });
    }

    this.loopRunning = true;
    this.aborted = false;

    try {
      this.ingest([{ type: 'sdk_state', state: 'running' }]);
      await this.runTurnLoop();
    } catch (err) {
      // Stop aborts the request on purpose: that is not an error
      if (!this.ended && !this.aborted) {
        this.ingest([
          {
            type: 'error',
            code: 'nvidia_api_error',
            message: err instanceof Error ? err.message : String(err),
            recoverable: true,
          },
        ]);
      }
    } finally {
      this.closeDanglingToolCalls();
      this.loopRunning = false;
      this.ingest([{ type: 'sdk_state', state: 'idle' }]);
    }
  }

  /** The API rejects an assistant tool_call that has no tool answer, so a Stop in the middle must still answer every call. */
  private closeDanglingToolCalls(): void {
    let last = -1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i]?.role === 'assistant' && this.messages[i]?.tool_calls?.length) { last = i; break; }
    }
    if (last < 0) return;
    const answered = new Set(this.messages.slice(last + 1).map((m) => m.tool_call_id));
    for (const call of this.messages[last]!.tool_calls!) {
      if (!answered.has(call.id)) this.messages.push({ role: 'tool', tool_call_id: call.id, content: 'Interrupted before this tool ran.' });
    }
  }

  private async runTurnLoop(): Promise<void> {
    const started = Date.now();
    let turnCount = 0;
    let finished = false;

    while (turnCount < MAX_TURNS && !this.ended && !this.aborted) {
      turnCount++;
      this.activeAbortController = new AbortController();
      const signal = this.activeAbortController.signal;

      let thinkingBlockOpen = false;
      let textBlockOpen = false;
      const thinkingBlockId = `think_${randomUUID()}`;
      const textBlockId = `text_${randomUUID()}`;

      let resultText = '';
      let toolCalls: OpenAiToolCall[] = [];

      try {
        const activeModelInfo = getNvidiaModel(this.model);
        const reasoningBudgetMap: Record<Effort, number> = {
          low: 2048,
          medium: 8192,
          high: 16384,
          xhigh: 24576,
          max: 32768,
        };
        const reasoningBudget = activeModelInfo.supportsReasoningBudget ? reasoningBudgetMap[this.effort] : undefined;

        await this.fitContext(signal);
        const res = await this.client.streamChat(
          {
            model: this.model,
            messages: this.messages,
            tools: this.allTools(),
            signal,
            enableThinking: activeModelInfo.supportsThinking,
            reasoningBudget,
            max_tokens: activeModelInfo.defaultMaxTokens,
            seed: 42,
            temperature: this.effort === 'low' ? 0.3 : this.effort === 'high' || this.effort === 'max' ? 0.8 : 0.7,
          },
          {
            onReasoning: (delta) => {
              if (!thinkingBlockOpen) {
                thinkingBlockOpen = true;
                this.ingest([{ type: 'block_start', blockId: thinkingBlockId, kind: 'thinking' }]);
              }
              this.ingest([{ type: 'thinking_delta', blockId: thinkingBlockId, text: delta }]);
            },
            onContent: (delta) => {
              if (thinkingBlockOpen) {
                thinkingBlockOpen = false;
                this.ingest([{ type: 'block_end', blockId: thinkingBlockId }]);
              }
              if (!textBlockOpen) {
                textBlockOpen = true;
                this.ingest([{ type: 'block_start', blockId: textBlockId, kind: 'text' }]);
              }
              this.ingest([{ type: 'text_delta', blockId: textBlockId, text: delta }]);
            },
          }
        );

        resultText = res.text;
        toolCalls = res.toolCalls;
        if (res.usage && res.usage.promptTokens > 0) {
          const max = activeModelInfo.contextWindow;
          this.ingest([{ type: 'usage', totalTokens: res.usage.promptTokens, maxTokens: max, percentage: Math.min(100, (res.usage.promptTokens / max) * 100), categories: res.usage.cachedTokens ? [{ id: 'cached', name: 'Cached prompt', tokens: res.usage.cachedTokens }] : [] }]);
        }
        if (res.finishReason === 'length') {
          this.ingest([{ type: 'notice', level: 'warning', text: 'The model hit its output limit and the reply was cut off.' }]);
        }
      } finally {
        if (thinkingBlockOpen) {
          this.ingest([{ type: 'block_end', blockId: thinkingBlockId }]);
        }
        if (textBlockOpen) {
          this.ingest([{ type: 'block_end', blockId: textBlockId }]);
        }
      }

      // Record assistant message in history
      this.messages.push({
        role: 'assistant',
        content: resultText.trim() ? resultText : null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      });

      // If no tool calls, this turn is finished
      if (toolCalls.length === 0) {
        finished = true;
        this.ingest([
          {
            type: 'result',
            ok: true,
            stopped: false,
            costUsd: 0,
            durationMs: Date.now() - started,
            turns: turnCount,
            denials: 0,
          },
        ]);
        break;
      }

      if (toolCalls.every((c) => c.function.name.trim() === 'invoke_subagent')) {
        // independent subagents run side by side (3 at a time); their answers go back in the order the model asked
        const from = this.messages.length;
        for (let i = 0; i < toolCalls.length && !this.aborted; i += MAX_PARALLEL_SUBAGENTS) {
          await Promise.all(toolCalls.slice(i, i + MAX_PARALLEL_SUBAGENTS).map((c) => this.runToolCall(c)));
        }
        const order = new Map(toolCalls.map((c, i) => [c.id, i]));
        this.messages.splice(from, this.messages.length - from, ...this.messages.slice(from).sort((a, b) => (order.get(a.tool_call_id ?? '') ?? 0) - (order.get(b.tool_call_id ?? '') ?? 0)));
      } else {
        // everything else one after the other: edits and commands may depend on each other
        for (const call of toolCalls) {
          if (this.aborted) break; // closeDanglingToolCalls answers the rest
          await this.runToolCall(call);
        }
      }
    }

    if (!finished && !this.aborted && !this.ended) {
      this.ingest([
        { type: 'notice', level: 'warning', text: `Stopped after ${MAX_TURNS} model turns without a final answer. Send a message to continue.` },
        { type: 'result', ok: false, stopped: false, errorKind: 'max_turns', costUsd: 0, durationMs: Date.now() - started, turns: turnCount, denials: 0 },
      ]);
    }
  }

  /** Runs one tool call of the model: permission, execution, and the matching tool message. */
  private async runToolCall(call: OpenAiToolCall): Promise<void> {
    const toolName = call.function.name.trim();
    const answer = (text: string, isError: boolean, extra: { truncated?: boolean } = {}) => {
      this.ingest([{ type: 'tool_end', id: call.id, result: { text, images: 0, ...extra }, isError }]);
      this.messages.push({ role: 'tool', tool_call_id: call.id, content: capToolResult(text) }); // the UI keeps the full text
    };

    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = JSON.parse(call.function.arguments || '{}');
    } catch {
      // usually a reply cut off by the token limit: tell the model instead of running a call it did not finish writing
      this.ingest([{ type: 'tool_start', id: call.id, name: toolName }, { type: 'tool_input', id: call.id, input: { raw: call.function.arguments } }]);
      answer(`Error: the arguments of "${toolName}" were not valid JSON (the reply may have been cut off). Send the call again with shorter content.`, true);
      return;
    }

    this.ingest([
      { type: 'tool_start', id: call.id, name: toolName },
      { type: 'tool_input', id: call.id, input: parsedArgs },
    ]);

    if (toolName === 'exit_plan') {
      answer(...(await this.exitPlan(call.id, parsedArgs)));
      return;
    }
    if (toolName === 'ask_user_question') {
      answer(...(await this.askUser(call.id, parsedArgs)));
      return;
    }

    const auth = await this.authorize(call.id, toolName, parsedArgs);
    if (!auth.ok) {
      answer(auth.message, true);
      return;
    }
    const args = auth.input;

    if (toolName === 'TodoWrite') {
      // the UI draws the task strip from the call itself; the model only needs to know it was taken
      const ok = Array.isArray(args.todos);
      answer(ok ? 'Task list updated.' : 'Error: "todos" must be an array of {content, activeForm, status}.', !ok);
      return;
    }

    if (toolName === 'bash' && args.run_in_background === true) {
      const started = this.jobs.start(String(args.command ?? ''), this.cwd);
      answer('error' in started ? started.error : `Started in the background as ${started.id}. Read its output with bash_output, stop it with bash_kill.`, 'error' in started);
      return;
    }
    if (toolName === 'bash_output') {
      const r = this.jobs.read(String(args.id ?? ''));
      answer(
        r ? `${r.text || '(no new output)'}\n[${r.running ? 'still running' : `finished, exit code ${r.exitCode ?? 0}`}]` : `Error: no background command "${String(args.id ?? '')}".`,
        !r,
      );
      return;
    }
    if (toolName === 'bash_kill') {
      const ok = this.jobs.kill(String(args.id ?? ''));
      answer(ok ? 'Stopped.' : `Error: no background command "${String(args.id ?? '')}".`, !ok);
      return;
    }

    if (toolName === 'load_skill') {
      const skillName = String(args.skill_name ?? '');
      const skill = this.skills.getSkill(skillName);
      answer(
        skill
          ? `Skill "${skillName}" loaded successfully:\n\n${skill.instructions}`
          : `Skill "${skillName}" not found. Available skills:\n${this.skills.formatCatalog()}`,
        !skill,
      );
      return;
    }

    if (toolName === 'install_skill') {
      const instRes = await installSkillFromRepo(String(args.repo_url ?? ''), args.name ? String(args.name) : undefined, args.global === true, this.cwd);
      if (instRes.success) this.skills.reload();
      answer(instRes.message, !instRes.success);
      return;
    }

    if (toolName === 'invoke_subagent') {
      const role = String(args.role ?? 'Specialized Agent');
      const description = String(args.description ?? 'Delegated task');
      const subRes = await executeSubagent(
        {
          role,
          description,
          prompt: String(args.prompt ?? ''),
          model: args.model ? String(args.model) : undefined,
          maxTurns: typeof args.maxTurns === 'number' ? args.maxTurns : undefined,
          tools: args.read_only === true ? SUBAGENT_READ_ONLY : undefined,
        },
        this.cwd,
        {
          onProgress: (ev) => {
            this.ingest([
              {
                type: 'task',
                taskId: ev.taskId,
                toolUseId: call.id,
                subagentType: ev.subagentType,
                description: ev.summary ?? description,
                state: ev.state,
                toolUses: ev.toolUses,
              },
            ]);
          },
        },
        this.activeAbortController?.signal,
        {
          authorize: (name, input) => this.authorize(call.id, name, input),
          addDirs: this.addDirs,
          checkpoint: this.checkpoint,
        },
      );
      this.ingest([
        {
          type: 'tool_end',
          id: call.id,
          result: { text: `[Subagent (${role} on ${subRes.modelUsed}) concluded]:\n\n${subRes.text}`, images: 0 },
          isError: subRes.isError,
        },
      ]);
      this.messages.push({ role: 'tool', tool_call_id: call.id, content: capToolResult(`[Subagent (${role} on ${subRes.modelUsed}) output]:\n${subRes.text}`) });
      return;
    }

    const signal = this.activeAbortController?.signal;
    const execRes: { text: string; isError: boolean; truncated?: boolean } = this.mcp.isMcpTool(toolName)
      ? await this.mcp.call(toolName, args, signal)
      : await executeTool(toolName, args, this.cwd, this.addDirs, signal, this.checkpoint);
    // a PostToolUse hook can add feedback the model should see (a linter's complaint, say)
    const post: { message?: string } = this.hooks.any ? await this.hooks.run('PostToolUse', toolName, args, { tool_response: { text: execRes.text, isError: execRes.isError } }, signal) : {};
    answer(post.message ? `${execRes.text}\n\n[PostToolUse hook]: ${post.message}` : execRes.text, execRes.isError, { truncated: execRes.truncated });
  }

  /** The model asks the user to choose; the answer comes back as text it can act on. */
  private async askUser(toolUseId: string, input: Record<string, unknown>): Promise<[string, boolean]> {
    const asked = Array.isArray(input.questions) ? input.questions.slice(0, 4) : [];
    const questions = asked
      .filter((q): q is Record<string, unknown> => typeof q === 'object' && q !== null && typeof (q as { question?: unknown }).question === 'string')
      .map((q) => ({
        question: String(q.question),
        header: String(q.header ?? '').slice(0, 12),
        multiSelect: q.multiSelect === true,
        options: (Array.isArray(q.options) ? q.options : []).slice(0, 4).map((o) => ({ label: String((o as { label?: unknown }).label ?? ''), description: String((o as { description?: unknown }).description ?? '') })).filter((o) => o.label),
      }))
      .filter((q) => q.options.length >= 2);
    if (!questions.length) return ['Error: ask_user_question needs 1-4 questions, each with at least 2 options.', true];

    const decision = (await this.request({ type: 'question', reqId: randomUUID(), toolUseId, questions }, 'ask_user_question', input, [])) as Decision;
    if (decision.behavior !== 'allow') return [decision.message || 'The user did not answer.', true];
    const answers = (decision.updatedInput?.answers ?? {}) as Record<string, string>;
    return [questions.map((q) => `${q.question} → ${answers[q.question] ?? '(no answer)'}`).join('\n'), false];
  }

  /** Plan mode's way out: the user reads the plan and picks how the work goes on. */
  private async exitPlan(toolUseId: string, input: Record<string, unknown>): Promise<[string, boolean]> {
    if (this.mode !== 'plan') return ['Not in plan mode: nothing to approve. Carry on with the task.', true];
    const decision = (await this.request(
      { type: 'plan', reqId: randomUUID(), toolUseId, markdown: String(input.plan ?? '') },
      'exit_plan',
      input,
      [],
    )) as Decision;
    if (decision.behavior !== 'allow') return [decision.message, true];
    const toAuto = (decision.updatedPermissions ?? []).some((p) => (p as { type?: string }).type === 'setMode');
    await this.setMode(toAuto ? 'acceptEdits' : 'default');
    return [`Plan approved. Permissions are now "${this.mode}". Carry out the plan.`, false];
  }

  /** The one gate for every tool call, the main agent's and its subagents'. */
  private async authorize(toolUseId: string, toolName: string, input: Record<string, unknown>): Promise<Auth> {
    // the user's own PreToolUse hooks run first and can refuse the call outright
    if (this.hooks.any) {
      const h = await this.hooks.run('PreToolUse', toolName, input, {}, this.activeAbortController?.signal);
      if (h.blocked) return { ok: false, message: `Blocked by a PreToolUse hook: ${h.message}` };
    }
    const verdict = decide(this.mode, toolName, input, this.cwd, this.addDirs, this.remembered);
    if (verdict.kind === 'allow') return { ok: true, input };
    if (verdict.kind === 'deny') return { ok: false, message: verdict.message };

    const path = typeof input.path === 'string' ? input.path : '';
    const isReadTool = ['read_file', 'glob', 'grep'].includes(toolName);
    const displayName = toolName === 'bash'
      ? 'Run Command'
      : toolName === 'install_skill'
        ? 'Install skill'
        : toolName === 'web_fetch'
          ? 'Fetch web page'
        : this.mcp.isMcpTool(toolName)
          ? `MCP: ${toolName.replace(/^mcp__/, '').replace('__', ' / ')}`
        : isReadTool
          ? `Read ${path}`
          : `Modify ${path}`;
    const description = toolName === 'bash'
      ? String(input.command ?? '')
      : toolName === 'install_skill'
        ? String(input.repo_url ?? '')
        : toolName === 'web_fetch'
          ? String(input.url ?? '')
        : this.mcp.isMcpTool(toolName)
          ? JSON.stringify(input).slice(0, 300)
        : isReadTool
          ? `Read outside workspace: ${path}`
          : `Edit file ${path}`;

    const decision = (await this.request(
      {
        type: 'permission_request',
        reqId: randomUUID(),
        tool: toolName,
        toolUseId,
        input,
        displayName,
        description,
        requiresUserInteraction: true,
        canRemember: true,
      },
      toolName,
      input,
      [],
    )) as Decision;

    if (decision.behavior !== 'allow') {
      return { ok: false, message: decision.interrupt ? 'The request was cancelled.' : decision.message || `Tool execution of "${toolName}" was denied by user.` };
    }
    // the card may have edited the command; that edited input is what runs, and what a remembered answer matches
    const finalInput = decision.updatedInput ?? input;
    if (decision.updatedPermissions?.length) this.remembered.add(ruleKey(toolName, finalInput));
    return { ok: true, input: finalInput };
  }

  protected async stop(): Promise<void> {
    if (!this.loopRunning) return;
    this.aborted = true;
    this.activeAbortController?.abort();
    this.ingest([
      {
        type: 'result',
        ok: false,
        stopped: true,
        terminalReason: 'aborted_by_user',
        costUsd: 0,
        durationMs: 0,
        turns: 0,
        denials: 0,
      },
    ]);
  }

  async setMode(mode: PermissionMode): Promise<void> {
    const refused = this.allowedMode(mode) !== mode;
    const next = refused ? this.mode : mode; // a refused bypass keeps the mode the user had
    if (refused) this.announceNotice('Bypass permissions is off. Start the bridge with CLAUDEINTERFACE_ALLOW_BYPASS=1 to allow it.', 'warning');
    this.mode = next;
    // the init keeps the header and a reloaded page in step with the mode
    this.ingest([{ type: 'status', compacting: false, mode: next }, this.initEvent()]);
  }

  async setModel(model: string): Promise<void> {
    this.model = model && model !== 'default' ? model : DEFAULT_NVIDIA_MODEL;
    this.ingest([this.initEvent(), { type: 'notice', level: 'info', text: `Switched model to ${this.model}` }]);
  }

  async setEffort(effort: Effort): Promise<void> {
    this.effort = effort;
    if (this.messages.length > 0 && this.messages[0]?.role === 'system') {
      this.messages[0].content = this.systemText();
    }
    this.ingest([{ type: 'status', compacting: false, effort }, this.initEvent()]);
  }

  announceNotice(text: string, level: 'info' | 'warning' | 'danger' = 'info'): void {
    this.ingest([{ type: 'notice', level, text }]);
  }

  async rollbackLastTurn(turnId?: string): Promise<{ restored: string[]; deleted: string[] }> {
    return this.checkpoint.rollback(turnId);
  }

  detach(): void {
    this.ended = true;
    this.jobs.killAll();
    this.mcp.closeAll();
    this.activeAbortController?.abort();
  }

  close(): void {
    this.ended = true;
    this.jobs.killAll();
    this.mcp.closeAll();
    this.activeAbortController?.abort();
    this.ingest([{ type: 'session_ended', reason: 'closed' }]);
  }
}
