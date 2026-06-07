/* Board.jsx — Agent Board: borderless columns, minimal cards, hover actions. */

const { Icon, Avatar, STATUS_META, PRIORITY_META } = window.WO;
const { CARD_ACTIONS, MENU_ICON } = window.BOARD;

/* ---------- tiny atoms ---------- */

function PriorityTag({ priority }) {
  const p = PRIORITY_META[priority];
  return (
    <span className="ab-prio" title={`Priority: ${p.label}`}>
      <span className="ab-prio-bars" aria-hidden="true">
        {[1, 2, 3].map((n) => <i key={n} style={{ background: n <= p.bars ? p.color : 'var(--background-modifier-border)' }} />)}
      </span>
      {p.label}
    </span>
  );
}

function MiniProgress({ done, total, t }) {
  if (!total) return null;
  const complete = done === total;
  const color = complete ? 'var(--color-green)' : 'var(--color-accent)';
  return (
    <span className="ab-progress" title={`Acceptance ${done}/${total}`}>
      <span className="ab-progress-track"><span className="ab-progress-fill" style={{ width: `${(done / total) * 100}%`, background: color }} /></span>
      <span className="ab-progress-count" style={complete ? { color: 'var(--color-green)' } : undefined}>{done}/{total}</span>
    </span>
  );
}

function StatusDot({ status }) {
  const m = STATUS_META[status];
  if (m.live) return <span className="ab-dot ab-dot-live" style={{ background: m.color }} title={m.label} />;
  return <span className="ab-dot" style={{ background: m.color }} title={m.label} />;
}

/* ---------- overflow menu ---------- */

function CardMenu({ items, onAny }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ top: 0, left: 0, drop: 'down' });
  const ref = React.useRef(null);
  const btnRef = React.useRef(null);

  const place = React.useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const menuW = 180;
    const menuH = items.length * 34 + 8;
    const dropUp = r.bottom + menuH + 8 > window.innerHeight && r.top - menuH > 0;
    setPos({
      top: dropUp ? r.top - menuH - 4 : r.bottom + 4,
      left: Math.max(8, Math.min(r.right - menuW, window.innerWidth - menuW - 8)),
      drop: dropUp ? 'up' : 'down',
    });
  }, [items.length]);

  React.useEffect(() => {
    if (!open) return;
    place();
    const close = (e) => { if (ref.current && !ref.current.contains(e.target) && btnRef.current && !btnRef.current.contains(e.target)) setOpen(false); };
    const reflow = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', reflow, true);
    window.addEventListener('resize', reflow);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', reflow, true);
      window.removeEventListener('resize', reflow);
    };
  }, [open, place]);

  return (
    <span className="ab-menu">
      <button ref={btnRef} className="ab-icon-btn" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} aria-label="More actions">⋯</button>
      {open && (
        <div ref={ref} className="ab-menu-pop" style={{ top: pos.top, left: pos.left }} onClick={(e) => e.stopPropagation()}>
          {items.map((label) => (
            <button key={label} className={`ab-menu-item${/fail|stop|archive/i.test(label) ? ' is-danger' : ''}`} onClick={() => { setOpen(false); onAny(label); }}>
              <Icon name={MENU_ICON[label] || 'file-text'} size={14} />
              {label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/* ---------- live strip (running / needs_input) ---------- */

function LiveStrip({ live }) {
  const tierColor = live.tier === 'green' ? 'var(--color-green)' : live.tier === 'amber' ? 'var(--color-yellow)' : 'var(--color-red)';
  return (
    <div className="ab-live">
      <span className="ab-live-meta">
        <span className="ab-live-dot" style={{ background: tierColor }} />
        {live.elapsed} · attempt {live.attempt}
      </span>
      <span className="ab-live-ledger" title={live.ledger}>{live.ledger}</span>
    </div>
  );
}

/* ---------- inline reply (needs_input) ---------- */

function ReplySurface({ reply }) {
  return (
    <div className="ab-reply" onClick={(e) => e.stopPropagation()}>
      <div className="ab-reply-prompt">{reply.prompt}</div>
      <input className="ab-reply-field" type="text" placeholder="Your reply…" />
      <div className="ab-reply-actions">
        <button className="ab-btn ab-btn-cta">Send</button>
        <button className="ab-btn ab-btn-ghost">Stop</button>
      </div>
    </div>
  );
}

/* ---------- card ---------- */

function Card({ card, t }) {
  const acts = CARD_ACTIONS[card.status] || { primary: null, menu: ['Open note'] };
  const accent = STATUS_META[card.status].color;
  const showReply = !!card.reply;
  const noop = () => {};

  return (
    <div
      className={`ab-card ab-accent-${t.accent} ab-card--${card.status}`}
      style={t.accent === 'bar' ? { '--ab-accent': accent } : undefined}
    >
      <div className="ab-card-top">
        <span className="ab-card-title-wrap">
          {t.accent === 'dot' && <StatusDot status={card.status} />}
          <span className="ab-card-title">{card.title}</span>
        </span>
        <span className="ab-card-hover">
          {acts.primary && (
            <button
              className={`ab-btn ${acts.primary.danger ? 'ab-btn-danger' : acts.primary.ghost ? 'ab-btn-ghost' : 'ab-btn-cta'}`}
              onClick={(e) => { e.stopPropagation(); noop(); }}
            >
              {acts.primary.icon && <Icon name={acts.primary.icon} size={13} />}
              {acts.primary.label}
            </button>
          )}
          <CardMenu items={acts.menu} onAny={noop} />
        </span>
      </div>

      {t.meta && (
        <div className="ab-card-meta">
          <span className="ab-card-engine">{card.provider} <span className="ab-sep">/</span> {card.model}</span>
          <PriorityTag priority={card.priority} />
        </div>
      )}

      {!showReply && ((t.progress && card.total > 0) || t.assignee) && (
        <div className="ab-card-foot">
          {t.progress && card.total > 0
            ? <MiniProgress done={card.done} total={card.total} t={t} />
            : <span className="ab-foot-spacer" />}
          {t.assignee && <Avatar agent={card.agent} size={20} />}
        </div>
      )}

      {card.live && !showReply && <LiveStrip live={card.live} />}
      {showReply && <ReplySurface reply={card.reply} />}
    </div>
  );
}

/* ---------- lane (column) ---------- */

function Lane({ lane, t }) {
  const [collapsed, setCollapsed] = React.useState(false);

  if (lane.collapsible && collapsed) {
    return (
      <button className={`ab-lane-collapsed ab-lane-style-${t.lane}`} onClick={() => setCollapsed(false)} aria-label={`Expand ${lane.title}`}>
        <Icon name="chevron-right" size={14} />
        <span className="ab-lane-vert">{lane.title}</span>
        <span className="ab-lane-count">{lane.cards.length}</span>
      </button>
    );
  }

  return (
    <section className={`ab-lane ab-lane-style-${t.lane}`}>
      <header className="ab-lane-head">
        <span className="ab-lane-title">{lane.title}</span>
        <span className="ab-lane-head-right">
          <span className="ab-lane-count">{lane.cards.length}</span>
          {lane.collapsible && (
            <button className="ab-icon-btn ab-lane-collapse" onClick={() => setCollapsed(true)} aria-label="Collapse lane"><Icon name="chevron-down" size={14} /></button>
          )}
        </span>
      </header>
      <div className="ab-lane-cards">
        {lane.cards.map((c) => <Card key={c.id} card={c} t={t} />)}
        {lane.id === 'backlog' && (
          <button className="ab-add-card">+ Add work order</button>
        )}
      </div>
    </section>
  );
}

window.BoardParts = { Lane, Card };
