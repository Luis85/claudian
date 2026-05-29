import { normalizePath, Notice, TFile, TFolder } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../core/providers/types';
import type ClaudianPlugin from '../../../main';
import type { BrowserSelectionContext } from '../../../utils/browser';
import type { TaskPriority, TaskSpec, TaskStatus } from '../model/taskTypes';
import { HANDOFF_END, HANDOFF_START, RUN_LEDGER_END, RUN_LEDGER_START } from '../storage/TaskNoteStore';
import { buildTemplateVars, renderWorkOrderBody, resolvePriority, resolveProviderModel } from '../templates/templateResolution';
import type { WorkOrderTemplate } from '../templates/templateTypes';

interface BuildWorkOrderArgs {
  id: string;
  title: string;
  provider: string;
  model: string;
  timestamp: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  sourcePath?: string | null;
  sourceFolderPath?: string | null;
  objective?: string;
  contextMarkdown?: string;
  conversationId?: string | null;
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

interface FrontmatterArgs {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  timestamp: string;
  provider: string;
  model: string;
  conversationId?: string | null;
}

function workOrderFrontmatter(args: FrontmatterArgs): string {
  const conversationLine = args.conversationId
    ? `conversation_id: ${JSON.stringify(args.conversationId)}`
    : 'conversation_id:';
  return `---
type: claudian-work-order
schema_version: 1
id: ${args.id}
title: ${JSON.stringify(args.title)}
status: ${args.status}
priority: ${args.priority}
created: ${args.timestamp}
updated: ${args.timestamp}
provider: ${args.provider}
model: ${args.model}
run_id:
${conversationLine}
sidepanel_tab_id:
started:
finished:
attempts: 0
---`;
}

const GENERATED_REGIONS_TAIL = `## Run Ledger

${RUN_LEDGER_START}
${RUN_LEDGER_END}

## Result / Handoff

${HANDOFF_START}
${HANDOFF_END}
`;

function buildWorkOrderMarkdown(args: BuildWorkOrderArgs): string {
  const status = args.status ?? 'ready';
  const priority = args.priority ?? 'normal';

  let contextBody = '_Add the links, files, and scope the agent needs._';
  if (args.contextMarkdown && args.contextMarkdown.trim()) {
    contextBody = args.contextMarkdown.trim();
  } else if (args.sourcePath) {
    contextBody = `Source note: [[${stripMarkdownExtension(args.sourcePath)}]]`;
  } else if (args.sourceFolderPath) {
    contextBody = `Source folder: \`${args.sourceFolderPath}\``;
  }

  const objectiveBody =
    args.objective && args.objective.trim() ? args.objective.trim() : '_What should the agent accomplish?_';

  return `${workOrderFrontmatter({
    id: args.id,
    title: args.title,
    status,
    priority,
    timestamp: args.timestamp,
    provider: args.provider,
    model: args.model,
    conversationId: args.conversationId,
  })}
# ${args.title}

## Objective

${objectiveBody}

## Acceptance Criteria

- [ ] _Define what "done" means._

## Context

${contextBody}

## Constraints

- Keep direct chat behavior intact.
- Do not modify unrelated files.

${GENERATED_REGIONS_TAIL}`;
}

function buildWorkOrderFromTemplate(args: FrontmatterArgs & { body: string }): string {
  return `${workOrderFrontmatter(args)}
${args.body.trim()}

${GENERATED_REGIONS_TAIL}`;
}

function buildExampleTemplateMarkdown(): string {
  return `---
type: claudian-work-order-template
schema_version: 1
name: Example template
description: Starting point for a custom work-order template.
priority: normal
---
# {{title}}

## Objective

_Describe what the agent should accomplish._

## Acceptance Criteria

- [ ] _Define what "done" means._

## Context

{{source}}

_Created {{date}}._

## Constraints

- Do not modify unrelated files.
`;
}

function timestampId(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function isoDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

/** Resolve the board archive folder, defaulting and stripping stray slashes (mirrors the board's folder getter). */
export function resolveArchiveFolder(setting: string): string {
  return (setting || 'Agent Board/archive').replace(/^\/+|\/+$/g, '');
}

/**
 * Move a work-order note into the board archive folder so it leaves the board's scanned folder.
 * Returns the new path on success, or null if the note was missing.
 */
export async function archiveWorkOrder(
  plugin: ClaudianPlugin,
  task: TaskSpec,
): Promise<string | null> {
  const file = plugin.app.vault.getAbstractFileByPath(task.path);
  if (!(file instanceof TFile)) return null;

  const archiveFolder = resolveArchiveFolder(plugin.settings.agentBoardArchiveFolder);
  await ensureFolder(plugin, normalizePath(archiveFolder));

  const destination = uniquePath(plugin, normalizePath(`${archiveFolder}/${file.name}`));
  await plugin.app.fileManager.renameFile(file, destination);
  return destination;
}

export interface CreateWorkOrderOptions {
  status?: TaskStatus;
  reveal?: 'note' | 'none';
  template?: WorkOrderTemplate;
}

export interface WorkOrderSeed {
  title?: string;
  status?: TaskStatus;
  sourcePath?: string | null;
  sourceFolderPath?: string | null;
  objective?: string;
  contextMarkdown?: string;
  conversationId?: string | null;
}

function buildSeedFromSource(source?: TFile | TFolder | null): WorkOrderSeed {
  const sourceFile = source instanceof TFile ? source : null;
  const sourceFolder = source instanceof TFolder ? source : null;
  const title = sourceFile ? sourceFile.basename : sourceFolder ? sourceFolder.name : 'New work order';
  return { title, sourcePath: sourceFile?.path ?? null, sourceFolderPath: sourceFolder?.path ?? null };
}

export async function createWorkOrderFromSeed(
  plugin: ClaudianPlugin,
  seed: WorkOrderSeed,
  options?: CreateWorkOrderOptions,
): Promise<TFile | null> {
  const settings = plugin.settings as unknown as Record<string, unknown>;
  const defaults = {
    provider: plugin.settings.agentBoardDefaultProvider,
    model: plugin.settings.agentBoardDefaultModel,
  };
  const template = options?.template;

  let provider = defaults.provider;
  let model = defaults.model;
  let priority: TaskPriority = 'normal';
  if (template) {
    const resolved = resolveProviderModel(template, defaults, {
      isValidProvider: (id) =>
        ProviderRegistry.getRegisteredProviderIds().includes(id as ProviderId) &&
        ProviderRegistry.isEnabled(id as ProviderId, settings),
      ownsModel: (id, candidate) =>
        ProviderRegistry.getRegisteredProviderIds().includes(id as ProviderId) &&
        ProviderRegistry.getChatUIConfig(id as ProviderId).ownsModel(candidate, settings),
    });
    provider = resolved.provider;
    model = resolved.model;
    priority = resolvePriority(template);
    for (const warning of resolved.warnings) {
      new Notice(warning);
    }
  }

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
  const title = seed.title || 'New work order';
  const slug = slugifyTitle(title) || 'work-order';
  const id = `task-${timestampId(now)}-${slug}`;
  const status = options?.status ?? seed.status ?? 'ready';

  let markdown: string;
  if (template) {
    const vars = buildTemplateVars({
      title,
      date: isoDate(now),
      sourcePath: seed.sourcePath ?? null,
      sourceFolderPath: seed.sourceFolderPath ?? null,
    });
    const rendered = renderWorkOrderBody(template, vars);
    if (rendered.errors.length > 0) {
      new Notice(`Template "${template.name}" has problems: ${rendered.errors.join('; ')}`);
      return null;
    }
    markdown = buildWorkOrderFromTemplate({
      id,
      title,
      status,
      priority,
      timestamp: now.toISOString(),
      provider,
      model,
      conversationId: seed.conversationId ?? null,
      body: rendered.body,
    });
  } else {
    markdown = buildWorkOrderMarkdown({
      id,
      title,
      provider,
      model,
      timestamp: now.toISOString(),
      status,
      sourcePath: seed.sourcePath ?? null,
      sourceFolderPath: seed.sourceFolderPath ?? null,
      objective: seed.objective,
      contextMarkdown: seed.contextMarkdown,
      conversationId: seed.conversationId ?? null,
    });
  }

  const filePath = uniquePath(plugin, normalizePath(`${folder}/${id}.md`));
  const created = await plugin.app.vault.create(filePath, markdown);
  if (created instanceof TFile) {
    if ((options?.reveal ?? 'note') === 'note') {
      await plugin.app.workspace.getLeaf('tab').openFile(created);
    }
    return created;
  }
  return null;
}

export async function createWorkOrder(
  plugin: ClaudianPlugin,
  source?: TFile | TFolder | null,
  options?: CreateWorkOrderOptions,
): Promise<TFile | null> {
  return createWorkOrderFromSeed(plugin, buildSeedFromSource(source), options);
}

export async function createWorkOrderTemplate(plugin: ClaudianPlugin): Promise<TFile | null> {
  const folder = normalizePath(plugin.settings.agentBoardTemplateFolder || 'Agent Board/templates');
  await ensureFolder(plugin, folder);
  const filePath = uniquePath(plugin, normalizePath(`${folder}/work-order-template.md`));
  const created = await plugin.app.vault.create(filePath, buildExampleTemplateMarkdown());
  if (created instanceof TFile) {
    await plugin.app.workspace.getLeaf('tab').openFile(created);
    return created;
  }
  return null;
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Reduce a single line of Markdown to plain text for use as a work-order title.
 * Strips leading block markers (heading, blockquote, list, task checkbox) and
 * common inline markers (emphasis, code, strikethrough, links, wikilinks, images)
 * so a captured first line like `## Refactor the **parser**` titles as
 * `Refactor the parser`.
 */
function stripMarkdown(line: string): string {
  let text = line.trim();

  // Leading block-level markers.
  text = text.replace(/^>+\s*/, '');               // blockquote
  text = text.replace(/^#{1,6}\s+/, '');           // ATX heading
  text = text.replace(/\s+#+\s*$/, '');            // closing ATX hashes
  text = text.replace(/^(?:[-*+]|\d+[.)])\s+/, ''); // unordered/ordered list marker
  text = text.replace(/^\[[ xX]\]\s+/, '');        // task checkbox (after list marker)

  // Inline markers.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // image -> alt
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');  // link -> label
  text = text.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_match, target: string, alias?: string) => alias ?? target,
  ); // wikilink -> alias or target
  text = text.replace(/(\*\*\*|___)(.+?)\1/g, '$2');    // bold italic
  text = text.replace(/(\*\*|__)(.+?)\1/g, '$2');       // bold
  text = text.replace(/(\*|_)(.+?)\1/g, '$2');          // italic
  text = text.replace(/~~(.+?)~~/g, '$1');              // strikethrough
  text = text.replace(/`+([^`]+)`+/g, '$1');            // inline code

  return text.trim();
}

/** First line of captured text, normalized to a plain-text title (Markdown stripped). */
function titleFromFirstLine(text: string): string {
  const firstLine = text.trim().split(/\r?\n/)[0] ?? '';
  return stripMarkdown(firstLine);
}

function blockquote(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

export function buildSelectionSeed(args: { selectionText: string; sourcePath: string | null }): WorkOrderSeed {
  const parts: string[] = [];
  if (args.sourcePath) parts.push(`Source note: [[${stripMarkdownExtension(args.sourcePath)}]]`);
  parts.push(blockquote(args.selectionText));
  return {
    title: truncate(titleFromFirstLine(args.selectionText), 60) || 'Work order from selection',
    contextMarkdown: parts.join('\n\n'),
    status: 'inbox',
  };
}

export function buildBrowserSeed(context: BrowserSelectionContext): WorkOrderSeed {
  const parts: string[] = [blockquote(context.selectedText)];
  if (context.url) {
    parts.push(`Source: [${context.title?.trim() || context.url}](${context.url})`);
  }
  return {
    title: truncate(context.title?.trim() || titleFromFirstLine(context.selectedText), 60) || 'Work order from browser',
    contextMarkdown: parts.join('\n\n'),
    status: 'inbox',
  };
}

export async function createWorkOrderFromBrowserSelection(plugin: ClaudianPlugin): Promise<TFile | null> {
  const context = plugin.getActiveBrowserSelection();
  if (!context || !context.selectedText.trim()) {
    new Notice('Open Claudian chat and select text in a browser view first.');
    return null;
  }
  return createWorkOrderFromSeed(plugin, buildBrowserSeed(context));
}

export function buildMessageSeed(args: {
  messageContent: string;
  currentNote: string | null;
  conversationId: string | null;
}): WorkOrderSeed {
  const parts: string[] = [];
  if (args.currentNote) parts.push(`Source note: [[${stripMarkdownExtension(args.currentNote)}]]`);
  parts.push('Promoted from chat message.');
  return {
    title: truncate(titleFromFirstLine(args.messageContent), 60) || 'Work order from chat',
    objective: args.messageContent.trim(),
    contextMarkdown: parts.join('\n\n'),
    conversationId: args.conversationId,
    status: 'inbox',
  };
}

export function buildConversationSeed(args: {
  conversationId: string;
  conversationTitle: string;
}): WorkOrderSeed {
  return {
    title: truncate(args.conversationTitle, 60) || 'Work order from chat',
    contextMarkdown: 'Promoted from chat conversation.',
    conversationId: args.conversationId,
    status: 'inbox',
  };
}

export const __taskCommandTestUtils = {
  buildWorkOrderMarkdown,
  buildWorkOrderFromTemplate,
  buildExampleTemplateMarkdown,
  slugifyTitle,
  stripMarkdown,
};

export const __taskCaptureTestUtils = { buildSelectionSeed, buildBrowserSeed, buildMessageSeed, buildConversationSeed };
