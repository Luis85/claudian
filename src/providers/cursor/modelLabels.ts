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

function formatGenericLabel(id: string): string {
  return id
    .split(/[-_/.]/)
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

  const gptMatch = lower.match(/^gpt-?(\d+(?:\.\d+)?)/);
  if (gptMatch) {
    return `GPT-${gptMatch[1]}`;
  }

  const geminiMatch = lower.match(/^gemini-?(\d+(?:\.\d+)?)(?:-?(pro|flash|ultra))?/);
  if (geminiMatch) {
    const tier = geminiMatch[2]
      ? ` ${geminiMatch[2].charAt(0).toUpperCase()}${geminiMatch[2].slice(1)}`
      : '';
    return `Gemini ${geminiMatch[1]}${tier}`;
  }

  const grokMatch = lower.match(/^grok-?(\d+(?:\.\d+)?)/);
  if (grokMatch) {
    return `Grok ${grokMatch[1]}`;
  }

  if (lower === 'sonic' || lower.startsWith('sonic-')) {
    return formatGenericLabel(trimmed);
  }

  return formatGenericLabel(trimmed);
}

/** Display label for a Cursor mode/effort suffix used in the composer dropdown. */
export function formatCursorModeLabel(mode: string): string {
  const trimmed = mode.trim();
  if (!trimmed) {
    return mode;
  }
  if (trimmed.toLowerCase() === 'standard') {
    return 'Standard';
  }
  if (trimmed.toLowerCase() === 'xhigh') {
    return 'XHigh';
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}
