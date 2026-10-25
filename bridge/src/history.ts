// Past conversations come from the SDK itself (verified: listSessions / getSessionMessages work), never from hand-parsed .jsonl files.
import { getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { SessionInfo } from '@ci/shared';

export async function listPast(limit = 200): Promise<SessionInfo[]> {
  const all = await listSessions();
  return all
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(0, limit)
    .map((s) => ({ id: s.sessionId, cwd: s.cwd ?? '', title: s.customTitle || s.summary || s.firstPrompt || 'Untitled', updated: s.lastModified, gitBranch: s.gitBranch, live: false }))
    .filter((s) => s.cwd);
}

/** Distinct project folders, most recently used first. */
export function recentFrom(sessions: SessionInfo[], limit = 12): string[] {
  const seen = new Set<string>();
  for (const s of [...sessions].sort((a, b) => b.updated - a.updated)) seen.add(s.cwd);
  return [...seen].slice(0, limit);
}

export async function loadMessages(sessionId: string, cwd: string): Promise<unknown[]> {
  return getSessionMessages(sessionId, { dir: cwd });
}
