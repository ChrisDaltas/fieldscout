// The list body — shared by all three versions. One list renders three ways:
//   list   — tiers stacked vertically, roomy rows, two pinned stats
//   table  — tiers stacked vertically, every chosen stat as a column
//   card   — one column PER TIER, running horizontally, players as cards
(function () {
  const NS = window.FieldScoutDesignSystem_d5e2dc;
  const { Icon, Button, IconButton, Badge, Tooltip } = NS;
  const C = window.FS_ListsCommon;
  const S = () => window.FS_LISTS;
  const PL = () => window.FS_PLAYERS;

  const COL_W = 86;

  // Rank order has no natural tiers; card view chunks it into blocks of ten so
  // there is still something to put in columns.
  function bucketsFor(list, view) {
    const st = S();
    if (view !== "card" || list.org !== "rank") return st.buckets(list);
    const out = [];
    for (let i = 0; i < list.entries.length; i += 10) {
      out.push({ key: "blk" + i, label: (i + 1) + "–" + Math.min(list.entries.length, i + 10), entries: list.entries.slice(i, i + 10), color: "var(--surface-card)", textColor: "var(--text-primary)" });
    }
    return out.length ? out : [{ key: "blk0", label: "1–10", entries: [], color: "var(--surface-card)", textColor: "var(--text-primary)" }];
  }

  function NoteTip({ note, children }) {
    const ref = React.useRef(null);
    const [box, setBox] = React.useState(null);
    const show = () => {
      const r = ref.current && ref.current.getBoundingClientRect();
      if (!r) return;
      const w = 260;
      setBox({ left: Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)), top: r.bottom + 8, w: w });
    };
    return (
      <span ref={ref} onMouseEnter={show} onMouseLeave={() => setBox(null)} style={{ display: "flex" }}>
        {children}
        {box && ReactDOM.createPortal(
          <div style={{ position: "fixed", left: box.left, top: box.top, width: box.w, zIndex: 9000, padding: "9px 11px", background: "var(--surface-card)", color: "var(--text-primary)", border: "var(--border)", boxShadow: "var(--shadow-8)", fontSize: 11.5, fontWeight: 500, lineHeight: 1.45, textWrap: "pretty", pointerEvents: "none" }}>{note}</div>,
          document.body)}
      </span>
    );
  }

  // A note is a mark, not a paragraph — hover to read it.
  function NoteMark({ en, onNote, size = 13 }) {
    if (!en.note) return null;
    return (
      <NoteTip note={en.note}>
        <button onClick={(ev) => { ev.stopPropagation(); onNote(en.name); }} title="Note"
          style={{ border: "none", background: "none", padding: 2, cursor: "pointer", display: "flex", flexShrink: 0 }}>
          <Icon name="comments" size={size} fill="var(--accent)" />
        </button>
      </NoteTip>
    );
  }

  function SectionAdd({ b, onAddTo, sticky }) {
    if (!b.label || !onAddTo) return null;
    return (
      <button onClick={(ev) => { ev.stopPropagation(); onAddTo(b); }} title={"Add a player to " + b.label} className="fs-ghosthover"
        style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 22, padding: "0 6px", border: "none", background: "transparent", cursor: "pointer", font: "inherit", fontSize: 11.5, fontWeight: 500, color: "currentColor", opacity: 0.85, flexShrink: 0, ...(sticky ? { position: "sticky", right: 4 } : null) }}>
        Add <Icon name="plus" size={12} fill="currentColor" />
      </button>
    );
  }

  function BucketLabel({ b, list, size = 12.5, short }) {
    const st = S();
    const [editing, setEditing] = React.useState(false);
    const [draft, setDraft] = React.useState(b.label);
    const canEdit = b.editable && st.mine(list);
    const save = () => { st.setBandLabel(list, b.key, draft); setEditing(false); };
    return (
      <React.Fragment>
        {editing ? (
          <input autoFocus value={draft} onChange={(ev) => setDraft(ev.target.value)} onBlur={save}
            onKeyDown={(ev) => { if (ev.key === "Enter") save(); if (ev.key === "Escape") { setDraft(b.label); setEditing(false); } }}
            onClick={(ev) => ev.stopPropagation()}
            style={{ width: 118, height: 24, padding: "0 6px", border: "var(--border)", borderRadius: "var(--radius-sm)", background: "var(--surface-card)", color: "var(--text-primary)", font: "inherit", fontSize: size, fontWeight: 700 }} />
        ) : canEdit ? (
          <button onClick={(ev) => { ev.stopPropagation(); setDraft(b.label); setEditing(true); }} title="Rename this band"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "none", background: "none", padding: 0, cursor: "text", font: "inherit", fontSize: size, fontWeight: 700, color: "inherit", whiteSpace: "nowrap", textAlign: "left" }}>
            {b.label}<Icon name="edit" size={11} fill="currentColor" style={{ opacity: 0.6 }} />
          </button>
        ) : (
          <span style={{ fontSize: size, fontWeight: 700, lineHeight: 1.1, whiteSpace: short ? "normal" : "nowrap" }}>{short ? String(b.label).replace(/^(Tier|Round)\s+/i, "") : b.label}</span>
        )}
      </React.Fragment>
    );
  }

  function BucketHead({ b, list, style, onAddTo, sticky }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 8px 0 12px", height: 36, background: b.color, color: b.textColor, borderBottom: "var(--border)", ...style }}>
        <BucketLabel b={b} list={list} short />
        <span style={{ marginRight: "auto" }} />
        {b.meta && <span className="fs-num" style={{ fontSize: 11.5, fontWeight: 500 }}>{b.meta}</span>}
        <SectionAdd b={b} onAddTo={onAddTo} sticky={sticky} />
      </div>
    );
  }

  // ---------------- table ----------------
  function TableRow({ list, en, rank, dnd, bucket, idx, onNote, minW, sel, onSel }) {
    const st = S(); const P = PL();
    const p = st.player(en);
    if (!p) return null;
    const share = list.budget ? Math.round((en.cost / list.budget) * 100) : 0;
    return (
      <div {...dnd.rowProps(en.name, bucket, idx)} onClick={() => onSel && onSel(en.name)} className="fs-rowh"
        style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "0 12px", height: 44, minWidth: minW, transition: "opacity 120ms linear", borderBottom: "1px solid var(--n-4)", background: sel === en.name ? "var(--accent-soft)" : en.drafted ? "var(--surface-sunken)" : "var(--surface-card)", cursor: onSel ? "pointer" : "default", opacity: dnd.drag === en.name ? 0.35 : 1 }}>
        <C.Grip />
        <span className="fs-num" style={{ width: 30, flexShrink: 0, fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>#{rank}</span>
        {window.FS_PlayerFace ? <window.FS_PlayerFace name={p.name} size={26} open={!onSel} /> : null}
        <span style={{ minWidth: 120, flex: "1 1 160px", display: "flex", alignItems: "center", gap: 7, overflow: "hidden" }}>
          <span style={{ fontWeight: 700, fontSize: 13, minWidth: 54, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: en.drafted ? "line-through" : "none" }}>
            {window.FS_PlayerLink ? <window.FS_PlayerLink name={p.name}>{C.shortName(p.name, 18)}</window.FS_PlayerLink> : C.shortName(p.name, 18)}
          </span>
          <NS.PositionBadge position={p.pos} style={{ height: 17, minWidth: 25, fontSize: 9, padding: "0 5px", flexShrink: 0 }} />
          <span className="fs-num" style={{ fontSize: 11, fontWeight: 500, color: "var(--n-3)", whiteSpace: "nowrap" }}>{p.team}</span>
          {p.status === "Q" && <Badge variant="yellow" style={{ height: 16, fontSize: 9, flexShrink: 0 }}>Q</Badge>}
          {p.status === "O" && <Badge variant="pink" style={{ height: 16, fontSize: 9, flexShrink: 0 }}>Out</Badge>}
        </span>
        {list.org === "budget" && (
          <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, width: 130 }}>
            <span style={{ flex: 1, height: 8, border: "var(--border)", background: "var(--surface-sunken)", position: "relative" }}>
              <span style={{ position: "absolute", inset: 0, width: Math.min(100, share * 2.5) + "%", background: "var(--brand)" }} />
            </span>
            <span className="fs-num" style={{ fontSize: 11.5, fontWeight: 500, width: 30, textAlign: "right" }}>{share}%</span>
          </span>
        )}
        {list.cols.map((cid) => (
          <span key={cid} style={{ width: COL_W, flexShrink: 0, textAlign: "right" }}>
            <span className="fs-num" style={{ fontSize: 13, fontWeight: 600 }}>{P.fmt(p, cid)}</span>
          </span>
        ))}
        <span style={{ width: 30, flexShrink: 0, display: "flex", justifyContent: "center" }}>
          <NoteMark en={en} onNote={onNote} size={14} />
        </span>
        <span onClick={(ev) => ev.stopPropagation()} style={{ display: "flex" }}><C.RowMenu list={list} name={en.name} onNote={onNote} /></span>
      </div>
    );
  }

  function TableView({ list, dnd, onNote, onAdd, onAddTo, sel, onSel }) {
    const P = PL();
    const buckets = bucketsFor(list, "table");
    const minW = 336 + (list.org === "budget" ? 140 : 0) + list.cols.length * (COL_W + 10);
    let n = 0;
    return (
      <div className="fs-lift" style={{ border: "var(--border)", background: "var(--surface-card)", overflowX: "auto", overscrollBehaviorX: "contain" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 12px", height: 36, minWidth: minW, borderBottom: "var(--border)", background: "var(--surface-card)" }}>
          <span style={{ width: 12 }} />
          <span style={{ width: 26, fontSize: 10, fontWeight: 500, color: "var(--n-3)" }}>#</span>
          <span style={{ width: 26 }} />
          <span style={{ flex: 1, fontSize: 10.5, fontWeight: 500, color: "var(--n-3)" }}>Player</span>
          {list.org === "budget" && <span style={{ width: 130, fontSize: 10.5, fontWeight: 500, color: "var(--n-3)", textAlign: "right" }}>Share of budget</span>}
          {list.cols.map((cid) => (
            <Tooltip key={cid} label={P.STAT[cid].full}>
              <span style={{ width: COL_W, flexShrink: 0, textAlign: "right", fontSize: 10.5, fontWeight: 500, color: "var(--n-3)", cursor: "help" }}>{P.STAT[cid].label}</span>
            </Tooltip>
          ))}
          <span style={{ width: 30 }} />
          <span style={{ width: 28 }} />
        </div>
        {buckets.map((b) => (
          <div key={b.key}>
            {b.label && <div {...dnd.bucketProps(b)} style={{ outline: dnd.overBucket === b.key ? "3px solid var(--accent)" : "none", outlineOffset: -3 }}>
              <BucketHead b={b} list={list} onAddTo={onAddTo} sticky style={{ minWidth: minW, height: 32, borderTop: "var(--border)" }} />
            </div>}
            {b.entries.map((en, i) => { n += 1; return (
              <React.Fragment key={en.name}>
                <C.DropGap dnd={dnd} bucket={b} index={i} minWidth={minW} />
                <TableRow list={list} en={en} rank={n} dnd={dnd} bucket={b} idx={i} onNote={onNote} minW={minW} sel={sel} onSel={onSel} />
              </React.Fragment>); })}
            {!!b.entries.length && <C.DropGap dnd={dnd} bucket={b} index={b.entries.length} minWidth={minW} />}
          </div>
        ))}
      </div>
    );
  }

  // ---------------- list ----------------
  function ListRow({ list, en, rank, dnd, bucket, idx, onNote, sel, onSel, minW }) {
    const st = S(); const P = PL();
    const p = st.player(en);
    if (!p) return null;
    const on = sel === en.name;
    return (
      <div {...dnd.rowProps(en.name, bucket, idx)} onClick={() => onSel && onSel(en.name)} className="fs-rowh"
        style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "0 12px", height: 60, minWidth: minW, transition: "opacity 120ms linear", borderBottom: "1px solid var(--n-4)", background: on ? "var(--accent-soft)" : en.drafted ? "var(--surface-sunken)" : "var(--surface-card)", cursor: onSel ? "pointer" : "default", opacity: dnd.drag === en.name ? 0.35 : 1 }}>
        <C.Grip />
        <span className="fs-num" style={{ width: 30, flexShrink: 0, fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)" }}>#{rank}</span>
        {window.FS_PlayerFace ? <window.FS_PlayerFace name={p.name} size={30} open={!onSel} /> : null}
        <span style={{ flex: "1 1 160px", minWidth: 130, overflow: "hidden" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
            <span style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.15, minWidth: 54, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: en.drafted ? "line-through" : "none" }}>
              {window.FS_PlayerLink ? <window.FS_PlayerLink name={p.name}>{C.shortName(p.name, 22)}</window.FS_PlayerLink> : C.shortName(p.name, 22)}
            </span>
            <NoteMark en={en} onNote={onNote} size={13} />
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, minWidth: 0 }}>
            <NS.PositionBadge position={p.pos} style={{ height: 16, minWidth: 24, fontSize: 9, padding: "0 5px", flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 500, lineHeight: 1, color: "var(--n-3)", whiteSpace: "nowrap" }}>{p.team}</span>
          </span>
        </span>
        {list.cols.map((cid) => (
          <span key={cid} style={{ flexShrink: 0, textAlign: "right", width: 62 }}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 500, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{P.fmt(p, cid)}</span>
            <span style={{ display: "block", marginTop: 4, fontSize: 9.5, fontWeight: 400, lineHeight: 1, color: "var(--n-3)", whiteSpace: "nowrap" }}>{P.STAT[cid].label}</span>
          </span>
        ))}
        <span onClick={(ev) => ev.stopPropagation()} style={{ display: "flex" }}><C.RowMenu list={list} name={en.name} onNote={onNote} /></span>
      </div>
    );
  }

  function ListView({ list, dnd, onNote, onAdd, onAddTo, sel, onSel }) {
    const buckets = bucketsFor(list, "list");
    const canAdd = list.org === "tier" || list.org === "round";
    const nextVal = () => Math.max(0, ...list.entries.map((e) => (list.org === "round" ? e.round : e.tier))) + 1;
    const minW = 330 + list.cols.length * 72;
    let n = 0;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {buckets.map((b) => (
          <div key={b.key} {...dnd.bucketProps(b)} className="fs-lift"
            style={{ border: "var(--border)", background: "var(--surface-card)", overflowX: "auto", outline: dnd.overBucket === b.key ? "3px solid var(--accent)" : "none", outlineOffset: -3 }}>
            {b.label
              ? <BucketHead b={b} list={list} onAddTo={onAddTo} style={{ height: 40, minWidth: minW }} />
              : null}
            {b.entries.map((en, i) => { n += 1; return (
              <React.Fragment key={en.name}>
                <C.DropGap dnd={dnd} bucket={b} index={i} minWidth={minW} />
                <ListRow list={list} en={en} rank={n} dnd={dnd} bucket={b} idx={i} onNote={onNote} sel={sel} onSel={onSel} minW={minW} />
              </React.Fragment>); })}
            {!!b.entries.length && <C.DropGap dnd={dnd} bucket={b} index={b.entries.length} minWidth={minW} />}
            {!b.entries.length && <div style={{ padding: 18, fontSize: 12, fontWeight: 600, color: "var(--n-3)", textAlign: "center" }}>Empty — drop a player here.</div>}
          </div>
        ))}
        {canAdd && (
          <div {...dnd.bucketProps({ key: "new", bucketKey: list.org === "round" ? "round" : "tier", value: nextVal() })}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 52, border: "1px dashed var(--n-1)", color: "var(--n-3)", fontSize: 12, fontWeight: 700, outline: dnd.overBucket === "new" ? "3px solid var(--accent)" : "none", outlineOffset: -3 }}>
            <Icon name="plus" size={14} fill="currentColor" />
            <span>Drop a player here to start {list.org === "round" ? "round " : "tier "}{nextVal()}</span>
          </div>
        )}
      </div>
    );
  }

  // ---------------- card ----------------
  function StatGrid({ p, cols, P, style }) {
    if (!cols.length) return null;
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(" + cols.length + ", 1fr)", borderTop: "1.25px solid var(--n-1)", ...style }}>
        {cols.map((cid) => (
          <span key={cid} style={{ minWidth: 0, padding: "6px 1px 5px", textAlign: "center" }}>
            <span style={{ display: "block", fontSize: 15, fontWeight: 500, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{P.fmt(p, cid)}</span>
            <span style={{ display: "block", marginTop: 3, fontSize: 10, fontWeight: 400, lineHeight: 1, color: "var(--n-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{P.STAT[cid].label}</span>
          </span>
        ))}
      </div>
    );
  }

  function SquareCardTile({ list, en, rank, dnd, bucket, idx, onNote, sel, onSel }) {
    const [hover, setHover] = React.useState(false);
    const st = S(); const P = PL();
    const p = st.player(en);
    if (!p) return null;
    const cols = list.cols.slice(0, 3);
    const pr = P.posRank(p);
    return (
      <div {...dnd.rowProps(en.name, bucket, idx, true)} onClick={() => onSel && onSel(en.name)} className="fs-lift"
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{ position: "relative", width: 164, flexShrink: 0, alignSelf: "flex-start", marginRight: 10, marginBottom: 10, transition: "opacity 120ms linear, box-shadow 200ms linear", border: "1.25px solid var(--n-1)", background: sel === en.name ? "var(--accent-soft)" : en.drafted ? "var(--surface-sunken)" : "var(--surface-card)", outline: sel === en.name ? "2px solid var(--accent)" : "none", outlineOffset: -2, display: "flex", flexDirection: "column", cursor: onSel ? "pointer" : "grab", opacity: dnd.drag === en.name ? 0.35 : 1 }}>
        <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 6px 7px" }}>
          <span style={{ position: "absolute", top: 0, left: 0, display: "inline-flex", alignItems: "center", height: 22, padding: "0 7px", borderRight: "1.25px solid var(--n-1)", borderBottom: "1.25px solid var(--n-1)", background: (bucket && bucket.label && bucket.bucketKey) ? bucket.color : "var(--brand)", color: (bucket && bucket.label && bucket.bucketKey) ? bucket.textColor : "var(--n-1)", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>
            <span className="fs-num">#{rank}</span>
          </span>
          <span className="fs-num" style={{ position: "absolute", top: 0, right: 0, display: "inline-flex", alignItems: "center", height: 22, padding: "0 7px", borderLeft: "1.25px solid var(--n-1)", borderBottom: "1.25px solid var(--n-1)", fontSize: 13, fontWeight: 700, lineHeight: 1, color: "var(--text-primary)" }}>{P.ord(pr.rank)}</span>
          <span style={{ width: 38, height: 38, marginTop: 8, borderRadius: "var(--radius-pill)", overflow: "hidden", border: "var(--border)", flexShrink: 0, display: "block" }}>
            {window.FS_PlayerFace ? <window.FS_PlayerFace name={p.name} size={38} /> : null}
          </span>
          <span style={{ maxWidth: "100%", fontWeight: 600, fontSize: 15, lineHeight: 1, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: en.drafted ? "line-through" : "none" }}>
            {window.FS_PlayerLink ? <window.FS_PlayerLink name={p.name}>{C.shortName(p.name, 14)}</window.FS_PlayerLink> : C.shortName(p.name, 14)}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {(hover || en.drafted) && (
              <button onClick={(ev) => { ev.stopPropagation(); st.toggleDrafted(list, en.name); }} title={en.drafted ? "Mark undrafted" : "Mark drafted"}
                style={{ width: 16, height: 16, flexShrink: 0, border: "none", background: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                <span style={{ width: 14, height: 14, border: "1.25px solid var(--n-1)", borderRadius: "var(--radius-sm)", background: en.drafted ? "var(--positive)" : "var(--surface-card)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  {en.drafted && <Icon name="check" size={9} fill="var(--n-1)" />}
                </span>
              </button>
            )}
            <NS.PositionBadge position={p.pos} style={{ height: 17, minWidth: 26, fontSize: 9.5, padding: "0 5px" }} />
            <span style={{ fontSize: 12, fontWeight: 500, lineHeight: 1, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{p.team}</span>
            <NoteMark en={en} onNote={onNote} size={12} />
          </span>
          <span onClick={(ev) => ev.stopPropagation()}
            style={{ position: "absolute", top: 0, right: 0, display: "inline-flex", border: "1.25px solid var(--n-1)", background: "var(--surface-card)", opacity: hover ? 1 : 0, pointerEvents: hover ? "auto" : "none", transition: "opacity 150ms linear" }}>
            <C.RowMenu list={list} name={en.name} onNote={onNote} noDrafted />
          </span>
        </div>
        <StatGrid p={p} cols={cols} P={P} />
      </div>
    );
  }

  function CardView({ list, dnd, onNote, onAdd, onAddTo, sel, onSel }) {
    const buckets = bucketsFor(list, "card");
    const canAdd = list.org === "tier" || list.org === "round";
    const nextVal = () => Math.max(0, ...list.entries.map((e) => (list.org === "round" ? e.round : e.tier))) + 1;
    let n = 0;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {buckets.map((b) => {
          const grouped = !!(b.label && b.bucketKey);
          return (
          <div key={b.key} {...dnd.bucketProps(b)} className={grouped ? "fs-lift" : undefined}
            style={grouped
              ? { display: "flex", alignItems: "stretch", border: "var(--border)", background: "var(--surface-card)", outline: dnd.overBucket === b.key ? "3px solid var(--accent)" : "none", outlineOffset: -3 }
              : { display: "flex", alignItems: "stretch" }}>
            {grouped && (
              <div style={{ width: 62, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", gap: 1, padding: "10px 6px", background: b.color, color: b.textColor, borderRight: "var(--border)" }}>
                <span style={{ fontSize: list.org === "cost" ? 11 : 22, fontWeight: 700, lineHeight: 1.1, textAlign: "center" }}>
                  <BucketLabel b={b} list={list} size={list.org === "cost" ? 11 : 22} short />
                </span>
                <SectionAdd b={b} onAddTo={onAddTo} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "flex-start", alignContent: "flex-start", padding: grouped ? "10px 0 0 10px" : 0 }}>
              {b.entries.map((en, i) => { n += 1; return (
                <React.Fragment key={en.name}>
                  <C.DropGap dnd={dnd} bucket={b} index={i} axis="x" />
                  <SquareCardTile list={list} en={en} rank={n} dnd={dnd} bucket={b} idx={i} onNote={onNote} sel={sel} onSel={onSel} />
                </React.Fragment>); })}
              {!!b.entries.length && <C.DropGap dnd={dnd} bucket={b} index={b.entries.length} axis="x" />}
              {!b.entries.length && <div style={{ display: "flex", alignItems: "center", padding: "14px 6px 22px", fontSize: 11.5, fontWeight: 500, color: "var(--n-3)" }}>Drop a player here</div>}
            </div>
          </div>
          );
        })}
        {canAdd && (
          <div {...dnd.bucketProps({ key: "new", bucketKey: list.org === "round" ? "round" : "tier", value: nextVal() })}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 52, border: "1px dashed var(--n-1)", color: "var(--n-3)", fontSize: 12, fontWeight: 700, outline: dnd.overBucket === "new" ? "3px solid var(--accent)" : "none", outlineOffset: -3 }}>
            <Icon name="plus" size={14} fill="currentColor" />
            <span>Drop a player here to start {list.org === "round" ? "round " : "tier "}{nextVal()}</span>
          </div>
        )}
      </div>
    );
  }

  // ---------------- switch ----------------
  function ListBody({ list, onNote, onAdd, onAddTo, sel, onSel }) {
    const dnd = C.useDrag(list);
    const body = list.view === "card"
      ? <CardView list={list} dnd={dnd} onNote={onNote} onAdd={onAdd} onAddTo={onAddTo} sel={sel} onSel={onSel} />
      : list.view === "table"
      ? <TableView list={list} dnd={dnd} onNote={onNote} onAdd={onAdd} onAddTo={onAddTo} sel={sel} onSel={onSel} />
      : <ListView list={list} dnd={dnd} onNote={onNote} onAdd={onAdd} onAddTo={onAddTo} sel={sel} onSel={onSel} />;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {body}
      </div>
    );
  }

  // Shared toolbar: organise-by, scope, view style, stats modal, add players.
  function ListToolbar({ list, onStats, onAdd, statsLabel }) {
    const st = S();
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <NS.Menu align="left" width={170}
          trigger={
            <button className="fs-bareselect" style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 4px 0 0", font: "inherit", fontSize: 20, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
              {(st.ORGS.find((o) => o.id === list.org) || st.ORGS[0]).label}
              <Icon name="arrow-bottom" size={20} fill="currentColor" />
            </button>}
          onSelect={(it) => st.patch(list, { org: it.id })}
          items={st.ORGS.map((o) => ({ id: o.id, label: o.label }))} />
        <div style={{ display: "flex", border: "var(--border)", background: "var(--surface-card)", flexShrink: 0 }}>
          {st.VIEWS.map((v) => (
            <button key={v.id} onClick={() => st.patch(list, { view: v.id })} title={v.label + " view"} className="fs-seg" data-active={list.view === v.id ? "true" : undefined}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 32, border: "none", borderRight: "1px solid var(--n-4)", cursor: "pointer" }}>
              <Icon name={v.icon} size={16} fill="currentColor" />
            </button>
          ))}
        </div>
        <C.KeyButton size="sm" onClick={onStats}>
          <C.Gear size={15} style={{ marginRight: 7 }} />{statsLabel || "Stats"} <span className="fs-num" style={{ marginLeft: 6, opacity: 0.7 }}>{list.cols.length}</span>
        </C.KeyButton>
        <Button size="sm" variant="purple" shadow iconLeft="plus" onClick={onAdd} style={{ marginLeft: "auto" }}>Add players</Button>
      </div>
    );
  }

  window.FS_ListsBody = { ListBody, ListToolbar, bucketsFor };
})();
