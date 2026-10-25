import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnsiText } from '../components/AnsiText.tsx';
import { ansiSpans, cleanOutput } from './ansi.ts';

const ESC = String.fromCharCode(27);
const csi = (code: string) => `${ESC}[${code}`;

describe('cleanOutput', () => {
  it('keeps only the last state of a progress bar that rewrites its line', () => {
    expect(cleanOutput('10%\r50%\r100%\ndone')).toBe('100%\ndone');
  });
  it('treats Windows line endings as plain line endings', () => {
    expect(cleanOutput('a\r\nb\r\n')).toBe('a\nb\n');
  });
  it('drops cursor movement, erasing and window-title sequences but keeps colour', () => {
    const title = `${ESC}]0;my title\u0007`;
    expect(cleanOutput(`${title}${csi('2K')}${csi('1A')}${csi('31m')}red${csi('0m')}`)).toBe(`${csi('31m')}red${csi('0m')}`);
  });
  it('removes stray control characters but not tabs and newlines', () => {
    expect(cleanOutput('a\u0000b\u0007c\td\ne')).toBe('abc\td\ne');
  });
  it('collapses a run of replacement characters from binary output', () => {
    expect(cleanOutput('x�����y')).toBe('x�y');
  });
});

describe('ansiSpans', () => {
  it('splits coloured and bold runs', () => {
    const spans = ansiSpans(`plain ${csi('31m')}red${csi('0m')} ${csi('1;32m')}bold green${csi('0m')}`);
    expect(spans.find((s) => s.text === 'red')).toMatchObject({ fg: 'red' });
    expect(spans.find((s) => s.text === 'bold green')).toMatchObject({ fg: 'green', bold: true });
    expect(spans.find((s) => s.text === 'plain ')).toMatchObject({ fg: undefined });
  });
  it('ignores 256-colour and true-colour values rather than inventing colours', () => {
    const spans = ansiSpans(`${csi('38;2;12;34;56m')}x${csi('0m')}${csi('38;5;200m')}y${csi('0m')}`);
    expect(spans.every((s) => s.fg === undefined)).toBe(true);
  });
  it('is fine with empty and escape-free text', () => {
    expect(ansiSpans('')).toEqual([]);
    expect(ansiSpans('just text')).toMatchObject([{ text: 'just text' }]);
  });
});

describe('AnsiText', () => {
  it('shows colours through tokens and never leaks escape codes', () => {
    const html = renderToStaticMarkup(<AnsiText text={`${csi('31m')}error${csi('0m')} and ${csi('33m')}warn${csi('0m')}`} />);
    expect(html).toContain('class="text-danger">error<');
    expect(html).toContain('class="text-caution">warn<');
    expect(html).not.toContain(ESC);
    expect(html).not.toContain('[31m');
  });
  it('escapes markup in the output', () => {
    expect(renderToStaticMarkup(<AnsiText text="<script>alert(1)</script>" />)).not.toContain('<script');
  });
  it('cuts an enormous output instead of building a huge page', () => {
    expect(renderToStaticMarkup(<AnsiText text={'x'.repeat(500_000)} />).length).toBeLessThan(70_000);
  });
});
