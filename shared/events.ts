// Handshake only. The full contract (PLAN.md §2) lands in M1 step 3.
export type Command = { type: 'hello'; token: string };
export type UiEvent = { type: 'ready' };
