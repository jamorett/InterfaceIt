// Everything the UI may ask the bridge to do. The bridge parses every incoming message with `commandSchema`
// (PLAN.md §4 rule 6): an invalid or unknown message is answered with an error and never acted on.
import { z } from 'zod';
import { effortLevels, permissionModes } from './events.ts';

const id = z.string().min(1).max(120);
const folder = z.string().min(1).max(1000);
const mode = z.enum(permissionModes as [string, ...string[]]);

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), token: z.string().max(200) }),
  z.object({ type: z.literal('list_sessions') }),
  z.object({ type: z.literal('preflight') }),
  z.object({ type: z.literal('trust_folder'), path: folder }),

  z.object({
    type: z.literal('start'),
    cwd: folder,
    model: z.string().max(100).optional(),
    effort: z.enum(effortLevels).optional(),
    mode: mode.optional(),
    addDirs: z.array(folder).max(20).optional(),
  }),
  /** continue a conversation that is stored on disk; `fork` makes a copy under a new id instead of continuing it */
  z.object({ type: z.literal('resume'), sdkSessionId: id, cwd: folder, fork: z.boolean().optional() }),
  z.object({ type: z.literal('close'), sessionId: id }),
  z.object({ type: z.literal('replay_from'), sessionId: id, seq: z.number().int().min(0) }),

  z.object({ type: z.literal('prompt'), sessionId: id, text: z.string().min(1).max(200_000) }),
  z.object({ type: z.literal('unqueue'), sessionId: id, promptId: id }),
  z.object({ type: z.literal('interrupt'), sessionId: id }),

  z.object({
    type: z.literal('permission_reply'),
    sessionId: id,
    reqId: id,
    decision: z.enum(['allow', 'deny']),
    scope: z.enum(['once', 'session', 'local', 'project', 'user']).optional(),
    reason: z.string().max(2000).optional(),
    editedInput: z.record(z.string(), z.unknown()).optional(),
  }),
  /** question text → chosen label(s); several labels of a multi-select are joined with ", " by the bridge */
  z.object({ type: z.literal('answer'), sessionId: id, reqId: id, answers: z.record(z.string().max(2000), z.string().max(2000)) }),
  z.object({ type: z.literal('plan_reply'), sessionId: id, reqId: id, decision: z.enum(['approve_auto', 'approve_manual', 'reject']), feedback: z.string().max(4000).optional() }),

  z.object({ type: z.literal('set_mode'), sessionId: id, mode }),
  z.object({ type: z.literal('set_model'), sessionId: id, model: z.string().max(100) }),
  z.object({ type: z.literal('set_effort'), sessionId: id, effort: z.enum(effortLevels) }),
]);

export type Command = z.infer<typeof commandSchema>;
