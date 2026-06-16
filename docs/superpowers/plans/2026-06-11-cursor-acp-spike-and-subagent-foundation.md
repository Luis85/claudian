# Cursor ACP Spike + Subagent Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Cursor ACP spike harness (Part A of the spec) and the transport-independent Cursor subagent foundation — storage, discovery, @-mentions, prompt hint, settings UI (Part B) — per `docs/superpowers/specs/2026-06-11-cursor-acp-spike-and-subagent-parity-design.md`.

**Architecture:** Part A is a standalone Node JSON-RPC driver under `dev/spikes/cursor-acp/` (no `src/` imports) that a human runs against an authenticated `cursor-agent acp` and that writes raw NDJSON captures. Part B mirrors the Opencode/Codex subagent seams: a markdown-frontmatter `CursorAgentStorage` over vault `.cursor/agents/`, global `~/.cursor/agents/`, and read-only `.claude/agents/` compat, exposed through the shared `StorageBackedAgentMentionProvider` base (extended with a source-resolver hook), registered in `CursorWorkspaceServices`, plus a settings section and an agent-mention context hint in `encodeCursorTurn`.

**Tech Stack:** TypeScript (Obsidian plugin), Jest (unit project, mirrored `tests/` paths), Node ≥18 ESM for the spike script. No new dependencies.

**Out of scope (later plan, after spike verdict):** Part C transport work — `CursorAcpRuntime` or stream-json subagent event mapping, async subagent lifecycle adapter, the new ADR. The spike findings doc and ADR are produced by the human-run spike, not by this plan's tasks.

**Conventions that apply to every task** (from `CLAUDE.md`):
- TDD: write the failing test in the mirrored `tests/unit/...` path first.
- No `console.*` in `src/` (the spike script lives outside `src/` and gets an eslint block).
- No `innerHTML`; build DOM with `createEl`/`createDiv`/`createSpan`/`setText`.
- Comments explain why, not what. UI strings are plain English sentence case (matches the existing Cursor settings tab; no i18n keys — the Cursor tab is not localized today).
- Commit after each task with a conventional message (`feat(cursor): ...`, `test: ...`, `docs: ...`).

**Verification commands** (used throughout):
```bash
npm run test -- --selectProjects unit -t "<test name filter>"   # single test
npm run typecheck && npm run lint && npm run test && npm run build  # full gates
```

---

## Phase A — ACP spike harness

### Task 1: eslint scope + spike driver script

**Files:**
- Modify: `eslint.config.mjs` (the `files: ['esbuild.config.mjs', 'scripts/**/*.js', 'scripts/**/*.mjs']` block, around line 66)
- Create: `dev/spikes/cursor-acp/spike.mjs`

- [x] **Step 1: Extend the eslint tooling block to cover `dev/`**

In `eslint.config.mjs`, find the block (≈line 66):

```js
  {
    files: ['esbuild.config.mjs', 'scripts/**/*.js', 'scripts/**/*.mjs'],
```

and change the `files` array to:

```js
  {
    files: ['esbuild.config.mjs', 'scripts/**/*.js', 'scripts/**/*.mjs', 'dev/**/*.mjs'],
```

- [x] **Step 2: Create `dev/spikes/cursor-acp/spike.mjs`**

```js
#!/usr/bin/env node
// Interactive driver for Cursor's first-party ACP server (`cursor-agent acp`).
// Speaks newline-delimited JSON-RPC 2.0 over stdio, logs every frame in both
// directions to an NDJSON capture file, and lets a human answer server-initiated
// requests (session/request_permission, cursor/ask_question) from the terminal.
// See README.md in this directory for the full spike protocol.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const args = parseArgs(process.argv.slice(2));
const scenario = args.scenario ?? 'handshake';
const bin = args.bin ?? 'cursor-agent';
const cwd = resolve(args.cwd ?? process.cwd());
const captureDir = resolve(args.capture ?? join(cwd, '.context', 'cursor-acp-captures'));
mkdirSync(captureDir, { recursive: true });
const captureFile = join(captureDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${scenario}.ndjson`);

console.log(`[spike] scenario=${scenario} bin=${bin} cwd=${cwd}`);
console.log(`[spike] capture: ${captureFile}`);

const child = spawn(bin, ['acp'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.on('data', (d) => process.stderr.write(`[agent stderr] ${d}`));
child.on('exit', (code, signal) => {
  console.log(`[spike] agent exited code=${code} signal=${signal}`);
  process.exit(code ?? 0);
});

const rl = createInterface({ input: process.stdin, output: process.stdout });
const pending = new Map();
let nextId = 1;
let sessionId = args.resume ?? null;
let buffer = '';

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) handleFrame(line);
  }
});

function record(dir, frame) {
  appendFileSync(captureFile, `${JSON.stringify({ at: new Date().toISOString(), dir, frame })}\n`);
}

function send(frame) {
  record('send', frame);
  console.log(`→ ${JSON.stringify(frame)}`);
  child.stdin.write(`${JSON.stringify(frame)}\n`);
}

function request(method, params) {
  const id = nextId++;
  return new Promise((resolvePromise, rejectPromise) => {
    pending.set(id, { resolvePromise, rejectPromise });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function handleFrame(line) {
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    console.log(`← [unparseable] ${line}`);
    record('recv', { raw: line });
    return;
  }
  record('recv', frame);
  console.log(`← ${JSON.stringify(frame)}`);

  if (frame.id !== undefined && (frame.result !== undefined || frame.error !== undefined)) {
    const entry = pending.get(frame.id);
    if (entry) {
      pending.delete(frame.id);
      if (frame.error) entry.rejectPromise(new Error(JSON.stringify(frame.error)));
      else entry.resolvePromise(frame.result);
    }
    return;
  }
  if (frame.method && frame.id !== undefined) {
    void answerServerRequest(frame);
  }
}

async function answerServerRequest(frame) {
  console.log(`\n[server request] ${frame.method}`);
  console.log(JSON.stringify(frame.params, null, 2));
  if (frame.method === 'session/request_permission') {
    const options = frame.params?.options ?? [];
    for (const opt of options) console.log(`  option: ${JSON.stringify(opt)}`);
    const optionId = await ask('optionId to select (empty = cancelled): ');
    const outcome = optionId
      ? { outcome: 'selected', optionId }
      : { outcome: 'cancelled' };
    send({ jsonrpc: '2.0', id: frame.id, result: { outcome } });
    return;
  }
  // Unknown/extension methods (cursor/ask_question etc.): the spike's job is to
  // discover the response shape. Plain text wraps as { answer }, a JSON object
  // passes through verbatim, so mismatched shapes can be retried live.
  const reply = await ask('response (plain text or JSON object): ');
  let result;
  try {
    result = JSON.parse(reply);
  } catch {
    result = { answer: reply };
  }
  send({ jsonrpc: '2.0', id: frame.id, result });
}

function ask(prompt) {
  return new Promise((resolvePromise) => rl.question(prompt, resolvePromise));
}

function buildPromptContent() {
  const content = [];
  if (args.image) {
    const data = readFileSync(resolve(args.image)).toString('base64');
    const mimeType = args.image.endsWith('.jpg') || args.image.endsWith('.jpeg')
      ? 'image/jpeg'
      : 'image/png';
    content.push({ type: 'image', mimeType, data });
  }
  content.push({ type: 'text', text: args.prompt ?? 'Reply with the single word: pong' });
  return content;
}

async function initialize() {
  const result = await request('initialize', {
    protocolVersion: 1,
    clientInfo: { name: 'claudian-cursor-acp-spike', version: '0.1.0' },
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
  });
  console.log(`[spike] initialize ok: ${JSON.stringify(result)}`);
  return result;
}

async function openSession() {
  if (sessionId) {
    const loaded = await request('session/load', { sessionId, cwd, mcpServers: [] });
    console.log(`[spike] session/load ok: ${JSON.stringify(loaded)}`);
    return;
  }
  const created = await request('session/new', { cwd, mcpServers: [] });
  sessionId = created?.sessionId ?? created?.session_id ?? null;
  console.log(`[spike] session/new → sessionId=${sessionId}`);
}

async function runPrompt() {
  if (args.mode) {
    try {
      await request('session/set_mode', { sessionId, modeId: args.mode });
    } catch (err) {
      console.log(`[spike] session/set_mode failed (record + continue): ${err.message}`);
    }
  }
  if (args['cancel-after']) {
    setTimeout(() => {
      console.log('[spike] sending session/cancel');
      notify('session/cancel', { sessionId });
    }, Number(args['cancel-after']));
  }
  const result = await request('session/prompt', {
    sessionId,
    prompt: buildPromptContent(),
  });
  console.log(`[spike] session/prompt completed: ${JSON.stringify(result)}`);
}

async function runRawRepl() {
  console.log('[spike] raw mode: type a JSON-RPC frame per line ("exit" quits). "id" is auto-assigned when omitted on requests with a "method".');
  for (;;) {
    const line = await ask('raw> ');
    if (line.trim() === 'exit') break;
    if (!line.trim()) continue;
    try {
      const frame = JSON.parse(line);
      if (frame.method && frame.id === undefined && !args['as-notification']) frame.id = nextId++;
      frame.jsonrpc ??= '2.0';
      send(frame);
    } catch (err) {
      console.log(`[spike] not valid JSON: ${err.message}`);
    }
  }
}

const scenarios = {
  handshake: async () => { await initialize(); },
  prompt: async () => { await initialize(); await openSession(); await runPrompt(); },
  resume: async () => { await initialize(); await openSession(); if (args.prompt) await runPrompt(); },
  raw: async () => { await initialize(); await runRawRepl(); },
};

const run = scenarios[scenario];
if (!run) {
  console.log(`[spike] unknown scenario "${scenario}". Available: ${Object.keys(scenarios).join(', ')}`);
  process.exit(1);
}

run().then(() => {
  console.log('[spike] scenario complete. Ctrl+C to quit (process stays attached for late notifications).');
}).catch((err) => {
  console.log(`[spike] scenario failed: ${err.message}`);
});

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq >= 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      out[arg.slice(2)] = argv[++i];
    } else {
      out[arg.slice(2)] = true;
    }
  }
  return out;
}
```

- [x] **Step 3: Syntax-check the script and lint**

Run: `node --check dev/spikes/cursor-acp/spike.mjs && npm run lint`
Expected: no output from `node --check`; lint passes (the new eslint `files` entry gives the script `console`/`process` globals).

- [x] **Step 4: Commit**

```bash
git add eslint.config.mjs dev/spikes/cursor-acp/spike.mjs
git commit -m "feat(dev): add cursor ACP spike driver script"
```

### Task 2: Spike run protocol (README) + test agent fixtures

**Files:**
- Create: `dev/spikes/cursor-acp/README.md`

- [x] **Step 1: Write the README with the full 10-item protocol**

````markdown
# Cursor ACP spike

Validates Cursor's first-party `agent acp` mode against the criteria in
`docs/superpowers/specs/2026-06-11-cursor-acp-spike-and-subagent-parity-design.md`
(Part A). Reopens ADR 0002.

## Prerequisites

- `cursor-agent` installed and authenticated (`cursor-agent status`).
- Record the version next to every capture: `cursor-agent --version`.
- Run from a disposable test vault/workspace, not your real vault.
- Captures land in `.context/cursor-acp-captures/` (gitignored territory —
  never commit raw captures; promote sanitized excerpts to the findings doc).

## Harness

```bash
node dev/spikes/cursor-acp/spike.mjs --scenario <name> [--bin cursor-agent] \
  [--cwd <workspace>] [--prompt "<text>"] [--resume <sessionId>] \
  [--mode plan|ask|agent] [--image <path>] [--cancel-after <ms>]
```

Scenarios: `handshake`, `prompt`, `resume`, `raw` (ad-hoc JSON-RPC REPL).
Server-initiated requests pause for your answer in the terminal. Every frame is
captured to NDJSON. If Cursor's `initialize`/`session/new` parameter shapes
differ from the ACP defaults the script sends, use `--scenario raw` to probe
the correct shape, then adjust the script and note the delta in the findings.

## Test agent fixtures

Before item 6, create these in the test workspace:

`.cursor/agents/spike-echo.md`
```markdown
---
name: spike-echo
description: Spike test agent. Summarizes a file in one sentence.
---
You are a test subagent. Read the file you are pointed at and reply with a
one-sentence summary prefixed with "ECHO:".
```

`.cursor/agents/spike-background.md`
```markdown
---
name: spike-background
description: Spike test background agent.
is_background: true
---
Count the markdown files in this workspace and report the number.
```

## Protocol (record verdict + capture file per item)

| # | Item | How |
|---|------|-----|
| 1 | Handshake | `--scenario handshake`. Record protocol version + advertised capabilities/auth methods from the response. If an `authenticate` step is required, probe it via `--scenario raw`. |
| 2 | Prompt round trip | `--scenario prompt --prompt "Reply with the single word: pong"`. Capture the full `session/update` vocabulary (text deltas, thinking, tool calls). |
| 3 | Permissions | `--scenario prompt --prompt "Create a file named spike-permission-test.txt containing the word ok"`. A `session/request_permission` must arrive; exercise allow-once, then re-run and exercise reject. Record what the agent does after reject. |
| 4 | In-turn question (ADR 0002 criterion a) | `--scenario prompt --prompt "Before doing anything, ask me which of two options I prefer: red or blue. Use a question, then wait."`. A blocking `cursor/ask_question` should arrive; answer it and confirm the same turn continues in-process. |
| 5 | Session continuity (make-or-break) | After item 2: (a) `cursor-agent ls` — does the ACP session appear? (b) check `~/.cursor/chats/<workspace-hash>/<sessionId>/store.db` exists and gains blobs; (c) `--scenario resume --resume <id> --prompt "What word did you reply with earlier?"` against the ACP session; (d) create a session with `cursor-agent -p "say hi" --output-format stream-json`, then `session/load` it via `--scenario resume`; (e) the reverse: resume the ACP session with `cursor-agent --resume <id> -p "continue"`. |
| 6 | Subagents | With fixtures in place: `--scenario prompt --prompt "Use the spike-echo subagent to summarize README.md"`. Then `--prompt "Run the spike-background subagent"`. Capture `cursor/task` / `session/update` shapes, nested tool events, agent ids, and where background output lands (`~/.cursor/subagents/`?). |
| 7 | Plan mode | `--scenario prompt --mode plan --prompt "Plan how you would rename a function used in 3 files"`. Capture `cursor/create_plan` / `cursor/update_todos` and whether a plan file lands under `.cursor/plans/`. |
| 8 | MCP | Add a trivial server to `<workspace>/.cursor/mcp.json`, re-run item 2's command, and capture how MCP tools surface and how their approval arrives. |
| 9 | Images | `--scenario prompt --image <png> --prompt "Describe this image in five words"`. If the prompt is rejected, record the error shape — that is itself the finding. |
| 10 | Operational parity | `--cancel-after 1500` on a long prompt (cancel semantics); `--scenario raw` probe for model selection on `session/new`; record any usage/token reporting frames seen across items 2–9. |

## Wrap-up

1. Findings → `docs/research/2026-06-cursor-acp-spike-findings.md` (frontmatter:
   `title`, `date`, `status`, `scope`), one verdict row per item + sanitized
   frame excerpts + the `cursor-agent --version` used.
2. GO/NO-GO per the spec's criteria (items 3, 4, 5 must pass for GO).
3. New ADR in `docs/adr/` superseding or reaffirming ADR 0002.
4. Part C implementation plan follows the verdict.
````

- [x] **Step 2: Lint and commit**

Run: `npm run lint`
Expected: passes (markdown not linted; eslint block from Task 1 already covers the script).

```bash
git add dev/spikes/cursor-acp/README.md
git commit -m "docs(dev): cursor ACP spike run protocol and fixtures"
```

> **Checkpoint — human-run spike:** Tasks 1–2 produce the harness. Running the
> 10 items needs an authenticated `cursor-agent` on the user's machine and
> happens outside this plan. Phase B below does NOT depend on the spike outcome
> — continue immediately.

---

## Phase B — Transport-independent subagent foundation

### Task 3: `HomeFileAdapter.listFiles`

The global `~/.cursor/agents/` scan needs flat file listing; `HomeFileAdapter` only has `listFolders` today.

**Files:**
- Modify: `src/core/storage/HomeFileAdapter.ts`
- Test: `tests/unit/core/storage/HomeFileAdapter.test.ts`

- [x] **Step 1: Write the failing test**

Append to the existing describe block in `tests/unit/core/storage/HomeFileAdapter.test.ts` (reuse its temp-root setup if present; otherwise add this self-contained block):

```ts
describe('HomeFileAdapter.listFiles', () => {
  let root: string;
  let adapter: HomeFileAdapter;

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'claudian-home-adapter-'));
    adapter = new HomeFileAdapter(root);
  });

  afterEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  it('lists only files, prefixed with the folder path', async () => {
    await fs.promises.mkdir(path.join(root, '.cursor/agents/nested'), { recursive: true });
    await fs.promises.writeFile(path.join(root, '.cursor/agents/reviewer.md'), 'x');
    await fs.promises.writeFile(path.join(root, '.cursor/agents/helper.md'), 'y');

    const files = await adapter.listFiles('.cursor/agents');

    expect(files.sort()).toEqual(['.cursor/agents/helper.md', '.cursor/agents/reviewer.md']);
  });

  it('returns an empty array for a missing folder', async () => {
    await expect(adapter.listFiles('.cursor/agents')).resolves.toEqual([]);
  });
});
```

Match the existing file's import style for `fs`/`os`/`path` (it already imports them if it does real-fs tests; otherwise add `import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';`).

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "HomeFileAdapter.listFiles"`
Expected: FAIL — `adapter.listFiles is not a function`.

- [x] **Step 3: Implement `listFiles`**

In `src/core/storage/HomeFileAdapter.ts`, add `'listFiles'` to the `Pick<...>` union in the class signature:

```ts
export class HomeFileAdapter implements Pick<VaultFileAdapter,
  'exists' | 'read' | 'write' | 'delete' | 'deleteFolder' | 'listFiles' | 'listFolders' | 'ensureFolder'
> {
```

and add the method after `listFolders`:

```ts
  async listFiles(folder: string): Promise<string[]> {
    const full = this.resolve(folder);
    try {
      const entries = await fs.promises.readdir(full, { withFileTypes: true });
      return entries
        .filter(e => e.isFile())
        .map(e => `${folder}/${e.name}`);
    } catch {
      return [];
    }
  }
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit -t "HomeFileAdapter"`
Expected: PASS (new and pre-existing cases).

- [x] **Step 5: Commit**

```bash
git add src/core/storage/HomeFileAdapter.ts tests/unit/core/storage/HomeFileAdapter.test.ts
git commit -m "feat(core): add HomeFileAdapter.listFiles for flat home-dir scans"
```

### Task 4: Cursor agent definition type + markdown parse/serialize

**Files:**
- Create: `src/providers/cursor/types/agent.ts`
- Create: `src/providers/cursor/storage/CursorAgentStorage.ts` (parse/serialize/persistence-key functions only in this task; class in Task 5)
- Test: `tests/unit/providers/cursor/storage/CursorAgentStorage.test.ts`

- [x] **Step 1: Write the failing tests**

Create `tests/unit/providers/cursor/storage/CursorAgentStorage.test.ts`:

```ts
import {
  createCursorAgentPersistenceKey,
  parseCursorAgentMarkdown,
  parseCursorAgentPersistenceKey,
  serializeCursorAgentMarkdown,
} from '@/providers/cursor/storage/CursorAgentStorage';
import type { CursorAgentDefinition } from '@/providers/cursor/types/agent';

const BASIC_MARKDOWN = `---
description: "Reviews code for correctness."
---
Review code like an owner.
`;

const FULL_MARKDOWN = `---
name: reviewer
description: "Reviews code for correctness."
model: "composer-2"
readonly: true
is_background: true
custom_key: "custom-value"
---
Review deeply and call out regressions.
`;

describe('parseCursorAgentMarkdown', () => {
  it('derives the name from the file path when frontmatter omits it', () => {
    const result = parseCursorAgentMarkdown(BASIC_MARKDOWN, '.cursor/agents/review.md', 'vault');

    expect(result).not.toBeNull();
    expect(result!.name).toBe('review');
    expect(result!.description).toBe('Reviews code for correctness.');
    expect(result!.prompt).toBe('Review code like an owner.');
    expect(result!.source).toBe('vault');
    expect(result!.persistenceKey).toBe(
      createCursorAgentPersistenceKey({ source: 'vault', filePath: '.cursor/agents/review.md' }),
    );
  });

  it('parses model, readonly, is_background, and unknown frontmatter', () => {
    const result = parseCursorAgentMarkdown(FULL_MARKDOWN, '.cursor/agents/reviewer.md', 'vault');

    expect(result).not.toBeNull();
    expect(result!.name).toBe('reviewer');
    expect(result!.model).toBe('composer-2');
    expect(result!.readonly).toBe(true);
    expect(result!.isBackground).toBe(true);
    expect(result!.extraFrontmatter).toEqual({ custom_key: 'custom-value' });
  });

  it('returns null when description is missing', () => {
    expect(parseCursorAgentMarkdown('---\nname: x\n---\nbody', '.cursor/agents/x.md', 'vault')).toBeNull();
  });

  it('labels claude-compat agents and notes their origin in the description', () => {
    const result = parseCursorAgentMarkdown(BASIC_MARKDOWN, '.claude/agents/review.md', 'claude-compat');

    expect(result!.source).toBe('claude-compat');
    expect(result!.description).toBe('Reviews code for correctness. (from .claude/agents)');
  });
});

describe('serializeCursorAgentMarkdown', () => {
  it('round-trips a full definition', () => {
    const agent: CursorAgentDefinition = {
      name: 'reviewer',
      description: 'Reviews code for correctness.',
      prompt: 'Review deeply and call out regressions.',
      source: 'vault',
      model: 'composer-2',
      readonly: true,
      isBackground: true,
      extraFrontmatter: { custom_key: 'custom-value' },
    };

    const parsed = parseCursorAgentMarkdown(
      serializeCursorAgentMarkdown(agent),
      '.cursor/agents/reviewer.md',
      'vault',
    );

    expect(parsed).toMatchObject({
      name: 'reviewer',
      model: 'composer-2',
      readonly: true,
      isBackground: true,
      extraFrontmatter: { custom_key: 'custom-value' },
    });
  });

  it('omits optional keys that are unset', () => {
    const serialized = serializeCursorAgentMarkdown({
      name: 'minimal',
      description: 'Minimal agent.',
      prompt: 'Do the thing.',
      source: 'vault',
    });

    expect(serialized).not.toContain('model:');
    expect(serialized).not.toContain('readonly:');
    expect(serialized).not.toContain('is_background:');
  });
});

describe('cursor agent persistence keys', () => {
  it('round-trips source and path', () => {
    const key = createCursorAgentPersistenceKey({ source: 'global', filePath: '.cursor/agents/helper.md' });

    expect(parseCursorAgentPersistenceKey(key)).toEqual({
      source: 'global',
      filePath: '.cursor/agents/helper.md',
    });
  });

  it('rejects malformed keys', () => {
    expect(parseCursorAgentPersistenceKey('not-a-key')).toBeNull();
    expect(parseCursorAgentPersistenceKey('cursor-agent:bogus-source:x.md')).toBeNull();
    expect(parseCursorAgentPersistenceKey(undefined)).toBeNull();
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npm run test -- --selectProjects unit -t "parseCursorAgentMarkdown"`
Expected: FAIL — module `@/providers/cursor/storage/CursorAgentStorage` not found.

- [x] **Step 3: Create `src/providers/cursor/types/agent.ts`**

```ts
export type CursorAgentSource = 'builtin' | 'vault' | 'global' | 'claude-compat';

export interface CursorAgentDefinition {
  name: string;
  description: string;
  prompt: string;
  source: CursorAgentSource;
  /** Cursor model id (e.g. 'composer-2'); omitted = inherit the chat model. */
  model?: string;
  readonly?: boolean;
  isBackground?: boolean;
  persistenceKey?: string;
  extraFrontmatter?: Record<string, unknown>;
}

export const CURSOR_AGENT_KNOWN_KEYS = new Set([
  'name',
  'description',
  'model',
  'readonly',
  'is_background',
]);

/**
 * Cursor's CLI ships these agents (2.4+). They have no definition file and are
 * surfaced read-only for discovery/mentions.
 */
export const CURSOR_BUILTIN_AGENTS: readonly CursorAgentDefinition[] = Object.freeze([
  Object.freeze({
    name: 'Explore',
    description: 'Built-in Cursor subagent for read-only codebase exploration.',
    prompt: '',
    source: 'builtin' as const,
    readonly: true,
  }),
  Object.freeze({
    name: 'Bash',
    description: 'Built-in Cursor subagent for shell command execution.',
    prompt: '',
    source: 'builtin' as const,
  }),
  Object.freeze({
    name: 'Browser',
    description: 'Built-in Cursor subagent for browser-based tasks.',
    prompt: '',
    source: 'builtin' as const,
  }),
]);
```

- [x] **Step 4: Create `src/providers/cursor/storage/CursorAgentStorage.ts` (functions only)**

```ts
import { extractBoolean } from '../../../utils/frontmatter';
import { parseFrontmatter } from '../../../utils/frontmatter';
import { yamlString } from '../../../utils/slashCommand';
import {
  CURSOR_AGENT_KNOWN_KEYS,
  type CursorAgentDefinition,
  type CursorAgentSource,
} from '../types/agent';

export const CURSOR_AGENT_VAULT_ROOT = '.cursor/agents';
export const CLAUDE_AGENT_COMPAT_ROOT = '.claude/agents';
/** Relative to the user's home directory (HomeFileAdapter root). */
export const CURSOR_AGENT_HOME_ROOT = '.cursor/agents';

const PERSISTENCE_PREFIX = 'cursor-agent';
const FILE_SOURCES = ['vault', 'global', 'claude-compat'] as const;
type CursorAgentFileSource = (typeof FILE_SOURCES)[number];

export interface CursorAgentLocation {
  source: CursorAgentFileSource;
  filePath: string;
}

export function createCursorAgentPersistenceKey(location: CursorAgentLocation): string {
  return `${PERSISTENCE_PREFIX}:${location.source}:${encodeURIComponent(normalizeSlashes(location.filePath))}`;
}

export function parseCursorAgentPersistenceKey(key?: string): CursorAgentLocation | null {
  if (!key) return null;
  const [prefix, source, encodedPath] = key.split(':');
  if (prefix !== PERSISTENCE_PREFIX || !encodedPath) return null;
  if (!FILE_SOURCES.includes(source as CursorAgentFileSource)) return null;
  return {
    source: source as CursorAgentFileSource,
    filePath: normalizeSlashes(decodeURIComponent(encodedPath)),
  };
}

export function parseCursorAgentMarkdown(
  content: string,
  filePath: string,
  source: CursorAgentFileSource,
): CursorAgentDefinition | null {
  const parsed = parseFrontmatter(content);
  if (!parsed) return null;

  const frontmatter = parsed.frontmatter;
  const rawName = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '';
  const name = rawName || nameFromPath(filePath);
  const rawDescription = typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '';
  if (!name || !rawDescription) return null;

  const description = source === 'claude-compat'
    ? `${rawDescription} (from ${CLAUDE_AGENT_COMPAT_ROOT})`
    : rawDescription;

  const result: CursorAgentDefinition = {
    name,
    description,
    prompt: parsed.body.trim(),
    source,
    persistenceKey: createCursorAgentPersistenceKey({ source, filePath: normalizeSlashes(filePath) }),
  };

  const model = typeof frontmatter.model === 'string' && frontmatter.model.trim()
    ? frontmatter.model.trim()
    : undefined;
  if (model && model !== 'inherit') result.model = model;
  if (extractBoolean(frontmatter, 'readonly')) result.readonly = true;
  if (extractBoolean(frontmatter, 'is_background')) result.isBackground = true;

  const extraFrontmatter: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!CURSOR_AGENT_KNOWN_KEYS.has(key)) extraFrontmatter[key] = value;
  }
  if (Object.keys(extraFrontmatter).length > 0) result.extraFrontmatter = extraFrontmatter;

  return result;
}

export function serializeCursorAgentMarkdown(agent: CursorAgentDefinition): string {
  const lines: string[] = ['---'];
  lines.push(`name: ${yamlString(agent.name)}`);
  lines.push(`description: ${yamlString(stripCompatSuffix(agent.description))}`);
  if (agent.model) lines.push(`model: ${yamlString(agent.model)}`);
  if (agent.readonly) lines.push('readonly: true');
  if (agent.isBackground) lines.push('is_background: true');
  if (agent.extraFrontmatter) {
    for (const [key, value] of Object.entries(agent.extraFrontmatter)) {
      lines.push(`${key}: ${serializeYamlValue(value)}`);
    }
  }
  lines.push('---');
  lines.push(agent.prompt);
  return lines.join('\n');
}

function stripCompatSuffix(description: string): string {
  return description.replace(new RegExp(` \\(from ${CLAUDE_AGENT_COMPAT_ROOT.replace(/[./]/g, '\\$&')}\\)$`), '');
}

function serializeYamlValue(value: unknown): string {
  if (typeof value === 'string') return yamlString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  return JSON.stringify(value);
}

function nameFromPath(filePath: string): string {
  const base = normalizeSlashes(filePath).split('/').pop() ?? '';
  return base.replace(/\.md$/i, '');
}

function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export type { CursorAgentSource };
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npm run test -- --selectProjects unit tests/unit/providers/cursor/storage/CursorAgentStorage.test.ts`
Expected: PASS — all parse/serialize/key cases. If `extractBoolean`'s exact signature differs (check `src/utils/frontmatter.ts`), adapt the two call sites — the tests define the contract.

- [x] **Step 6: Commit**

```bash
git add src/providers/cursor/types/agent.ts src/providers/cursor/storage/CursorAgentStorage.ts tests/unit/providers/cursor/storage/CursorAgentStorage.test.ts
git commit -m "feat(cursor): cursor agent definition type and markdown parse/serialize"
```

### Task 5: `CursorAgentStorage` class — scan, save, delete, builtin merge

**Files:**
- Modify: `src/providers/cursor/storage/CursorAgentStorage.ts`
- Test: `tests/unit/providers/cursor/storage/CursorAgentStorage.test.ts`

- [x] **Step 1: Write the failing tests** (append to the Task 4 test file)

```ts
import {
  CursorAgentStorage,
  loadCursorAgentsWithBuiltins,
} from '@/providers/cursor/storage/CursorAgentStorage';

const AGENT_MD = (name: string, description: string) => `---
name: ${name}
description: ${description}
---
Prompt body for ${name}.
`;

function createVaultAdapter(files: Record<string, string> = {}) {
  return {
    exists: jest.fn(async (p: string) => Object.keys(files).some((k) => k === p || k.startsWith(`${p}/`))),
    read: jest.fn(async (p: string) => {
      if (!(p in files)) throw new Error(`not found: ${p}`);
      return files[p];
    }),
    write: jest.fn(async (p: string, content: string) => { files[p] = content; }),
    delete: jest.fn(async (p: string) => { delete files[p]; }),
    listFilesRecursive: jest.fn(async (folder: string) =>
      Object.keys(files).filter((k) => k.startsWith(`${folder}/`))),
    ensureFolder: jest.fn(),
  };
}

function createHomeAdapter(files: Record<string, string> = {}) {
  return {
    exists: jest.fn(async (p: string) => p in files),
    read: jest.fn(async (p: string) => {
      if (!(p in files)) throw new Error(`not found: ${p}`);
      return files[p];
    }),
    write: jest.fn(async (p: string, content: string) => { files[p] = content; }),
    delete: jest.fn(async (p: string) => { delete files[p]; }),
    listFiles: jest.fn(async (folder: string) =>
      Object.keys(files).filter((k) => k.startsWith(`${folder}/`) && !k.slice(folder.length + 1).includes('/'))),
    ensureFolder: jest.fn(),
  };
}

describe('CursorAgentStorage', () => {
  it('scans vault, compat, and global roots with vault winning name conflicts', async () => {
    const vault = createVaultAdapter({
      '.cursor/agents/reviewer.md': AGENT_MD('reviewer', 'Vault reviewer.'),
      '.claude/agents/reviewer.md': AGENT_MD('reviewer', 'Claude compat reviewer.'),
      '.claude/agents/researcher.md': AGENT_MD('researcher', 'Claude compat researcher.'),
    });
    const home = createHomeAdapter({
      '.cursor/agents/helper.md': AGENT_MD('helper', 'Global helper.'),
    });
    const storage = new CursorAgentStorage(vault, home);

    const agents = await storage.loadAll();
    const byName = new Map(agents.map((a) => [a.name, a]));

    expect(byName.get('reviewer')!.source).toBe('vault');
    expect(byName.get('reviewer')!.description).toBe('Vault reviewer.');
    expect(byName.get('researcher')!.source).toBe('claude-compat');
    expect(byName.get('helper')!.source).toBe('global');
  });

  it('skips malformed files instead of failing the scan', async () => {
    const vault = createVaultAdapter({
      '.cursor/agents/broken.md': 'no frontmatter here',
      '.cursor/agents/good.md': AGENT_MD('good', 'Works.'),
    });
    const storage = new CursorAgentStorage(vault, createHomeAdapter());

    const agents = await storage.loadAll();

    expect(agents.map((a) => a.name)).toEqual(['good']);
  });

  it('saves vault agents under .cursor/agents and global agents under the home root', async () => {
    const vault = createVaultAdapter();
    const home = createHomeAdapter();
    const storage = new CursorAgentStorage(vault, home);

    await storage.save({ name: 'v', description: 'Vault.', prompt: 'p', source: 'vault' });
    await storage.save({ name: 'g', description: 'Global.', prompt: 'p', source: 'global' });

    // Content round-trip correctness is covered by the Task 4 serialize tests;
    // the routing (which adapter, which path) is the contract under test here.
    expect(vault.write).toHaveBeenCalledWith('.cursor/agents/v.md', expect.any(String));
    expect(home.write).toHaveBeenCalledWith('.cursor/agents/g.md', expect.any(String));
  });

  it('deletes the previous file on rename', async () => {
    const vault = createVaultAdapter({
      '.cursor/agents/old.md': AGENT_MD('old', 'Old.'),
    });
    const storage = new CursorAgentStorage(vault, createHomeAdapter());
    const [previous] = await storage.loadAll();

    await storage.save({ ...previous, name: 'renamed' }, previous);

    expect(vault.write).toHaveBeenCalledWith('.cursor/agents/renamed.md', expect.any(String));
    expect(vault.delete).toHaveBeenCalledWith('.cursor/agents/old.md');
  });

  it('refuses to save or delete read-only sources', async () => {
    const storage = new CursorAgentStorage(createVaultAdapter(), createHomeAdapter());
    const compat = { name: 'c', description: 'C.', prompt: '', source: 'claude-compat' as const };
    const builtin = { name: 'Explore', description: 'B.', prompt: '', source: 'builtin' as const };

    await expect(storage.save(compat)).rejects.toThrow(/read-only/);
    await expect(storage.delete(builtin)).rejects.toThrow(/read-only/);
  });
});

describe('loadCursorAgentsWithBuiltins', () => {
  it('appends builtins that are not shadowed by file agents', async () => {
    const vault = createVaultAdapter({
      '.cursor/agents/explore.md': AGENT_MD('Explore', 'Custom explore override.'),
    });
    const storage = new CursorAgentStorage(vault, createHomeAdapter());

    const agents = await loadCursorAgentsWithBuiltins(storage);
    const names = agents.map((a) => `${a.name}:${a.source}`);

    expect(names).toContain('Explore:vault');
    expect(names).not.toContain('Explore:builtin');
    expect(names).toContain('Bash:builtin');
    expect(names).toContain('Browser:builtin');
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npm run test -- --selectProjects unit -t "CursorAgentStorage"`
Expected: FAIL — `CursorAgentStorage` / `loadCursorAgentsWithBuiltins` not exported.

- [x] **Step 3: Implement the class and the builtin merge** (append to `CursorAgentStorage.ts`)

```ts
import { CURSOR_BUILTIN_AGENTS } from '../types/agent';   // merge into the existing import block

type CursorAgentVaultAdapter = {
  exists(p: string): Promise<boolean>;
  read(p: string): Promise<string>;
  write(p: string, content: string): Promise<void>;
  delete(p: string): Promise<void>;
  listFilesRecursive(folder: string): Promise<string[]>;
  ensureFolder(p: string): Promise<void>;
};

type CursorAgentHomeAdapter = {
  exists(p: string): Promise<boolean>;
  read(p: string): Promise<string>;
  write(p: string, content: string): Promise<void>;
  delete(p: string): Promise<void>;
  listFiles(folder: string): Promise<string[]>;
  ensureFolder(p: string): Promise<void>;
};

export class CursorAgentStorage {
  constructor(
    private readonly vaultAdapter: CursorAgentVaultAdapter,
    private readonly homeAdapter: CursorAgentHomeAdapter,
  ) {}

  /**
   * Scan order encodes precedence (later wins on name conflict), matching
   * Cursor's own loading: compat root, then user-global, then project.
   */
  async loadAll(): Promise<CursorAgentDefinition[]> {
    const byName = new Map<string, CursorAgentDefinition>();
    const collect = (agents: CursorAgentDefinition[]) => {
      for (const agent of agents) {
        const key = agent.name.toLowerCase();
        byName.delete(key);
        byName.set(key, agent);
      }
    };

    collect(await this.scanVaultRoot(CLAUDE_AGENT_COMPAT_ROOT, 'claude-compat'));
    collect(await this.scanHomeRoot());
    collect(await this.scanVaultRoot(CURSOR_AGENT_VAULT_ROOT, 'vault'));

    return Array.from(byName.values());
  }

  async save(agent: CursorAgentDefinition, previous?: CursorAgentDefinition | null): Promise<void> {
    const adapter = this.writableAdapterFor(agent.source);
    // The persisted location only survives when name and source are unchanged;
    // renames and vault<->global moves re-derive the path from the new name.
    const targetPath = previous && previous.source === agent.source && previous.name === agent.name
      ? this.editablePath(previous)
      : `${this.rootFor(agent.source)}/${agent.name}.md`;
    await adapter.ensureFolder(folderOf(targetPath));
    await adapter.write(targetPath, serializeCursorAgentMarkdown(agent));

    if (previous) {
      const previousAdapter = this.writableAdapterFor(previous.source);
      const previousPath = this.editablePath(previous);
      if (previous.source !== agent.source || previousPath !== targetPath) {
        await previousAdapter.delete(previousPath);
      }
    }
  }

  async delete(agent: CursorAgentDefinition): Promise<void> {
    const adapter = this.writableAdapterFor(agent.source);
    await adapter.delete(this.editablePath(agent));
  }

  private writableAdapterFor(source: CursorAgentDefinition['source']): CursorAgentVaultAdapter | CursorAgentHomeAdapter {
    if (source === 'vault') return this.vaultAdapter;
    if (source === 'global') return this.homeAdapter;
    throw new Error(`Cursor ${source} agents are read-only`);
  }

  private rootFor(source: CursorAgentDefinition['source']): string {
    return source === 'global' ? CURSOR_AGENT_HOME_ROOT : CURSOR_AGENT_VAULT_ROOT;
  }

  private editablePath(agent: CursorAgentDefinition): string {
    const persisted = parseCursorAgentPersistenceKey(agent.persistenceKey);
    if (persisted && persisted.source === agent.source) return persisted.filePath;
    return `${this.rootFor(agent.source)}/${agent.name}.md`;
  }

  private async scanVaultRoot(
    root: string,
    source: 'vault' | 'claude-compat',
  ): Promise<CursorAgentDefinition[]> {
    try {
      return await parseAgentFiles(
        (await this.vaultAdapter.listFilesRecursive(root)).filter((p) => p.endsWith('.md')),
        (p) => this.vaultAdapter.read(p),
        source,
      );
    } catch {
      return [];
    }
  }

  private async scanHomeRoot(): Promise<CursorAgentDefinition[]> {
    try {
      return await parseAgentFiles(
        (await this.homeAdapter.listFiles(CURSOR_AGENT_HOME_ROOT)).filter((p) => p.endsWith('.md')),
        (p) => this.homeAdapter.read(p),
        'global',
      );
    } catch {
      return [];
    }
  }
}

async function parseAgentFiles(
  filePaths: string[],
  read: (p: string) => Promise<string>,
  source: 'vault' | 'global' | 'claude-compat',
): Promise<CursorAgentDefinition[]> {
  const agents: CursorAgentDefinition[] = [];
  for (const filePath of filePaths) {
    try {
      const agent = parseCursorAgentMarkdown(await read(filePath), filePath, source);
      if (agent) agents.push(agent);
    } catch {
      // Skip unreadable/malformed files; the rest of the scan still succeeds.
    }
  }
  return agents;
}

function folderOf(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx >= 0 ? filePath.slice(0, idx) : '';
}

/** File agents shadow builtins by name (project definitions win). */
export async function loadCursorAgentsWithBuiltins(
  storage: Pick<CursorAgentStorage, 'loadAll'>,
): Promise<CursorAgentDefinition[]> {
  const fileAgents = await storage.loadAll();
  const taken = new Set(fileAgents.map((a) => a.name.toLowerCase()));
  return [
    ...fileAgents,
    ...CURSOR_BUILTIN_AGENTS.filter((a) => !taken.has(a.name.toLowerCase())),
  ];
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npm run test -- --selectProjects unit tests/unit/providers/cursor/storage/CursorAgentStorage.test.ts`
Expected: PASS — all describes.

- [x] **Step 5: Commit**

```bash
git add src/providers/cursor/storage/CursorAgentStorage.ts tests/unit/providers/cursor/storage/CursorAgentStorage.test.ts
git commit -m "feat(cursor): agent storage over vault, global, and claude-compat roots"
```

### Task 6: Source-resolver hook in the shared mention base + `CursorAgentMentionProvider`

**Files:**
- Modify: `src/core/providers/StorageBackedAgentMentionProvider.ts`
- Create: `src/providers/cursor/agents/CursorAgentMentionProvider.ts`
- Test: `tests/unit/providers/cursor/agents/CursorAgentMentionProvider.test.ts`

- [x] **Step 1: Write the failing test**

Create `tests/unit/providers/cursor/agents/CursorAgentMentionProvider.test.ts`:

```ts
import { CursorAgentMentionProvider } from '@/providers/cursor/agents/CursorAgentMentionProvider';
import type { CursorAgentStorage } from '@/providers/cursor/storage/CursorAgentStorage';
import type { CursorAgentDefinition } from '@/providers/cursor/types/agent';

function providerWith(agents: CursorAgentDefinition[]): CursorAgentMentionProvider {
  const storage = { loadAll: jest.fn(async () => agents) } as unknown as CursorAgentStorage;
  return new CursorAgentMentionProvider(storage);
}

describe('CursorAgentMentionProvider', () => {
  it('surfaces file agents and builtins with their sources', async () => {
    const provider = providerWith([
      { name: 'reviewer', description: 'Vault reviewer.', prompt: '', source: 'vault' },
      { name: 'helper', description: 'Global helper.', prompt: '', source: 'global' },
    ]);
    await provider.loadAgents();

    const results = provider.searchAgents('');
    const byName = new Map(results.map((r) => [r.name, r]));

    expect(byName.get('reviewer')!.source).toBe('vault');
    expect(byName.get('helper')!.source).toBe('global');
    expect(byName.get('Explore')!.source).toBe('builtin');
  });

  it('maps claude-compat agents to the vault source label', async () => {
    const provider = providerWith([
      { name: 'researcher', description: 'Compat. (from .claude/agents)', prompt: '', source: 'claude-compat' },
    ]);
    await provider.loadAgents();

    expect(provider.searchAgents('researcher')[0]!.source).toBe('vault');
  });

  it('filters by name or description substring', async () => {
    const provider = providerWith([
      { name: 'reviewer', description: 'Checks diffs.', prompt: '', source: 'vault' },
    ]);
    await provider.loadAgents();

    expect(provider.searchAgents('diffs')).toHaveLength(1);
    expect(provider.searchAgents('zzz')).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "CursorAgentMentionProvider"`
Expected: FAIL — module not found.

- [x] **Step 3: Add the source-resolver hook to the shared base**

Replace the constructor and the `map` in `src/core/providers/StorageBackedAgentMentionProvider.ts`:

```ts
import type { AgentMentionProvider, AgentMentionSource } from './types';

/**
 * Shared `@`-mention provider over a vault subagent store. Providers supply
 * their definition type, an optional mentionability filter (e.g. Opencode
 * hides non-subagent or disabled definitions), and an optional source
 * resolver (e.g. Cursor labels builtin/global/vault).
 */
export class StorageBackedAgentMentionProvider<
  T extends { name: string; description: string },
> implements AgentMentionProvider {
  private agents: T[] = [];

  constructor(
    private readonly storage: { loadAll(): Promise<T[]> },
    private readonly isMentionable: (agent: T) => boolean = () => true,
    private readonly resolveSource: (agent: T) => AgentMentionSource = () => 'vault',
  ) {}

  async loadAgents(): Promise<void> {
    this.agents = await this.storage.loadAll();
  }

  searchAgents(query: string): Array<{
    id: string;
    name: string;
    description?: string;
    source: AgentMentionSource;
  }> {
    const q = query.toLowerCase();
    return this.agents
      .filter((agent) => this.isMentionable(agent))
      .filter((agent) => (
        agent.name.toLowerCase().includes(q) ||
        agent.description.toLowerCase().includes(q)
      ))
      .map((agent) => ({
        id: agent.name,
        name: agent.name,
        description: agent.description,
        source: this.resolveSource(agent),
      }));
  }
}
```

(The previous return type inlined the source literals; using `AgentMentionSource` is the same union — `AgentDefinition['source']` — so Codex/Opencode call sites are unaffected.)

- [x] **Step 4: Create `src/providers/cursor/agents/CursorAgentMentionProvider.ts`**

```ts
import { StorageBackedAgentMentionProvider } from '../../../core/providers/StorageBackedAgentMentionProvider';
import { type CursorAgentStorage, loadCursorAgentsWithBuiltins } from '../storage/CursorAgentStorage';
import type { CursorAgentDefinition } from '../types/agent';

export class CursorAgentMentionProvider
  extends StorageBackedAgentMentionProvider<CursorAgentDefinition> {
  constructor(storage: CursorAgentStorage) {
    super(
      { loadAll: () => loadCursorAgentsWithBuiltins(storage) },
      () => true,
      // 'claude-compat' is not an AgentMentionSource; those agents read as
      // vault entries (their description carries the origin suffix).
      (agent) => (agent.source === 'claude-compat' ? 'vault' : agent.source),
    );
  }
}
```

- [x] **Step 5: Run tests — new and the existing subclass suites**

Run: `npm run test -- --selectProjects unit tests/unit/providers/cursor/agents/CursorAgentMentionProvider.test.ts tests/unit/providers/opencode/agents/OpencodeAgentMentionProvider.test.ts`
Expected: PASS for both (the base change is additive).

- [x] **Step 6: Commit**

```bash
git add src/core/providers/StorageBackedAgentMentionProvider.ts src/providers/cursor/agents/CursorAgentMentionProvider.ts tests/unit/providers/cursor/agents/CursorAgentMentionProvider.test.ts
git commit -m "feat(cursor): agent mention provider with source labels via shared base hook"
```

### Task 7: Register agent services in `CursorWorkspaceServices`

**Files:**
- Modify: `src/providers/cursor/app/CursorWorkspaceServices.ts`
- Test: `tests/unit/providers/cursor/app/CursorWorkspaceServices.test.ts`

- [x] **Step 1: Write the failing test**

Create `tests/unit/providers/cursor/app/CursorWorkspaceServices.test.ts`:

```ts
import { createCursorWorkspaceServices } from '@/providers/cursor/app/CursorWorkspaceServices';
import type { HomeFileAdapter } from '@/core/storage/HomeFileAdapter';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import type { PluginContext } from '@/core/types/PluginContext';

const AGENT_MD = `---
name: reviewer
description: Reviews code.
---
Prompt.
`;

function createPlugin(): PluginContext {
  // Cursor is opt-in and disabled by default, so model-catalog warmup (which
  // would spawn the CLI) short-circuits before touching the resolver.
  return {
    settings: {},
    app: {},
    logger: { scope: () => ({ warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() }) },
  } as unknown as PluginContext;
}

function createVaultAdapter(files: Record<string, string>): VaultFileAdapter {
  return {
    exists: jest.fn(async (p: string) => Object.keys(files).some((k) => k.startsWith(p))),
    read: jest.fn(async (p: string) => files[p]),
    write: jest.fn(async (p: string, c: string) => { files[p] = c; }),
    delete: jest.fn(),
    listFilesRecursive: jest.fn(async (folder: string) =>
      Object.keys(files).filter((k) => k.startsWith(`${folder}/`))),
    ensureFolder: jest.fn(),
  } as unknown as VaultFileAdapter;
}

function createHomeAdapter(): HomeFileAdapter {
  return {
    exists: jest.fn(async () => false),
    read: jest.fn(),
    write: jest.fn(),
    delete: jest.fn(),
    listFiles: jest.fn(async () => []),
    ensureFolder: jest.fn(),
  } as unknown as HomeFileAdapter;
}

describe('createCursorWorkspaceServices', () => {
  it('registers a loaded agent mention provider and storage', async () => {
    const files: Record<string, string> = { '.cursor/agents/reviewer.md': AGENT_MD };
    const services = await createCursorWorkspaceServices(createPlugin(), createVaultAdapter(files), createHomeAdapter());

    const results = services.agentMentionProvider!.searchAgents('reviewer');
    expect(results).toHaveLength(1);
    expect(results[0]!.source).toBe('vault');
    expect(services.agentStorage).toBeDefined();
  });

  it('refreshAgentMentions picks up newly added agents', async () => {
    const files: Record<string, string> = {};
    const services = await createCursorWorkspaceServices(createPlugin(), createVaultAdapter(files), createHomeAdapter());
    expect(services.agentMentionProvider!.searchAgents('late')).toHaveLength(0);

    files['.cursor/agents/late.md'] = `---\nname: late\ndescription: Added later.\n---\nP.\n`;
    await services.refreshAgentMentions?.();

    expect(services.agentMentionProvider!.searchAgents('late')).toHaveLength(1);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "createCursorWorkspaceServices"`
Expected: FAIL — `services.agentMentionProvider` is undefined / `agentStorage` not on the type.

- [x] **Step 3: Wire the services**

In `src/providers/cursor/app/CursorWorkspaceServices.ts`:

Add imports:

```ts
import { CursorAgentMentionProvider } from '../agents/CursorAgentMentionProvider';
import { CursorAgentStorage } from '../storage/CursorAgentStorage';
```

Add the typed services interface after the imports:

```ts
export interface CursorWorkspaceServices extends ProviderWorkspaceServices {
  agentStorage: CursorAgentStorage;
  agentMentionProvider: CursorAgentMentionProvider;
}
```

Replace `createCursorWorkspaceServices` (the `_vaultAdapter`/`_homeAdapter` params lose their underscore prefix) and the typed getter:

```ts
export async function createCursorWorkspaceServices(
  plugin: PluginContext,
  vaultAdapter: VaultFileAdapter,
  homeAdapter: HomeFileAdapter,
): Promise<CursorWorkspaceServices> {
  const cliResolver = createCursorCliResolver();
  warmCursorModelCatalog(plugin, cliResolver);

  const agentStorage = new CursorAgentStorage(vaultAdapter, homeAdapter);
  const agentMentionProvider = new CursorAgentMentionProvider(agentStorage);
  await agentMentionProvider.loadAgents();

  return {
    cliResolver,
    settingsTabRenderer: cursorSettingsTabRenderer,
    agentStorage,
    agentMentionProvider,
    refreshAgentMentions: async () => {
      await agentMentionProvider.loadAgents();
    },
  };
}

export function getCursorWorkspaceServices(): CursorWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('cursor') as CursorWorkspaceServices | null;
}
```

(`cursorWorkspaceRegistration` stays as-is — it already forwards `vaultAdapter`/`homeAdapter`. If `ProviderWorkspaceServices` declares `refreshAgentMentions` — it does, Opencode/Codex return it — no type changes are needed.)

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test -- --selectProjects unit tests/unit/providers/cursor/app/CursorWorkspaceServices.test.ts`
Expected: PASS. Also run `npm run typecheck` — the adapter types must satisfy the storage's structural adapter contracts.

- [x] **Step 5: Commit**

```bash
git add src/providers/cursor/app/CursorWorkspaceServices.ts tests/unit/providers/cursor/app/CursorWorkspaceServices.test.ts
git commit -m "feat(cursor): register agent storage and mention provider in workspace services"
```

### Task 8: Agent-mention hint in `encodeCursorTurn`

The composer inserts agent mentions as the literal text `@<id> (agent) ` (see `MentionDropdownController`, `case 'agent'`). Cursor delegates to subagents from name references, so the encoder adds an explicit delegation hint when that token is present.

**Files:**
- Modify: `src/providers/cursor/prompt/encodeCursorTurn.ts`
- Test: `tests/unit/providers/cursor/prompt/encodeCursorTurn.test.ts` (exists — append)

- [x] **Step 1: Write the failing tests** (append to the existing file, matching its request-builder helpers if any)

```ts
describe('agent mention hints', () => {
  it('adds a delegation hint when the composer agent-mention token is present', () => {
    const turn = encodeCursorTurn({ text: 'Please have @reviewer (agent) check the diff.' });

    expect(turn.prompt).toContain('"reviewer"');
    expect(turn.prompt).toContain('.cursor/agents/');
    expect(turn.prompt).toContain('Delegate');
  });

  it('deduplicates repeated mentions of the same agent', () => {
    const turn = encodeCursorTurn({
      text: '@reviewer (agent) then @reviewer (agent) again',
    });

    expect(turn.prompt.match(/"reviewer"/g)).toHaveLength(1);
  });

  it('does not add a hint for plain @ text without the agent marker', () => {
    const turn = encodeCursorTurn({ text: 'email @bob and read @notes/file.md' });

    expect(turn.prompt).not.toContain('.cursor/agents/');
  });
});
```

If the existing test file builds requests through a helper (e.g. a `makeRequest(...)` factory), use that helper instead of object literals — keep `text` as the only meaningful field.

- [x] **Step 2: Run tests to verify they fail**

Run: `npm run test -- --selectProjects unit tests/unit/providers/cursor/prompt/encodeCursorTurn.test.ts`
Expected: new cases FAIL (no hint emitted), pre-existing cases PASS.

- [x] **Step 3: Implement the hint**

In `src/providers/cursor/prompt/encodeCursorTurn.ts`, add above `buildCursorContextHints`:

```ts
// Matches the composer's agent-mention insertion format: `@<id> (agent) `.
const AGENT_MENTION_PATTERN = /@(\S+) \(agent\)/g;

function collectMentionedAgentNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(AGENT_MENTION_PATTERN)) {
    if (!names.includes(match[1])) {
      names.push(match[1]);
    }
  }
  return names;
}
```

and add to `buildCursorContextHints`, after the `currentNotePath` block:

```ts
  const agentNames = collectMentionedAgentNames(request.text);
  if (agentNames.length > 0) {
    hints.push(
      `\n[The user referenced the subagent(s) ${agentNames.map((n) => `"${n}"`).join(', ')}.`
      + ` Subagent definitions live under .cursor/agents/.`
      + ` Delegate the relevant parts of this task to the referenced subagent(s).]`,
    );
  }
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npm run test -- --selectProjects unit tests/unit/providers/cursor/prompt/encodeCursorTurn.test.ts`
Expected: PASS, including pre-existing cases.

- [x] **Step 5: Commit**

```bash
git add src/providers/cursor/prompt/encodeCursorTurn.ts tests/unit/providers/cursor/prompt/encodeCursorTurn.test.ts
git commit -m "feat(cursor): delegation hint for @-mentioned subagents in turn encoding"
```

### Task 9: Settings UI — `CursorAgentSettings` + tab section

**Files:**
- Create: `src/providers/cursor/ui/CursorAgentSettings.ts`
- Modify: `src/providers/cursor/ui/CursorSettingsTab.ts` (end of `render()`, after the `renderEnvironmentSettingsSection(...)` call)
- Test: `tests/unit/providers/cursor/ui/CursorAgentSettings.test.ts`

- [x] **Step 1: Write the failing test**

Create `tests/unit/providers/cursor/ui/CursorAgentSettings.test.ts`. Mirror the harness setup (obsidian mocks, container creation) from `tests/unit/providers/opencode/ui/OpencodeAgentSettings.test.ts` — same mock module, same flush helpers — with these cases:

```ts
import { CursorAgentSettings, validateCursorAgentName } from '@/providers/cursor/ui/CursorAgentSettings';
import type { CursorAgentStorage } from '@/providers/cursor/storage/CursorAgentStorage';
import type { CursorAgentDefinition } from '@/providers/cursor/types/agent';

function createStorage(agents: CursorAgentDefinition[]): CursorAgentStorage {
  return {
    loadAll: jest.fn(async () => agents),
    save: jest.fn(),
    delete: jest.fn(),
  } as unknown as CursorAgentStorage;
}

async function renderSettings(agents: CursorAgentDefinition[]): Promise<HTMLElement> {
  const container = document.createElement('div');
  const settings = new CursorAgentSettings(container, createStorage(agents), undefined, undefined);
  await settings.render();
  return container;
}

describe('CursorAgentSettings', () => {
  it('lists file agents and builtins, with edit/delete only on editable sources', async () => {
    const container = await renderSettings([
      { name: 'reviewer', description: 'Vault reviewer.', prompt: 'p', source: 'vault' },
      { name: 'compat', description: 'Compat. (from .claude/agents)', prompt: 'p', source: 'claude-compat' },
    ]);

    const text = container.textContent ?? '';
    expect(text).toContain('reviewer');
    expect(text).toContain('compat');
    expect(text).toContain('Explore');   // builtin appended
    // One editable agent → exactly one edit and one delete control.
    expect(container.querySelectorAll('[aria-label="Edit"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-label="Delete"]')).toHaveLength(1);
  });

  it('shows the create hint when no editable agents exist', async () => {
    const container = await renderSettings([]);

    expect(container.textContent).toContain('No vault or global Cursor subagents yet');
  });
});

describe('validateCursorAgentName', () => {
  it('accepts simple names', () => {
    expect(validateCursorAgentName('code-reviewer')).toBeNull();
    expect(validateCursorAgentName('reviewer.v2')).toBeNull();
  });

  it('rejects empty, path-traversal, and reserved-character names', () => {
    expect(validateCursorAgentName('')).not.toBeNull();
    expect(validateCursorAgentName('..')).not.toBeNull();
    expect(validateCursorAgentName('a/b')).not.toBeNull();
    expect(validateCursorAgentName('a\\b')).not.toBeNull();
    expect(validateCursorAgentName('a:b')).not.toBeNull();
    expect(validateCursorAgentName(' padded ')).not.toBeNull();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit -t "CursorAgentSettings"`
Expected: FAIL — module not found.

- [x] **Step 3: Create `src/providers/cursor/ui/CursorAgentSettings.ts`**

```ts
import type { App } from 'obsidian';
import { Modal, Notice, setIcon, Setting } from 'obsidian';

import { renderModalButtonRow, renderSettingsListItem } from '../../../shared/components/settingsListUI';
import { confirmDelete } from '../../../shared/modals/ConfirmModal';
import { type CursorAgentStorage, loadCursorAgentsWithBuiltins } from '../storage/CursorAgentStorage';
import type { CursorAgentDefinition } from '../types/agent';

const INVALID_NAME_PATTERN = /[<>:"/\\|?* ]/;

export function validateCursorAgentName(name: string): string | null {
  if (!name) return 'Name is required.';
  if (name !== name.trim()) return 'Name cannot start or end with whitespace.';
  if (name === '.' || name === '..') return 'Name cannot be a dot segment.';
  if (INVALID_NAME_PATTERN.test(name)) {
    return 'Name cannot contain path separators or reserved characters.';
  }
  return null;
}

function isEditable(agent: CursorAgentDefinition): boolean {
  return agent.source === 'vault' || agent.source === 'global';
}

function sourceBadge(agent: CursorAgentDefinition): string {
  if (agent.source === 'claude-compat') return 'claude compat';
  return agent.source;
}

export class CursorAgentSettings {
  private agents: CursorAgentDefinition[] = [];

  constructor(
    private readonly containerEl: HTMLElement,
    private readonly storage: CursorAgentStorage,
    private readonly app?: App,
    private readonly onChanged?: () => Promise<void> | void,
  ) {
    void this.render();
  }

  async render(): Promise<void> {
    this.containerEl.empty();

    try {
      this.agents = await loadCursorAgentsWithBuiltins(this.storage);
    } catch {
      this.agents = [];
    }

    const headerEl = this.containerEl.createDiv({ cls: 'claudian-sp-header' });
    headerEl.createSpan({ text: 'Cursor subagents', cls: 'claudian-sp-label' });

    const actionsEl = headerEl.createDiv({ cls: 'claudian-sp-header-actions' });
    const refreshBtn = actionsEl.createEl('button', {
      cls: 'claudian-settings-action-btn',
      attr: { 'aria-label': 'Refresh' },
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', () => { void this.render(); });

    const addBtn = actionsEl.createEl('button', {
      cls: 'claudian-settings-action-btn',
      attr: { 'aria-label': 'Add' },
    });
    setIcon(addBtn, 'plus');
    addBtn.addEventListener('click', () => this.openModal(null));

    if (!this.agents.some(isEditable)) {
      const emptyEl = this.containerEl.createDiv({ cls: 'claudian-sp-empty-state' });
      emptyEl.setText('No vault or global Cursor subagents yet. Click + to create one. Built-in and Claude-compat agents below are read-only.');
    }

    const listEl = this.containerEl.createDiv({ cls: 'claudian-sp-list' });
    for (const agent of this.agents) {
      this.renderItem(listEl, agent);
    }
  }

  private renderItem(listEl: HTMLElement, agent: CursorAgentDefinition): void {
    const actions = isEditable(agent)
      ? [
          { icon: 'pencil', ariaLabel: 'Edit', onClick: () => this.openModal(agent) },
          {
            icon: 'trash-2',
            ariaLabel: 'Delete',
            danger: true,
            onClick: () => { void this.deleteAgent(agent); },
          },
        ]
      : [];

    const { headerRow } = renderSettingsListItem(listEl, {
      name: agent.name,
      description: agent.description,
      actions,
    });

    headerRow.createSpan({ text: sourceBadge(agent), cls: 'claudian-slash-item-badge' });
    if (agent.model) {
      headerRow.createSpan({ text: agent.model, cls: 'claudian-slash-item-badge' });
    }
    if (agent.isBackground) {
      headerRow.createSpan({ text: 'background', cls: 'claudian-slash-item-badge' });
    }
  }

  private async deleteAgent(agent: CursorAgentDefinition): Promise<void> {
    if (!this.app) return;
    const confirmed = await confirmDelete(this.app, `Delete subagent "${agent.name}"?`);
    if (!confirmed) return;
    try {
      await this.storage.delete(agent);
      await this.render();
      await this.onChanged?.();
      new Notice(`Deleted subagent "${agent.name}".`);
    } catch {
      new Notice('Failed to delete the subagent.');
    }
  }

  private openModal(existing: CursorAgentDefinition | null): void {
    if (!this.app) return;
    new CursorAgentModal(this.app, existing, this.agents, async (agent) => {
      try {
        await this.storage.save(agent, existing);
        await this.render();
        await this.onChanged?.();
        new Notice(`Saved subagent "${agent.name}".`);
        return true;
      } catch {
        new Notice('Failed to save the subagent.');
        return false;
      }
    }).open();
  }
}

class CursorAgentModal extends Modal {
  private name: string;
  private description: string;
  private model: string;
  private isBackground: boolean;
  private saveToGlobal: boolean;
  private prompt: string;

  constructor(
    app: App,
    private readonly existing: CursorAgentDefinition | null,
    private readonly allAgents: CursorAgentDefinition[],
    private readonly onSubmit: (agent: CursorAgentDefinition) => Promise<boolean>,
  ) {
    super(app);
    this.name = existing?.name ?? '';
    this.description = existing?.description ?? '';
    this.model = existing?.model ?? '';
    this.isBackground = existing?.isBackground ?? false;
    this.saveToGlobal = existing?.source === 'global';
    this.prompt = existing?.prompt ?? '';
  }

  onOpen(): void {
    this.titleEl.setText(this.existing ? 'Edit Cursor subagent' : 'New Cursor subagent');
    const { contentEl } = this;

    new Setting(contentEl)
      .setName('Name')
      .setDesc('Used as the file name under the agents folder and as the @mention id.')
      .addText((text) => text
        .setValue(this.name)
        .onChange((value) => { this.name = value; }));

    new Setting(contentEl)
      .setName('Description')
      .setDesc('Tells Cursor when to delegate to this subagent.')
      .addText((text) => text
        .setValue(this.description)
        .onChange((value) => { this.description = value; }));

    new Setting(contentEl)
      .setName('Model')
      .setDesc('Optional Cursor model id (for example composer-2). Empty inherits the chat model.')
      .addText((text) => text
        .setValue(this.model)
        .onChange((value) => { this.model = value.trim(); }));

    new Setting(contentEl)
      .setName('Background agent')
      .setDesc('Sets is_background: true so Cursor runs it without blocking the turn.')
      .addToggle((toggle) => toggle
        .setValue(this.isBackground)
        .onChange((value) => { this.isBackground = value; }));

    new Setting(contentEl)
      .setName('Save globally')
      .setDesc('Store under ~/.cursor/agents/ instead of the vault.')
      .addToggle((toggle) => toggle
        .setValue(this.saveToGlobal)
        .onChange((value) => { this.saveToGlobal = value; }));

    new Setting(contentEl)
      .setName('Prompt')
      .setDesc('System prompt body of the agent definition.');
    const promptEl = contentEl.createEl('textarea', { cls: 'claudian-agent-prompt-input' });
    promptEl.rows = 8;
    promptEl.value = this.prompt;
    promptEl.addEventListener('input', () => { this.prompt = promptEl.value; });

    renderModalButtonRow(contentEl, {
      submitLabel: this.existing ? 'Save' : 'Create',
      onCancel: () => this.close(),
      onSubmit: () => {
        void (async (): Promise<void> => {
          const name = this.name.trim();
          const validationError = validateCursorAgentName(name);
          if (validationError) {
            new Notice(validationError);
            return;
          }
          const conflict = this.allAgents.some((agent) =>
            agent.name.toLowerCase() === name.toLowerCase()
            && agent.persistenceKey !== this.existing?.persistenceKey);
          if (conflict) {
            new Notice(`An agent named "${name}" already exists.`);
            return;
          }
          if (!this.description.trim()) {
            new Notice('Description is required.');
            return;
          }
          const ok = await this.onSubmit({
            name,
            description: this.description.trim(),
            prompt: this.prompt,
            source: this.saveToGlobal ? 'global' : 'vault',
            ...(this.model ? { model: this.model } : {}),
            ...(this.isBackground ? { isBackground: true } : {}),
            ...(this.existing?.persistenceKey && this.existing.source === (this.saveToGlobal ? 'global' : 'vault')
              ? { persistenceKey: this.existing.persistenceKey }
              : {}),
          });
          if (ok) this.close();
        })();
      },
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
```

If `renderModalButtonRow`'s option names differ (check `src/shared/components/settingsListUI.ts` — Opencode's modal uses it the same way), match its actual signature; the Opencode modal at `src/providers/opencode/ui/OpencodeAgentSettings.ts` is the working reference.

- [x] **Step 4: Add the section to the Cursor settings tab**

In `src/providers/cursor/ui/CursorSettingsTab.ts`, add imports (type-only services import avoids a runtime cycle — `CursorWorkspaceServices.ts` imports this file's renderer):

```ts
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type { CursorWorkspaceServices } from '../app/CursorWorkspaceServices';
import { CursorAgentSettings } from './CursorAgentSettings';
```

At the end of the `render(container, context)` body, after the `renderEnvironmentSettingsSection(...)` call, append:

```ts
    const cursorWorkspace = ProviderWorkspaceRegistry.getServices('cursor') as CursorWorkspaceServices | null;
    if (cursorWorkspace?.agentStorage) {
      new Setting(container).setName('Subagents').setHeading();

      const subagentsDesc = container.createDiv({ cls: 'claudian-sp-settings-desc' });
      subagentsDesc.createEl('p', {
        cls: 'setting-item-description',
        text: 'Manage Cursor subagents in .cursor/agents/ (vault) and ~/.cursor/agents/ (global). Claude vault agents from .claude/agents/ and the built-in Explore, Bash, and Browser agents are listed read-only. Entries appear in the @mention menu.',
      });

      const agentsContainer = container.createDiv({ cls: 'claudian-slash-commands-container' });
      new CursorAgentSettings(agentsContainer, cursorWorkspace.agentStorage, context.plugin.app, async () => {
        await cursorWorkspace.refreshAgentMentions?.();
      });
    }
```

- [x] **Step 5: Run tests + typecheck + lint**

Run: `npm run test -- --selectProjects unit tests/unit/providers/cursor/ui/CursorAgentSettings.test.ts && npm run typecheck && npm run lint`
Expected: PASS / clean. Lint's obsidianmd UI rules require sentence-case strings — the strings above comply; fix any flagged casing rather than disabling rules.

- [x] **Step 6: Commit**

```bash
git add src/providers/cursor/ui/CursorAgentSettings.ts src/providers/cursor/ui/CursorSettingsTab.ts tests/unit/providers/cursor/ui/CursorAgentSettings.test.ts
git commit -m "feat(cursor): subagent management section in cursor settings"
```

### Task 10: Docs sync, full gates, push

**Files:**
- Modify: `CLAUDE.md` (root — Cursor provider bullet + Storage table)

- [x] **Step 1: Update the root `CLAUDE.md` Cursor bullet**

In the Architecture Status section, the Cursor bullet ends with:

```
Rewind, in-app MCP management, and subagents are gated.
```

Replace that sentence with:

```
Subagent definitions are first-class: discovered from `.cursor/agents/` (vault), `~/.cursor/agents/` (global), and read-only `.claude/agents/` compat, @-mentionable via `CursorAgentMentionProvider`, and manageable in Cursor settings; live async subagent lifecycle awaits the ACP transport decision (see `docs/superpowers/specs/2026-06-11-cursor-acp-spike-and-subagent-parity-design.md`). Rewind and in-app MCP management are gated.
```

- [x] **Step 2: Add the storage rows to the root `CLAUDE.md` Storage table**

After the `.codex/agents/*.toml` row, add:

```
| `.cursor/agents/*.md` | Cursor vault subagent definitions (markdown frontmatter) |
```

- [x] **Step 3: Run the full gate suite**

Run: `npm run typecheck && npm run lint && npm run test && npm run build && npm run check:loc && npm run check:artifacts && npm run check:quality`
Expected: all pass. If `check:loc` fails on the new modules, follow the baseline-update procedure in `docs/build-ci/quality-gates.md` and include the regenerated `scripts/loc-baseline.json` in this commit; same for `check:quality` and `scripts/quality-baseline.json`. Do not suppress failures any other way.

- [x] **Step 4: Commit and push**

```bash
git add CLAUDE.md
git commit -m "docs: cursor subagent foundation status in provider matrix"
git push -u origin claude/zealous-mccarthy-g6zr9w
```

(PR #81 already tracks this branch; the push updates it.)

---

## Completion criteria

- Spike harness + protocol committed (Tasks 1–2); running it is a human step outside this plan.
- Cursor agents are discoverable, @-mentionable with correct source labels, and manageable in settings; the encoder hints delegation for mentioned agents (Tasks 3–9).
- All gates green and pushed (Task 10).
- NOT in this plan (by design): spike findings doc, the ADR, Part C transport/runtime work, async subagent lifecycle.
