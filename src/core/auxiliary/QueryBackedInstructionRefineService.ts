import { buildRefineSystemPrompt, parseInstructionRefineResponse } from '../prompt/instructionRefine';
import type {
  InstructionRefineService,
  RefineProgressCallback,
} from '../providers/types';
import type { InstructionRefineResult } from '../types';
import { QueryBackedConversationService } from './QueryBackedConversationService';

export class QueryBackedInstructionRefineService
  extends QueryBackedConversationService
  implements InstructionRefineService {
  private existingInstructions = '';

  async refineInstruction(
    rawInstruction: string,
    existingInstructions: string,
    onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    this.resetConversation();
    this.existingInstructions = existingInstructions;
    return this.sendMessage(`Please refine this instruction: "${rawInstruction}"`, onProgress);
  }

  async continueConversation(
    message: string,
    onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    if (!this.hasConversation) {
      return { success: false, error: 'No active conversation to continue' };
    }
    return this.sendMessage(message, onProgress);
  }

  private async sendMessage(
    prompt: string,
    onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    this.abortController = new AbortController();

    try {
      const text = await this.runner.query({
        abortController: this.abortController,
        model: this.modelOverride,
        onTextChunk: onProgress
          ? (accumulatedText: string) => onProgress(parseInstructionRefineResponse(accumulatedText))
          : undefined,
        systemPrompt: buildRefineSystemPrompt(this.existingInstructions),
      }, prompt);
      this.hasConversation = true;
      return parseInstructionRefineResponse(text);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      this.abortController = null;
    }
  }
}
