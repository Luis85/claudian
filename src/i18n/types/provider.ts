export type ProviderTranslationKey =
  // Provider - Claude plugin manager notices (Q-1 chunk 16)
  | 'provider.claude.plugin.toggleTabRestartFailed'
  | 'provider.claude.plugin.enabled'
  | 'provider.claude.plugin.disabled'
  | 'provider.claude.plugin.toggleFailed'
  | 'provider.claude.plugin.listRefreshed'
  | 'provider.claude.plugin.refreshFailed'
  | 'provider.claude.plugin.malformedEntry'

  // Provider - Claude background task notices (Q-1 chunk 16)
  | 'provider.claude.task.resultRenderFailed'

  // Provider - Cursor CLI + model discovery notices (Q-1 chunk 16)
  | 'provider.cursor.cli.notFound'
  | 'provider.cursor.models.noModels'
  | 'provider.cursor.models.discoveredOne'
  | 'provider.cursor.models.discoveredMany'
  | 'provider.cursor.models.refreshFailed'

  // Provider - Opencode subagent notices (Q-1 chunk 4)
  | 'provider.opencode.subagent.descriptionRequired'
  | 'provider.opencode.subagent.promptRequired'
  | 'provider.opencode.subagent.duplicate'
  | 'provider.opencode.subagent.saveFailed'
  | 'provider.opencode.subagent.deleted'
  | 'provider.opencode.subagent.deleteFailed'
  | 'provider.opencode.subagent.updated'
  | 'provider.opencode.subagent.created'

  // Provider - Opencode subagent name validation (Q-1 follow-up)
  | 'provider.opencode.subagent.validation.required'
  | 'provider.opencode.subagent.validation.slashSegments'
  | 'provider.opencode.subagent.validation.emptySegment'
  | 'provider.opencode.subagent.validation.whitespaceSegment'
  | 'provider.opencode.subagent.validation.dotSegment'
  | 'provider.opencode.subagent.validation.reservedChars'

  // Provider - Codex subagent notices (Q-1 chunk 8)
  | 'provider.codex.subagent.descriptionRequired'
  | 'provider.codex.subagent.developerInstructionsRequired'
  | 'provider.codex.subagent.duplicate'
  | 'provider.codex.subagent.saveFailed'
  | 'provider.codex.subagent.deleted'
  | 'provider.codex.subagent.deleteFailed'
  | 'provider.codex.subagent.updated'
  | 'provider.codex.subagent.created'

  // Provider - Codex subagent name + nickname validation (Q-1 follow-up)
  | 'provider.codex.subagent.validation.required'
  | 'provider.codex.subagent.validation.tooLong'
  | 'provider.codex.subagent.validation.invalidChars'
  | 'provider.codex.subagent.validation.nicknameInvalidChars'
  | 'provider.codex.subagent.validation.nicknameDuplicate'

  // Provider - Codex skill notices (Q-1 chunk 11)
  | 'provider.codex.skill.instructionsRequired'
  | 'provider.codex.skill.saveFailed'
  | 'provider.codex.skill.deleteFailed'
  | 'provider.codex.skill.deleted'
  | 'provider.codex.skill.updated'
  | 'provider.codex.skill.created'

  // Provider - Cursor subagent notices
  | 'provider.cursor.subagent.saved'
  | 'provider.cursor.subagent.saveFailed'
  | 'provider.cursor.subagent.deleted'
  | 'provider.cursor.subagent.deleteFailed'
  | 'provider.cursor.subagent.duplicate'
  | 'provider.cursor.subagent.descriptionRequired'
  | 'provider.cursor.subagent.nameRequired'
  | 'provider.cursor.subagent.nameWhitespace'
  | 'provider.cursor.subagent.nameDotSegment'
  | 'provider.cursor.subagent.nameReservedChars';
