import { parseYaml } from 'obsidian';

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const VALID_KEY_PATTERN = /^[\w-]+$/;

function isValidKey(key: string): boolean {
  return key.length > 0 && VALID_KEY_PATTERN.test(key);
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseScalarValue(rawValue: string): unknown {
  const value = rawValue.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '') return null;
  if (!Number.isNaN(Number(value))) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => unquote(item));
  }
  return unquote(value);
}

/**
 * Line-by-line YAML fallback for malformed frontmatter (e.g. unquoted values with
 * colons). Tracks the open list and pending bare key as mutable state so the parent
 * loop reads as a sequence of guarded phases that mirror the original fall-through.
 */
class FrontmatterFallbackParser {
  readonly result: Record<string, unknown> = {};
  private currentListKey: string | null = null;
  private currentList: unknown[] = [];
  private pendingBareKey: string | null = null;

  private flushList(): void {
    if (!this.currentListKey) return;
    this.result[this.currentListKey] = this.currentList;
    this.currentListKey = null;
    this.currentList = [];
  }

  /**
   * Phase 1 — an open list either absorbs another `- ` item (line consumed) or ends,
   * letting the line fall through to later phases. Returns true when the line is consumed.
   */
  private consumeListItem(trimmed: string): boolean {
    if (!this.currentListKey) return false;
    if (trimmed.startsWith('- ')) {
      this.currentList.push(parseScalarValue(trimmed.slice(2)));
      return true;
    }
    this.flushList();
    return false;
  }

  /**
   * Phase 2 — a pending bare key opens a list when followed by a `- ` item (line
   * consumed); otherwise it resolves to an empty string and the line falls through.
   * Returns true when the line is consumed.
   */
  private resolvePendingBareKey(trimmed: string): boolean {
    if (!this.pendingBareKey) return false;
    if (trimmed.startsWith('- ')) {
      this.currentListKey = this.pendingBareKey;
      this.currentList = [parseScalarValue(trimmed.slice(2))];
      this.pendingBareKey = null;
      return true;
    }
    this.result[this.pendingBareKey] = '';
    this.pendingBareKey = null;
    return false;
  }

  /** Phase 3 — a `key: value` line, or a bare `key:` that arms a pending list/empty value. */
  private parseKeyValueLine(trimmed: string): void {
    const colonIndex = trimmed.indexOf(': ');
    if (colonIndex === -1) {
      if (trimmed.endsWith(':')) {
        const key = trimmed.slice(0, -1).trim();
        if (isValidKey(key)) {
          this.pendingBareKey = key;
        }
      }
      return;
    }

    const key = trimmed.slice(0, colonIndex).trim();
    if (!isValidKey(key)) return;
    this.result[key] = parseScalarValue(trimmed.slice(colonIndex + 2));
  }

  private processLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    if (this.consumeListItem(trimmed)) return;
    if (this.resolvePendingBareKey(trimmed)) return;
    this.parseKeyValueLine(trimmed);
  }

  parse(yamlContent: string): Record<string, unknown> {
    for (const line of yamlContent.split(/\r?\n/)) {
      this.processLine(line);
    }

    if (this.pendingBareKey) {
      this.result[this.pendingBareKey] = '';
    }
    this.flushList();
    return this.result;
  }
}

/** Handles malformed YAML (e.g. unquoted values with colons) by line-by-line key:value extraction. */
function parseFrontmatterFallback(yamlContent: string): Record<string, unknown> {
  return new FrontmatterFallbackParser().parse(yamlContent);
}

export function parseFrontmatter(
  content: string
): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) return null;

  try {
    const parsed: unknown = parseYaml(match[1]);
    if (parsed !== null && parsed !== undefined && typeof parsed !== 'object') {
      return null;
    }
    return {
      frontmatter: (parsed as Record<string, unknown>) ?? {},
      body: match[2],
    };
  } catch {
    const fallbackParsed = parseFrontmatterFallback(match[1]);
    if (Object.keys(fallbackParsed).length > 0) {
      return {
        frontmatter: fallbackParsed,
        body: match[2],
      };
    }
    return null;
  }
}

export function extractString(
  fm: Record<string, unknown>,
  key: string
): string | undefined {
  const val = fm[key];
  if (typeof val === 'string' && val.length > 0) return val;
  if (Array.isArray(val) && val.length > 0 && val.every(v => typeof v === 'string')) {
    return val.map(v => `[${v}]`).join(' ');
  }
  return undefined;
}

export function normalizeStringArray(val: unknown): string[] | undefined {
  if (val === undefined || val === null) return undefined;

  if (Array.isArray(val)) {
    return val.map(v => String(v).trim()).filter(Boolean);
  }

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return undefined;
    return trimmed.split(',').map(s => s.trim()).filter(Boolean);
  }

  return undefined;
}

export function extractStringArray(
  fm: Record<string, unknown>,
  key: string
): string[] | undefined {
  return normalizeStringArray(fm[key]);
}

export function extractBoolean(
  fm: Record<string, unknown>,
  key: string
): boolean | undefined {
  const val = fm[key];
  if (typeof val === 'boolean') return val;
  return undefined;
}

export function extractNumber(
  fm: Record<string, unknown>,
  key: string
): number | undefined {
  const val = fm[key];
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

const MAX_SLUG_LENGTH = 64;
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const YAML_RESERVED_WORDS = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off']);

export type SlugValidationRule = 'required' | 'tooLong' | 'invalidChars' | 'yamlReserved';

export interface SlugValidationResult {
  rule: SlugValidationRule;
  params?: Record<string, string | number>;
}

/**
 * Structured slug-name validation. Returns null on success or a `{ rule, params? }`
 * object so each caller can map the rule to its own translation subspace
 * (e.g. settings.subagents.validation.* vs settings.slashCommands.validation.*).
 */
export function validateSlugName(name: string): SlugValidationResult | null {
  if (!name) {
    return { rule: 'required' };
  }
  if (name.length > MAX_SLUG_LENGTH) {
    return { rule: 'tooLong', params: { max: MAX_SLUG_LENGTH } };
  }
  if (!SLUG_PATTERN.test(name)) {
    return { rule: 'invalidChars' };
  }
  if (YAML_RESERVED_WORDS.has(name)) {
    return { rule: 'yamlReserved' };
  }
  return null;
}
