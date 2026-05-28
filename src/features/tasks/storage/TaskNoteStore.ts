import { stringifyYaml } from 'obsidian';

import { parseFrontmatter } from '../../../utils/frontmatter';
import type { TaskLedgerEntry, TaskSpec, TaskStatus } from '../model/taskTypes';

export const RUN_LEDGER_START = '<!-- claudian:run-ledger-start -->';
export const RUN_LEDGER_END = '<!-- claudian:run-ledger-end -->';
export const HANDOFF_START = '<!-- claudian:handoff-start -->';
export const HANDOFF_END = '<!-- claudian:handoff-end -->';

const CLAUDIAN_MARKER_PREFIX = '<!-- claudian:';

type WritableFrontmatter = TaskSpec['frontmatter'] & Record<string, unknown>;

export interface ParsedTaskSpec extends Omit<TaskSpec, 'frontmatter'> {
  frontmatter: WritableFrontmatter;
}

export interface TaskParseResult {
  task: ParsedTaskSpec;
}

export interface WriteStatusOptions {
  status: TaskStatus;
  timestamp: string;
  runId?: string | null;
  conversationId?: string | null;
  sidepanelTabId?: string | null;
}

const SECTION_HEADINGS = Object.freeze({
  objective: 'Objective',
  acceptanceCriteria: 'Acceptance Criteria',
  context: 'Context',
  constraints: 'Constraints',
});

export class TaskNoteStore {
  parse(path: string, content: string): TaskParseResult {
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      throw new Error('Missing YAML frontmatter');
    }

    if (parsed.frontmatter.type !== 'claudian-work-order') {
      throw new Error('Invalid work order type');
    }

    if (parsed.frontmatter.schema_version !== 1) {
      throw new Error('Unsupported work order schema_version');
    }

    return {
      task: {
        path,
        frontmatter: { ...parsed.frontmatter } as WritableFrontmatter,
        sections: {
          objective: this.extractSection(parsed.body, SECTION_HEADINGS.objective),
          acceptanceCriteria: this.extractSection(parsed.body, SECTION_HEADINGS.acceptanceCriteria),
          context: this.extractSection(parsed.body, SECTION_HEADINGS.context),
          constraints: this.extractSection(parsed.body, SECTION_HEADINGS.constraints),
          ledger: this.extractGeneratedRegion(parsed.body, RUN_LEDGER_START, RUN_LEDGER_END),
          handoff: this.extractGeneratedRegion(parsed.body, HANDOFF_START, HANDOFF_END),
        },
        body: parsed.body,
        raw: content,
      },
    };
  }

  writeStatus(content: string, options: WriteStatusOptions): string {
    const parsed = this.parse('', content);
    const frontmatter: Record<string, unknown> = { ...parsed.task.frontmatter };

    frontmatter.status = options.status;
    frontmatter.updated = options.timestamp;

    if (options.runId !== undefined) frontmatter.run_id = options.runId;
    if (options.conversationId !== undefined) frontmatter.conversation_id = options.conversationId;
    if (options.sidepanelTabId !== undefined) frontmatter.sidepanel_tab_id = options.sidepanelTabId;

    if (options.status === 'running') {
      frontmatter.started = options.timestamp;
    }

    if (options.status === 'done' || options.status === 'failed' || options.status === 'canceled') {
      frontmatter.finished = options.timestamp;
    }

    return this.withFrontmatter(frontmatter, parsed.task.body);
  }

  appendLedger(content: string, entry: TaskLedgerEntry): string {
    this.assertNoEmbeddedClaudianMarkers(entry.message);

    const currentLedger = this.extractGeneratedRegion(content, RUN_LEDGER_START, RUN_LEDGER_END);
    const nextLine = `- ${entry.timestamp} [${entry.status}] ${entry.message}`;
    const nextLedger = currentLedger.length > 0 ? `${currentLedger}\n${nextLine}` : nextLine;
    return this.replaceGeneratedRegion(content, RUN_LEDGER_START, RUN_LEDGER_END, nextLedger);
  }

  writeHandoff(content: string, markdown: string): string {
    this.assertNoEmbeddedClaudianMarkers(markdown);

    return this.replaceGeneratedRegion(content, HANDOFF_START, HANDOFF_END, markdown.trim());
  }

  extractGeneratedRegion(content: string, start: string, end: string): string {
    const body = this.splitFrontmatter(content).body;
    const startIndex = body.indexOf(start);
    const endIndex = body.indexOf(end, startIndex + start.length);
    if (startIndex === -1 || endIndex === -1) {
      return '';
    }

    return body.slice(startIndex + start.length, endIndex).trim();
  }

  private extractSection(body: string, heading: string): string {
    const lines = body.split(/\r?\n/);
    const headingPattern = /^##\s+(.+?)\s*$/;
    const sectionLines: string[] = [];
    let inSection = false;

    for (const line of lines) {
      const match = line.match(headingPattern);
      if (match) {
        if (inSection) break;
        inSection = match[1] === heading;
        continue;
      }

      if (inSection) {
        sectionLines.push(line);
      }
    }

    return sectionLines.join('\n').trim();
  }

  private replaceGeneratedRegion(content: string, start: string, end: string, markdown: string): string {
    const { prefix, body } = this.splitFrontmatter(content);
    const startIndex = body.indexOf(start);
    const endIndex = body.indexOf(end, startIndex + start.length);
    if (startIndex === -1 || endIndex === -1) {
      throw new Error('Missing generated region markers');
    }

    const replacement = `${start}\n${markdown.trim()}\n${end}`;
    const nextBody = `${body.slice(0, startIndex)}${replacement}${body.slice(endIndex + end.length)}`;
    return `${prefix}${nextBody}`;
  }

  private splitFrontmatter(content: string): { prefix: string; body: string } {
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      return { prefix: '', body: content };
    }

    return {
      prefix: content.slice(0, content.length - parsed.body.length),
      body: parsed.body,
    };
  }

  private assertNoEmbeddedClaudianMarkers(markdown: string): void {
    if (markdown.includes(CLAUDIAN_MARKER_PREFIX)) {
      throw new Error('Generated task region content cannot contain Claudian markers');
    }
  }

  private withFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
    return `---\n${this.renderFrontmatter(frontmatter).trim()}\n---\n${body}`;
  }

  private renderFrontmatter(frontmatter: Record<string, unknown>): string {
    if (typeof stringifyYaml === 'function') {
      return stringifyYaml(frontmatter);
    }

    return Object.entries(frontmatter)
      .map(([key, value]) => `${key}: ${this.renderYamlValue(value)}`)
      .join('\n');
  }

  private renderYamlValue(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return `[${value.map(item => this.renderYamlScalar(String(item))).join(', ')}]`;
    if (typeof value === 'object') return JSON.stringify(value);
    return this.renderYamlScalar(String(value));
  }

  private renderYamlScalar(value: string): string {
    if (/[:#\n{}]|\[|\]|^\s|\s$|^(true|false|null|yes|no|on|off)$/i.test(value)) {
      return JSON.stringify(value);
    }
    return value;
  }
}
