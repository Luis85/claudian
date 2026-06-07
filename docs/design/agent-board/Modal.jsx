/* Modal.jsx — the redesigned work-order detail modal.
   Sticky header (click-to-edit title + status pill), scrollable body laid out
   per the active layout tweak, and a sticky footer that keeps actions in view. */

const { Icon, Avatar, STATUS_META, PRIORITY_META, AGENTS, AGENT_OPTIONS, AGENT_BY_NAME, PROVIDER_OPTIONS, MODEL_OPTIONS, PRIORITY_OPTIONS } = window.WO;

/* ---------- small atoms ---------- */

function StatusPill({ status, t }) {
  const m = STATUS_META[status];
  const colored = t.statusAccent;
  return (
    <span
      className="wo-status-pill"
      style={{
        color: colored ? m.color : 'var(--text-muted)',
        background: colored ? m.soft : 'var(--background-modifier-hover)',
        borderColor: colored ? 'transparent' : 'var(--border-color)',
      }}
    >
      {m.live ? (
        <span className="wo-live-dot" style={{ background: m.color }} />
      ) : (
        t.icons && <Icon name={m.icon} size={13} />
      )}
      {m.label}
    </span>
  );
}

function PriorityValue({ priority }) {
  const p = PRIORITY_META[priority];
  return (
    <span className="wo-prop-value-inner">
      <span className="wo-priority-bars" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <i key={n} style={{ background: n <= p.bars ? p.color : 'var(--background-modifier-border)' }} />
        ))}
      </span>
      {p.label}
    </span>
  );
}

/* Editable property: a borderless select that reads like Linear's value chips. */
function PropSelect({ value, options, onChange }) {
  return (
    <div className="wo-prop-select">
      <span className="wo-prop-select-label">{value || options[0]}</span>
      <Icon name="chevron-down" size={13} />
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o === 'Provider default' ? '' : o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

function PropAgent({ agentId, editable, onChange }) {
  const a = AGENTS[agentId] || AGENTS.standard;
  if (!editable) {
    return <span className="wo-prop-value-inner"><Avatar agent={a.id} size={18} />{a.name}</span>;
  }
  return (
    <div className="wo-prop-select">
      <span className="wo-prop-select-label wo-prop-agent-label"><Avatar agent={a.id} size={18} />{a.name}</span>
      <Icon name="chevron-down" size={13} />
      <select value={a.name} onChange={(e) => onChange(AGENT_BY_NAME[e.target.value])}>
        {AGENT_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );
}

function PropRow({ icon, label, children, t }) {
  return (
    <div className="wo-prop-row">
      <span className="wo-prop-label">
        {t.icons && <Icon name={icon} size={15} />}
        {label}
      </span>
      <span className="wo-prop-value">{children}</span>
    </div>
  );
}

function Properties({ task, editable, t, onField, strip }) {
  const modelOpts = MODEL_OPTIONS[task.provider] || ['Provider default'];
  return (
    <div className={`wo-props${strip ? ' wo-props-strip' : ''}`}>
      {!strip && <div className="wo-props-head">Properties</div>}

      <PropRow icon="circle-dot" label="Status" t={t}>
        <StatusPill status={task.status} t={t} />
      </PropRow>

      <PropRow icon="user" label="Agent" t={t}>
        <PropAgent agentId={task.agent} editable={editable} onChange={(v) => onField('agent', v)} />
      </PropRow>

      <PropRow icon="cpu" label="Provider" t={t}>
        {editable
          ? <PropSelect value={task.provider} options={PROVIDER_OPTIONS} onChange={(v) => onField('provider', v)} />
          : <span className="wo-prop-value-inner wo-mono">{task.provider}</span>}
      </PropRow>

      <PropRow icon="sparkles" label="Model" t={t}>
        {editable
          ? <PropSelect value={task.model} options={modelOpts} onChange={(v) => onField('model', v)} />
          : <span className="wo-prop-value-inner">{task.model}</span>}
      </PropRow>

      <PropRow icon="signal" label="Priority" t={t}>
        {editable
          ? <PropSelect value={task.priority} options={PRIORITY_OPTIONS} onChange={(v) => onField('priority', v)} />
          : <PriorityValue priority={task.priority} />}
      </PropRow>

      {!strip && <div className="wo-props-divider" />}

      <PropRow icon="calendar" label="Created" t={t}>
        <span className="wo-prop-value-inner wo-muted">{task.created}</span>
      </PropRow>
      <PropRow icon="clock" label="Updated" t={t}>
        <span className="wo-prop-value-inner wo-muted">{task.updated}</span>
      </PropRow>
      <PropRow icon="repeat" label="Attempts" t={t}>
        <span className="wo-prop-value-inner wo-muted">{task.attempts}</span>
      </PropRow>
      {task.conversation && (
        <PropRow icon="message-square" label="Conversation" t={t}>
          <a className="wo-prop-link" href="#" onClick={(e) => e.preventDefault()}>
            {task.conversation}
          </a>
        </PropRow>
      )}
    </div>
  );
}

/* ---------- progress (ring or bar) ---------- */

function ProgressRing({ done, total, color }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const frac = total ? done / total : 0;
  return (
    <svg className="wo-ring" width="22" height="22" viewBox="0 0 22 22">
      <circle cx="11" cy="11" r={r} fill="none" stroke="var(--background-modifier-border)" strokeWidth="2.5" />
      <circle
        cx="11" cy="11" r={r} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - frac)}
        transform="rotate(-90 11 11)" style={{ transition: 'stroke-dashoffset .4s ease' }}
      />
    </svg>
  );
}

function Acceptance({ task, t }) {
  const done = task.acceptance.filter((a) => a.done).length;
  const total = task.acceptance.length;
  const color = done === total && total > 0 ? 'var(--color-green)' : 'var(--color-accent)';
  return (
    <section className="wo-section">
      <div className="wo-section-head">
        <span className="wo-section-title">
          {t.icons && <Icon name="list-checks" size={16} />}
          Acceptance criteria
        </span>
        <span className="wo-ac-meter">
          {t.progressStyle === 'ring'
            ? <ProgressRing done={done} total={total} color={color} />
            : (
              <span className="wo-bar"><span className="wo-bar-fill" style={{ width: `${total ? (done / total) * 100 : 0}%`, background: color }} /></span>
            )}
          <span className="wo-ac-count" style={{ color: done === total && total > 0 ? 'var(--color-green)' : 'var(--text-muted)' }}>
            {done}/{total}
          </span>
        </span>
      </div>
      <ul className="wo-ac-list">
        {task.acceptance.map((a, i) => (
          <li key={i} className={a.done ? 'is-checked' : ''}>
            <span className="wo-ac-box" style={a.done ? { background: 'var(--color-green)', borderColor: 'var(--color-green)' } : undefined}>
              {a.done && <Icon name="check" size={12} stroke={3} />}
            </span>
            {a.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- objective ---------- */

function Objective({ task, t }) {
  return (
    <section className="wo-section">
      <div className="wo-section-head">
        <span className="wo-section-title">
          {t.icons && <Icon name="target" size={16} />}
          Objective
        </span>
      </div>
      <p className="wo-objective">{task.objective}</p>
    </section>
  );
}

/* ---------- collapsible handoff ---------- */

function Collapsible({ icon, title, children, defaultOpen, accent, t }) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  return (
    <div className={`wo-collapse${open ? ' is-open' : ''}`}>
      <button className="wo-collapse-head" onClick={() => setOpen((o) => !o)}>
        <Icon name="chevron-right" size={15} style={{ transition: 'transform .15s ease', transform: open ? 'rotate(90deg)' : 'none' }} />
        {t.icons && icon && <Icon name={icon} size={15} style={{ color: accent }} />}
        <span>{title}</span>
      </button>
      {open && <div className="wo-collapse-body">{children}</div>}
    </div>
  );
}

function Handoff({ task, t }) {
  const h = task.handoff;
  return (
    <section className="wo-section">
      <div className="wo-section-head">
        <span className="wo-section-title">
          {t.icons && <Icon name="clipboard-check" size={16} />}
          Agent handoff
        </span>
      </div>
      <div className="wo-collapse-group">
        <Collapsible title="Summary" icon="file-text" defaultOpen accent="var(--color-blue)" t={t}>
          <p>{h.summary}</p>
        </Collapsible>
        <Collapsible title="Verification" icon="check-square" accent="var(--color-green)" t={t}>
          <p>{h.verification}</p>
        </Collapsible>
        <Collapsible title="Risks" icon="triangle" accent="var(--color-orange)" t={t}>
          <p>{h.risks}</p>
        </Collapsible>
        <Collapsible title="Next action" icon="signal" defaultOpen accent="var(--color-accent)" t={t}>
          <p>{h.nextAction}</p>
        </Collapsible>
      </div>
    </section>
  );
}

/* ---------- needs-handoff salvage + failed ledger ---------- */

function HandoffSalvage({ task, t }) {
  return (
    <section className="wo-section">
      <div className="wo-section-head">
        <span className="wo-section-title">
          {t.icons && <Icon name="triangle" size={16} style={{ color: 'var(--color-orange)' }} />}
          Run finished without a handoff
        </span>
      </div>
      <div className="wo-callout">{task.note}</div>
      <div className="wo-collapse-group" style={{ marginTop: 12 }}>
        <Collapsible title="Transcript tail" icon="scroll-text" defaultOpen accent="var(--color-orange)" t={t}>
          <p className="wo-mono-block">{task.tail}</p>
        </Collapsible>
      </div>
    </section>
  );
}

function Ledger({ task, t }) {
  return (
    <section className="wo-section">
      <div className="wo-section-head">
        <span className="wo-section-title">
          {t.icons && <Icon name="scroll-text" size={16} />}
          Run ledger
        </span>
      </div>
      <ol className="wo-ledger">
        {task.ledger.map((e, i) => (
          <li key={i}>
            <span className="wo-ledger-dot" style={{ background: STATUS_META[e.status].color }} />
            <span className="wo-ledger-time wo-mono">{e.time}</span>
            <span className="wo-ledger-msg">{e.msg}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

window.WOModalParts = { Properties, Objective, Acceptance, Handoff, HandoffSalvage, Ledger, StatusPill };
