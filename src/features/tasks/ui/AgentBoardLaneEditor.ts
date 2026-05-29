import { Setting } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import { loadBoardConfig } from '../config/BoardConfigStore';
import { type BoardConfig, type BoardLaneConfig,DEFAULT_BOARD_CONFIG } from '../config/boardConfigTypes';
import { TASK_STATUSES } from '../model/taskStateMachine';

function cloneConfig(config: BoardConfig): BoardConfig {
  return JSON.parse(JSON.stringify(config)) as BoardConfig;
}

export function renderAgentBoardLaneEditor(container: HTMLElement, plugin: ClaudianPlugin): void {
  const settings = plugin.settings as unknown as Record<string, unknown>;
  let config = cloneConfig(loadBoardConfig(settings).config);

  const wrap = container.createDiv({ cls: 'claudian-lane-editor' });

  const persist = async (): Promise<void> => {
    plugin.settings.agentBoardConfig = config;
    await plugin.saveSettings();
    plugin.events.emit('task:board-config-changed');
  };

  const swap = (a: number, b: number): void => {
    const lanes = config.lanes;
    [lanes[a], lanes[b]] = [lanes[b], lanes[a]];
  };

  const renderLaneBlock = (lane: BoardLaneConfig, index: number): void => {
    const block = wrap.createDiv({ cls: 'claudian-lane-editor-lane' });

    const head = new Setting(block).setName(`Lane ${index + 1}`).setDesc('Title and whether the lane shows on the board.');
    head.addText((text) =>
      text.setValue(lane.title).onChange(async (value) => {
        lane.title = value;
        await persist();
      }),
    );
    head.addToggle((toggle) =>
      toggle.setValue(lane.visible).onChange(async (value) => {
        lane.visible = value;
        await persist();
      }),
    );
    head.addExtraButton((btn) =>
      btn
        .setIcon('arrow-up')
        .setTooltip('Move up')
        .onClick(async () => {
          if (index === 0) return;
          swap(index - 1, index);
          await persist();
          rerender();
        }),
    );
    head.addExtraButton((btn) =>
      btn
        .setIcon('arrow-down')
        .setTooltip('Move down')
        .onClick(async () => {
          if (index >= config.lanes.length - 1) return;
          swap(index + 1, index);
          await persist();
          rerender();
        }),
    );
    head.addExtraButton((btn) =>
      btn
        .setIcon('trash-2')
        .setTooltip('Remove lane')
        .onClick(async () => {
          config.lanes.splice(index, 1);
          await persist();
          rerender();
        }),
    );

    const statusRow = block.createDiv({ cls: 'claudian-lane-editor-statuses' });
    for (const status of TASK_STATUSES) {
      const label = statusRow.createEl('label', { cls: 'claudian-lane-editor-status' });
      const checkbox = label.createEl('input', { type: 'checkbox' });
      checkbox.checked = lane.statuses.includes(status);
      checkbox.addEventListener('change', async () => {
        if (checkbox.checked) {
          if (!lane.statuses.includes(status)) lane.statuses.push(status);
        } else {
          lane.statuses = lane.statuses.filter((value) => value !== status);
        }
        await persist();
      });
      label.createSpan({ text: status });
    }

    renderCriteria(block, 'Definition of ready', lane.definitionOfReady, async (lines) => {
      lane.definitionOfReady = lines;
      await persist();
    });
    renderCriteria(block, 'Definition of done', lane.definitionOfDone, async (lines) => {
      lane.definitionOfDone = lines;
      await persist();
    });
  };

  const rerender = (): void => {
    wrap.empty();
    config.lanes.forEach((lane, index) => renderLaneBlock(lane, index));

    new Setting(wrap)
      .addButton((btn) =>
        btn.setButtonText('Add lane').onClick(async () => {
          config.lanes.push({
            id: `lane-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
            title: 'New lane',
            statuses: [],
            visible: true,
            definitionOfReady: [],
            definitionOfDone: [],
          });
          await persist();
          rerender();
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText('Reset to default')
          .setWarning()
          .onClick(async () => {
            config = cloneConfig(DEFAULT_BOARD_CONFIG);
            await persist();
            rerender();
          }),
      );
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
