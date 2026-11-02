import { describe, expect, it } from 'vitest';
import { BatchClaims, FailureTracker, isOwned, ownedPaths, TurnEvidence, validateBatch } from './guard.ts';

const cwd = process.platform === 'win32' ? 'C:/proj' : '/proj';
const req = (role: string, files?: string[], check = 'node t.js') => ({ role, files, check });

describe('validateBatch', () => {
  it('lets a single agent through with or without files', () => {
    expect(validateBatch([req('A')], cwd)).toBeUndefined();
    expect(validateBatch([req('A', ['src/a.ts'])], cwd)).toBeUndefined();
  });
  it('rejects a batch where an agent has no files, naming who', () => {
    const msg = validateBatch([req('Engine', ['engine.js']), req('Styles')], cwd)!;
    expect(msg).toContain('Batch not run');
    expect(msg).toContain('"Styles"');
    expect(msg).not.toContain('"Engine"');
  });
  it('rejects a batch where an agent has no check, naming who', () => {
    const msg = validateBatch([req('A', ['a.js']), req('B', ['b.js'], '')], cwd)!;
    expect(msg).toContain('Batch not run');
    expect(msg).toContain('"check"');
    expect(msg).toContain('"B"');
    expect(msg).not.toContain('"A"');
  });
  it('rejects the same file, and a file inside a folder another agent owns', () => {
    expect(validateBatch([req('A', ['app.js']), req('B', ['app.js'])], cwd)).toContain('both own');
    expect(validateBatch([req('A', ['src']), req('B', ['src/ui/keypad.css'])], cwd)).toContain('both own');
  });
  it('accepts agents with different files and folders', () => {
    expect(validateBatch([req('A', ['engine.js', 'engine.test.js']), req('B', ['ui/']), req('C', ['app.js'])], cwd)).toBeUndefined();
  });
  it('a similar name is not an overlap (src/app vs src/app.css)', () => {
    expect(validateBatch([req('A', ['src/app']), req('B', ['src/app.css'])], cwd)).toBeUndefined();
  });
});

describe('BatchClaims', () => {
  const owned = ownedPaths(['src/engine'], cwd);
  it('refuses a write outside the agent\'s files, and says what to do', () => {
    const c = new BatchClaims();
    const msg = c.write('A', 'src/ui/app.js', owned, cwd)!;
    expect(msg).toContain('not one of your files');
    expect(msg).toContain('say in your report');
    expect(c.write('A', 'src/engine/calc.js', owned, cwd)).toBeUndefined();
  });
  it('the first writer keeps the file, another agent is refused, the same agent may write again', () => {
    const c = new BatchClaims();
    expect(c.write('A', 'x.js', [], cwd)).toBeUndefined();
    expect(c.write('A', 'x.js', [], cwd)).toBeUndefined();
    expect(c.write('B', 'x.js', [], cwd)).toContain('being changed by another agent (A)');
    c.reset();
    expect(c.write('B', 'x.js', [], cwd)).toBeUndefined();
  });
  it('throwaway files under .tmp/ are free for every agent and never claimed', () => {
    const c = new BatchClaims();
    expect(c.write('A', '.tmp/scratch/t.html', owned, cwd)).toBeUndefined();
    expect(c.write('B', '.tmp/scratch/t.html', owned, cwd)).toBeUndefined();
  });
  it('isOwned follows folders', () => {
    expect(isOwned('src/engine/a.js', owned, cwd)).toBe(true);
    expect(isOwned('src/engineer.js', owned, cwd)).toBe(false);
  });
});

describe('FailureTracker', () => {
  it('warns on the second identical failure and does not run the third', () => {
    const t = new FailureTracker();
    const args = { path: 'a.ts', old_string: 'x' };
    expect(t.before('edit_file', args)).toBeUndefined();
    expect(t.after('edit_file', args, true)).toBeUndefined();
    expect(t.after('edit_file', args, true)).toContain('failed twice');
    expect(t.before('edit_file', args)).toContain('Blocked');
  });
  it('a different call, or a success, resets it', () => {
    const t = new FailureTracker();
    t.after('bash', { command: 'a' }, true);
    t.after('bash', { command: 'a' }, true);
    expect(t.before('bash', { command: 'b' })).toBeUndefined();
    t.after('bash', { command: 'a' }, false);
    expect(t.before('bash', { command: 'a' })).toBeUndefined();
  });
});

describe('TurnEvidence', () => {
  it('says nothing when nothing was changed, or when only docs and scratch files were', () => {
    const e = new TurnEvidence();
    expect(e.reminder()).toBeUndefined();
    e.noteChanged(['README.md', 'notes.txt', '.tmp/scratch/x.js']);
    expect(e.reminder()).toBeUndefined();
  });
  it('asks once to run the code that was changed, and not again', () => {
    const e = new TurnEvidence();
    e.noteChanged(['calc.js']);
    expect(e.reminder()).toContain('have not run, built or tested it');
    expect(e.reminder()).toBeUndefined();
  });
  it('a check after the change is enough for non-UI code, and a check before it is not', () => {
    const a = new TurnEvidence();
    a.noteChanged(['calc.js']);
    a.noteCommand('node calc.test.js');
    expect(a.reminder()).toBeUndefined();
    const b = new TurnEvidence();
    b.noteCommand('npm test');
    b.noteChanged(['calc.js']);
    expect(b.reminder()).toBeDefined();
  });
  it('UI code needs a look at the page, not only a build', () => {
    const e = new TurnEvidence();
    e.noteChanged(['index.html', 'app.js']);
    e.noteCommand('npm run build');
    expect(e.reminder()).toContain('browser');
    const f = new TurnEvidence();
    f.noteChanged(['index.html']);
    f.noteLook();
    expect(f.reminder()).toBeUndefined();
  });
  it('changing again after the look asks again, once per turn only', () => {
    const e = new TurnEvidence();
    e.noteChanged(['index.html']);
    e.noteLook();
    e.noteChanged(['index.html']);
    expect(e.reminder()).toBeDefined();
    e.noteChanged(['index.html']);
    expect(e.reminder()).toBeUndefined();
  });
});

describe('startsBackgroundProcess', () => {
  it('sees a lone & and nothing else', async () => {
    const { startsBackgroundProcess } = await import('./guard.ts');
    for (const c of ['python -m http.server 8000 &', 'npm run dev & echo started', 'sleep 5 &\nls']) expect(startsBackgroundProcess(c), c).toBe(true);
    for (const c of ['a && b', 'cmd 2>&1 | tail', 'cmd >&2', 'cmd &> out.txt', 'echo "a & b"', "grep 'x&y' f", 'ls']) expect(startsBackgroundProcess(c), c).toBe(false);
  });
});
