import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromShellPath, isPathInsideRoots, resolveSafePath } from './read.ts';
import { screenshotTarget } from './screenshot.ts';

// Git Bash paths only exist on Windows; elsewhere nothing is changed
describe.skipIf(process.platform !== 'win32')('Git Bash paths on Windows', () => {
  it('turns /c/... and /tmp/... back into Windows paths, and leaves the rest alone', () => {
    expect(fromShellPath('/c/Users/me/proj/a.txt')).toBe('C:/Users/me/proj/a.txt');
    expect(fromShellPath('/d')).toBe('D:/');
    expect(fromShellPath('/tmp/work/index.html')).toBe(join(tmpdir(), 'work/index.html'));
    expect(fromShellPath('/tmp')).toBe(join(tmpdir(), ''));
    expect(fromShellPath('C:\Users\me')).toBe('C:\Users\me');
    expect(fromShellPath('src/a.ts')).toBe('src/a.ts');
    expect(fromShellPath('/tmpfoo')).toBe('/tmpfoo');
  });
  it('a path copied from `pwd` in Git Bash counts as inside the workspace it points into', () => {
    const cwd = join(tmpdir(), 'ci-eval-x');
    expect(isPathInsideRoots(cwd, '/tmp/ci-eval-x/index.html')).toBe(true);
    expect(isPathInsideRoots(cwd, '/tmp/other/index.html')).toBe(false);
    expect(resolveSafePath(cwd, '/tmp/ci-eval-x/a.txt')).toBe(join(tmpdir(), 'ci-eval-x', 'a.txt'));
    expect(screenshotTarget('/tmp/ci-eval-x/index.html', cwd, []).kind).toBe('local');
  });
});
