/**
 * @jest-environment jsdom
 */
import '../../../../setup/obsidianDom';

import { Notice, Setting } from 'obsidian';

import { loadBoardConfig } from '../../../../../src/features/tasks/config/BoardConfigStore';
import type { BoardConfig } from '../../../../../src/features/tasks/config/boardConfigTypes';
import { renderAgentBoardLaneEditor } from '../../../../../src/features/tasks/ui/AgentBoardLaneEditor';

// Reset the global Setting instance log between tests so each spec sees only
// the Setting rows produced by its own render. The Obsidian mock pushes every
// `new Setting(container)` onto a static array; without this reset, header-
// name assertions would also see Settings created by earlier tests.
beforeEach(() => {
  (Setting as unknown as { instances: unknown[] }).instances = [];
});

type LaneSeed = {
  id: string;
  title: string;
  statuses: string[];
};

function makePlugin(lanes: LaneSeed[]): {
  plugin: any;
  emit: jest.Mock;
  save: jest.Mock;
} {
  const emit = jest.fn();
  const save = jest.fn().mockResolvedValue(undefined);
  const config: BoardConfig = {
    schemaVersion: 1,
    lanes: lanes.map((lane) => ({
      id: lane.id,
      title: lane.title,
      statuses: lane.statuses as BoardConfig['lanes'][number]['statuses'],
      visible: true,
      definitionOfReady: [],
      definitionOfDone: [],
    })),
  };
  const plugin = {
    settings: { agentBoardConfig: config },
    saveSettings: save,
    events: { emit },
  };
  return { plugin, emit, save };
}

function findCheckbox(
  host: HTMLElement,
  laneIndex: number,
  status: string,
): HTMLInputElement {
  const lanes = host.querySelectorAll('.claudian-lane-editor-lane');
  const lane = lanes[laneIndex];
  if (!lane) throw new Error(`No lane block at index ${laneIndex}`);
  const labels = lane.querySelectorAll('.claudian-lane-editor-status');
  for (const label of Array.from(labels)) {
    // The matching span is the one whose text equals the status. The duplicate
    // hint span (if present) reads "Also in '…'" and does not match.
    const spans = Array.from(label.querySelectorAll('span'));
    const matches = spans.some((span) => span.textContent?.trim() === status);
    if (!matches) continue;
    const input = label.querySelector('input');
    if (!input) throw new Error(`No input element for status ${status}`);
    return input as HTMLInputElement;
  }
  throw new Error(`Status checkbox ${status} not found in lane ${laneIndex}`);
}

describe('renderAgentBoardLaneEditor — duplicate-status hint', () => {
  it('does NOT silently revert when a checked status is already owned by another lane', async () => {
    // Repro the user-reported freeze: on a fresh vault, lane 4 (needs_input) is
    // unchecked for every other status. Clicking any other status used to make
    // loadBoardConfig fall back to DEFAULT, the editor would re-render with the
    // user's click reverted, and to the user it looked like the UI froze.
    const { plugin, save, emit } = makePlugin([
      { id: 'l1', title: 'Lane 1', statuses: ['ready'] },
      { id: 'l4', title: 'Lane 4', statuses: ['needs_input'] },
    ]);
    const host = document.createElement('div');
    renderAgentBoardLaneEditor(host, plugin);

    const lane4Ready = findCheckbox(host, 1, 'ready');
    lane4Ready.checked = true;
    lane4Ready.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();

    expect(save).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('task:board-config-changed');
    expect(plugin.settings.agentBoardConfig.lanes[1].statuses).toEqual(['needs_input', 'ready']);

    // Critical regression guard: re-hydrate the saved settings through
    // loadBoardConfig and confirm the lanes still reflect the user's intent.
    // Pre-fix, loadBoardConfig replaced the user's lanes with
    // DEFAULT_BOARD_CONFIG whenever a status was duplicated, so the user's
    // checkbox click vanished on every re-render and the UI looked frozen.
    const roundTripped = loadBoardConfig(plugin.settings as unknown as Record<string, unknown>);
    expect(roundTripped.config.lanes.map((lane) => lane.statuses)).toEqual([
      ['ready'],
      ['needs_input', 'ready'],
    ]);
    expect(
      roundTripped.errors.some((e) => e.includes('ready') && e.includes('more than one lane')),
    ).toBe(true);
  });

  it('marks a duplicate-status checkbox with a modifier class and an inline hint', () => {
    const { plugin } = makePlugin([
      { id: 'l1', title: 'Ready lane', statuses: ['ready'] },
      { id: 'l4', title: 'Combo lane', statuses: ['needs_input', 'ready'] },
    ]);
    const host = document.createElement('div');
    renderAgentBoardLaneEditor(host, plugin);

    // The second lane's `ready` checkbox is the duplicate occurrence — it should
    // surface as a duplicate.
    const lanes = host.querySelectorAll('.claudian-lane-editor-lane');
    const lane2 = lanes[1];
    const labels = Array.from(lane2.querySelectorAll('.claudian-lane-editor-status'));
    const readyLabel = labels.find(
      (label) => label.querySelector('span')?.textContent?.trim() === 'ready',
    );
    expect(readyLabel).toBeDefined();
    expect(readyLabel!.classList.contains('claudian-lane-editor-status--duplicate')).toBe(true);

    const hint = lane2.querySelector('.claudian-lane-editor-status-hint');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain('Ready lane');
  });

  it('does NOT mark uniquely-owned statuses as duplicates', () => {
    const { plugin } = makePlugin([
      { id: 'l1', title: 'Lane 1', statuses: ['ready'] },
      { id: 'l4', title: 'Lane 4', statuses: ['needs_input'] },
    ]);
    const host = document.createElement('div');
    renderAgentBoardLaneEditor(host, plugin);

    const duplicates = host.querySelectorAll('.claudian-lane-editor-status--duplicate');
    expect(duplicates.length).toBe(0);
    const hints = host.querySelectorAll('.claudian-lane-editor-status-hint');
    expect(hints.length).toBe(0);
  });

  it('hides the duplicate hint when the canonical lane is invisible (routing follows visible lanes only)', () => {
    // resolveBoardLayout filters by lane.visible, so the editor must as well —
    // otherwise hiding the canonical lane would silently reroute work orders
    // while the editor kept naming the hidden lane.
    const { plugin } = makePlugin([
      { id: 'l1', title: 'Hidden canonical', statuses: ['ready'] },
      { id: 'l4', title: 'Visible owner', statuses: ['needs_input', 'ready'] },
    ]);
    plugin.settings.agentBoardConfig.lanes[0].visible = false;
    const host = document.createElement('div');
    renderAgentBoardLaneEditor(host, plugin);

    const duplicates = host.querySelectorAll('.claudian-lane-editor-status--duplicate');
    expect(duplicates.length).toBe(0);
    const hints = host.querySelectorAll('.claudian-lane-editor-status-hint');
    expect(hints.length).toBe(0);
  });

  it('does not annotate hidden lanes that hold the duplicate status (hidden lanes do not route)', () => {
    const { plugin } = makePlugin([
      { id: 'l1', title: 'Visible owner', statuses: ['ready'] },
      { id: 'l4', title: 'Hidden duplicate', statuses: ['ready'] },
    ]);
    plugin.settings.agentBoardConfig.lanes[1].visible = false;
    const host = document.createElement('div');
    renderAgentBoardLaneEditor(host, plugin);

    const duplicates = host.querySelectorAll('.claudian-lane-editor-status--duplicate');
    expect(duplicates.length).toBe(0);
  });

  it('collapses many duplicate statuses on one lane into a single combined hint', () => {
    // A lane that mirrors many statuses from earlier lanes used to render one
    // italic hint per checkbox — a wall of redundant text. Now the lane emits
    // a single per-lane note listing every conflict with its canonical title.
    const { plugin } = makePlugin([
      { id: 'l1', title: 'First', statuses: ['ready', 'running', 'done'] },
      { id: 'l2', title: 'Second', statuses: ['ready', 'running', 'done'] },
    ]);
    const host = document.createElement('div');
    renderAgentBoardLaneEditor(host, plugin);

    const lanes = host.querySelectorAll('.claudian-lane-editor-lane');
    const lane2Hints = lanes[1].querySelectorAll('.claudian-lane-editor-status-hint');
    expect(lane2Hints.length).toBe(1);
    const hintText = lane2Hints[0].textContent ?? '';
    expect(hintText).toContain('ready');
    expect(hintText).toContain('running');
    expect(hintText).toContain('done');
    expect(hintText).toContain('First');
    // The hint sits OUTSIDE the status checkbox label so screen readers do not
    // mis-read it as part of the checkbox label.
    expect(lane2Hints[0].getAttribute('role')).toBe('note');
    expect(lane2Hints[0].closest('label')).toBeNull();
  });

  it('rolls back the in-memory config and surfaces a Notice when saveSettings rejects', async () => {
    const { plugin, save } = makePlugin([
      { id: 'l1', title: 'Lane 1', statuses: ['ready'] },
      { id: 'l4', title: 'Lane 4', statuses: ['needs_input'] },
    ]);
    save.mockRejectedValueOnce(new Error('disk full'));
    (Notice as unknown as jest.Mock).mockClear();

    const host = document.createElement('div');
    renderAgentBoardLaneEditor(host, plugin);

    const lane4Ready = findCheckbox(host, 1, 'ready');
    lane4Ready.checked = true;
    lane4Ready.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Persistence failed → config must reflect the snapshot, not the optimistic
    // mutation. Otherwise the editor would silently desync from disk.
    expect(plugin.settings.agentBoardConfig.lanes[1].statuses).toEqual(['needs_input']);
    expect((Notice as unknown as jest.Mock)).toHaveBeenCalledTimes(1);
    expect((Notice as unknown as jest.Mock).mock.calls[0][0]).toContain('disk full');
  });

  it('restores keyboard focus to the same checkbox after a successful change', async () => {
    const { plugin } = makePlugin([
      { id: 'l1', title: 'Lane 1', statuses: ['ready'] },
      { id: 'l4', title: 'Lane 4', statuses: ['needs_input'] },
    ]);
    const host = document.createElement('div');
    document.body.appendChild(host);
    renderAgentBoardLaneEditor(host, plugin);

    const before = findCheckbox(host, 1, 'ready');
    before.checked = true;
    before.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();

    const after = findCheckbox(host, 1, 'ready');
    expect(after).not.toBe(before); // rerender replaced the DOM node
    expect(document.activeElement).toBe(after);
    document.body.removeChild(host);
  });

  it('uses each lane title for the lane block header so reorder does not lie', () => {
    // Positional names like `Lane 4` lied after a move-up / move-down because
    // the index changed but the user still thinks of the lane by its label.
    const { plugin } = makePlugin([
      { id: 'l1', title: 'Inbox', statuses: ['inbox'] },
      { id: 'l2', title: 'Working on it', statuses: ['running'] },
    ]);
    const host = document.createElement('div');
    renderAgentBoardLaneEditor(host, plugin);

    const lanes = host.querySelectorAll('.claudian-lane-editor-lane');
    const instances = (Setting as unknown as { instances: Array<{ setName: jest.Mock }> })
      .instances;
    const namesCalled = instances.flatMap((s) =>
      s.setName.mock.calls.map((call) => call[0] as string),
    );
    expect(namesCalled).toContain('Inbox');
    expect(namesCalled).toContain('Working on it');
    expect(namesCalled).not.toContain('Lane 1');
    expect(namesCalled).not.toContain('Lane 2');
    expect(lanes).toHaveLength(2);
  });
});
