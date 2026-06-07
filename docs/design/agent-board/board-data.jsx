/* board-data.jsx — lane + card fixtures for the Agent Board redesign mock.
   Reuses Icon / STATUS_META / PRIORITY_META from data.jsx (window.WO). */

const LANES = [
  {
    id: 'backlog', title: 'Backlog',
    cards: [
      { id: 'WO-204', title: 'Bug fix', status: 'inbox', agent: 'standard', provider: 'claude', model: 'sonnet', priority: '1 - high', done: 0, total: 4 },
      { id: 'WO-209', title: 'Refactor the token parser into smaller units', status: 'inbox', agent: 'refactorer', provider: 'codex', model: 'gpt-5-codex', priority: '2 - normal', done: 0, total: 3 },
    ],
  },
  {
    id: 'ready', title: 'Ready',
    cards: [
      { id: 'WO-201', title: 'Documentation pass on the public API', status: 'ready', agent: 'docwriter', provider: 'claude', model: 'sonnet', priority: '3 - low', done: 0, total: 4 },
      { id: 'WO-207', title: 'Add retry + backoff to the sync service', status: 'ready', agent: 'standard', provider: 'claude', model: 'haiku', priority: '2 - normal', done: 2, total: 5 },
    ],
  },
  {
    id: 'running', title: 'Running',
    cards: [
      {
        id: 'WO-198', title: 'Settings overhaul — execute plan', status: 'running',
        agent: 'refactorer', provider: 'claude', model: 'opus', priority: '2 - normal', done: 9, total: 16,
        live: { elapsed: '4m 12s', attempt: 1, ledger: 'Editing registry/fields/agentBoard.ts', tier: 'green' },
      },
      {
        id: 'WO-211', title: 'Migrate auth tokens to keychain', status: 'needs_input',
        agent: 'security', provider: 'codex', model: 'gpt-5-codex', priority: '1 - high', done: 1, total: 3,
        live: { elapsed: '8m 02s', attempt: 2, ledger: 'Awaiting your decision', tier: 'amber' },
        reply: { kind: 'input', prompt: 'Found two token files. Migrate both into the keychain, or only the active one and archive the legacy file?' },
      },
    ],
  },
  {
    id: 'review', title: 'Review',
    cards: [
      { id: 'WO-198b', title: 'Keychain migration — verify', status: 'review', agent: 'security', provider: 'codex', model: 'gpt-5-codex', priority: '1 - high', done: 3, total: 3 },
    ],
  },
  {
    id: 'done', title: 'Done', collapsible: true,
    cards: [
      { id: 'WO-176', title: 'Add dark-mode toggle to ribbon', status: 'done', agent: 'standard', provider: 'claude', model: 'haiku', priority: '3 - low', done: 3, total: 3 },
      { id: 'WO-188', title: 'Localise command palette strings', status: 'done', agent: 'docwriter', provider: 'claude', model: 'sonnet', priority: '2 - normal', done: 5, total: 5 },
    ],
  },
];

/* Primary (CTA) action per status + the overflow menu items. */
const CARD_ACTIONS = {
  inbox:         { primary: { label: 'Mark ready', icon: 'check' }, menu: ['Open note', 'Run now', 'Archive'] },
  ready:         { primary: { label: 'Run', icon: 'play' }, menu: ['Open note', 'Back to inbox', 'Archive'] },
  running:       { primary: { label: 'Stop', icon: 'square', danger: true }, menu: ['Open note', 'Open conversation'] },
  needs_input:   { primary: null, menu: ['Open note', 'Open conversation', 'Stop'] },
  review:        { primary: { label: 'Accept', icon: 'check' }, menu: ['Rework', 'Open note', 'Open conversation', 'Back to inbox'] },
  needs_handoff: { primary: { label: 'Send to review', icon: 'check' }, menu: ['Mark failed', 'Open note'] },
  done:          { primary: { label: 'Reopen', icon: 'rotate-ccw', ghost: true }, menu: ['Open note', 'Archive'] },
  failed:        { primary: { label: 'Retry', icon: 'rotate-ccw' }, menu: ['Open note', 'Archive'] },
};

const MENU_ICON = {
  'Open note': 'file-text', 'Open conversation': 'message-square', 'Back to inbox': 'rotate-ccw',
  'Archive': 'archive', 'Run now': 'play', 'Rework': 'rotate-ccw', 'Mark failed': 'triangle', 'Stop': 'square',
};

window.BOARD = { LANES, CARD_ACTIONS, MENU_ICON };
