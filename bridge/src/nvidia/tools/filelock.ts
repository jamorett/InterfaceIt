import { resolve } from 'node:path';

const tails = new Map<string, Promise<unknown>>();

/**
 * Runs `work` when no one else is changing this file. Edits read the file, change it and write it back, so two agents editing the
 * same file at once would each start from the same old text and the second write would erase the first. One after the other, the
 * second edit sees the first one's result. Different files never wait for each other.
 */
export function withFileLock<T>(file: string, work: () => Promise<T>): Promise<T> {
  const key = process.platform === 'win32' ? resolve(file).toLowerCase() : resolve(file);
  const run = (tails.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); }); // nothing is kept for a file no one is waiting on
  return run;
}
