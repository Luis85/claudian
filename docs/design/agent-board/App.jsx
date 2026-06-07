/* App.jsx — root: Obsidian board backdrop, state switcher, Tweaks, and the modal. */

const { TASKS, STATE_ORDER, STATUS_META, Icon } = window.WO;

const ACCENTS = {
  Teal:   ['#00bd7e', '#00d48c'],
  Blue:   ['#4a8fe7', '#6aa6f0'],
  Purple: ['#7c5cbf', '#9576d8'],
  Amber:  ['#e0a052', '#edb96f'],
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "layout": "two-pane",
  "density": "regular",
  "statusAccent": true,
  "icons": true,
  "progressStyle": "ring",
  "sidebarLeft": false,
  "accent": "Teal"
}/*EDITMODE-END*/;

/* ---------- backdrop board (faint, behind the dimmed overlay) ---------- */
const BOARD_LANES = [
  { name: 'Inbox', n: 3, cards: ['Bug fix', 'Refactor parser', 'Tidy imports'] },
  { name: 'Ready', n: 2, cards: ['Wire telemetry', 'Cache warmer'] },
  { name: 'Running', n: 1, cards: ['Settings overhaul — execute plan'] },
  { name: 'Review', n: 2, cards: ['Keychain migration', 'OpenAPI client'] },
  { name: 'Done', n: 4, cards: ['Dark-mode toggle', 'Ribbon icons', 'i18n pass', 'Hotkeys'] },
];

function Backdrop() {
  return (
    <div className="wo-board" aria-hidden="true">
      <div className="wo-board-topbar">
        <span className="wo-board-tab is-active">Agent Board</span>
        <span className="wo-board-tab">Chat</span>
      </div>
      <div className="wo-board-lanes">
        {BOARD_LANES.map((lane) => (
          <div className="wo-lane" key={lane.name}>
            <div className="wo-lane-head"><span>{lane.name}</span><span className="wo-lane-count">{lane.n}</span></div>
            {lane.cards.map((c, i) => (
              <div className="wo-card" key={i}>
                <div className="wo-card-title">{c}</div>
                <div className="wo-card-foot"><span className="wo-card-dot" /><span className="wo-card-meta">claude · sonnet</span></div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function StateSwitcher({ value, onChange }) {
  return (
    <div className="wo-switcher">
      <span className="wo-switcher-label">Preview state</span>
      <div className="wo-switcher-seg">
        {STATE_ORDER.map((s) => {
          const m = STATUS_META[s];
          const active = s === value;
          return (
            <button
              key={s}
              className={active ? 'is-active' : ''}
              onClick={() => onChange(s)}
              style={active ? { color: m.color } : undefined}
            >
              <span className="wo-switcher-dot" style={{ background: m.color, opacity: active ? 1 : 0.5 }} />
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [stateKey, setStateKey] = React.useState('inbox');
  const [tasks, setTasks] = React.useState(() => JSON.parse(JSON.stringify(TASKS)));

  const task = tasks[stateKey];

  React.useEffect(() => {
    const [a1, a2] = ACCENTS[t.accent] || ACCENTS.Teal;
    document.documentElement.style.setProperty('--color-accent', a1);
    document.documentElement.style.setProperty('--color-accent-2', a2);
    document.documentElement.style.setProperty('--color-green', a1);
    document.documentElement.style.setProperty('--interactive-accent', a1);
    document.documentElement.style.setProperty('--interactive-accent-hover', a2);
    document.documentElement.style.setProperty('--text-accent', a1);
  }, [t.accent]);

  const onField = (key, val) => {
    setTasks((prev) => {
      const next = { ...prev, [stateKey]: { ...prev[stateKey], [key]: val } };
      if (key === 'provider') next[stateKey].model = '';
      return next;
    });
  };
  const onTitle = (title) => {
    if (title) setTasks((prev) => ({ ...prev, [stateKey]: { ...prev[stateKey], title } }));
  };

  return (
    <div className="theme-dark wo-root">
      <Backdrop />
      <div className="wo-overlay" />
      <StateSwitcher value={stateKey} onChange={setStateKey} />
      <div className="wo-modal-wrap">
        <WorkOrderModal task={task} t={t} onClose={() => {}} onField={onField} onTitle={onTitle} />
      </div>

      <TweaksPanel>
        <TweakSection label="Layout" />
        <TweakSelect label="Structure" value={t.layout}
          options={['two-pane', 'stacked', 'tabbed']}
          onChange={(v) => setTweak('layout', v)} />
        <TweakToggle label="Sidebar on left" value={t.sidebarLeft}
          onChange={(v) => setTweak('sidebarLeft', v)} />
        <TweakRadio label="Density" value={t.density}
          options={['compact', 'regular', 'comfy']}
          onChange={(v) => setTweak('density', v)} />

        <TweakSection label="Style" />
        <TweakToggle label="Status color accent" value={t.statusAccent}
          onChange={(v) => setTweak('statusAccent', v)} />
        <TweakToggle label="Property icons" value={t.icons}
          onChange={(v) => setTweak('icons', v)} />
        <TweakRadio label="Progress" value={t.progressStyle}
          options={['ring', 'bar']}
          onChange={(v) => setTweak('progressStyle', v)} />
        <TweakSelect label="Accent" value={t.accent}
          options={Object.keys(ACCENTS)}
          onChange={(v) => setTweak('accent', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
