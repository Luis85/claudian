#!/usr/bin/env node
// Interactive driver for Cursor's first-party ACP server (`agent acp`).
// Speaks newline-delimited JSON-RPC 2.0 over stdio, logs every frame in both
// directions to an NDJSON capture file, and lets a human answer server-initiated
// requests (session/request_permission, cursor/ask_question) from the terminal.
// See README.md in this directory for the full spike protocol.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { createInterface } from 'node:readline';

const VERSION_DIR_PATTERN = /^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$/u;
const WINDOWS_CMD_ARGUMENT_CHARS = /[\s"&<>|{}^=;!'+,`~()%@]/u;

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

function isFileSafe(target) {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

function versionSortKey(versionName) {
  const datePart = versionName.split('-')[0];
  const [year, month, day] = datePart.split('.');
  return `${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`;
}

/** Locates the bundled node + index.js the Cursor shim delegates to. */
function resolveCursorNodeEntry(cliPath) {
  const p = process.platform === 'win32' ? win32 : { dirname, join, basename };
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
  const dir = p.dirname(cliPath);

  const adjacentNode = p.join(dir, nodeName);
  const adjacentEntry = p.join(dir, 'index.js');
  if (isFileSafe(adjacentNode) && isFileSafe(adjacentEntry)) {
    return { node: adjacentNode, entry: adjacentEntry };
  }

  try {
    const versionsDir = p.join(dir, 'versions');
    const candidates = readdirSync(versionsDir)
      .filter((name) => VERSION_DIR_PATTERN.test(name))
      .sort((a, b) => versionSortKey(b).localeCompare(versionSortKey(a)));

    for (const version of candidates) {
      const node = p.join(versionsDir, version, nodeName);
      const entry = p.join(versionsDir, version, 'index.js');
      if (isFileSafe(node) && isFileSafe(entry)) {
        return { node, entry };
      }
    }
  } catch {
    return null;
  }

  return null;
}

function deriveInvokedAs(cliPath) {
  const stripped = basename(cliPath).replace(/\.(cmd|bat|ps1|exe)$/iu, '');
  return stripped || 'cursor-agent';
}

function quoteWindowsShellArgument(value) {
  if (!value.length) return '""';
  if (!WINDOWS_CMD_ARGUMENT_CHARS.test(value) && !value.includes('[') && !value.includes(']')) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function wrapWindowsCmdShim(command, cmdArgs) {
  const shellCommand = [command, ...cmdArgs].map(quoteWindowsShellArgument).join(' ');
  return {
    command: process.env.ComSpec || process.env.comspec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${shellCommand}"`],
    windowsVerbatimArguments: true,
  };
}

/**
 * Resolves how to spawn the Cursor CLI. Prefers the bundled node entry (avoids
 * EINVAL on `.cmd` shims); falls back to a cmd.exe wrap on Windows.
 */
function resolveAgentLaunch(cliPath, cmdArgs) {
  const entry = resolveCursorNodeEntry(cliPath);
  if (entry) {
    return {
      command: entry.node,
      args: [entry.entry, ...cmdArgs],
      env: { CURSOR_INVOKED_AS: deriveInvokedAs(cliPath) },
    };
  }

  const lower = cliPath.toLowerCase();
  if (process.platform === 'win32' && (lower.endsWith('.cmd') || lower.endsWith('.bat'))) {
    return wrapWindowsCmdShim(cliPath, cmdArgs);
  }

  return { command: cliPath, args: cmdArgs };
}

function probeAgentCli(cliPath) {
  const launch = resolveAgentLaunch(cliPath, ['--version']);
  const options = { stdio: 'ignore', env: launch.env ? { ...process.env, ...launch.env } : process.env };
  if (launch.windowsVerbatimArguments) {
    options.windowsVerbatimArguments = true;
  }
  const probe = spawnSync(launch.command, launch.args, options);
  return !probe.error;
}

function discoverAgentCliPath() {
  if (process.platform === 'win32') {
    const installRoot = process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'cursor-agent')
      : null;
    const windowsNames = ['agent.cmd', 'cursor-agent.cmd', 'agent.exe', 'cursor-agent.exe'];
    if (installRoot && existsSync(installRoot)) {
      for (const name of windowsNames) {
        const candidate = join(installRoot, name);
        if (isFileSafe(candidate) && probeAgentCli(candidate)) {
          return candidate;
        }
      }
    }

    for (const dir of (process.env.PATH ?? '').split(';')) {
      const trimmed = dir.trim();
      if (!trimmed) continue;
      for (const name of windowsNames) {
        const candidate = join(trimmed, name);
        if (isFileSafe(candidate) && probeAgentCli(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }

  for (const candidate of ['agent', 'cursor-agent']) {
    if (probeAgentCli(candidate)) {
      return candidate;
    }
  }
  return null;
}

// The Jan 2026 CLI release renamed the binary: `agent` is the primary entry
// point and `cursor-agent` survives as a backward-compatible alias. On Windows
// PowerShell resolves `agent` to agent.ps1, but Node must spawn agent.cmd or
// the bundled node.exe entry — see resolveAgentLaunch().
function resolveAgentBinary(requested) {
  if (typeof requested === 'string' && requested.trim()) {
    const cliPath = resolve(requested.trim());
    if (!probeAgentCli(cliPath)) {
      console.log(`[spike] could not run ${cliPath} --version. Check --bin or install the Cursor CLI.`);
      process.exit(1);
    }
    return cliPath;
  }

  const discovered = discoverAgentCliPath();
  if (discovered) {
    return discovered;
  }

  console.log('[spike] neither `agent` nor `cursor-agent` found. Install the Cursor CLI or pass --bin <path to agent.cmd>.');
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const scenario = args.scenario ?? 'handshake';
const cliPath = resolveAgentBinary(args.bin);
const launch = resolveAgentLaunch(cliPath, ['acp']);
const cwd = resolve(args.cwd ?? process.cwd());
const captureDir = resolve(args.capture ?? join(cwd, '.context', 'cursor-acp-captures'));
mkdirSync(captureDir, { recursive: true });
const captureFile = join(captureDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${scenario}.ndjson`);

console.log(`[spike] scenario=${scenario} cli=${cliPath} cwd=${cwd}`);
console.log(`[spike] launch: ${launch.command} ${launch.args.join(' ')}`);
console.log(`[spike] capture: ${captureFile}`);

const spawnOptions = {
  cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: launch.env ? { ...process.env, ...launch.env } : process.env,
};
if (launch.windowsVerbatimArguments) {
  spawnOptions.windowsVerbatimArguments = true;
}
const child = spawn(launch.command, launch.args, spawnOptions);
// A late send() racing the agent's exit must not crash the harness with EPIPE.
child.stdin.on('error', (err) => console.log(`[spike] stdin write failed: ${err.message}`));
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

// fs/terminal requests only arrive once the client advertises those
// capabilities (default). They must be serviced or the agent's tool call hangs.
// Returning real results keeps the turn alive so we can observe whether
// Resolve an ACP-supplied path against the session cwd and reject anything that
// escapes it (absolute paths elsewhere, ../ traversal), so a buggy or adversarial
// ACP server can't read or clobber files outside the disposable test workspace.
// Mirrors the intent of production resolveWorkspaceScopedPath().
function resolveInCwd(requestedPath) {
  const resolved = resolve(cwd, requestedPath);
  const rel = relative(cwd, resolved);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`path escapes session cwd: ${requestedPath}`);
  }
  return resolved;
}

// session/request_permission and cursor/ask_question fire afterwards.
function handleClientSideMethod(frame) {
  const { method, params } = frame;
  try {
    if (method === 'fs/read_text_file') {
      // Resolve relative paths against the ACP session cwd, not the harness
      // process cwd, so captures reflect the workspace the agent was told to use.
      const content = readFileSync(resolveInCwd(params.path), 'utf8');
      // Honor the ACP line/limit read window (1-based line) like a real client,
      // so captures don't over-feed the agent on large files. Mirrors the
      // production readWorkspaceTextFile slicing in src/providers/acp/acpWorkspaceFs.ts.
      let text = content;
      if (params.line !== undefined || params.limit !== undefined) {
        const lines = content.split(/\r?\n/);
        const startIndex = Math.max(0, (params.line ?? 1) - 1);
        const endIndex = params.limit ? startIndex + Math.max(0, params.limit) : lines.length;
        text = lines.slice(startIndex, endIndex).join('\n');
      }
      send({ jsonrpc: '2.0', id: frame.id, result: { content: text } });
      return true;
    }
    if (method === 'fs/write_text_file') {
      const target = resolveInCwd(params.path);
      // Production's ACP write path creates the parent dir first; mirror it so a
      // new nested path (e.g. .cursor/plans/...) doesn't record a spurious ENOENT.
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, params.content ?? '');
      send({ jsonrpc: '2.0', id: frame.id, result: {} });
      return true;
    }
    if (method === 'terminal/create' || method === 'terminal/output' || method === 'terminal/release' || method === 'terminal/wait_for_exit' || method === 'terminal/kill') {
      // Minimal terminal stub: acknowledge so the agent can proceed (including
      // terminal/kill, so non-interactive --auto-answer/--cancel-after probes
      // don't hang waiting on a human). We are not running real shell here; the
      // point is to keep the turn alive to observe permission/question delegation.
      const result = method === 'terminal/create'
        ? { terminalId: `spike-term-${frame.id}` }
        : method === 'terminal/output'
          ? { output: '', truncated: false, exitStatus: { exitCode: 0 } }
          : method === 'terminal/wait_for_exit'
            ? { exitCode: 0 }
            : {};
      send({ jsonrpc: '2.0', id: frame.id, result });
      return true;
    }
  } catch (err) {
    send({ jsonrpc: '2.0', id: frame.id, error: { code: -32000, message: String(err && err.message ? err.message : err) } });
    return true;
  }
  return false;
}

async function answerServerRequest(frame) {
  console.log(`\n[server request] ${frame.method}`);
  console.log(JSON.stringify(frame.params, null, 2));

  if (handleClientSideMethod(frame)) {
    return;
  }

  if (frame.method === 'session/request_permission') {
    const options = frame.params?.options ?? [];
    for (const opt of options) console.log(`  option: ${JSON.stringify(opt)}`);
    // Auto-select an allow-once option when running non-interactively so the
    // probe completes; --auto-answer drives this. Falls back to interactive.
    const auto = args['auto-answer'];
    if (auto) {
      const allow = options.find((o) => /allow.?once|allow_once|allowonce/i.test(o.optionId ?? o.kind ?? ''))
        ?? options.find((o) => /allow/i.test(o.optionId ?? o.kind ?? ''))
        ?? options[0];
      const optionId = allow?.optionId;
      console.log(`[spike] auto-answer permission → ${optionId}`);
      send({ jsonrpc: '2.0', id: frame.id, result: { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } } });
      return;
    }
    const optionId = await ask('optionId to select (empty = cancelled): ');
    const outcome = optionId
      ? { outcome: 'selected', optionId }
      : { outcome: 'cancelled' };
    send({ jsonrpc: '2.0', id: frame.id, result: { outcome } });
    return;
  }

  // Cursor extension methods (cursor/ask_question etc.). Auto-answer with the
  // first option when requested, so the same turn can continue in-process.
  if (args['auto-answer'] && /ask_question/i.test(frame.method)) {
    const q = frame.params ?? {};
    const opts = q.options ?? q.choices ?? [];
    const first = Array.isArray(opts) && opts.length ? (opts[0].optionId ?? opts[0].id ?? opts[0].value ?? opts[0]) : 'red';
    console.log(`[spike] auto-answer ask_question → ${JSON.stringify(first)}`);
    send({ jsonrpc: '2.0', id: frame.id, result: typeof first === 'string' ? { optionId: first } : first });
    return;
  }

  // Unknown/extension methods: the spike's job is to discover the response
  // shape. Plain text wraps as { answer }, a JSON object passes through verbatim.
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
  if (typeof args.image === 'string') {
    const data = readFileSync(resolve(args.image)).toString('base64');
    const ext = args.image.toLowerCase().split('.').pop();
    const mimeTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
    content.push({ type: 'image', mimeType: mimeTypes[ext] ?? 'image/png', data });
  }
  // --prompt-file <path> reads the prompt from a file. This sidesteps shell
  // argument splitting (PowerShell Start-Process -ArgumentList splits a
  // multi-word --prompt value on spaces), which silently truncates prompts.
  let promptText = 'Reply with the single word: pong';
  if (typeof args['prompt-file'] === 'string') {
    promptText = readFileSync(resolve(args['prompt-file']), 'utf8').trim();
  } else if (typeof args.prompt === 'string') {
    promptText = args.prompt;
  }
  content.push({ type: 'text', text: promptText });
  return content;
}

async function initialize() {
  // Cursor's ACP server only delegates session/request_permission and
  // cursor/ask_question back to the client when the client advertises that it
  // can actually service fs + terminal work. A client that declares
  // readTextFile/writeTextFile=false (and no terminal) signals "handle tools
  // yourself", so the server auto-approves and asks questions as plain text.
  // Default to the full capability set; allow --minimal-caps to reproduce the
  // earlier under-declared behavior for comparison.
  const fullCaps = {
    fs: { readTextFile: true, writeTextFile: true },
    terminal: true,
  };
  const minimalCaps = { fs: { readTextFile: false, writeTextFile: false } };
  const clientCapabilities = args['minimal-caps'] ? minimalCaps : fullCaps;
  const result = await request('initialize', {
    protocolVersion: 1,
    clientInfo: { name: 'claudian-cursor-acp-spike', version: '0.1.0' },
    clientCapabilities,
  });
  console.log(`[spike] initialize ok (caps=${args['minimal-caps'] ? 'minimal' : 'full'}): ${JSON.stringify(result)}`);
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
  const cancelAfterMs = Number(args['cancel-after']);
  if (Number.isFinite(cancelAfterMs) && cancelAfterMs > 0) {
    setTimeout(() => {
      console.log('[spike] sending session/cancel');
      notify('session/cancel', { sessionId });
    }, cancelAfterMs);
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
