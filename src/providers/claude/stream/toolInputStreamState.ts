type JsonTokenType = 'brace' | 'bracket' | 'separator' | 'delimiter' | 'string' | 'number' | 'name';

type JsonToken = {
  type: JsonTokenType;
  value: string;
};

type ToolUseSnapshot = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  partialJson: string;
};

type ToolUseFields = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export interface TransformStreamState {
  registerToolUse(parentToolUseId: string | null, index: number, toolUse: ToolUseFields): void;
  applyInputJsonDelta(parentToolUseId: string | null, index: number, partialJson: string): ToolUseFields | null;
  clearContentBlock(parentToolUseId: string | null, index: number): void;
  clearParent(parentToolUseId: string | null): void;
  clearAll(): void;
}

const MAIN_AGENT_STREAM = '__main__';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeToolInput(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function getContentBlockKey(parentToolUseId: string | null, index: number): string {
  return `${parentToolUseId ?? MAIN_AGENT_STREAM}:${index}`;
}

function getParentPrefix(parentToolUseId: string | null): string {
  return `${parentToolUseId ?? MAIN_AGENT_STREAM}:`;
}

function findClosingTokenIndex(tokens: JsonToken[], value: string): number {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (tokens[index]?.value === value) {
      return index;
    }
  }
  return -1;
}

const PUNCTUATION_TOKEN_TYPES: Readonly<Record<string, JsonTokenType | undefined>> = {
  '{': 'brace',
  '}': 'brace',
  '[': 'bracket',
  ']': 'bracket',
  ':': 'separator',
  ',': 'delimiter',
};

function isNumberStartChar(char: string): boolean {
  return /[0-9]/.test(char) || char === '-' || char === '.';
}

/**
 * Consumes one string literal starting at the opening quote. Pushes a token
 * only when the closing quote was reached (a dangling string is dropped so
 * the repaired JSON stays parseable). Returns the index just past the
 * consumed characters — each character is visited exactly once.
 */
function scanStringToken(input: string, startIndex: number, tokens: JsonToken[]): number {
  let index = startIndex + 1;
  let value = '';

  while (index < input.length && input[index] !== '"') {
    const char = input[index] ?? '';
    if (char === '\\') {
      value += char + (input[index + 1] ?? '');
      index += 2;
    } else {
      value += char;
      index += 1;
    }
  }

  const isDanglingString = index >= input.length;
  index += 1;
  if (!isDanglingString) {
    tokens.push({ type: 'string', value });
  }
  return index;
}

function scanNumberToken(input: string, startIndex: number, tokens: JsonToken[]): number {
  let index = startIndex;
  let value = '';
  let char = input[index] ?? '';

  if (char === '-') {
    value += char;
    index += 1;
    char = input[index] ?? '';
  }

  while (/[0-9]/.test(char) || char === '.') {
    value += char;
    index += 1;
    char = input[index] ?? '';
  }

  tokens.push({ type: 'number', value });
  return index;
}

function scanNameToken(input: string, startIndex: number, tokens: JsonToken[]): number {
  let index = startIndex;
  let value = '';
  let char = input[index] ?? '';

  while (/[a-z]/i.test(char)) {
    value += char;
    index += 1;
    char = input[index] ?? '';
  }

  if (value === 'true' || value === 'false' || value === 'null') {
    tokens.push({ type: 'name', value });
  } else {
    // Unknown bare word: skip the delimiter that stopped the scan too, so a
    // malformed run cannot stall the tokenizer.
    index += 1;
  }
  return index;
}

function tokenizePartialJson(input: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index] ?? '';
    const punctuationType = PUNCTUATION_TOKEN_TYPES[char];

    if (punctuationType) {
      tokens.push({ type: punctuationType, value: char });
      index += 1;
    } else if (char === '"') {
      index = scanStringToken(input, index, tokens);
    } else if (isNumberStartChar(char)) {
      index = scanNumberToken(input, index, tokens);
    } else if (/[a-z]/i.test(char)) {
      index = scanNameToken(input, index, tokens);
    } else {
      // Whitespace, stray top-level backslashes, and any other noise advance
      // by one character; the next iteration re-dispatches on what follows.
      index += 1;
    }
  }

  return tokens;
}

function stripIncompleteTail(tokens: JsonToken[]): JsonToken[] {
  if (tokens.length === 0) {
    return tokens;
  }

  const lastToken = tokens[tokens.length - 1];
  if (!lastToken) {
    return tokens;
  }

  switch (lastToken.type) {
    case 'separator':
    case 'delimiter':
      return stripIncompleteTail(tokens.slice(0, -1));
    case 'number': {
      const lastChar = lastToken.value[lastToken.value.length - 1];
      return lastChar === '.' || lastChar === '-'
        ? stripIncompleteTail(tokens.slice(0, -1))
        : tokens;
    }
    case 'string': {
      const previousToken = tokens[tokens.length - 2];
      if (previousToken?.type === 'delimiter') {
        return stripIncompleteTail(tokens.slice(0, -1));
      }
      if (previousToken?.type === 'brace' && previousToken.value === '{') {
        return stripIncompleteTail(tokens.slice(0, -1));
      }
      return tokens;
    }
    default:
      return tokens;
  }
}

function dropPendingClosingToken(closingTokens: JsonToken[], closingValue: string): void {
  const closingIndex = findClosingTokenIndex(closingTokens, closingValue);
  if (closingIndex >= 0) {
    closingTokens.splice(closingIndex, 1);
  }
}

// Tracks one container token against the pending stack: an opener pushes its
// matching closer, a closer cancels the nearest pending closer.
function trackContainerToken(closingTokens: JsonToken[], token: JsonToken): void {
  if (token.type === 'brace') {
    if (token.value === '{') {
      closingTokens.push({ type: 'brace', value: '}' });
    } else {
      dropPendingClosingToken(closingTokens, '}');
    }
    return;
  }

  if (token.type === 'bracket') {
    if (token.value === '[') {
      closingTokens.push({ type: 'bracket', value: ']' });
    } else {
      dropPendingClosingToken(closingTokens, ']');
    }
  }
}

function appendPendingClosingTokens(completedTokens: JsonToken[], closingTokens: JsonToken[]): void {
  for (let index = closingTokens.length - 1; index >= 0; index -= 1) {
    const token = closingTokens[index];
    if (token) {
      completedTokens.push(token);
    }
  }
}

function closeOpenContainers(tokens: JsonToken[]): JsonToken[] {
  const completedTokens = [...tokens];
  const closingTokens: JsonToken[] = [];

  for (const token of completedTokens) {
    trackContainerToken(closingTokens, token);
  }

  appendPendingClosingTokens(completedTokens, closingTokens);
  return completedTokens;
}

function renderJson(tokens: JsonToken[]): string {
  return tokens
    .map((token) => token.type === 'string' ? `"${token.value}"` : token.value)
    .join('');
}

function parsePartialToolInput(input: string): Record<string, unknown> | null {
  const tokens = tokenizePartialJson(input);
  if (tokens.length === 0) {
    return {};
  }

  try {
    const repairedJson = renderJson(closeOpenContainers(stripIncompleteTail(tokens)));
    return normalizeToolInput(JSON.parse(repairedJson));
  } catch {
    return null;
  }
}

export function createTransformStreamState(): TransformStreamState {
  const activeToolUses = new Map<string, ToolUseSnapshot>();

  return {
    registerToolUse(parentToolUseId, index, toolUse) {
      activeToolUses.set(getContentBlockKey(parentToolUseId, index), {
        ...toolUse,
        input: { ...toolUse.input },
        partialJson: '',
      });
    },
    applyInputJsonDelta(parentToolUseId, index, partialJson) {
      const snapshot = activeToolUses.get(getContentBlockKey(parentToolUseId, index));
      if (!snapshot) {
        return null;
      }

      snapshot.partialJson += partialJson;
      const parsedInput = parsePartialToolInput(snapshot.partialJson);
      if (parsedInput === null) {
        return null;
      }

      snapshot.input = {
        ...snapshot.input,
        ...parsedInput,
      };

      return {
        id: snapshot.id,
        name: snapshot.name,
        input: { ...snapshot.input },
      };
    },
    clearContentBlock(parentToolUseId, index) {
      activeToolUses.delete(getContentBlockKey(parentToolUseId, index));
    },
    clearParent(parentToolUseId) {
      const parentPrefix = getParentPrefix(parentToolUseId);
      for (const key of activeToolUses.keys()) {
        if (key.startsWith(parentPrefix)) {
          activeToolUses.delete(key);
        }
      }
    },
    clearAll() {
      activeToolUses.clear();
    },
  };
}
