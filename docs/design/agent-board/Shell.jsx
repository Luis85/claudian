/* Shell.jsx — modal frame: sticky header, layout-aware scroll body, sticky footer. */

const { Icon, STATUS_META } = window.WO;
const { Properties, Objective, Acceptance, Handoff, HandoffSalvage, Ledger } = window.WOModalParts;

const EDITABLE = new Set(['inbox', 'ready', 'needs_fix']);

/* Footer action sets per status */
function actionsFor(status) {
  switch (status) {
    case 'inbox':         return { sec: ['Open note'], pri: [{ label: 'Mark ready', kind: 'cta', icon: 'check' }] };
    case 'running':       return { sec: ['Open note', 'Open conversation'], pri: [{ label: 'Stop', kind: 'danger', icon: 'square' }] };
    case 'review':        return { sec: ['Open note', 'Open conversation'], pri: [{ label: 'Rework', kind: 'ghost', icon: 'rotate-ccw' }, { label: 'Accept', kind: 'cta', icon: 'check' }] };
    case 'needs_handoff': return { sec: ['Open note', 'Open conversation'], pri: [{ label: 'Mark failed', kind: 'danger', icon: 'triangle' }, { label: 'Send to review', kind: 'cta', icon: 'check' }] };
    case 'done':          return { sec: ['Open note', 'Archive'], pri: [{ label: 'Reopen', kind: 'ghost', icon: 'rotate-ccw' }] };
    case 'failed':        return { sec: ['Open note'], pri: [{ label: 'Archive', kind: 'ghost', icon: 'archive' }] };
    default:              return { sec: ['Open note'], pri: [] };
  }
}

const SEC_ICON = { 'Open note': 'file-text', 'Open conversation': 'message-square', 'Archive': 'archive' };

function Btn({ label, kind, icon, t }) {
  return (
    <button className={`wo-btn wo-btn-${kind}`}>
      {t.icons && icon && <Icon name={icon} size={14} />}
      {label}
    </button>
  );
}

function ActivityBlocks({ task, t }) {
  if (task.handoff) return <Handoff task={task} t={t} />;
  if (task.note) return <HandoffSalvage task={task} t={t} />;
  if (task.ledger) return <Ledger task={task} t={t} />;
  return null;
}

function Header({ task, editable, t, onTitle, onClose }) {
  const m = STATUS_META[task.status];
  return (
    <header className="wo-header" style={{ '--wo-accent': t.statusAccent ? m.color : 'var(--border-color)' }}>
      <div className="wo-header-meta">
        <span className="wo-id-chip wo-mono">{task.id}</span>
        {task.startedAgo && (
          <span className="wo-header-live"><span className="wo-live-dot" style={{ background: m.color }} />{task.startedAgo}</span>
        )}
        {task.finished && <span className="wo-header-sub">{task.finished}</span>}
      </div>
      <h1
        className={`wo-title${editable ? ' is-editable' : ''}`}
        contentEditable={editable}
        suppressContentEditableWarning
        spellCheck={false}
        onBlur={(e) => onTitle(e.target.textContent.trim())}
      >
        {task.title}
      </h1>
      {editable && <span className="wo-title-hint">{t.icons && <Icon name="pencil" size={12} />}Click title to rename</span>}
      <button className="wo-close" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
    </header>
  );
}

function TabbedMain({ task, editable, t, onField }) {
  const hasActivity = !!(task.handoff || task.note || task.ledger);
  const [tab, setTab] = React.useState('overview');
  return (
    <div className="wo-main">
      {hasActivity && (
        <div className="wo-tabs">
          <button className={tab === 'overview' ? 'is-active' : ''} onClick={() => setTab('overview')}>Overview</button>
          <button className={tab === 'activity' ? 'is-active' : ''} onClick={() => setTab('activity')}>
            Activity
            <span className="wo-tab-badge" style={{ background: STATUS_META[task.status].color }} />
          </button>
        </div>
      )}
      {tab === 'overview' ? (
        <>
          <Objective task={task} t={t} />
          <Acceptance task={task} t={t} />
          {!hasActivity && null}
        </>
      ) : (
        <ActivityBlocks task={task} t={t} />
      )}
    </div>
  );
}

function WorkOrderModal({ task, t, onClose, onField, onTitle }) {
  const editable = EDITABLE.has(task.status);
  const acts = actionsFor(task.status);
  const layout = t.layout;

  let body;
  if (layout === 'stacked') {
    body = (
      <div className="wo-body wo-body-stacked">
        <Properties task={task} editable={editable} t={t} onField={onField} strip />
        <div className="wo-main">
          <Objective task={task} t={t} />
          <Acceptance task={task} t={t} />
          <ActivityBlocks task={task} t={t} />
        </div>
      </div>
    );
  } else if (layout === 'tabbed') {
    body = (
      <div className={`wo-body wo-body-split${t.sidebarLeft ? ' is-left' : ''}`}>
        <TabbedMain task={task} editable={editable} t={t} onField={onField} />
        <aside className="wo-aside"><Properties task={task} editable={editable} t={t} onField={onField} /></aside>
      </div>
    );
  } else {
    body = (
      <div className={`wo-body wo-body-split${t.sidebarLeft ? ' is-left' : ''}`}>
        <div className="wo-main">
          <Objective task={task} t={t} />
          <Acceptance task={task} t={t} />
          <ActivityBlocks task={task} t={t} />
        </div>
        <aside className="wo-aside"><Properties task={task} editable={editable} t={t} onField={onField} /></aside>
      </div>
    );
  }

  return (
    <div className={`wo-modal wo-density-${t.density}`}>
      <Header task={task} editable={editable} t={t} onTitle={onTitle} onClose={onClose} />
      {body}
      <footer className="wo-footer">
        <div className="wo-footer-left">
          {acts.sec.map((s) => <Btn key={s} label={s} kind="ghost" icon={SEC_ICON[s]} t={t} />)}
        </div>
        <div className="wo-footer-right">
          {acts.pri.map((p) => <Btn key={p.label} {...p} t={t} />)}
        </div>
      </footer>
    </div>
  );
}

window.WorkOrderModal = WorkOrderModal;
