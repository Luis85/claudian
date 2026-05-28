import { normalizePath, Notice, TFile, TFolder } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import { HANDOFF_END, HANDOFF_START, RUN_LEDGER_END, RUN_LEDGER_START } from '../storage/TaskNoteStore';

interface BuildWorkOrderArgs {
  id: string;
  title: string;
  provider: string;
  model: string;
  timestamp: string;
  sourcePath?: string | null;
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stripMarkdownExtension(path: string): string {
  return path.replace(/\.md$/i, '');
}

function buildWorkOrderMarkdown(args: BuildWorkOrderArgs): string {
  const { id, title, provider, model, timestamp, sourcePath } = args;
  const contextBody = sourcePath
    ? `Source note: [[${stripMarkdownExtension(sourcePath)}]]`
    : '_Add the links, files, and scope the agent needs._';

  return `---
type: claudian-work-order
schema_version: 1
id: ${id}
title: ${JSON.stringify(title)}
status: ready
priority: normal
created: ${timestamp}
updated: ${timestamp}
provider: ${provider}
model: ${model}
run_id:
conversation_id:
sidepanel_tab_id:
started:
finished:
attempts: 0
---
# ${title}

## Objective

_What should the agent accomplish?_

## Acceptance Criteria

- [ ] _Define what "done" means._

## Context

${contextBody}

## Constraints

- Keep direct chat behavior intact.
- Do not modify unrelated files.

## Run Ledger

${RUN_LEDGER_START}
${RUN_LEDGER_END}

## Result / Handoff

${HANDOFF_START}
${HANDOFF_END}
`;
}

function timestampId(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

async function ensureFolder(plugin: ClaudianPlugin, folder: string): Promise<void> {
  const existing = plugin.app.vault.getAbstractFileByPath(folder);
  if (existing instanceof TFolder) return;
  if (existing) return;
  await plugin.app.vault.createFolder(folder);
}

function uniquePath(plugin: ClaudianPlugin, basePath: string): string {
  if (!plugin.app.vault.getAbstractFileByPath(basePath)) return basePath;
  const withoutExt = stripMarkdownExtension(basePath);
  let counter = 2;
  while (plugin.app.vault.getAbstractFileByPath(`${withoutExt}-${counter}.md`)) {
    counter += 1;
  }
  return `${withoutExt}-${counter}.md`;
}

export async function createWorkOrder(
  plugin: ClaudianPlugin,
  sourceFile?: TFile | null,
): Promise<TFile | null> {
  const provider = plugin.settings.agentBoardDefaultProvider;
  const model = plugin.settings.agentBoardDefaultModel;
  if (!provider) {
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Agent Board" is the product feature name.
    new Notice('Set an Agent Board default provider in settings first.');
    return null;
  }
  if (!model) {
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Agent Board" is the product feature name.
    new Notice('Set an Agent Board default model in settings first.');
    return null;
  }

  const folder = normalizePath(plugin.settings.agentBoardWorkOrderFolder || 'Agent Board/tasks');
  await ensureFolder(plugin, folder);

  const now = new Date();
  const title = sourceFile ? sourceFile.basename : 'New work order';
  const slug = slugifyTitle(title) || 'work-order';
  const id = `task-${timestampId(now)}-${slug}`;
  const markdown = buildWorkOrderMarkdown({
    id,
    title,
    provider,
    model,
    timestamp: now.toISOString(),
    sourcePath: sourceFile?.path ?? null,
  });

  const filePath = uniquePath(plugin, normalizePath(`${folder}/${id}.md`));
  const created = await plugin.app.vault.create(filePath, markdown);
  return created instanceof TFile ? created : null;
}

export async function createWorkOrderFromCurrentNote(plugin: ClaudianPlugin): Promise<TFile | null> {
  const active = plugin.app.workspace.getActiveFile();
  if (!active) {
    new Notice('Open a note to create a work order from it.');
    return null;
  }
  return createWorkOrder(plugin, active);
}

export const __taskCommandTestUtils = { buildWorkOrderMarkdown, slugifyTitle };
