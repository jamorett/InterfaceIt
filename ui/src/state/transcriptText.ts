import type { TranscriptItem } from '../model.ts';

/** The words of a card, for search and export. Cards without words (thinking, stopped…) give nothing. */
export function textOf(item: TranscriptItem): string {
  switch (item.kind) {
    case 'user':
    case 'assistant':
    case 'notice': return item.text;
    case 'tool': return `${item.tool.name} ${item.tool.target} ${item.tool.output ?? ''}`;
    case 'permission': return `${item.view.title} ${item.view.target}`;
    case 'question': return item.view.question;
    default: return '';
  }
}

/** Positions of the cards that contain the query, ignoring case. */
export function findMatches(items: TranscriptItem[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return items.flatMap((item, i) => (textOf(item).toLowerCase().includes(q) ? [i] : []));
}

/** The conversation as Markdown. Tool output is left out: it can be huge and the file is for reading. */
export function toMarkdown(items: TranscriptItem[], title: string): string {
  const out = [`# ${title}`];
  for (const item of items) {
    if (item.kind === 'user') out.push(`## You\n\n${item.text}`);
    else if (item.kind === 'assistant') out.push(`## Claude\n\n${item.text}`);
    else if (item.kind === 'tool') out.push(`- \`${item.tool.name}\` ${item.tool.target}`);
    else if (item.kind === 'notice') out.push(`> ${item.text}`);
  }
  return out.join('\n\n') + '\n';
}
