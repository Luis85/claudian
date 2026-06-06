/**
 * Exhaustiveness guard for discriminated-union switches. The compiler narrows
 * the value to `never` only after every variant is handled; if a new variant
 * is added without a matching `case`, `assertNever` becomes a typecheck error
 * at the call site. The thrown runtime error is a backstop, not the primary
 * mechanism — the contract is enforced at build time.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled discriminated-union variant: ${JSON.stringify(value)}`);
}
