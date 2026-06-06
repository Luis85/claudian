import { setIcon } from 'obsidian';

import type { ProgressData } from './WorkOrderProtocolDisplay';

export function renderWorkOrderProgressCard(parentEl: HTMLElement, progress: ProgressData): void {
  const card = parentEl.createDiv({ cls: 'claudian-work-order-progress-card' });
  const header = card.createDiv({ cls: 'claudian-work-order-progress-card-header' });

  const icon = header.createSpan({ cls: 'claudian-work-order-progress-card-icon' });
  setIcon(icon, 'activity');

  const main = header.createDiv({ cls: 'claudian-work-order-progress-card-main' });
  main.createDiv({ cls: 'claudian-work-order-progress-card-step', text: progress.step });

  if (progress.done) {
    const counter = header.createSpan({ cls: 'claudian-work-order-progress-card-counter' });
    counter.setText(`${progress.done.complete} / ${progress.done.total}`);
  }

  if (progress.done) {
    const bar = card.createDiv({ cls: 'claudian-work-order-progress-card-bar' });
    const fill = bar.createDiv({ cls: 'claudian-work-order-progress-card-bar-fill' });
    const pct = progress.done.total > 0
      ? Math.min(100, Math.max(0, Math.round((progress.done.complete / progress.done.total) * 100)))
      : 0;
    fill.style.width = `${pct}%`;
  }

  if (progress.note) {
    card.createDiv({ cls: 'claudian-work-order-progress-card-note', text: progress.note });
  }
}
