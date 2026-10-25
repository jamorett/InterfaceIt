// Plain data (no JSX) so the Playwright tests can import the list. scenarios.tsx is typed against it, so a name without a screen is a compile error.
export const scenarioNames = [
  'splash',
  'onboarding-cli-missing',
  'onboarding-cli-old',
  'onboarding-login',
  'project-picker',
  'project-trust',
  'empty',
  'idle',
  'running',
  'awaiting-permission',
  'awaiting-permission-person',
  'awaiting-question',
  'plan-review',
  'todo-lanes',
  'disconnected',
  'rate-limited',
  'limit-warning',
  'retrying',
  'crashed',
  'hostile',
  'tool-failed',
  'bypass',
  'tools-rich',
  'inspector',
] as const;

export type ScenarioName = (typeof scenarioNames)[number];
