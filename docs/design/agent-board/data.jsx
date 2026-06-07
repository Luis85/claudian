/* data.jsx — fixtures, status metadata, and Lucide-style stroke icons
   for the Agent Board work-order modal redesign. */

/* ---------- Lucide-style stroke icons (24×24, stroke-width 2) ---------- */
const ICON_PATHS = {
  'circle-dot': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  sparkles: '<path d="M9.94 4.94 9 2 8.06 4.94 5 6l3.06 1.06L9 10l.94-2.94L12 6zM18 9l-.66 2.34L15 12l2.34.66L18 15l.66-2.34L21 12l-2.34-.66zM13 14l-.5 1.8L10.5 16l2 .7.5 1.8.5-1.8 2-.7-2-.7z"/>',
  signal: '<path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  'message-square': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  'list-checks': '<path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
  'clipboard-check': '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  'scroll-text': '<path d="M15 12h-5M15 8h-5M19 17V5a2 2 0 0 0-2-2H4M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  square: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  'check-square': '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  triangle: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
};

function Icon({ name, size = 16, stroke = 2, style }) {
  const d = ICON_PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block', ...style }}
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}

/* ---------- Status metadata: label, color token, glyph ---------- */
const STATUS_META = {
  inbox:         { label: 'Inbox',         color: 'var(--color-base-60)', soft: 'rgba(112,112,112,0.16)', icon: 'square' },
  ready:         { label: 'Ready',         color: 'var(--color-blue)',    soft: 'rgba(74,143,231,0.16)',  icon: 'circle-dot' },
  running:       { label: 'Running',       color: 'var(--color-yellow)',  soft: 'rgba(229,178,93,0.16)',  icon: 'activity', live: true },
  needs_input:   { label: 'Needs input',    color: 'var(--color-blue)',    soft: 'rgba(74,143,231,0.16)',  icon: 'message-square', live: true },
  needs_approval:{ label: 'Needs approval', color: 'var(--color-purple)',  soft: 'rgba(124,92,191,0.16)',  icon: 'check-square', live: true },
  review:        { label: 'In review',     color: 'var(--color-blue)',    soft: 'rgba(74,143,231,0.16)',  icon: 'clipboard-check' },
  needs_fix:     { label: 'Needs fix',     color: 'var(--color-orange)',  soft: 'rgba(224,125,82,0.16)',  icon: 'rotate-ccw' },
  needs_handoff: { label: 'Needs handoff', color: 'var(--color-orange)',  soft: 'rgba(224,125,82,0.16)',  icon: 'triangle' },
  done:          { label: 'Done',          color: 'var(--color-green)',   soft: 'rgba(0,189,126,0.16)',   icon: 'check-square' },
  failed:        { label: 'Failed',        color: 'var(--color-red)',     soft: 'rgba(224,82,82,0.16)',   icon: 'triangle' },
  canceled:      { label: 'Canceled',      color: 'var(--color-base-50)', soft: 'rgba(85,85,85,0.16)',    icon: 'x' },
};

const PRIORITY_META = {
  '0 - urgent': { label: 'Urgent', color: 'var(--color-red)',    bars: 3 },
  '1 - high':   { label: 'High',   color: 'var(--color-orange)', bars: 3 },
  '2 - normal': { label: 'Normal', color: 'var(--color-yellow)', bars: 2 },
  '3 - low':    { label: 'Low',    color: 'var(--color-base-60)', bars: 1 },
};

/* ---------- Agents (assignable personas) ----------
   There is always a built-in Standard agent; users create the rest in the
   Agents feature and assign them to work orders like an assignee. */
const AGENTS = {
  standard:   { id: 'standard',   name: 'Standard agent',  color: 'var(--color-base-90)', soft: 'rgba(170,170,170,0.16)', standard: true },
  refactorer: { id: 'refactorer', name: 'Refactorer',      color: 'var(--color-purple)', soft: 'rgba(124,92,191,0.20)',  initials: 'RF' },
  docwriter:  { id: 'docwriter',  name: 'Doc Writer',      color: 'var(--color-blue)',   soft: 'rgba(74,143,231,0.20)', initials: 'DW' },
  tester:     { id: 'tester',     name: 'Test Engineer',   color: 'var(--color-green)',  soft: 'rgba(0,189,126,0.20)',  initials: 'TE' },
  security:   { id: 'security',   name: 'Security Auditor',color: 'var(--color-orange)', soft: 'rgba(224,125,82,0.20)', initials: 'SA' },
};
const AGENT_OPTIONS = Object.values(AGENTS).map((a) => a.name);
const AGENT_BY_NAME = Object.fromEntries(Object.values(AGENTS).map((a) => [a.name, a.id]));

function Avatar({ agent, size = 20 }) {
  const a = AGENTS[agent] || AGENTS.standard;
  return (
    <span
      className="ds-avatar"
      title={a.name}
      style={{
        display: 'inline-grid', placeItems: 'center', flexShrink: 0,
        width: size, height: size, borderRadius: '50%', fontWeight: 600,
        fontSize: Math.round(size * 0.42), lineHeight: 1, letterSpacing: '.01em',
        background: a.soft, color: a.color,
        border: '1px solid color-mix(in srgb, ' + 'currentColor 26%, transparent)',
      }}
    >
      {a.standard ? <Icon name="cpu" size={Math.round(size * 0.58)} /> : a.initials}
    </span>
  );
}

const PROVIDER_OPTIONS = ['claude', 'codex', 'cursor', 'opencode'];
const MODEL_OPTIONS = {
  claude: ['Provider default', 'Opus', 'Sonnet', 'Haiku'],
  codex: ['Provider default', 'gpt-5-codex', 'o4-mini'],
  cursor: ['Provider default', 'cursor-fast'],
  opencode: ['Provider default', 'kimi-k2', 'qwen3-coder'],
};
const PRIORITY_OPTIONS = ['0 - urgent', '1 - high', '2 - normal', '3 - low'];

/* ---------- Acceptance helper ---------- */
const ac = (label, done) => ({ label, done });

/* ---------- Task fixtures, one per demonstrated status ---------- */
const TASKS = {
  inbox: {
    id: 'WO-204',
    status: 'inbox',
    agent: 'standard',
    title: 'Bug fix',
    provider: 'claude',
    model: 'Sonnet',
    priority: '1 - high',
    created: '2026-06-05',
    updated: '2026-06-07',
    attempts: 0,
    conversation: null,
    objective: 'Diagnose and fix the bug described below. Confirm the root cause before changing code, and keep the change surface minimal.',
    acceptance: [
      ac('Repro confirmed', false),
      ac('Root cause identified', false),
      ac('Fix covered by a regression test', false),
      ac('No unrelated changes', false),
    ],
  },

  running: {
    id: 'WO-198',
    status: 'running',
    agent: 'refactorer',
    title: 'Settings overhaul — execute plan',
    provider: 'claude',
    model: 'Opus',
    priority: '2 - normal',
    created: '2026-05-30',
    updated: '2026-06-07',
    attempts: 1,
    startedAgo: 'Started 4m ago',
    conversation: 'chat-7af3',
    objective: 'Execute linked plan docs/superpowers/plans/2026-05-30-settings-overhaul. Replace the imperative settings shell with a typed registry driving every tab, surface a search box and first-run banner, and resolve the Agent Board default provider deterministically.',
    acceptance: [
      ac('Registry foundation in place', true),
      ac('Search bar + first-run banner', true),
      ac('Custom-models table', false),
      ac('Resolver-aware default provider', false),
      ac('Live hotkey bindings shown', false),
    ],
  },

  review: {
    id: 'WO-198',
    status: 'review',
    agent: 'refactorer',
    title: 'Settings overhaul — execute plan',
    provider: 'claude',
    model: 'Opus',
    priority: '2 - normal',
    created: '2026-05-30',
    updated: '2026-06-07',
    attempts: 1,
    conversation: 'chat-7af3',
    objective: 'Execute linked plan docs/superpowers/plans/2026-05-30-settings-overhaul. Replace the imperative settings shell with a typed registry driving every tab.',
    acceptance: [
      ac('Registry foundation in place', true),
      ac('Search bar + first-run banner', true),
      ac('Custom-models table', true),
      ac('Resolver-aware default provider', true),
    ],
    handoff: {
      summary: 'Halted before any code change. Discovered the work-order assumes Claudian 3.0.0 is not yet released; in reality the current version is 3.5.0 and 3.0.0 shipped months ago with legacy renderers restored as a fallback. Residual port was deferred to settings-registry-port-followup (target v3.1.0, also now stale).',
      verification: 'Read work order + full plan (2800 lines). Inventoried registry state: fields for agentBoard, claude, codex, cursor, diagnostics, general, opencode are present (no orchestrator.ts). package.json / manifest.json version = 3.5.0. Git tags: 3.1.0, 3.2.0, 3.4.0, 3.5.0.',
      risks: 'Executing as written would mis-tag (3.0.0 already exists), force a 5-tab deep port + LEGACY rename + legacy file deletion under a stale plan that no longer matches the repo. Proceeding without scope clarification risks breaking a known-working v3.5.0 settings panel.',
      nextAction: 'Pick option A (deep port + ship 4.0.0), B (small cleanup only), or C (close as stale + flip statuses). Default C. After your answer I will execute exactly that and update the plan/spec/work-order accordingly.',
    },
  },

  needs_handoff: {
    id: 'WO-211',
    status: 'needs_handoff',
    agent: 'security',
    title: 'Migrate auth tokens to keychain',
    provider: 'codex',
    model: 'gpt-5-codex',
    priority: '1 - high',
    created: '2026-06-04',
    updated: '2026-06-07',
    attempts: 2,
    conversation: 'chat-9c12',
    objective: 'Move plaintext auth tokens out of data.json and into the OS keychain via the Electron safeStorage API, with a one-time migration on plugin load.',
    acceptance: [
      ac('Tokens read/written through safeStorage', false),
      ac('One-time migration off data.json', false),
      ac('Fallback path when keychain unavailable', false),
    ],
    note: 'The run finished but exited without emitting a structured handoff block, so it could not be auto-routed to review. The raw tail of the agent transcript is shown below — send it to review to salvage, or mark the run failed.',
    tail: 'Implemented safeStorage read/write wrapper in src/core/security/tokenStore.ts and wired the migration into bootstrap. Wrote 4 unit tests (all green). Was about to update the settings copy when the session was interrupted — no structured handoff was emitted.',
  },

  done: {
    id: 'WO-176',
    status: 'done',
    agent: 'standard',
    title: 'Add dark-mode toggle to ribbon',
    provider: 'claude',
    model: 'Haiku',
    priority: '3 - low',
    created: '2026-05-28',
    updated: '2026-06-02',
    attempts: 1,
    conversation: 'chat-5d80',
    finished: 'Finished 5 days ago',
    objective: 'Add a ribbon icon that toggles the active theme between light and dark, persisting the choice across reloads.',
    acceptance: [
      ac('Ribbon icon registered', true),
      ac('Toggles theme on click', true),
      ac('Choice persists across reloads', true),
    ],
  },

  failed: {
    id: 'WO-205',
    status: 'failed',
    agent: 'tester',
    title: 'Generate API client from OpenAPI',
    provider: 'opencode',
    model: 'qwen3-coder',
    priority: '2 - normal',
    created: '2026-06-03',
    updated: '2026-06-06',
    attempts: 3,
    conversation: 'chat-2b41',
    objective: 'Generate a typed TypeScript client from the vendored openapi.yaml and wire it into the sync service.',
    acceptance: [
      ac('Client generated & compiles', false),
      ac('Wired into sync service', false),
    ],
    ledger: [
      { time: '14:02', status: 'running', msg: 'Run started (attempt 3 of 3).' },
      { time: '14:05', status: 'running', msg: 'Parsed openapi.yaml — 38 paths, 12 schemas.' },
      { time: '14:09', status: 'running', msg: 'Code generation step exited 1: unresolved $ref "#/components/schemas/Workspace".' },
      { time: '14:09', status: 'failed', msg: 'Run failed after 3 attempts. Schema bundle appears malformed; needs a valid spec before retry.' },
    ],
  },
};

const STATE_ORDER = ['inbox', 'running', 'review', 'needs_handoff', 'done', 'failed'];

window.WO = { Icon, Avatar, STATUS_META, PRIORITY_META, AGENTS, AGENT_OPTIONS, AGENT_BY_NAME, PROVIDER_OPTIONS, MODEL_OPTIONS, PRIORITY_OPTIONS, TASKS, STATE_ORDER };
