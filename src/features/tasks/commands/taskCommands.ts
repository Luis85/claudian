import { normalizePath, Notice, TFile, TFolder } from 'obsidian';

import { asSettingsBag } from '../../../core/types/settings';
import { t } from '../../../i18n/i18n';
import type SpecoratorPlugin from '../../../main';
import type { BrowserSelectionContext } from '../../../utils/browser';
import { resolveAgentBoardDefaultModel } from '../defaultModelResolver';
import { resolveAgentBoardDefaultProvider } from '../defaultProviderResolver';
import type { TaskPriority, TaskSpec, TaskStatus } from '../model/taskTypes';
import { CONTEXT_PLACEHOLDER, HANDOFF_END, HANDOFF_START, RUN_LEDGER_END, RUN_LEDGER_START } from '../storage/TaskNoteStore';
import type { WorkOrderTemplate } from '../templates/templateTypes';
import {
  buildWorkOrderMarkdownForSeed,
  resolveRunTarget,
  type WorkOrderMarkdownBuilders,
} from './workOrderResolution';

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
  loop?: string;
  /** Roster agent id (`roster:<slug>`); omitted from the note when unset. */
  agent?: string;
}

function workOrderFrontmatter(args: FrontmatterArgs): string {
  const conversationLine = args.conversationId
    ? `conversation_id: ${JSON.stringify(args.conversationId)}`
    : 'conversation_id:';
  const loopLine = args.loop ? `\nloop: ${JSON.stringify(args.loop)}` : '';
  const agentLine = args.agent ? `\nagent: ${JSON.stringify(args.agent)}` : '';
  return `---
type: specorator-work-order
schema_version: 1
id: ${args.id}
title: ${JSON.stringify(args.title)}
status: ${args.status}
priority: ${args.priority}
created: ${args.timestamp}
updated: ${args.timestamp}${agentLine}
provider: ${args.provider}
model: ${args.model}
run_id:
${conversationLine}${loopLine}
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

function normalizePriority(priority?: TaskPriority): TaskPriority {
  if (!priority) return '2 - normal';
  // Already validated as TaskPriority, return as-is
  return priority;
}

function buildWorkOrderMarkdown(args: BuildWorkOrderArgs): string {
  const status = args.status ?? 'inbox';
  const priority = normalizePriority(args.priority);

  let contextBody = CONTEXT_PLACEHOLDER;
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
  const normalizedArgs = {
    ...args,
    priority: normalizePriority(args.priority),
  };
  return `${workOrderFrontmatter(normalizedArgs)}
${args.body.trim()}

${GENERATED_REGIONS_TAIL}`;
}

function buildExampleTemplateMarkdown(): string {
  return `---
type: specorator-work-order-template
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

async function ensureFolder(plugin: SpecoratorPlugin, folder: string): Promise<void> {
  const existing = plugin.app.vault.getAbstractFileByPath(folder);
  if (existing instanceof TFolder) return;
  if (existing) return;
  await plugin.app.vault.createFolder(folder);
}

function uniquePath(plugin: SpecoratorPlugin, basePath: string): string {
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
  plugin: SpecoratorPlugin,
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

/**
 * Delete a work-order note via Obsidian's trash flow so the user can restore it
 * from the system trash or vault `.trash/` (whichever the vault is configured
 * for). Routed through `fileManager.trashFile` to honor that setting, mirroring
 * how `TemplateNoteStore.delete` deletes vault-authored templates.
 *
 * Returns `true` when the file was trashed, `false` when the path no longer
 * resolves to a TFile (already moved/deleted/shadowed by a TFolder).
 */
export async function deleteWorkOrder(
  plugin: SpecoratorPlugin,
  task: TaskSpec,
): Promise<boolean> {
  const file = plugin.app.vault.getAbstractFileByPath(task.path);
  if (!(file instanceof TFile)) return false;
  await plugin.app.fileManager.trashFile(file);
  return true;
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

const WORK_ORDER_MARKDOWN_BUILDERS: WorkOrderMarkdownBuilders = {
  fromTemplate: buildWorkOrderFromTemplate,
  fromSeed: buildWorkOrderMarkdown,
};

export async function createWorkOrderFromSeed(
  plugin: SpecoratorPlugin,
  seed: WorkOrderSeed,
  options?: CreateWorkOrderOptions,
): Promise<TFile | null> {
  const template = options?.template;
  const target = resolveRunTarget(
    asSettingsBag(plugin.settings),
    {
      provider: resolveAgentBoardDefaultProvider(plugin.settings) ?? '',
      model: resolveAgentBoardDefaultModel(plugin.settings) ?? '',
    },
    template,
  );
  if (!target) return null;

  const folder = normalizePath(plugin.settings.agentBoardWorkOrderFolder || 'Agent Board/tasks');
  await ensureFolder(plugin, folder);

  const now = new Date();
  // Template name dominates the seed-derived title: when the user explicitly
  // picks a template, that picker choice is the strongest signal of what this
  // work order is "about", so it drives the frontmatter title, the H1, and the
  // filename slug.
  const title = template?.name?.trim() || seed.title || 'New work order';
  const slug = slugifyTitle(title) || 'work-order';
  const id = `task-${timestampId(now)}-${slug}`;

  const markdown = buildWorkOrderMarkdownForSeed(
    {
      id,
      title,
      status: options?.status ?? seed.status ?? 'inbox',
      timestamp: now.toISOString(),
      isoDate: isoDate(now),
      conversationId: seed.conversationId ?? null,
      sourcePath: seed.sourcePath ?? null,
      sourceFolderPath: seed.sourceFolderPath ?? null,
      objective: seed.objective,
      contextMarkdown: seed.contextMarkdown,
    },
    target,
    template,
    WORK_ORDER_MARKDOWN_BUILDERS,
  );
  if (markdown === null) return null;

  const filePath = uniquePath(plugin, normalizePath(`${folder}/${id}.md`));
  const created = await plugin.app.vault.create(filePath, markdown);
  if (!(created instanceof TFile)) return null;
  if ((options?.reveal ?? 'note') === 'note') {
    await plugin.app.workspace.getLeaf('tab').openFile(created);
  }
  return created;
}

export async function createWorkOrder(
  plugin: SpecoratorPlugin,
  source?: TFile | TFolder | null,
  options?: CreateWorkOrderOptions,
): Promise<TFile | null> {
  return createWorkOrderFromSeed(plugin, buildSeedFromSource(source), options);
}

export async function createWorkOrderTemplate(plugin: SpecoratorPlugin): Promise<TFile | null> {
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

export async function createWorkOrderFromBrowserSelection(plugin: SpecoratorPlugin): Promise<TFile | null> {
  const context = plugin.getActiveBrowserSelection();
  if (!context || !context.selectedText.trim()) {
    new Notice(t('tasks.create.needsBrowserSelection'));
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
