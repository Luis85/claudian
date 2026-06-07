/* BoardApp.jsx — Agent Board root: toolbar, lanes, Tweaks. */

const { Icon } = window.WO;
const { LANES } = window.BOARD;
const { Lane } = window.BoardParts;

const ACCENTS_B = {
  Teal:   ['#00bd7e', '#00d48c'],
  Blue:   ['#4a8fe7', '#6aa6f0'],
  Purple: ['#7c5cbf', '#9576d8'],
  Amber:  ['#e0a052', '#edb96f'],
};

const BOARD_TWEAKS = /*EDITMODE-BEGIN*/{
  "lane": "borderless",
  "accent": "dot",
  "density": "regular",
  "meta": true,
  "progress": true,
  "assignee": true,
  "accentColor": "Teal"
}/*EDITMODE-END*/;

function Toolbar() {
  // Auto-run (the background watcher / orchestrator) starts OFF on every app
  // launch so the board never surprises the user by running on its own.
  const [autoRun, setAutoRun] = React.useState(false);
  return (
    <div className="ab-toolbar">
      <div className="ab-toolbar-actions">
        <button className="ab-btn ab-btn-cta">Add work order</button>
        <button className="ab-btn ab-btn-tool"><Icon name="play" size={13} />Run next ready</button>
        <span className="ab-tool-divider" />
        <button
          className={`ab-autorun${autoRun ? ' is-on' : ''}`}
          onClick={() => setAutoRun((v) => !v)}
          role="switch"
          aria-checked={autoRun}
          title="Automatically starts work orders once they reach Ready. Runs in the background."
        >
          <span className="ab-autorun-track"><span className="ab-autorun-thumb" /></span>
          <span className="ab-autorun-label">Auto-run</span>
        </button>
      </div>
      <div className="ab-toolbar-info">
        <span className="ab-slot"><span className="ab-slot-dot" />1/3 active</span>
        <span className="ab-slot-sep" />
        <span className="ab-slot-muted">Work-order tabs 1/3 · 2 free</span>
      </div>
    </div>
  );
}

function App() {
  const [t, setTweak] = useTweaks(BOARD_TWEAKS);

  React.useEffect(() => {
    const [a1, a2] = ACCENTS_B[t.accentColor] || ACCENTS_B.Teal;
    const r = document.documentElement.style;
    r.setProperty('--color-accent', a1);
    r.setProperty('--color-accent-2', a2);
    r.setProperty('--color-green', a1);
    r.setProperty('--interactive-accent', a1);
    r.setProperty('--interactive-accent-hover', a2);
    r.setProperty('--text-accent', a1);
  }, [t.accentColor]);

  return (
    <div className={`theme-dark ab-root ab-density-${t.density}`}>
      <div className="ab-tabstrip">
        <span className="ab-tab">2026-06-06-work-order…</span>
        <span className="ab-tab is-active"><Icon name="list-checks" size={14} />Agent Board</span>
        <span className="ab-tab"><Icon name="square" size={13} />Backlog</span>
      </div>

      <div className="ab-surface">
        <Toolbar />
        <div className="ab-lanes">
          {LANES.map((lane) => <Lane key={lane.id} lane={lane} t={t} />)}
        </div>
      </div>

      <TweaksPanel>
        <TweakSection label="Columns" />
        <TweakRadio label="Lane style" value={t.lane}
          options={['borderless', 'framed']}
          onChange={(v) => setTweak('lane', v)} />
        <TweakRadio label="Density" value={t.density}
          options={['compact', 'regular', 'comfy']}
          onChange={(v) => setTweak('density', v)} />

        <TweakSection label="Cards" />
        <TweakRadio label="Status accent" value={t.accent}
          options={['dot', 'bar', 'none']}
          onChange={(v) => setTweak('accent', v)} />
        <TweakToggle label="Show provider / priority" value={t.meta}
          onChange={(v) => setTweak('meta', v)} />
        <TweakToggle label="Show acceptance progress" value={t.progress}
          onChange={(v) => setTweak('progress', v)} />
        <TweakToggle label="Show assignee avatar" value={t.assignee}
          onChange={(v) => setTweak('assignee', v)} />

        <TweakSection label="Theme" />
        <TweakSelect label="Accent" value={t.accentColor}
          options={Object.keys(ACCENTS_B)}
          onChange={(v) => setTweak('accentColor', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
