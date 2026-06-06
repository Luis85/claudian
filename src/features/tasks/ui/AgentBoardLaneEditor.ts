import { Notice, Setting } from 'obsidian';

import { asSettingsBag } from '../../../core/types/settings';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { loadBoardConfig } from '../config/BoardConfigStore';
import { type BoardConfig, type BoardLaneConfig,DEFAULT_BOARD_CONFIG } from '../config/boardConfigTypes';
import { TASK_STATUSES } from '../model/taskStateMachine';
import type { TaskStatus } from '../model/taskTypes';

function cloneConfig(config: BoardConfig): BoardConfig {
  return JSON.parse(JSON.stringify(config)) as BoardConfig;
}

interface StatusOccurrence {
  laneIndex: number;
  laneTitle: string;
}

// Maps each status to every VISIBLE lane that currently claims it. Only visible
// lanes participate in board routing (`resolveBoardLayout` filters by
// `lane.visible` before its first-wins lookup), so the duplicate hint must use
// the same filter — otherwise hiding the canonical lane would make routing
// move silently to the next visible owner while the editor kept naming the
// hidden one.
function computeStatusOccurrences(config: BoardConfig): Map<TaskStatus, StatusOccurrence[]> {
  const map = new Map<TaskStatus, StatusOccurrence[]>();
  config.lanes.forEach((lane, laneIndex) => {
    if (!lane.visible) return;
    for (const status of lane.statuses) {
      const list = map.get(status) ?? [];
      list.push({ laneIndex, laneTitle: lane.title });
      map.set(status, list);
    }
  });
  return map;
}

export function renderAgentBoardLaneEditor(container: HTMLElement, plugin: ClaudianPlugin): void {
  const settings = asSettingsBag(plugin.settings);
  let config = cloneConfig(loadBoardConfig(settings).config);

  const wrap = container.createDiv({ cls: 'claudian-lane-editor' });

  // `data-focus-key` is set on every interactive widget and read back after
  // `rerender()` to restore keyboard focus to the just-clicked checkbox or
  // title input. Without this, every status toggle dropped focus to the body
  // and made keyboard navigation impossible.
  let pendingFocusKey: string | null = null;

  // `persist` accepts the pre-mutation `config` snapshot and rolls back the
  // editor's in-memory state if `saveSettings` rejects, then surfaces the
  // error via a Notice. The old code awaited `saveSettings` without catching,
  // which left the editor desynced from disk and produced an unhandled
  // promise rejection on every save failure.
  const persist = async (snapshot: BoardConfig): Promise<boolean> => {
    // The lane editor owns lanes only; queue.paused is toggled from the Agent
    // Board and can change while this pane is open. Re-read the live queue at
    // both save and roll-back time so a pause set elsewhere is never clobbered
    // by the queue captured when the pane opened.
    const liveQueue = loadBoardConfig(asSettingsBag(plugin.settings)).config.queue;
    config.queue = liveQueue;
    plugin.settings.agentBoardConfig = config;
    try {
      await plugin.saveSettings();
      plugin.events.emit('task:board-config-changed');
      return true;
    } catch (error) {
      // Roll back the lanes but keep the live queue so a failed write does not
      // leave the live settings desynced from disk or revert an unrelated pause.
      config = { ...snapshot, queue: liveQueue };
      plugin.settings.agentBoardConfig = config;
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t('tasks.board.laneSaveFailed', { error: message }));
      return false;
    }
  };

  const swap = (a: number, b: number): void => {
    const lanes = config.lanes;
    [lanes[a], lanes[b]] = [lanes[b], lanes[a]];
  };

  const renderLaneBlock = (
    lane: BoardLaneConfig,
    index: number,
    occurrences: Map<TaskStatus, StatusOccurrence[]>,
  ): void => {
    const block = wrap.createDiv({ cls: 'claudian-lane-editor-lane' });
    block.dataset.laneId = lane.id;

    // Use the lane's own title as the row header so users can identify the
    // lane after reorder. Positional names like `Lane ${index + 1}` lied after
    // any move-up / move-down click.
    const headName = lane.title.trim().length > 0 ? lane.title : 'Untitled lane';
    const head = new Setting(block).setName(headName).setDesc('Title and whether the lane shows on the board.');
    head.addText((text) => {
      text
        .setValue(lane.title)
        .onChange(async (value) => {
          const snapshot = cloneConfig(config);
          lane.title = value;
          await persist(snapshot);
        });
      text.inputEl.dataset.focusKey = `lane:${lane.id}:title`;
      // Refresh duplicate hints only after the user is done typing so we do
      // not destroy the input mid-keystroke. `onChange` already persists each
      // keystroke; `blur` is the natural commit signal.
      text.inputEl.addEventListener('blur', () => rerender());
    });
    head.addToggle((toggle) =>
      toggle.setValue(lane.visible).onChange(async (value) => {
        const snapshot = cloneConfig(config);
        lane.visible = value;
        const ok = await persist(snapshot);
        if (ok) {
          // Visibility changes the visible-only occurrence map, so duplicate
          // hints in other lanes need to be recomputed. Without this, hiding
          // the canonical lane would silently reroute work orders while the
          // editor kept naming the hidden lane.
          rerender();
        }
      }),
    );
    head.addExtraButton((btn) =>
      btn
        .setIcon('arrow-up')
        .setTooltip('Move up')
        .onClick(async () => {
          if (index === 0) return;
          const snapshot = cloneConfig(config);
          swap(index - 1, index);
          const ok = await persist(snapshot);
          if (ok) rerender();
        }),
    );
    head.addExtraButton((btn) =>
      btn
        .setIcon('arrow-down')
        .setTooltip('Move down')
        .onClick(async () => {
          if (index >= config.lanes.length - 1) return;
          const snapshot = cloneConfig(config);
          swap(index + 1, index);
          const ok = await persist(snapshot);
          if (ok) rerender();
        }),
    );
    head.addExtraButton((btn) =>
      btn
        .setIcon('trash-2')
        .setTooltip('Remove lane')
        .onClick(async () => {
          const snapshot = cloneConfig(config);
          config.lanes.splice(index, 1);
          const ok = await persist(snapshot);
          if (ok) rerender();
        }),
    );

    const statusRow = block.createDiv({ cls: 'claudian-lane-editor-statuses' });
    const conflicts: Array<{ status: TaskStatus; canonicalTitle: string }> = [];

    for (const status of TASK_STATUSES) {
      const label = statusRow.createEl('label', { cls: 'claudian-lane-editor-status' });
      const checkbox = label.createEl('input', { type: 'checkbox' });
      checkbox.dataset.focusKey = `lane:${lane.id}:status:${status}`;
      const isChecked = lane.statuses.includes(status);
      checkbox.checked = isChecked;
      checkbox.addEventListener('change', async () => {
        const snapshot = cloneConfig(config);
        if (checkbox.checked) {
          if (!lane.statuses.includes(status)) lane.statuses.push(status);
        } else {
          lane.statuses = lane.statuses.filter((value) => value !== status);
        }
        const ok = await persist(snapshot);
        if (ok) {
          // Restore focus to the same checkbox after the rebuild so keyboard
          // users keep their place. The DOM node is replaced, but the
          // `data-focus-key` selector finds the new instance.
          pendingFocusKey = `lane:${lane.id}:status:${status}`;
          rerender();
        }
      });
      label.createSpan({ text: status });

      // Non-canonical occurrences (this lane is not the first VISIBLE one that
      // claims the status) get a marker class and feed into the per-lane
      // combined hint below. We deliberately do NOT add a per-status hint span
      // inside the `<label>` — screen readers would read it as part of the
      // checkbox label ("ready Routed to …"), and a lane with many duplicates
      // would render as an unreadable wall of italics. The label's `title`
      // attribute still surfaces a per-status tooltip for sighted users.
      if (isChecked && lane.visible) {
        const owners = occurrences.get(status) ?? [];
        if (owners.length > 1 && owners[0].laneIndex !== index) {
          label.classList.add('claudian-lane-editor-status--duplicate');
          label.setAttribute('title', `Routed to "${owners[0].laneTitle}"`);
          conflicts.push({ status, canonicalTitle: owners[0].laneTitle });
        }
      }
    }

    if (conflicts.length > 0) {
      // Single lane-level note that lists every duplicate status with the
      // lane the board actually routes to. `role="note"` keeps screen readers
      // from confusing it with the status checkboxes. A leading warning icon
      // gives a non-colour cue.
      const hint = block.createDiv({ cls: 'claudian-lane-editor-status-hint' });
      hint.setAttribute('role', 'note');
      const summary = conflicts
        .map((entry) => `${entry.status} → "${entry.canonicalTitle}"`)
        .join(', ');
      hint.textContent = `⚠ Routed elsewhere: ${summary}`;
    }

    renderCriteria(block, 'Definition of ready', lane.definitionOfReady, async (lines) => {
      const snapshot = cloneConfig(config);
      lane.definitionOfReady = lines;
      await persist(snapshot);
    });
    renderCriteria(block, 'Definition of done', lane.definitionOfDone, async (lines) => {
      const snapshot = cloneConfig(config);
      lane.definitionOfDone = lines;
      await persist(snapshot);
    });
  };

  const rerender = (): void => {
    wrap.empty();
    const occurrences = computeStatusOccurrences(config);
    config.lanes.forEach((lane, index) => renderLaneBlock(lane, index, occurrences));

    new Setting(wrap)
      .addButton((btn) =>
        btn.setButtonText('Add lane').onClick(async () => {
          const snapshot = cloneConfig(config);
          const newId = `lane-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
          config.lanes.push({
            id: newId,
            title: 'New lane',
            statuses: [],
            visible: true,
            definitionOfReady: [],
            definitionOfDone: [],
          });
          const ok = await persist(snapshot);
          if (ok) {
            pendingFocusKey = `lane:${newId}:title`;
            rerender();
          }
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText('Reset to default')
          .setWarning()
          .onClick(async () => {
            const snapshot = cloneConfig(config);
            config = cloneConfig(DEFAULT_BOARD_CONFIG);
            const ok = await persist(snapshot);
            if (ok) rerender();
          }),
      );

    if (pendingFocusKey !== null) {
      const selector = `[data-focus-key="${pendingFocusKey.replace(/"/g, '\\"')}"]`;
      const target = wrap.querySelector<HTMLElement>(selector);
      pendingFocusKey = null;
      target?.focus();
    }
  };

  rerender();
}

function renderCriteria(
  parent: HTMLElement,
  label: string,
  lines: string[],
  onChange: (lines: string[]) => Promise<void>,
): void {
  new Setting(parent).setName(label).addTextArea((area) => {
    area.setValue(lines.join('\n'));
    area.onChange(async (value) => {
      await onChange(
        value
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      );
    });
  });
}
