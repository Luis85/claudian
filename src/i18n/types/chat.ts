export type ChatTranslationKey =
  // Chat
  | 'chat.loadEarlier'
  | 'chat.history.showMore'
  | 'chat.history.loadFailed'
  | 'chat.history.regenerateFailed'
  | 'chat.history.deleteFailed'
  | 'chat.history.renameFailed'
  | 'chat.history.linkedNotFound'
  | 'chat.history.linkedNoFreeTab'
  | 'chat.history.loading'

  // Chat - File / folder context commands (Q-1 chunk 9, main.ts entries)
  | 'chat.context.fileNoTab'
  | 'chat.context.folderNoTab'
  | 'chat.context.fileAttachFailed'
  | 'chat.context.folderAttachFailed'
  | 'chat.context.fileAdded'
  | 'chat.context.folderAdded'

  // Chat - Drag and drop
  | 'chat.drop.image'
  | 'chat.drop.fileContext'
  | 'chat.drop.folderContext'
  | 'chat.drop.osContext'
  | 'chat.drop.mixed'
  | 'chat.drop.batchAdded'
  | 'chat.drop.batchSkipped'
  | 'chat.drop.externalFolderUnsupported'
  | 'chat.drop.outsideContext'
  | 'chat.drop.outsideContextBatch'
  | 'chat.drop.imageFailed'

  // Chat - Storage (Q-1 chunk 15)
  | 'chat.storage.tabLayoutSaveFailed'

  // Chat - Bang-bash command (Q-1 chunk 16)
  | 'chat.bangBash.commandFailed'

  // Chat - Tabs (Q-1 chunk 13)
  | 'chat.tab.createFailed'
  | 'chat.tab.createConversationFailed'
  | 'chat.tab.switchFailed'
  | 'chat.tab.closeFailed'
  | 'chat.tab.maxReached'
  | 'chat.tab.providerSwitchBlocked'

  // Chat - External context (Q-1 chunk 13)
  | 'chat.externalContext.invalidRemoved'
  | 'chat.externalContext.persistFailed'
  | 'chat.externalContext.duplicate'
  | 'chat.externalContext.pickerFailed'

  // Chat - Image attachments (Q-1 chunk 13)
  | 'chat.image.unsupported'
  | 'chat.image.unavailable'

  // Chat - File open (Q-1 chunk 13)
  | 'chat.fileOpen.notFound'
  | 'chat.fileOpen.failed'

  // Chat - Files changed by the agent (edited-files strip)
  | 'chat.editedFiles.label'

  // Chat - Rewind
  | 'chat.rewind.confirmMessage'
  | 'chat.rewind.confirmMessageConversationOnly'
  | 'chat.rewind.confirmButton'
  | 'chat.rewind.ariaLabel'
  | 'chat.rewind.menuConversationOnly'
  | 'chat.rewind.menuCodeAndConversation'
  | 'chat.rewind.notice'
  | 'chat.rewind.noticeConversationOnly'
  | 'chat.rewind.noticeSaveFailed'
  | 'chat.rewind.noticeConversationOnlySaveFailed'
  | 'chat.rewind.failed'
  | 'chat.rewind.cannot'
  | 'chat.rewind.unavailableStreaming'
  | 'chat.rewind.unavailableNoUuid'
  | 'chat.rewind.errMessageNotFound'
  | 'chat.rewind.errServiceUnavailable'
  | 'chat.rewind.errUnknown'
  | 'chat.rewind.errUnsupported'
  | 'chat.bangBash.placeholder'
  | 'chat.bangBash.commandPanel'
  | 'chat.bangBash.copyAriaLabel'
  | 'chat.bangBash.clearAriaLabel'
  | 'chat.bangBash.commandLabel'
  | 'chat.bangBash.statusLabel'
  | 'chat.bangBash.collapseOutput'
  | 'chat.bangBash.expandOutput'
  | 'chat.bangBash.running'
  | 'chat.bangBash.copyFailed'

  // Chat - Fork
  | 'chat.fork.ariaLabel'
  | 'chat.fork.chooseTarget'
  | 'chat.fork.targetNewTab'
  | 'chat.fork.targetCurrentTab'
  | 'chat.fork.maxTabsReached'
  | 'chat.fork.notice'
  | 'chat.fork.noticeCurrentTab'
  | 'chat.fork.failed'
  | 'chat.fork.unavailableStreaming'
  | 'chat.fork.unavailableNoUuid'
  | 'chat.fork.unavailableNoResponse'
  | 'chat.fork.errorMessageNotFound'
  | 'chat.fork.errorNoSession'
  | 'chat.fork.errorNoActiveTab'
  | 'chat.fork.commandNoMessages'
  | 'chat.fork.commandNoAssistantUuid'
  | 'chat.fork.unsupportedProvider'

  // Chat - Plan mode
  | 'chat.planMode.ariaLabel'
  | 'chat.planMode.titleInactive'
  | 'chat.planMode.titleActive'
  | 'chat.planMode.toggleFailed'

  // Chat - Permission mode
  | 'chat.permissionMode.yoloWarning'

  // Chat - Feedback (thumbs up / down on assistant responses)
  | 'chat.feedback.thumbsUp.label'
  | 'chat.feedback.thumbsUp.prompt'
  | 'chat.feedback.thumbsDown.label'
  | 'chat.feedback.thumbsDown.prompt'

  // Chat - Queued message
  | 'chat.queue.steerFailed'

  // Chat - Input controller notices (Q-1 routing through t())
  | 'chat.input.initFailed'
  | 'chat.input.serviceUnavailable'
  | 'chat.input.instructionAdded'
  | 'chat.input.processResponseFailed'
  | 'chat.input.refineFailed'
  | 'chat.input.noInstruction'
  | 'chat.input.unexpectedApprovalSelection'
  | 'chat.input.commandUnsupported'
  | 'chat.input.externalContextUnavailable'
  | 'chat.input.externalContextAdded'
  | 'chat.input.forkUnsupported'
  | 'chat.input.forkUnavailable'
  | 'chat.input.unknownCommand'
  | 'chat.input.noConversationsToResume'
  | 'chat.input.openConversationFailed'
  | 'chat.input.chatServiceInitFailed'

  // Chat - Actionable runtime error cards (UX-F/UX-J)
  | 'chat.runtimeError.cliNotFound.title'
  | 'chat.runtimeError.cliNotFound.body'
  | 'chat.runtimeError.cliNotFound.openSettings'
  | 'chat.runtimeError.unauthenticated.title'
  | 'chat.runtimeError.unauthenticated.body'
  | 'chat.runtimeError.unauthenticated.hintLabel'
  | 'chat.runtimeError.unauthenticated.claudeHint'
  | 'chat.runtimeError.unauthenticated.codexHint'
  | 'chat.runtimeError.unauthenticated.cursorHint'
  | 'chat.runtimeError.unauthenticated.opencodeHint'
  | 'chat.runtimeError.unauthenticated.genericHint'
  | 'chat.runtimeError.unauthenticated.copyHint'
  | 'chat.runtimeError.unauthenticated.copied'
  | 'chat.runtimeError.unauthenticated.openSettings'
  | 'chat.runtimeError.contextTooLarge.title'
  | 'chat.runtimeError.contextTooLarge.body'
  | 'chat.runtimeError.generic.title'
  | 'chat.runtimeError.retry'
  | 'chat.runtimeError.detailsLabel'
  | 'chat.tabs.maxChatReached'
  | 'chat.tabs.maxWorkOrderReached'
  | 'chat.tabs.workOrderSuffix';
