# Collapse Streaming Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default-on setting that hides the live, half-formed streaming render of an assistant answer behind a "Writing response..." placeholder and renders each answer text block in one pass when it completes.

**Architecture:** The change is localized to `StreamController`'s text-block path. In collapse mode, `appendText` accumulates content into an (empty) text element and shows an immediate streaming indicator instead of scheduling live markdown re-parses; `finalizeCurrentTextBlock` renders the accumulated content once, then runs the existing card-swap / copy-button / persistence tail unchanged. A new boolean setting is wired through settings types, defaults, the settings registry, the legacy settings tab, and i18n.

**Tech Stack:** TypeScript, Obsidian plugin APIs (`createDiv`/`createSpan`/`setText`), Jest (`--selectProjects unit` / `integration`), the project's i18n locale files, and the settings registry.

**Design reference:** `docs/superpowers/specs/2026-06-14-collapse-streaming-response-design.md`

---

## File Structure

**Modified — core/setting plumbing**
- `src/core/types/settings.ts` — add `collapseStreamingResponse: boolean` to the settings interface.
- `src/app/settings/defaultSettings.ts` — default the setting to `true`.

**Modified — behavior**
- `src/features/chat/constants.ts` — add the `STREAMING_RESPONSE_LABEL` placeholder constant.
- `src/features/chat/controllers/StreamController.ts` — `shouldCollapseStreamingResponse()`, collapse branches in `appendText` / `finalizeCurrentTextBlock`, extracted `renderStreamingIndicator()`, new `showWritingIndicator()`.

**Modified — settings UI + i18n**
- `src/features/settings/registry/fields/general.ts` — register the toggle.
- `src/features/settings/ClaudianSettings.ts` — legacy imperative toggle (kept until the v4.0.0 deletion pass).
- `src/i18n/types.ts` — add the two translation-key union members.
- `src/i18n/locales/{en,de,es,fr,ja,ko,pt,ru,zh-CN,zh-TW}.json` — add `settings.collapseStreamingResponse.{name,desc}`.

**Modified — tests**
- `tests/unit/features/chat/controllers/StreamController.test.ts` — harness opt-out + new collapse-behavior tests.
- `tests/perf/multiTabStreaming.perf.test.ts` — harness opt-out (perf gate targets the streaming-render path).
- `tests/integration/settings/generalPort.test.ts` — add the key to the `LEGACY_FIELD_IDS` parity list.

---

## Task 1: Setting type, default, and test-harness opt-out

This task adds the inert setting and keeps the two render-path test harnesses on the legacy streaming path. No runtime behavior changes yet (nothing reads the setting), so the full suite must stay green.

**Files:**
- Modify: `src/core/types/settings.ts:198`
- Modify: `src/app/settings/defaultSettings.ts:64`
- Modify: `tests/unit/features/chat/controllers/StreamController.test.ts:126-128`
- Modify: `tests/perf/multiTabStreaming.perf.test.ts:94`

- [ ] **Step 1: Add the setting to the settings interface**

In `src/core/types/settings.ts`, after the `deferMathRenderingDuringStreaming` line (currently line 198), add the new field:

```ts
  deferMathRenderingDuringStreaming: boolean;
  /** When true, hide the live partial render of an answer and show a "Writing response..." placeholder until each text block completes. */
  collapseStreamingResponse: boolean;
```

- [ ] **Step 2: Default the setting to on**

In `src/app/settings/defaultSettings.ts`, after the `deferMathRenderingDuringStreaming: true,` line (currently line 64), add:

```ts
  deferMathRenderingDuringStreaming: true,
  collapseStreamingResponse: true,
```

- [ ] **Step 3: Opt the unit render-path harness out of collapse mode**

In `tests/unit/features/chat/controllers/StreamController.test.ts`, the `createMockDeps()` settings object (currently `{ permissionMode: 'yolo' }` at lines 126-128) drives the real `appendText`/`renderContent` path. The existing streaming tests assert live renders, so keep the harness on the legacy path:

```ts
      settings: {
        permissionMode: 'yolo',
        collapseStreamingResponse: false,
      },
```

- [ ] **Step 4: Opt the perf gate out of collapse mode**

In `tests/perf/multiTabStreaming.perf.test.ts`, the `makeTab()` deps (line 94) feed the real streaming-render path the perf gate measures. Add the opt-out:

```ts
    plugin: { settings: { enableAutoScroll: true, collapseStreamingResponse: false }, app: { vault: {} } } as never,
```

- [ ] **Step 5: Verify typecheck and the affected suites pass (inert change)**

Run: `npm run typecheck`
Expected: PASS (no type errors).

Run: `npm run test -- --selectProjects unit -t "StreamController"`
Expected: PASS — existing streaming tests unchanged.

Run: `npm run test:perf -- -t "Multi-tab"`
Expected: PASS — perf gate unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/core/types/settings.ts src/app/settings/defaultSettings.ts tests/unit/features/chat/controllers/StreamController.test.ts tests/perf/multiTabStreaming.perf.test.ts
git commit -m "feat(chat): add collapseStreamingResponse setting (inert)

https://claude.ai/code/session_01MgG7KXRNJcSqgN7pyNvuQn"
```

---

## Task 2: StreamController collapse behavior (TDD)

**Files:**
- Modify: `src/features/chat/constants.ts`
- Modify: `src/features/chat/controllers/StreamController.ts` (`appendText` ~814, `finalizeCurrentTextBlock` ~829, `showThinkingIndicator` ~1552)
- Test: `tests/unit/features/chat/controllers/StreamController.test.ts`

- [ ] **Step 1: Write the failing collapse-behavior tests**

In `tests/unit/features/chat/controllers/StreamController.test.ts`, inside the `describe('StreamController - Text Content', ...)` block, add a new nested describe after the existing `describe('Text streaming', ...)` block:

```ts
  describe('Collapsed streaming response', () => {
    beforeEach(() => {
      (deps.plugin.settings as any).collapseStreamingResponse = true;
    });

    it('does not render the text block live while streaming, and shows a placeholder', async () => {
      await controller.appendText('Partial <claudian_hand');
      await controller.appendText('off>more');

      jest.advanceTimersByTime(500);
      await Promise.resolve();

      expect(deps.renderer.renderContent).not.toHaveBeenCalled();
      expect(deps.state.thinkingEl).not.toBeNull();
    });

    it('renders the full block once on finalize, persists it, and hides the placeholder', async () => {
      const msg = createTestMessage();

      await controller.appendText('Hello ');
      await controller.appendText('World');
      await controller.finalizeCurrentTextBlock(msg);

      expect(deps.renderer.renderContent).toHaveBeenCalledTimes(1);
      expect(deps.renderer.renderContent).toHaveBeenCalledWith(
        expect.anything(),
        'Hello World'
      );
      expect(deps.renderer.addTextCopyButton).toHaveBeenCalledWith(
        expect.anything(),
        'Hello World'
      );
      expect(msg.contentBlocks).toContainEqual({ type: 'text', content: 'Hello World' });
      expect(deps.state.thinkingEl).toBeNull();
    });

    it('renders a completed text segment at a block transition (text -> tool)', async () => {
      const msg = createTestMessage();

      await controller.handleStreamChunk({ type: 'text', content: 'Segment one' }, msg);
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 't1', name: 'Read', input: {} },
        msg,
      );

      expect(deps.renderer.renderContent).toHaveBeenCalledWith(
        expect.anything(),
        'Segment one'
      );
    });
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm run test -- --selectProjects unit -t "Collapsed streaming response"`
Expected: FAIL — collapse mode is not implemented yet, so `renderContent` is still called live during streaming (first test fails) and `thinkingEl` is not managed by the writing path.

- [ ] **Step 3: Add the placeholder label constant**

In `src/features/chat/constants.ts`, add above `FLAVOR_TEXTS` (kept as a plain constant to match the existing English-only flavor-text precedent):

```ts
/** Placeholder shown while a streamed response is hidden until it completes (collapseStreamingResponse). */
export const STREAMING_RESPONSE_LABEL = 'Writing response...';
```

- [ ] **Step 4: Import the constant in StreamController**

In `src/features/chat/controllers/StreamController.ts`, update the constants import (currently `import { FLAVOR_TEXTS } from '../constants';` at line 34):

```ts
import { FLAVOR_TEXTS, STREAMING_RESPONSE_LABEL } from '../constants';
```

- [ ] **Step 5: Add the setting reader**

In `src/features/chat/controllers/StreamController.ts`, next to `shouldDeferMathRendering()` (line 484), add:

```ts
  private shouldCollapseStreamingResponse(): boolean {
    return this.deps.plugin.settings.collapseStreamingResponse !== false;
  }
```

- [ ] **Step 6: Branch `appendText` for collapse mode**

Replace the body of `appendText` (lines 814-827) with:

```ts
  async appendText(text: string): Promise<void> {
    const { state } = this.deps;
    if (!state.currentContentEl) return;

    const collapse = this.shouldCollapseStreamingResponse();
    if (!collapse) {
      this.hideThinkingIndicator();
    }

    if (!state.currentTextEl) {
      state.currentTextEl = state.currentContentEl.createDiv({ cls: 'claudian-text-block' });
      state.currentTextContent = '';
    }

    state.currentTextContent += text;

    if (collapse) {
      // Hide the half-formed render: keep an immediate placeholder up and render
      // the whole block once it finalizes.
      this.showWritingIndicator();
      return;
    }

    void this.scheduleCurrentTextRender();
  }
```

- [ ] **Step 7: Branch `finalizeCurrentTextBlock` for collapse mode**

In `finalizeCurrentTextBlock` (lines 829-873), replace the math-defer re-render guard with a collapse-aware render. Change this block:

```ts
    if (msg && state.currentTextContent) {
      if (
        state.currentTextEl
        && this.shouldDeferMathRendering()
        && hasStreamingMathDelimiters(state.currentTextContent)
      ) {
        await renderer.renderContent(state.currentTextEl, state.currentTextContent);
      }
      msg.contentBlocks = msg.contentBlocks || [];
```

to:

```ts
    if (msg && state.currentTextContent) {
      if (this.shouldCollapseStreamingResponse()) {
        // Streaming rendered nothing in collapse mode — do the one and only
        // render now (exact, no deferMath), then drop the placeholder.
        this.hideThinkingIndicator();
        if (state.currentTextEl) {
          await renderer.renderContent(state.currentTextEl, state.currentTextContent);
        }
      } else if (
        state.currentTextEl
        && this.shouldDeferMathRendering()
        && hasStreamingMathDelimiters(state.currentTextContent)
      ) {
        await renderer.renderContent(state.currentTextEl, state.currentTextContent);
      }
      msg.contentBlocks = msg.contentBlocks || [];
```

Then, so the placeholder is also dropped when a collapsed block finalizes with no persisted content, change the trailing reset (lines 871-872) from:

```ts
    state.currentTextEl = null;
    state.currentTextContent = '';
  }
```

to:

```ts
    if (this.shouldCollapseStreamingResponse()) {
      this.hideThinkingIndicator();
    }
    state.currentTextEl = null;
    state.currentTextContent = '';
  }
```

- [ ] **Step 8: Extract `renderStreamingIndicator` from `showThinkingIndicator`**

In `showThinkingIndicator` (lines 1552-1614), the `setTimeout` callback builds the indicator DOM + timer inline. Extract that into a reusable method so the writing path can show it immediately. Replace the callback body (lines 1578-1613) so the scheduled creation delegates to the new method:

```ts
    // Schedule showing the indicator after a delay
    const timerWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
    state.setThinkingIndicatorTimeout(timerWindow.setTimeout(() => {
      state.setThinkingIndicatorTimeout(null, null);
      // Double-check we still have a content element, no indicator exists, and no thinking block
      if (!state.currentContentEl || state.thinkingEl || state.currentThinkingState) return;

      const text = overrideText || FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)];
      this.renderStreamingIndicator(text, overrideCls);
    }, StreamController.THINKING_INDICATOR_DELAY), timerWindow);
  }

  /**
   * Builds the streaming-indicator DOM (flavor/label span + live `esc to
   * interrupt` timer) and starts its 1s timer. Shared by the debounced thinking
   * indicator and the immediate writing placeholder. The label span carries a
   * stable class so the writing path can relabel an already-mounted indicator.
   */
  private renderStreamingIndicator(text: string, overrideCls?: string): void {
    const { state } = this.deps;
    if (!state.currentContentEl) return;

    const cls = overrideCls ? `claudian-thinking ${overrideCls}` : 'claudian-thinking';
    state.thinkingEl = state.currentContentEl.createDiv({ cls });
    state.thinkingEl.createSpan({ cls: 'claudian-thinking-flavor', text });

    const timerSpan = state.thinkingEl.createSpan({ cls: 'claudian-thinking-hint' });
    const updateTimer = () => {
      if (!state.responseStartTime) return;
      if (!timerSpan.isConnected) {
        if (state.flavorTimerInterval) {
          state.clearFlavorTimerInterval();
        }
        return;
      }
      const elapsedSeconds = Math.floor((performance.now() - state.responseStartTime) / 1000);
      timerSpan.setText(` (esc to interrupt · ${formatDurationMmSs(elapsedSeconds)})`);
    };
    updateTimer();

    if (state.flavorTimerInterval) {
      state.clearFlavorTimerInterval();
    }
    const thinkingWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
    state.setFlavorTimerInterval(thinkingWindow.setInterval(updateTimer, 1000), thinkingWindow);
  }

  /**
   * Immediately shows (or relabels) the streaming placeholder for collapse mode.
   * Unlike {@link showThinkingIndicator}, this bypasses the debounce — a
   * continuous text-only answer never produces the 400ms idle gap the debounce
   * waits for, so the placeholder must appear as soon as text starts streaming.
   */
  private showWritingIndicator(): void {
    const { state } = this.deps;
    if (!state.currentContentEl || state.currentThinkingState) return;

    if (state.thinkingIndicatorTimeout) {
      state.clearThinkingIndicatorTimeout(state.currentContentEl.ownerDocument.defaultView ?? null);
    }

    if (state.thinkingEl) {
      const labelSpan = state.thinkingEl.querySelector<HTMLElement>('.claudian-thinking-flavor');
      labelSpan?.setText(STREAMING_RESPONSE_LABEL);
      state.currentContentEl.appendChild(state.thinkingEl);
    } else {
      this.renderStreamingIndicator(STREAMING_RESPONSE_LABEL);
    }
    this.deps.updateQueueIndicator();
  }
```

Note: the only change to the existing thinking-indicator output is that its label span now carries the `claudian-thinking-flavor` class (previously class-less). Existing `showThinkingIndicator` tests must still pass — keep its debounce, early-returns, and re-append branch exactly as they are.

- [ ] **Step 9: Run the collapse tests to verify they pass**

Run: `npm run test -- --selectProjects unit -t "Collapsed streaming response"`
Expected: PASS — no live render during streaming, placeholder shown, single render + persist + placeholder hidden on finalize, and per-segment render at a block transition.

- [ ] **Step 10: Run the full StreamController suite for regressions**

Run: `npm run test -- --selectProjects unit -t "StreamController"`
Expected: PASS — existing streaming, backoff, deferMath, and finalize tests still pass (harness runs with `collapseStreamingResponse: false`).

- [ ] **Step 11: Commit**

```bash
git add src/features/chat/constants.ts src/features/chat/controllers/StreamController.ts tests/unit/features/chat/controllers/StreamController.test.ts
git commit -m "feat(chat): defer streaming render behind a placeholder when collapse is on

https://claude.ai/code/session_01MgG7KXRNJcSqgN7pyNvuQn"
```

---

## Task 3: Settings UI wiring, parity, and i18n

**Files:**
- Modify: `src/i18n/types.ts:749`
- Modify: `src/i18n/locales/en.json` (+ 9 other locales)
- Modify: `src/features/settings/registry/fields/general.ts:256`
- Modify: `src/features/settings/ClaudianSettings.ts:368`
- Test: `tests/integration/settings/generalPort.test.ts:39`

- [ ] **Step 1: Add the i18n key union members**

In `src/i18n/types.ts`, after the two `deferMathRenderingDuringStreaming` entries (lines 748-749), add:

```ts
  | 'settings.deferMathRenderingDuringStreaming.name'
  | 'settings.deferMathRenderingDuringStreaming.desc'
  | 'settings.collapseStreamingResponse.name'
  | 'settings.collapseStreamingResponse.desc'
```

- [ ] **Step 2: Add the English copy**

In `src/i18n/locales/en.json`, immediately after the `deferMathRenderingDuringStreaming` block, insert the new block. Use Edit with this exact `old_string`:

```json
    "deferMathRenderingDuringStreaming": {
      "name": "Defer math rendering during streaming",
      "desc": "Show raw LaTeX while responses stream, then render math once when each text block completes."
    },
```

and this `new_string`:

```json
    "deferMathRenderingDuringStreaming": {
      "name": "Defer math rendering during streaming",
      "desc": "Show raw LaTeX while responses stream, then render math once when each text block completes."
    },
    "collapseStreamingResponse": {
      "name": "Hide incomplete responses while streaming",
      "desc": "Show a 'Writing response...' placeholder while a response streams, then render each text block in one pass when it completes — avoids showing half-formed Markdown or XML."
    },
```

- [ ] **Step 3: Add the same key to the other 9 locales**

For each locale file, insert a `collapseStreamingResponse` block immediately after that file's existing `deferMathRenderingDuringStreaming` block (same 4-space / 6-space indentation, with a trailing comma after the new block's closing `}`). `locales.test.ts` requires every locale to carry exactly English's keys. Use these exact strings:

`src/i18n/locales/de.json`:
```json
    "collapseStreamingResponse": {
      "name": "Unvollständige Antworten während des Streamings ausblenden",
      "desc": "Während eine Antwort gestreamt wird, einen Platzhalter „Writing response...“ anzeigen und jeden Textblock erst beim Abschluss in einem Durchgang rendern – verhindert halbfertiges Markdown oder XML."
    },
```

`src/i18n/locales/es.json`:
```json
    "collapseStreamingResponse": {
      "name": "Ocultar respuestas incompletas durante el streaming",
      "desc": "Mostrar un marcador de posición «Writing response...» mientras se transmite una respuesta y renderizar cada bloque de texto de una vez al completarse — evita mostrar Markdown o XML a medio formar."
    },
```

`src/i18n/locales/fr.json`:
```json
    "collapseStreamingResponse": {
      "name": "Masquer les réponses incomplètes pendant le streaming",
      "desc": "Afficher un espace réservé « Writing response... » pendant la diffusion d'une réponse, puis rendre chaque bloc de texte en une fois lorsqu'il est terminé — évite d'afficher du Markdown ou XML à moitié formé."
    },
```

`src/i18n/locales/ja.json`:
```json
    "collapseStreamingResponse": {
      "name": "ストリーミング中は未完成の応答を非表示",
      "desc": "応答のストリーミング中は「Writing response...」プレースホルダーを表示し、各テキストブロックの完了時に一度にレンダリングします。途中の Markdown や XML の表示を防ぎます。"
    },
```

`src/i18n/locales/ko.json`:
```json
    "collapseStreamingResponse": {
      "name": "스트리밍 중 미완성 응답 숨기기",
      "desc": "응답이 스트리밍되는 동안 'Writing response...' 자리표시자를 표시하고 각 텍스트 블록이 완료되면 한 번에 렌더링합니다. 완성되지 않은 Markdown이나 XML 표시를 방지합니다."
    },
```

`src/i18n/locales/pt.json`:
```json
    "collapseStreamingResponse": {
      "name": "Ocultar respostas incompletas durante o streaming",
      "desc": "Mostrar um espaço reservado \"Writing response...\" enquanto uma resposta é transmitida e renderizar cada bloco de texto de uma vez quando terminar — evita mostrar Markdown ou XML pela metade."
    },
```

`src/i18n/locales/ru.json`:
```json
    "collapseStreamingResponse": {
      "name": "Скрывать незавершённые ответы во время потока",
      "desc": "Показывать заполнитель «Writing response...» во время потоковой передачи ответа и отрисовывать каждый текстовый блок за один раз после завершения — чтобы не показывать наполовину готовый Markdown или XML."
    },
```

`src/i18n/locales/zh-CN.json`:
```json
    "collapseStreamingResponse": {
      "name": "流式传输时隐藏未完成的响应",
      "desc": "响应流式传输时显示「Writing response...」占位符，并在每个文本块完成后一次性渲染，避免显示尚未成形的 Markdown 或 XML。"
    },
```

`src/i18n/locales/zh-TW.json`:
```json
    "collapseStreamingResponse": {
      "name": "串流傳輸時隱藏未完成的回應",
      "desc": "回應串流傳輸時顯示「Writing response...」佔位符，並在每個文字區塊完成後一次性渲染，避免顯示尚未成形的 Markdown 或 XML。"
    },
```

- [ ] **Step 4: Run the locale parity test**

Run: `npm run test -- --selectProjects unit -t "locale files"`
Expected: PASS — "keeps every locale structurally aligned with English" stays green with the new key present in all 10 files.

- [ ] **Step 5: Register the toggle in the settings registry**

In `src/features/settings/registry/fields/general.ts`, after the `deferMathRenderingDuringStreaming` field (ends line 256), add:

```ts
  r.registerField({
    id: 'collapseStreamingResponse',
    tabId: 'general',
    sectionId: 'display',
    label: t('settings.collapseStreamingResponse.name'),
    description: t('settings.collapseStreamingResponse.desc'),
    type: { kind: 'toggle' },
    default: true,
    keywords: ['streaming', 'render', 'response', 'placeholder', 'collapse'],
  });
```

- [ ] **Step 6: Add the legacy imperative toggle**

In `src/features/settings/ClaudianSettings.ts`, after the `deferMathRenderingDuringStreaming` setting (ends line 368), add:

```ts
    new Setting(container)
      .setName(t('settings.collapseStreamingResponse.name'))
      .setDesc(t('settings.collapseStreamingResponse.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.collapseStreamingResponse ?? true)
          .onChange(async (value) => {
            this.plugin.settings.collapseStreamingResponse = value;
            await this.plugin.saveSettings();
          })
      );
```

- [ ] **Step 7: Add the key to the legacy/registry parity inventory**

In `tests/integration/settings/generalPort.test.ts`, add `'collapseStreamingResponse'` to `LEGACY_FIELD_IDS` right after `'deferMathRenderingDuringStreaming'` (line 39):

```ts
  'enableAutoScroll',
  'deferMathRenderingDuringStreaming',
  'collapseStreamingResponse',
  'enableAutoTitleGeneration',
```

- [ ] **Step 8: Run the settings integration suite**

Run: `npm run test -- --selectProjects integration -t "general"`
Expected: PASS — registry/legacy parity holds with the new field registered on both sides.

- [ ] **Step 9: Commit**

```bash
git add src/i18n/types.ts src/i18n/locales/*.json src/features/settings/registry/fields/general.ts src/features/settings/ClaudianSettings.ts tests/integration/settings/generalPort.test.ts
git commit -m "feat(settings): expose collapseStreamingResponse toggle + i18n

https://claude.ai/code/session_01MgG7KXRNJcSqgN7pyNvuQn"
```

---

## Task 4: Full verification

**Files:** none (verification only; commit only if a baseline file legitimately changes).

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS (no new errors; no `innerHTML`/`console.*`).

- [ ] **Step 3: Full unit + integration tests**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 4: Performance gate**

Run: `npm run test:perf`
Expected: PASS (multi-tab streaming gate unaffected; harness opted out of collapse mode).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: LOC + quality ratchets**

Run: `npm run check:loc`
Run: `npm run check:quality`
Expected: PASS. If the LOC/quality ratchet trips purely on the net additions in `StreamController.ts`, re-baseline per `docs/build-ci/quality-gates.md` (e.g. update `scripts/quality-baseline.json`) and commit that change separately:

```bash
git add scripts/quality-baseline.json
git commit -m "chore(quality): re-baseline after collapseStreamingResponse

https://claude.ai/code/session_01MgG7KXRNJcSqgN7pyNvuQn"
```

- [ ] **Step 7: Manual smoke (optional but recommended)**

In a dev vault (`npm run dev`), stream a response containing a fenced code block or an `<claudian_handoff>`-style block and confirm: during streaming only the "Writing response..." placeholder shows; on completion the fully-formatted message appears in one pass; toggling the setting off in Settings → General → Display restores token-by-token streaming.

---

## Self-Review

**Spec coverage:**
- Decision 1 (collapse all streaming text) → Task 2 Steps 6-7 (`appendText`/`finalizeCurrentTextBlock` collapse branches).
- Decision 2 (setting, default on) → Task 1 Steps 1-2; Task 3 Steps 5-6.
- Decision 3 (reuse indicator + "Writing response..." label + timer) → Task 2 Steps 3, 8 (`STREAMING_RESPONSE_LABEL`, `renderStreamingIndicator`, `showWritingIndicator`).
- Decision 4 (per-text-block granularity) → Task 2 Step 1 third test (text → tool transition renders the segment).
- Decision 5 (thinking blocks unchanged) → no thinking-path edits; `appendThinking`/`renderPendingThinking` untouched.
- Decision 6 (tools/diffs/subagents unchanged) → no tool-path edits.
- Setting wiring (types/defaults/registry/legacy/i18n) → Task 1 + Task 3.
- Testing (defer-until-finalize, off-path unchanged, parity, locales, perf) → Task 2 + Task 3 + Task 4.

**Placeholder scan:** No TBD/TODO; every code and i18n string is given verbatim; every command has an expected result.

**Type/name consistency:** `collapseStreamingResponse` (setting), `shouldCollapseStreamingResponse()`, `showWritingIndicator()`, `renderStreamingIndicator()`, `STREAMING_RESPONSE_LABEL`, and CSS class `claudian-thinking-flavor` are used identically across every task that references them.
