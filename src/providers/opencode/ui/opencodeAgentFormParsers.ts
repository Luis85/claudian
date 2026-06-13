export function parseOptionalNumber(
  value: string,
  label: string,
): { error?: string; value?: number } {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { error: `${label} must be a valid number` };
  }

  return { value: parsed };
}

export function parseOptionalPositiveInteger(
  value: string,
  label: string,
): { error?: string; value?: number } {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { error: `${label} must be a positive integer` };
  }

  return { value: parsed };
}

export function parseOptionalJson(
  value: string,
  label: string,
): { error?: string; value?: unknown } {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return { value: JSON.parse(trimmed) };
  } catch {
    return { error: `${label} must be valid JSON` };
  }
}

export function parseOptionalJsonObject(
  value: string,
  label: string,
): { error?: string; value?: Record<string, unknown> } {
  const parsed = parseOptionalJson(value, label);
  if (parsed.error || parsed.value === undefined) {
    return parsed.error ? { error: parsed.error } : {};
  }

  if (!isJsonObject(parsed.value)) {
    return { error: `${label} must be a JSON object` };
  }

  return { value: parsed.value };
}

export function parseOptionalJsonObjectOfBooleans(
  value: string,
  label: string,
): { error?: string; value?: Record<string, boolean> } {
  const parsed = parseOptionalJsonObject(value, label);
  if (parsed.error || parsed.value === undefined) {
    return parsed.error ? { error: parsed.error } : {};
  }

  if (!Object.values(parsed.value).every((entry) => typeof entry === 'boolean')) {
    return { error: `${label} must map tool names to boolean values` };
  }

  return { value: parsed.value as Record<string, boolean> };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
