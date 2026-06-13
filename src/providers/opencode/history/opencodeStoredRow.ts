import type { ToolCallInfo } from '../../../core/types';

export type StoredRow = Record<string, unknown>;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getBoolean(value: unknown): boolean {
  return value === true;
}

export function getObject(value: unknown): StoredRow | null {
  return isPlainObject(value) ? value : null;
}

export function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function getNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

export function getNestedNumber(value: StoredRow, keys: string[]): number | null {
  let current: unknown = value;
  for (const key of keys) {
    if (!isPlainObject(current)) {
      return null;
    }
    current = current[key];
  }
  return getNumber(current);
}

export function mapToolStatus(status: string | null): ToolCallInfo['status'] | null {
  switch (status) {
    case 'pending':
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'error':
      return 'error';
    default:
      return null;
  }
}
