import { extractString, extractStringArray, parseFrontmatter } from '../../utils/frontmatter';
import {
  QUICK_ACTION_FRONTMATTER_TYPE,
  type QuickAction,
  type QuickActionFrontmatter,
} from './types';

export function parseQuickActionContent(
  content: string,
  filePath: string,
): QuickAction | null {
  const parsed = parseFrontmatter(content);
  const body = parsed?.body?.trim() ?? content.trim();
  if (!body) {
    return null;
  }

  const fm = parsed?.frontmatter ?? {};
  const type = extractString(fm, 'type')?.trim();
  if (type && type !== QUICK_ACTION_FRONTMATTER_TYPE) {
    return null;
  }

  const name = extractString(fm, 'name')?.trim()
    ?? filePathToDefaultName(filePath);
  const description = extractString(fm, 'description')?.trim() ?? name;
  const icon = extractString(fm, 'icon')?.trim() || undefined;
  const tags = extractStringArray(fm, 'tags');

  return {
    id: filePathToId(filePath),
    name,
    description,
    icon,
    tags: tags && tags.length > 0 ? tags : undefined,
    prompt: body,
    filePath,
  };
}

export function serializeQuickAction(action: QuickActionFrontmatter & { prompt: string }): string {
  const lines = ['---'];
  lines.push(`type: ${QUICK_ACTION_FRONTMATTER_TYPE}`);
  lines.push(`name: ${yamlQuote(action.name)}`);
  if (action.description?.trim() && action.description !== action.name) {
    lines.push(`description: ${yamlQuote(action.description.trim())}`);
  }
  if (action.icon?.trim()) {
    lines.push(`icon: ${yamlQuote(action.icon.trim())}`);
  }
  const tags = action.tags?.map((t) => t.trim()).filter(Boolean) ?? [];
  if (tags.length > 0) {
    lines.push('tags:');
    for (const tag of tags) {
      lines.push(`  - ${yamlQuote(tag)}`);
    }
  }
  lines.push('---', '', action.prompt.trim(), '');
  return lines.join('\n');
}

function yamlQuote(value: string): string {
  if (/[:#\n"'[\]{}]/.test(value) || value.startsWith(' ') || value.endsWith(' ')) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

function filePathToDefaultName(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.md$/i, '').replace(/-/g, ' ');
}

function filePathToId(filePath: string): string {
  return filePath.replace(/\.md$/i, '');
}
