// Acronyms that should stay upper-cased in the generic title-case fallback.
const KNOWN_ACRONYMS = new Set(['GPT', 'AI']);

const EXACT_LABELS: Record<string, string> = {
  'auto': 'Auto',
  'composer-2-fast': 'Composer 2 Fast',
  'composer-2': 'Composer 2',
  'composer-1.5': 'Composer 1.5',
  'composer-1': 'Composer 1',
  'sonic': 'Sonic',
};

function titleCaseWord(word: string): string {
  if (!word) {
    return word;
  }
  const upper = word.toUpperCase();
  if (KNOWN_ACRONYMS.has(upper)) {
    return upper;
  }
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

// Splits on `-`, `_`, `/` but keeps version-style dots intact so labels like
// "Composer 2.5", "Kimi K2.5", and "Grok Build 0.1" don't decay into the
// dot-stripped "Composer 2 5" form.
function formatGenericLabel(id: string): string {
  return id
    .split(/[-_/]/)
    .filter(Boolean)
    .map(titleCaseWord)
    .join(' ');
}

function formatClaudeLabel(lower: string): string | null {
  const family = lower.includes('opus')
    ? 'Opus'
    : lower.includes('sonnet')
      ? 'Sonnet'
      : lower.includes('haiku')
        ? 'Haiku'
        : null;
  if (!family) {
    return null;
  }
  const versionMatch = lower.match(/(\d+)[.-](\d+)/);
  const version = versionMatch ? `${versionMatch[1]}.${versionMatch[2]}` : '';
  return version ? `Claude ${family} ${version}` : `Claude ${family}`;
}

/**
 * Produces a display label for a Cursor model id. Recognizes Cursor's own
 * Composer/Sonic families plus common third-party models (Claude, GPT, Gemini,
 * Grok). Falls back to a title-cased split of the raw id.
 */
export function formatCursorModelLabel(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) {
    return id;
  }

  const lower = trimmed.toLowerCase();

  const exact = EXACT_LABELS[lower];
  if (exact) {
    return exact;
  }

  if (lower.includes('claude')) {
    const claudeLabel = formatClaudeLabel(lower);
    if (claudeLabel) {
      return claudeLabel;
    }
  }

  const gptMatch = lower.match(/^gpt-?(\d+(?:\.\d+)?)(?:-(.*))?$/);
  if (gptMatch) {
    const version = gptMatch[1];
    const tail = gptMatch[2];
    if (!tail) {
      return `GPT-${version}`;
    }
    const tailLabel = tail
      .split('-')
      .filter(Boolean)
      .map(titleCaseWord)
      .join(' ');
    return tailLabel ? `GPT-${version} ${tailLabel}` : `GPT-${version}`;
  }

  const geminiMatch = lower.match(/^gemini-?(\d+(?:\.\d+)?)(?:-(.*))?$/);
  if (geminiMatch) {
    const version = geminiMatch[1];
    const tail = geminiMatch[2];
    if (!tail) {
      return `Gemini ${version}`;
    }
    const tailLabel = tail
      .split('-')
      .filter(Boolean)
      .map(titleCaseWord)
      .join(' ');
    return tailLabel ? `Gemini ${version} ${tailLabel}` : `Gemini ${version}`;
  }

  const grokMatch = lower.match(/^grok-?(\d+(?:\.\d+)?)(?:-(.*))?$/);
  if (grokMatch) {
    const version = grokMatch[1];
    const tail = grokMatch[2];
    if (!tail) {
      return `Grok ${version}`;
    }
    const tailLabel = tail
      .split('-')
      .filter(Boolean)
      .map(titleCaseWord)
      .join(' ');
    return tailLabel ? `Grok ${version} ${tailLabel}` : `Grok ${version}`;
  }

  if (lower === 'sonic' || lower.startsWith('sonic-')) {
    return formatGenericLabel(trimmed);
  }

  return formatGenericLabel(trimmed);
}

function formatCursorModeToken(token: string): string {
  const lower = token.toLowerCase();
  if (lower === 'xhigh') return 'XHigh';
  if (!lower) return token;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Display label for a Cursor mode/effort suffix used in the composer dropdown.
 * Compound modes (e.g. `thinking-low-fast`, `extra-high-fast`) render as
 * space-separated title-cased tokens. Recognises `extra-high` as a single
 * concept ("Extra High") even though it lives as two hyphen-separated tokens
 * in the raw id.
 */
export function formatCursorModeLabel(mode: string): string {
  const trimmed = mode.trim();
  if (!trimmed) {
    return mode;
  }
  if (trimmed.toLowerCase() === 'standard') {
    return 'Standard';
  }

  const tokens = trimmed.split('-').filter(Boolean);
  const labelTokens: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i].toLowerCase();
    if (token === 'extra' && tokens[i + 1]?.toLowerCase() === 'high') {
      labelTokens.push('Extra High');
      i += 1;
      continue;
    }
    labelTokens.push(formatCursorModeToken(token));
  }
  return labelTokens.join(' ');
}
