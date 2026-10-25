import { createContext } from 'react';
import type { DiffLine } from '../model.ts';

/** What the side panel can show. Any card opens it through the context below, so cards never know where the panel lives. */
export type InspectorContent =
  | { kind: 'diff'; title: string; path: string; lines: DiffLine[] }
  | { kind: 'output'; title: string; text: string }
  | { kind: 'code'; title: string; code: string; language?: string }
  | { kind: 'image'; title: string; src: string };

export const InspectorContext = createContext<(content: InspectorContent) => void>(() => {});
