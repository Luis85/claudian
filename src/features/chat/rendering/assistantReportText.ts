import type { ChatMessage } from '../../../core/types';

export interface AssistantReportText {
  text: string;
  hadStreamError: boolean;
}

/** Text to report to orchestrator workers / synthesis after a turn ends. */
export function collectAssistantReportText(msg: ChatMessage): AssistantReportText {
  const fromContent = msg.content.trim();
  if (fromContent) {
    return {
      text: fromContent,
      hadStreamError: fromContent.includes('❌ **Error:**'),
    };
  }

  const fromBlocks = (msg.contentBlocks ?? [])
    .filter((block): block is { type: 'text'; content: string } => block.type === 'text')
    .map((block) => block.content)
    .join('\n\n')
    .trim();

  return {
    text: fromBlocks,
    hadStreamError: fromBlocks.includes('❌ **Error:**'),
  };
}
