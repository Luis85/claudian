// src/features/tools/transpile.ts
import { transform } from 'sucrase';

export function transpileToolSource(source: string): string {
  return transform(source, {
    transforms: ['typescript', 'imports'],
    filePath: 'tool.ts',
  }).code;
}
