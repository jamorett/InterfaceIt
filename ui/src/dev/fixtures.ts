// Hand-made data for the dev gallery and the responsive/accessibility tests. Shapes mirror what the real
// sessions produced in bridge/test/fixtures (PLAN.md §13.2); M1 step 3 replaces this with the live store.
import type { ContextView, LaneView, LimitWindow, PermissionView, PlanView, QuestionView, SessionSummary, TodoItem, ToolView, TranscriptItem } from '../model.ts';

export const sessions: SessionSummary[] = [
  { id: 's1', project: 'ClaudeInterface', title: 'Fix the failing store test', state: 'running', updated: 'now' },
  { id: 's2', project: 'ClaudeInterface', title: 'Add a dark theme', state: 'awaiting_permission', updated: '4m' },
  { id: 's3', project: 'ClaudeInterface', title: 'Explain the bridge', state: 'idle', updated: '2h' },
  { id: 's4', project: 'notes-site', title: 'Rename the tags page', state: 'error', updated: 'yesterday' },
  { id: 's5', project: 'notes-site', title: 'Check broken links', state: 'ended', updated: 'Mon' },
];

export const models = [
  { value: 'default', label: 'Default' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

export const context: ContextView = { totalTokens: 30_485, maxTokens: 1_000_000 };
export const limits: LimitWindow[] = [
  { label: '5h', utilization: 0.14, resetsAt: '22:19' },
  { label: '7d', utilization: 0.85, resetsAt: 'tomorrow 05:59' },
];

export const recentProjects = [
  'C:\\Users\\someone\\Desktop\\ClaudeInterface',
  'C:\\Users\\someone\\Documents\\notes-site',
  'C:\\Users\\someone\\Desktop\\a-folder-with-a-very-long-name\\and\\more\\levels\\of\\nesting\\project',
];

const readTool: ToolView = { id: 't1', name: 'Read', target: 'C:\\Users\\someone\\Desktop\\ClaudeInterface\\ui\\src\\store.ts', status: 'ok', elapsedSec: 0.4, output: "export const store = create(() => ({ items: [] }));\n" };
const bashTool: ToolView = { id: 't2', name: 'Bash', target: 'npm test -- store', status: 'ok', elapsedSec: 6, output: ' ✓ store.test.ts (3 tests)\n\n Test Files  1 passed (1)\n      Tests  3 passed (3)\n' };
const runningTool: ToolView = { id: 't3', name: 'Bash', target: 'npm run build', status: 'running', elapsedSec: 12 };
const failedTool: ToolView = { id: 't4', name: 'Bash', target: 'npm run lint', status: 'error', elapsedSec: 3, output: "error  'foo' is defined but never used  no-unused-vars\n\n1 problem (1 error)\n" };
const unknownTool: ToolView = { id: 't5', name: 'SomeFutureTool', target: '{"query":"anything"}', status: 'ok', output: '{"matches":[]}' };

export const permissionEdit: PermissionView = {
  id: 'p1',
  title: 'Edit ui/src/store.ts (+2 −1)',
  target: 'ui/src/store.ts',
  description: 'One file in your project would change.',
  agent: undefined,
  diff: [
    { kind: 'ctx', text: 'export const store = create(() => ({' },
    { kind: 'del', text: '  items: [],' },
    { kind: 'add', text: '  items: [] as Item[],' },
    { kind: 'add', text: '  version: 2,' },
    { kind: 'ctx', text: '}));' },
  ],
};
export const permissionDone: PermissionView = { id: 'p0', title: 'Write notes.txt', target: 'notes.txt', decision: 'allowed-session' };
export const permissionDenied: PermissionView = { id: 'p00', title: 'Bash: rm -rf build', target: 'rm -rf build', decision: 'denied', denyReason: 'Use npm run clean instead' };
export const permissionBash: PermissionView = {
  id: 'p2',
  title: 'Run: node scripts/migrate.mjs --all',
  target: 'node scripts/migrate.mjs --all',
  description: 'This command requires approval',
  agent: 'general-purpose',
};
export const askPerson: PermissionView = { id: 'p3', title: 'Leave plan mode and start editing', target: 'ExitPlanMode', requiresUserInteraction: true };

export const question: QuestionView = {
  id: 'q1',
  header: 'Colour',
  question: 'Which colour do you prefer, red or blue?',
  multiSelect: false,
  options: [
    { label: 'Red', description: 'Warm and strong' },
    { label: 'Blue', description: 'Calm and cool' },
  ],
};
export const questionMulti: QuestionView = {
  id: 'q2',
  header: 'Features',
  question: 'Which features should the first version include?',
  multiSelect: true,
  options: [
    { label: 'Dark theme', description: 'Follows the system setting' },
    { label: 'Session search', description: 'Find old conversations' },
    { label: 'Export', description: 'Save a transcript as Markdown' },
  ],
};

export const plan: PlanView = {
  id: 'pl1',
  text: '# Plan\n\n1. Add the `version` field to the store.\n2. Update the two selectors that read it.\n3. Write a test for the migration.\n4. Run the full suite.\n\nNothing outside `ui/src` will change.',
};

export const todos: TodoItem[] = [
  { content: 'Reproduce the failure', activeForm: 'Reproducing the failure', status: 'completed' },
  { content: 'Fix the selector', activeForm: 'Fixing the selector', status: 'completed' },
  { content: 'Run the tests', activeForm: 'Running the tests', status: 'in_progress' },
  { content: 'Update the docs', activeForm: 'Updating the docs', status: 'pending' },
];

const laneTypes = ['general-purpose', 'Explore', 'Plan', 'general-purpose', 'Explore', 'general-purpose', 'Plan', 'Explore', 'general-purpose'];
export const lanes: LaneView[] = laneTypes.map((type, i) => ({
  id: `l${i}`,
  type,
  description: ['Compute 2+2', 'Find every use of the store', 'Draft the migration', 'Check the docs build', 'Search for TODOs', 'Run the linter', 'Review the diff', 'Map the folders', 'Summarise the changes'][i]!,
  state: i < 2 ? 'completed' : i === 2 ? 'failed' : 'running',
  toolUses: i * 2,
  tokens: 1200 + i * 3100,
  depth: i === 3 ? 1 : 0,
}));

const user: TranscriptItem = { kind: 'user', id: 'u1', text: 'Fix the failing test in store.test.ts' };

export const baseTranscript: TranscriptItem[] = [
  user,
  { kind: 'thinking', id: 'th1', tokens: 280, live: false, seconds: 4 },
  { kind: 'tool', tool: readTool },
  { kind: 'tool', tool: bashTool },
  { kind: 'assistant', id: 'a1', text: 'The test failed because the store did not have a `version` field. I added it and the three tests in store.test.ts now pass.' },
];

export const runningTranscript: TranscriptItem[] = [
  user,
  { kind: 'tool', tool: readTool },
  { kind: 'tool', tool: runningTool },
  { kind: 'thinking', id: 'th2', tokens: 412, live: true },
  { kind: 'assistant', id: 'a2', text: 'Building the project first so I can see whether the type errors are related', streaming: true },
];

export const permissionTranscript: TranscriptItem[] = [
  user,
  { kind: 'tool', tool: readTool },
  { kind: 'permission', view: permissionDone },
  { kind: 'permission', view: permissionDenied },
  { kind: 'permission', view: permissionEdit },
];

/** A formatted answer with everything markdown can throw at the layout: wide tables, long code lines, links, a remote image. */
const richAnswer = [
  '## Result',
  '',
  'Here is **what changed**:',
  '',
  '- the store gained a version field',
  '- the selectors read it',
  '',
  '| file | change |',
  '|---|---|',
  '| store.ts | +2 −1 |',
  '| a-very-long-file-name-that-keeps-going-and-going-and-going-and-going.test.ts | +40 |',
  '',
  '~~~ts',
  'export const store = create(() => ({ items: [] as Item[], version: 2, aVeryLongLineOfCode: "x".repeat(400) }));',
  '~~~',
  '',
  '> Note: nothing outside ui/src changed.',
  '',
  '[docs](https://example.com/docs) and ![remote image](https://tracker.example/p.png)',
].join('\n');

export const hostileTranscript: TranscriptItem[] = [
  { kind: 'user', id: 'h1', text: 'Z'.repeat(400) + ' and some مرحبا بالعالم 你好，世界 🎉🎉 text' },
  { kind: 'tool', tool: { id: 'h2', name: 'Read', target: 'C:\\Users\\someone\\Documents\\a\\very\\deeply\\nested\\folder\\structure\\that\\keeps\\going\\and\\going\\until\\it\\reaches\\Component.tsx', status: 'ok', output: 'x'.repeat(600) + '\n' + Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join('\n'), truncatedBytes: 4_300_000 } },
  { kind: 'tool', tool: failedTool },
  { kind: 'tool', tool: unknownTool },
  // malformed on purpose: the target is not a string, so this card's renderer throws and the boundary catches it
  { kind: 'tool', tool: { id: 'h3', name: 'Broken', target: { not: 'a string' } as unknown as string, status: 'ok' } },
  { kind: 'unknown', id: 'h4', raw: { type: 'system', subtype: 'something_new', payload: { a: 1 } } },
  { kind: 'crash', id: 'h5', raw: { reason: 'forced', data: [1, 2, 3] } },
  { kind: 'compact', id: 'h6', before: 812_000, after: 41_000 },
  { kind: 'stopped', id: 'h7' },
  { kind: 'assistant', id: 'h8', text: '/context output', synthetic: true },
  { kind: 'assistant', id: 'h9', text: 'https://example.com/' + 'a-very-long-url-segment/'.repeat(12) },
  { kind: 'notice', id: 'h10', level: 'warning', text: 'A fallback model answered this turn.' },
  { kind: 'assistant', id: 'h11', text: richAnswer },
];

export const failedTranscript: TranscriptItem[] = [
  user,
  { kind: 'tool', tool: failedTool },
  { kind: 'assistant', id: 'a3', text: 'The linter found one unused variable. I will remove it.' },
];

export const diffForInspector = permissionEdit.diff!;

const ESC = String.fromCharCode(27);
const colour = (code: number, text: string) => `${ESC}[${code}m${text}${ESC}[0m`;
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Every way a tool card can show its work: a change, a file read as code, coloured terminal output, a picture, a cut output. */
export const richToolsTranscript: TranscriptItem[] = [
  user,
  { kind: 'tool', tool: { id: 'r1', name: 'Read', target: 'C:\\Users\\someone\\Desktop\\ClaudeInterface\\ui\\src\\store.ts', status: 'ok', elapsedSec: 0.3, output: '     1→export const store = create(() => ({\n     2→  items: [] as Item[],\n     3→  version: 2,\n     4→}));\n' } },
  {
    kind: 'tool',
    tool: {
      id: 'r2', name: 'Edit', target: 'ui/src/store.ts', status: 'ok', elapsedSec: 0.2, output: 'The file ui/src/store.ts has been updated.',
      input: { file_path: 'ui/src/store.ts', old_string: 'export const store = create(() => ({\n  items: [],\n}));', new_string: 'export const store = create(() => ({\n  items: [] as Item[],\n  version: 2,\n}));' },
    },
  },
  {
    kind: 'tool',
    tool: { id: 'r3', name: 'Write', target: 'notes.md', status: 'ok', output: 'File created successfully at: notes.md', input: { file_path: 'notes.md', content: Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n') } },
  },
  {
    kind: 'tool',
    tool: { id: 'r4', name: 'Bash', target: 'npm test', status: 'error', elapsedSec: 12, output: `${colour(32, '✓')} store.test.ts (3 tests)\n${colour(31, '✗ api.test.ts')} 1 failed\n${ESC}[1;33mwarning${ESC}[0m: slow test\nProgress 10%\rProgress 60%\rProgress 100%\n` },
  },
  { kind: 'tool', tool: { id: 'r5', name: 'Read', target: 'diagram.png', status: 'ok', output: '', images: [{ mediaType: 'image/png', data: PIXEL }] } },
  { kind: 'tool', tool: { id: 'r6', name: 'Bash', target: 'cat huge.log', status: 'ok', output: 'log line\n'.repeat(40), truncatedBytes: 4_300_000 } },
  { kind: 'assistant', id: 'r7', text: 'Here is a snippet:\n\n```ts\nconst answer: number = 42; // the answer\n```' },
];
