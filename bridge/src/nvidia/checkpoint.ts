import { existsSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';

export interface FileSnapshot {
  path: string;
  existed: boolean;
  content?: string;
}

export interface Checkpoint {
  id: string;
  timestamp: number;
  description: string;
  snapshots: Map<string, FileSnapshot>;
}

export class CheckpointManager {
  private checkpoints: Checkpoint[] = [];

  startTurn(turnId: string, description: string = ''): void {
    this.checkpoints.push({
      id: turnId,
      timestamp: Date.now(),
      description,
      snapshots: new Map(),
    });
  }

  async snapshotFile(filePath: string): Promise<void> {
    const active = this.checkpoints[this.checkpoints.length - 1];
    if (!active) return;
    // Only capture the first state of a file in a given checkpoint/turn
    if (active.snapshots.has(filePath)) return;

    if (existsSync(filePath)) {
      try {
        const content = await readFile(filePath, 'utf-8');
        active.snapshots.set(filePath, { path: filePath, existed: true, content });
      } catch {
        // Binary or unreadable; skip
      }
    } else {
      active.snapshots.set(filePath, { path: filePath, existed: false });
    }
  }

  async rollback(turnId?: string): Promise<{ restored: string[]; deleted: string[] }> {
    const targetIndex = turnId
      ? this.checkpoints.findIndex((c) => c.id === turnId)
      : this.checkpoints.length - 1;

    if (targetIndex < 0 || targetIndex >= this.checkpoints.length) {
      return { restored: [], deleted: [] };
    }

    const target = this.checkpoints[targetIndex];
    if (!target) return { restored: [], deleted: [] };

    const restored: string[] = [];
    const deleted: string[] = [];

    for (const [, snap] of target.snapshots.entries()) {
      if (snap.existed && snap.content !== undefined) {
        await writeFile(snap.path, snap.content, 'utf-8');
        restored.push(snap.path);
      } else if (!snap.existed && existsSync(snap.path)) {
        await unlink(snap.path).catch(() => undefined);
        deleted.push(snap.path);
      }
    }

    // Drop checkpoints from targetIndex onward
    this.checkpoints.splice(targetIndex);

    return { restored, deleted };
  }

  getCheckpoints(): { id: string; timestamp: number; fileCount: number; description: string }[] {
    return this.checkpoints.map((c) => ({
      id: c.id,
      timestamp: c.timestamp,
      fileCount: c.snapshots.size,
      description: c.description,
    }));
  }
}

