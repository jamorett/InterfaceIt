// Syntax highlighting, loaded only when a code block first needs it (this whole file is a separate chunk).
// Colours come from the --shiki-* variables in theme.css, which point at the contrast-tested design tokens, so light and dark need no second theme.
import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore, type ThemedToken } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguages, bundledLanguagesAlias } from 'shiki/langs';

export type Tokens = ThemedToken[][];

/** Beyond this a block is shown plain: highlighting a log file would freeze the page for nothing. */
export const MAX_HIGHLIGHT_CHARS = 30_000;

const theme = createCssVariablesTheme({ name: 'ci', variablePrefix: '--shiki-', variableDefaults: {}, fontStyle: true });
let highlighter: Promise<HighlighterCore> | undefined;
const get = () => (highlighter ??= createHighlighterCore({ themes: [theme], langs: [], engine: createJavaScriptRegexEngine() }));

const loaders = { ...bundledLanguagesAlias, ...bundledLanguages } as Record<string, (typeof bundledLanguages)[keyof typeof bundledLanguages]>;

/** The language is known if Shiki has a grammar for it (or an alias, like ts → typescript). */
export const isKnownLanguage = (lang?: string) => Boolean(lang && Object.hasOwn(loaders, lang.toLowerCase()));

/** Tokens with a colour variable and a font style each, or undefined when the language is unknown, the text too long, or the grammar cannot run here. */
export async function highlight(code: string, lang?: string): Promise<Tokens | undefined> {
  if (!lang || !isKnownLanguage(lang) || code.length > MAX_HIGHLIGHT_CHARS) return undefined;
  const id = lang.toLowerCase();
  try {
    const h = await get();
    await h.loadLanguage(loaders[id]!); // registering the grammar also registers its aliases, so `id` works as the language below
    return h.codeToTokensBase(code, { lang: id, theme: 'ci' });
  } catch {
    return undefined; // a grammar the JavaScript regex engine cannot run: plain text is still correct
  }
}
