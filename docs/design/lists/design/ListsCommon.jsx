// Shared pieces for the three list-page versions: store hook, drag helpers,
// cover art, the stat picker, and the modals (add players, share, note,
// links, expanded list).
(function () {
  const NS = window.FieldScoutDesignSystem_d5e2dc;
  const { Icon, Button, IconButton, Badge, Field, Modal, Menu, FilterChip, Checkbox, Avatar, Tooltip, Switch } = NS;
  const S = () => window.FS_LISTS;
  const PL = () => window.FS_PLAYERS;

  // ---------- store ----------
  function useStore() {
    const [, force] = React.useState(0);
    React.useEffect(() => S().subscribe(() => force((n) => n + 1)), []);
    return S();
  }

  // ---------- drag & drop ----------
  // Rows never light up themselves — the GAP the player will land in opens up
  // to exactly the height of the row being dragged, so the list shows you the
  // hole before you let go. One hook drives all three view styles.
  function useDrag(list, opts) {
    const [drag, setDrag] = React.useState(null);   // name being dragged
    const [dragH, setDragH] = React.useState(44);   // size of the hole it leaves
    const [dragW, setDragW] = React.useState(196);
    const [gap, setGap] = React.useState(null);     // "g:<bucket>:<index>"
    const [overBucket, setOverBucket] = React.useState(null);
    const end = () => { setDrag(null); setGap(null); setOverBucket(null); };
    const gapKey = (bucket, i) => "g:" + (bucket ? bucket.key : "-") + ":" + i;
    // Only ever set state when the target slot actually changed — dragover
    // fires continuously and a re-render per event is what made this jump.
    const aim = (k) => { setGap((p) => (p === k ? p : k)); setOverBucket((p) => (p === null ? p : null)); };
    const slot = (ev, idx, horiz) => {
      const r = ev.currentTarget.getBoundingClientRect();
      const past = horiz ? ev.clientX - r.left > r.width / 2 : ev.clientY - r.top > r.height / 2;
      return (idx || 0) + (past ? 1 : 0);
    };
    const commit = (bucket, i) => {
      const arr = (bucket && bucket.entries) || list.entries;
      const b = bucket && bucket.bucketKey ? { [bucket.bucketKey]: bucket.value } : null;
      const before = arr[i];
      if (before) { if (before.name !== drag) S().move(list, drag, before.name, b); }
      else {
        const last = arr[arr.length - 1];
        if (last && last.name !== drag) S().moveAfter(list, drag, last.name, b);
        else if (b) S().moveToBucket(list, drag, b);
      }
      if (opts && opts.onDrop) opts.onDrop(drag);
      end();
    };
    return {
      drag, dragH, dragW, gap, overBucket,
      rowProps: (name, bucket, idx, horiz) => ({
        draggable: true,
        onDragStart: (ev) => {
          ev.dataTransfer.effectAllowed = "move";
          try { ev.dataTransfer.setData("text/plain", name); } catch (e) {}
          const el = ev.currentTarget;
          setDragH(Math.max(28, el.offsetHeight));
          setDragW(Math.max(80, el.offsetWidth));
          setDrag(name);
        },
        onDragEnd: end,
        onDragOver: (ev) => { if (!drag) return; ev.preventDefault(); ev.stopPropagation(); aim(gapKey(bucket, slot(ev, idx, horiz))); },
        onDrop: (ev) => { ev.preventDefault(); ev.stopPropagation(); if (!drag) return end(); commit(bucket, slot(ev, idx, horiz)); },
      }),
      gapProps: (bucket, i) => ({
        on: gap === gapKey(bucket, i),
        onDragOver: (ev) => { if (!drag) return; ev.preventDefault(); ev.stopPropagation(); aim(gapKey(bucket, i)); },
        onDrop: (ev) => { ev.preventDefault(); ev.stopPropagation(); if (!drag) return end(); commit(bucket, i); },
      }),
      bucketProps: (bucket) => ({
        onDragOver: (ev) => { if (!drag) return; ev.preventDefault(); setOverBucket((p) => (p === bucket.key ? p : bucket.key)); setGap((p) => (p === null ? p : null)); },
        onDragLeave: () => setOverBucket((k) => (k === bucket.key ? null : k)),
        onDrop: (ev) => {
          ev.preventDefault();
          if (!drag) return end();
          if (bucket.bucketKey) S().moveToBucket(list, drag, { [bucket.bucketKey]: bucket.value });
          else if (bucket.band) S().setCost(list, drag, Math.round(list.budget * (bucket.band.min || 0.02)) + 1);
          end();
        },
      }),
    };
  }

  // The slot itself. Exists only while a drag is running, and contributes
  // exactly its own height — so mounting it closed is a true no-op. Parents
  // must therefore space their rows with margins, never a flex `gap`.
  function DropGap({ dnd, bucket, index, minWidth, axis }) {
    const p = dnd.gapProps(bucket, index);
    if (!dnd.drag) return null;
    const x = axis === "x";
    return (
      <div onDragOver={p.onDragOver} onDragEnter={(ev) => ev.preventDefault()} onDrop={p.onDrop}
        style={x
          ? { width: p.on ? dnd.dragW : 0, height: dnd.dragH, flexShrink: 0, marginBottom: 8, overflow: "hidden", transition: "width 120ms linear" }
          : { height: p.on ? dnd.dragH : 0, minWidth, overflow: "hidden", transition: "height 120ms linear" }}>
        <div style={{ width: x ? dnd.dragW : "auto", height: "100%", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", background: "var(--accent-soft)", border: "1px dashed var(--accent)", boxSizing: "border-box" }}>
          <Icon name="arrow-next" size={12} fill="var(--accent-strong)" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 500, color: "var(--accent-strong)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{shortName(dnd.drag, 20)}</span>
        </div>
      </div>
    );
  }

  // The kit's icon set has no cog; this is one drawn to the same 16x16 filled
  // spec rather than importing a foreign outline glyph.
  const GEAR_D = "M15.30 8.00L15.16 9.42L12.90 10.03L12.41 10.94L13.16 13.16L12.06 14.07L10.03 12.90L9.03 13.20L8.00 15.30L6.58 15.16L5.97 12.90L5.06 12.41L2.84 13.16L1.93 12.06L3.10 10.03L2.80 9.03L0.70 8.00L0.84 6.58L3.10 5.97L3.59 5.06L2.84 2.84L3.94 1.93L5.97 3.10L6.97 2.80L8.00 0.70L9.42 0.84L10.03 3.10L10.94 3.59L13.16 2.84L14.07 3.94L12.90 5.97L13.20 6.97ZM10.40 8.00L10.32 7.38L10.08 6.80L9.70 6.30L9.20 5.92L8.62 5.68L8.00 5.60L7.38 5.68L6.80 5.92L6.30 6.30L5.92 6.80L5.68 7.38L5.60 8.00L5.68 8.62L5.92 9.20L6.30 9.70L6.80 10.08L7.38 10.32L8.00 10.40L8.62 10.32L9.20 10.08L9.70 9.70L10.08 9.20L10.32 8.62L10.40 8.00Z";
  function Gear({ size = 16, fill = "currentColor", style }) {
    return <svg width={size} height={size} viewBox="0 0 16 16" style={{ flexShrink: 0, ...style }} aria-hidden="true"><path d={GEAR_D} fill={fill} /></svg>;
  }

  // No expand glyph in the kit either — two arrows to opposite corners, drawn
  // to the same 16x16 filled spec as the rest of the set.
  const EXPAND_D = "M9.0 0.6H15.4V7.0L12.9 4.5L10.9 6.5L9.5 5.1L11.5 3.1ZM4.5 12.9L6.5 10.9L5.1 9.5L3.1 11.5L0.6 9.0V15.4H7.0Z";
  function Expand({ size = 16, fill = "currentColor", style }) {
    return <svg width={size} height={size} viewBox="0 0 16 16" style={{ flexShrink: 0, ...style }} aria-hidden="true"><path d={EXPAND_D} fill={fill} /></svg>;
  }

  const COLLAPSE_D = "M8.6 1.4V7.4H14.6L12.2 5.0L15.6 1.6L14.4 0.4L11.0 3.8ZM7.4 14.6V8.6H1.4L3.8 11.0L0.4 14.4L1.6 15.6L5.0 12.2Z";
  function Collapse({ size = 16, fill = "currentColor", style }) {
    return <svg width={size} height={size} viewBox="0 0 16 16" style={{ flexShrink: 0, ...style }} aria-hidden="true"><path d={COLLAPSE_D} fill={fill} /></svg>;
  }

  const grabStyle = { width: 12, height: 18, flexShrink: 0, cursor: "grab", backgroundImage: "radial-gradient(circle, currentColor 1.1px, transparent 1.1px)", backgroundSize: "5px 5px", backgroundPosition: "1px 3px", backgroundRepeat: "repeat", opacity: 0.35 };
  function Grip(props) {
    return <span title="Drag to reorder" {...props} style={{ ...grabStyle, ...(props.style || {}) }} />;
  }

  // Names are abbreviated to "J. Jefferson" only in the tight surfaces, and
  // only when the full name would not fit the space the layout gives it.
  const shortName = (name, max) => {
    max = max || 16;
    if (!name || name.length <= max || name.indexOf("D/ST") >= 0) return name;
    const parts = name.split(" ");
    if (parts.length < 2) return name;
    return parts[0][0] + ". " + parts.slice(1).join(" ");
  };

  const fmtNum = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n));

  // ---------- cover ----------
  function CoverTile({ list, size = 48, radius = "var(--radius-sm)", style }) {
    const c = list.cover || {};
    return (
      <span style={{ width: size, height: size, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "var(--border)", borderRadius: radius, background: c.src ? "var(--n-4)" : c.color, overflow: "hidden", position: "relative", ...style }}>
        {c.src
          ? <img src={c.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <React.Fragment>
              <span className="fs-num" style={{ fontWeight: 700, fontSize: Math.round(size * 0.34), color: c.color === "var(--brand)" ? "var(--n-1)" : "#fff", letterSpacing: "-0.03em" }}>{c.mono}</span>
              <Icon name={c.icon || "list"} size={Math.round(size * 0.26)} fill={c.color === "var(--brand)" ? "rgba(0,0,0,.45)" : "rgba(255,255,255,.55)"} style={{ position: "absolute", right: 3, bottom: 3 }} />
            </React.Fragment>}
      </span>
    );
  }

  // ---------- social ----------
  function SocialBar({ list, onComments, size = "md", comments = true }) {
    const st = S();
    const n = (st.comments[list.id] || []).length;
    const sm = size === "sm";
    const pill = { display: "inline-flex", alignItems: "center", gap: 6, height: sm ? 26 : 32, padding: sm ? "0 8px" : "0 10px", border: "var(--border)", borderRadius: "var(--radius-sm)", background: "var(--surface-card)", font: "inherit", fontSize: sm ? 11 : 12, fontWeight: 700, cursor: "pointer", color: "var(--text-primary)" };
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...pill, cursor: "default", background: "transparent", borderColor: "transparent", paddingLeft: 0, color: "var(--n-3)" }}>
          <Icon name="eye" size={sm ? 13 : 15} fill="currentColor" />
          <span className="fs-num">{fmtNum(list.stats.views)}</span>
        </span>
        {comments && (
          <button onClick={onComments} style={pill} title="Comments">
            <Icon name="comments" size={sm ? 13 : 15} fill="currentColor" />
            <span className="fs-num">{n}</span>
          </button>
        )}
      </div>
    );
  }

  // ---------- stats modal ----------
  // A few metrics show by default; the modal is where the creator decides which
  // of the full set their list carries. Groups are ordered by how much of THIS
  // list they cover, so a WR list leads with receiving.
  function StatsModal({ list, open, onClose }) {
    const P = PL();
    const [q, setQ] = React.useState("");
    if (!open) return null;
    const cov = S().coverage(list);
    const dom = S().dominantPos(list);
    const groups = [];
    P.STATS.forEach((s) => {
      if (q && (s.label + " " + s.full).toLowerCase().indexOf(q.toLowerCase()) < 0) return;
      let g = groups.find((x) => x.name === s.group);
      if (!g) { g = { name: s.group, items: [], cov: 0 }; groups.push(g); }
      g.items.push(s);
      g.cov = Math.max(g.cov, cov[s.id]);
    });
    groups.sort((a, b) => b.cov - a.cov);
    return (
      <Modal open={open} onClose={onClose} title="Choose the stats on this list" width={660}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, margin: -2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input autoFocus value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Find a metric…" className="fs-input fs-input--sm" style={{ flex: 1 }} />
            <span className="fs-num" style={{ fontSize: 11.5, fontWeight: 500, color: "var(--n-3)", whiteSpace: "nowrap" }}>{list.cols.length} of {P.STATS.length} shown</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {S().presets.map((pr) => (
              <FilterChip key={pr.id} active={pr.cols.join() === list.cols.join()} onClick={() => S().setCols(list, pr.cols)}>{pr.label}</FilterChip>
            ))}
          </div>
          {list.view === "card" && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: "var(--n-3)" }}>
              <Icon name="info-circle" size={14} fill="var(--accent)" />
              Card view shows the first three stats you pick. The list and table views show them all.
            </div>
          )}
          {dom && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: "var(--n-3)" }}>
              <Icon name="info-circle" size={14} fill="var(--accent)" />
              Every player here is a {dom}, so {dom === "QB" ? "passing" : dom === "RB" ? "rushing" : "receiving"} metrics are listed first.
            </div>
          )}
          <div style={{ maxHeight: 400, overflow: "auto", border: "var(--border)", padding: "2px 8px 10px" }}>
            {groups.map((g) => (
              <div key={g.name} style={{ marginTop: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px 6px" }}>
                  <span className="fs-overline" style={{ color: "var(--n-3)" }}>{g.name}</span>
                  {g.cov < 0.5 && <Badge variant="stroke" style={{ height: 18, fontSize: 9 }}>Sparse for this list</Badge>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                  {g.items.map((s) => {
                    const on = list.cols.indexOf(s.id) >= 0;
                    return (
                      <button key={s.id} onClick={() => S().toggleCol(list, s.id)} title={s.full}
                        style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 8px", border: "none", borderRadius: "var(--radius-sm)", background: on ? "var(--accent-soft)" : "transparent", cursor: "pointer", font: "inherit", textAlign: "left", opacity: cov[s.id] < 0.2 ? 0.45 : 1 }}>
                        <span style={{ width: 15, height: 15, flexShrink: 0, border: "var(--border)", borderRadius: 2, background: on ? "var(--accent)" : "var(--surface-card)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                          {on && <Icon name="check" size={11} fill="#fff" />}
                        </span>
                        <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, marginRight: "auto", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>
                        <span className="fs-num" style={{ fontSize: 10, fontWeight: 500, color: "var(--n-3)" }}>{Math.round(cov[s.id] * 100)}%</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ marginRight: "auto" }} />
            <Button variant="purple" shadow onClick={onClose}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ---------- add players ----------
  function AddPlayers({ list, open, onClose, bucket }) {
    const [q, setQ] = React.useState("");
    const [pos, setPos] = React.useState("All");
    const P = PL();
    const inList = {};
    list.entries.forEach((en) => { inList[en.name] = 1; });
    const res = P.all.filter((p) => {
      if (pos !== "All" && p.pos !== pos) return false;
      if (!q) return true;
      return (p.name + " " + p.team).toLowerCase().indexOf(q.toLowerCase()) >= 0;
    }).slice(0, 40);
    return (
      <Modal open={open} onClose={onClose} title={bucket && bucket.label ? "Add players to " + bucket.label : "Add players to " + list.name} width={620}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input autoFocus value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search the player pool…" className="fs-input" style={{ width: "100%" }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["All", "QB", "RB", "WR", "TE", "K", "DEF"].map((x) => (
              <FilterChip key={x} active={pos === x} onClick={() => setPos(x)}>{x}</FilterChip>
            ))}
          </div>
          <div style={{ maxHeight: 380, overflow: "auto", border: "var(--border)", borderRadius: "var(--radius-sm)" }}>
            {res.map((p) => {
              const has = inList[p.name];
              return (
                <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--n-4)", background: has ? "var(--surface-sunken)" : "var(--surface-card)" }}>
                  {window.FS_PlayerFace ? <window.FS_PlayerFace name={p.name} size={30} open={false} /> : null}
                  <span style={{ minWidth: 0, marginRight: "auto" }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 13 }}>{p.name}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                      <NS.PositionBadge position={p.pos} style={{ height: 17, minWidth: 25, fontSize: 9, padding: "0 5px" }} />
                      <span className="fs-num" style={{ fontSize: 11, fontWeight: 500, color: "var(--n-3)" }}>{p.team} · ADP {P.fmt(p, "adp")} · {P.fmt(p, "cost")}</span>
                    </span>
                  </span>
                  {has
                    ? <Button size="sm" variant="ghost" iconLeft="check" disabled>Added</Button>
                    : <Button size="sm" variant="stroke" iconLeft="plus" onClick={() => { S().add(list, p.name, bucket); window.FS_TOAST && window.FS_TOAST(p.name + " added to " + ((bucket && bucket.label) || list.name)); }}>Add</Button>}
                </div>
              );
            })}
            {!res.length && <div style={{ padding: 20, fontSize: 13, fontWeight: 600, color: "var(--n-3)" }}>No players match “{q}”.</div>}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="purple" shadow onClick={onClose}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ---------- note ----------
  function NoteEditor({ list, name, onClose }) {
    const en = name ? list.entries.find((x) => x.name === name) : null;
    const [text, setText] = React.useState(en ? en.note : "");
    React.useEffect(() => { setText(en ? en.note : ""); }, [name]);
    if (!en) return null;
    return (
      <Modal open={!!name} onClose={onClose} title={"Note — " + name} width={480}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <textarea autoFocus value={text} onChange={(ev) => setText(ev.target.value)} rows={4}
            placeholder="Why is he here? What would change your mind?"
            className="fs-input fs-input--textarea" style={{ width: "100%" }} />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            {en.note && <Button variant="ghost" onClick={() => { S().setNote(list, name, ""); onClose(); }}>Remove</Button>}
            <Button variant="stroke" onClick={onClose}>Cancel</Button>
            <Button variant="purple" shadow onClick={() => { S().setNote(list, name, text); onClose(); }}>Save note</Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ---------- links (YouTube / article) ----------
  function LinkCard({ link, onRemove, compact }) {
    const yt = link.type === "youtube";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: compact ? 8 : 10, border: "var(--border)", borderRadius: "var(--radius-sm)", background: "var(--surface-card)" }}>
        <span style={{ width: compact ? 44 : 64, height: compact ? 32 : 44, flexShrink: 0, border: "var(--border)", background: yt ? "var(--negative)" : "var(--accent-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name={yt ? "arrow-next" : "document"} size={compact ? 15 : 18} fill="var(--n-1)" />
        </span>
        <span style={{ minWidth: 0, marginRight: "auto" }}>
          <span style={{ display: "block", fontWeight: 700, fontSize: compact ? 12 : 13, lineHeight: 1.25, textWrap: "pretty" }}>{link.title}</span>
          <span style={{ display: "block", marginTop: 2, fontSize: 11, fontWeight: 500, color: "var(--n-3)" }}>{link.source} · {link.meta}</span>
        </span>
        {onRemove && <IconButton icon="close" variant="ghost" size="sm" onClick={onRemove} />}
      </div>
    );
  }

  function AddLink({ list, open, onClose }) {
    const [type, setType] = React.useState("youtube");
    const [url, setUrl] = React.useState("");
    const [title, setTitle] = React.useState("");
    const save = () => {
      if (!title && !url) return onClose();
      S().addLink(list, {
        type, title: title || url,
        source: type === "youtube" ? "YouTube" : (url.replace(/^https?:\/\//, "").split("/")[0] || "Link"),
        meta: type === "youtube" ? "Video" : "Article",
      });
      setUrl(""); setTitle(""); onClose();
    };
    return (
      <Modal open={open} onClose={onClose} title="Attach a link" width={480}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <FilterChip active={type === "youtube"} onClick={() => setType("youtube")}>YouTube video</FilterChip>
            <FilterChip active={type === "article"} onClick={() => setType("article")}>Article</FilterChip>
          </div>
          <Field label="URL" placeholder={type === "youtube" ? "https://youtube.com/watch?v=…" : "https://…"} value={url} onChange={(ev) => setUrl(ev.target.value)} />
          <Field label="Title" placeholder="What is this?" value={title} onChange={(ev) => setTitle(ev.target.value)} />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Button variant="stroke" onClick={onClose}>Cancel</Button>
            <Button variant="purple" shadow onClick={save}>Attach</Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ---------- share ----------
  function ShareModal({ list, open, onClose }) {
    const st = S();
    const url = "fieldscout.com/l/" + list.id;
    const [copied, setCopied] = React.useState(false);
    return (
      <Modal open={open} onClose={onClose} title="Share this list" width={520}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, border: "var(--border)", background: "var(--surface-sunken)" }}>
            <CoverTile list={list} size={44} />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 700, fontSize: 14 }}>{list.name}</span>
              <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--n-3)", marginTop: 2 }}>{list.entries.length} players · {fmtNum(list.stats.views)} views · {fmtNum(list.stats.likes)} likes</span>
            </span>
          </div>
          <div>
            <div className="fs-field__label">Who can see it</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {st.VISIBILITY.map((v) => (
                <button key={v.id} onClick={() => st.patch(list, { visibility: v.id })}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "var(--border)", borderRadius: "var(--radius-sm)", background: list.visibility === v.id ? "var(--accent-soft)" : "var(--surface-card)", cursor: "pointer", font: "inherit", textAlign: "left" }}>
                  <Icon name={v.icon} size={16} fill="currentColor" />
                  <span style={{ marginRight: "auto" }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 13 }}>{v.label}</span>
                    <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--n-3)" }}>{v.note}</span>
                  </span>
                  {list.visibility === v.id && <Icon name="check-circle" size={17} fill="var(--accent)" />}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="fs-field__label">Link</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input readOnly value={url} className="fs-input fs-input--sm fs-num" style={{ flex: 1 }} />
              <Button size="sm" variant={copied ? "green" : "dark"} iconLeft={copied ? "check" : "save"}
                onClick={() => { setCopied(true); window.FS_TOAST && window.FS_TOAST("Link copied"); setTimeout(() => setCopied(false), 1800); }}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <KeyButton size="sm" iconLeft="send">Share to Community</KeyButton>
            <KeyButton size="sm" iconLeft="email">Email</KeyButton>
            <KeyButton size="sm" iconLeft="download">Export CSV</KeyButton>
          </div>
        </div>
      </Modal>
    );
  }

  // ---------- list cover ----------
  // Name is renamed inline in the hero; description is edited inline in the
  // Details tab. All this needs to carry is the thumbnail.
  function ListSettings({ list, open, onClose }) {
    const st = S();
    const fileRef = React.useRef(null);
    const pickFile = (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { list.cover.src = r.result; st.bump(); };
      r.readAsDataURL(f);
    };
    return (
      <Modal open={open} onClose={onClose} title="Change image" width={480}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ flexShrink: 0, textAlign: "center" }}>
              <CoverTile list={list} size={96} />
              <input ref={fileRef} type="file" accept="image/*" onChange={pickFile} style={{ display: "none" }} />
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <Button size="sm" variant="stroke" iconLeft="download" onClick={() => fileRef.current && fileRef.current.click()}>Upload</Button>
                {list.cover.src && <Button size="sm" variant="ghost" onClick={() => { delete list.cover.src; st.bump(); }}>Remove</Button>}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div className="fs-field__label">Cover colour</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {st.covers.map((c) => (
                    <button key={c} onClick={() => { list.cover.color = c; delete list.cover.src; st.bump(); }} title="Cover colour"
                      style={{ width: 30, height: 30, border: "var(--border)", borderRadius: "var(--radius-sm)", background: c, cursor: "pointer", boxShadow: list.cover.color === c && !list.cover.src ? "var(--shadow-4)" : "none" }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="purple" shadow onClick={onClose}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ---------- comments ----------
  function CommentThread({ list, compact }) {
    const st = S();
    const [text, setText] = React.useState("");
    const items = st.comments[list.id] || [];
    const post = () => { if (!text.trim()) return; st.addComment(list, text.trim()); setText(""); };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Avatar src="../../assets/avatars/avatar-1.jpg" size="sm" style={{ flexShrink: 0 }} />
          <input value={text} onChange={(ev) => setText(ev.target.value)} onKeyDown={(ev) => ev.key === "Enter" && post()}
            placeholder="Add a comment…" className="fs-input fs-input--sm" style={{ flex: 1, minWidth: 0 }} />
          <Button size="sm" variant="purple" iconLeft="send" onClick={post}>Post</Button>
        </div>
        {items.map((c, i) => (
          <div key={i} style={{ display: "flex", gap: 8 }}>
            <Avatar src={c.avatar} size="sm" style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <button onClick={() => window.FS_NAV && window.FS_NAV("user:" + c.handle)} title={"View " + c.handle}
                  style={{ border: "none", background: "none", padding: 0, font: "inherit", fontWeight: 700, fontSize: 12.5, color: "inherit", cursor: "pointer", textDecoration: "underline", textDecorationColor: "transparent", textUnderlineOffset: 3 }}
                  onMouseEnter={(ev) => { ev.currentTarget.style.textDecorationColor = "currentColor"; }}
                  onMouseLeave={(ev) => { ev.currentTarget.style.textDecorationColor = "transparent"; }}>{c.handle}</button>
                <span style={{ fontSize: 11, fontWeight: 500, color: "var(--n-3)" }}>{c.when}</span>
              </div>
              <div style={{ fontSize: compact ? 12 : 13, fontWeight: 500, lineHeight: 1.45, marginTop: 3, textWrap: "pretty" }}>{c.text}</div>
              <button style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 5, border: "none", background: "none", padding: 0, cursor: "pointer", font: "inherit", fontSize: 11, fontWeight: 500, color: "var(--n-3)" }}>
                <Icon name="like" size={12} fill="currentColor" /><span className="fs-num">{c.likes}</span>
              </button>
            </div>
          </div>
        ))}
        {!items.length && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--n-3)" }}>No comments yet.</div>}
      </div>
    );
  }

  // ---------- row menu ----------
  // noDrafted: the card view has its own drafted checkbox on hover.
  function RowMenu({ list, name, onNote, align = "right", noDrafted }) {
    const en = list.entries.find((x) => x.name === name) || {};
    return (
      <Menu align={align} trigger={<IconButton icon="dots-vertical" variant="ghost" size="sm" />}
        onSelect={(it) => {
          if (it.id === "note") onNote(name);
          else if (it.id === "drafted") S().toggleDrafted(list, name);
          else if (it.id === "remove") { S().remove(list, name); window.FS_TOAST && window.FS_TOAST(name + " removed from " + list.name); }
        }}
        items={(noDrafted ? [] : [{ id: "drafted", label: en.drafted ? "Mark undrafted" : "Mark drafted", icon: "check-circle" }]).concat([
          { id: "note", label: en.note ? "Edit note" : "Add note", icon: "edit" },
          { separator: true },
          { id: "remove", label: "Remove from list", icon: "remove", danger: true },
        ])} />
    );
  }

  // ---------- pop-out list windows ----------
  // A list can be popped out of the page into a draggable window. Open several
  // and set them side by side — the point is reading two boards at once while
  // a draft runs.
  const ZOOM = 0.8;

  function PopoutWindow({ p }) {
    const st = S();
    const PP = PL();
    const list = st.get(p.id);
    const dragRef = React.useRef(null);
    const sizeRef = React.useRef(null);
    const [min, setMin] = React.useState(false);
    const [stats, setStats] = React.useState(false);
    const [lift, setLift] = React.useState(false);
    const onResize = (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      st.raisePopout(p.id);
      sizeRef.current = { x: ev.clientX / ZOOM, y: ev.clientY / ZOOM, w: p.w || 440, h: p.h || 520 };
      const move = (e) => {
        const s = sizeRef.current;
        if (!s) return;
        st.sizePopout(p.id, s.w + (e.clientX / ZOOM - s.x), s.h + (e.clientY / ZOOM - s.y));
      };
      const up = () => { sizeRef.current = null; document.body.style.userSelect = ""; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };
    const onDown = (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      st.raisePopout(p.id);
      dragRef.current = { dx: ev.clientX / ZOOM - p.x, dy: ev.clientY / ZOOM - p.y };
      const move = (e) => {
        if (!dragRef.current) return;
        st.movePopout(p.id, Math.max(0, e.clientX / ZOOM - dragRef.current.dx), Math.max(0, e.clientY / ZOOM - dragRef.current.dy));
      };
      const up = () => { dragRef.current = null; document.body.style.userSelect = ""; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };
    const dnd = useDrag(list);
    const buckets = st.buckets(list);
    const rowW = 190 + list.cols.length * 68;
    let n = 0;
    return (
      <div onMouseDown={() => st.raisePopout(p.id)}
        onMouseEnter={() => setLift(true)} onMouseLeave={() => setLift(false)}
        style={{ position: "fixed", left: p.x, top: p.y, width: p.w || 440, zIndex: 60 + (p.z % 1000), background: "var(--n-2)", border: "1.25px solid " + (lift ? "var(--brand)" : "var(--text-secondary)"), transition: "border-color 150ms linear", display: "flex", flexDirection: "column", height: min ? undefined : p.h || 520 }}>
        <div className="fs-dark" style={{
          display: "flex", flexDirection: "column", flex: 1, minHeight: 0,
          "--surface-card": "var(--n-2)",
          "--surface-sunken": "#0b0b0b",
          "--text-primary": "var(--white)",
          "--n-1": "var(--white)",
          "--n-3": "#b3b9c0",
          "--n-4": "rgba(255,255,255,0.22)",
          "--border": "1px solid rgba(255,255,255,0.24)",
          color: "var(--white)",
        }}>
        <div onMouseDown={onDown}
          style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 8px 0 10px", height: 44, background: "var(--surface-card)", color: "var(--text-primary)", borderBottom: "var(--border)", cursor: "grab", flexShrink: 0 }}>
          <CoverTile list={list} size={24} />
          <span style={{ fontSize: 12.5, fontWeight: 600, marginRight: "auto", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{list.name}</span>
          <span onMouseDown={(ev) => ev.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <button onClick={() => setStats(true)} title="Choose stats" className="fs-icon-ghost" style={{ padding: 4, display: "inline-flex" }}>
              <Gear size={15} />
            </button>
            <Menu align="right" width={170} trigger={<IconButton icon="dots" variant="ghost" size="sm" title="List options" />}
              onSelect={(it) => st.patch(list, { org: it.id })}
              items={st.ORGS.map((o) => ({ id: o.id, label: o.label }))} />
          </span>
          <button onClick={() => setMin((m) => !m)} title={min ? "Expand" : "Collapse"} className="fs-icon-ghost" style={{ padding: 4 }}>
            <Icon name={min ? "arrow-bottom" : "arrow-up"} size={14} fill="currentColor" />
          </button>
          <button onClick={() => st.closePopout(p.id)} title="Close" className="fs-icon-ghost" style={{ padding: 4 }}>
            <Icon name="close" size={14} fill="currentColor" />
          </button>
        </div>
        {!min && (
          <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", height: 28, minWidth: rowW, background: "rgba(255,255,255,0.07)", borderBottom: "var(--border)", position: "sticky", top: 0, zIndex: 3 }}>
              <span style={{ width: 20, flexShrink: 0 }} />
              <span style={{ width: 18, fontSize: 9.5, fontWeight: 500, color: "var(--n-3)", flexShrink: 0 }}>#</span>
              <span style={{ minWidth: 108, flex: 1, fontSize: 9.5, fontWeight: 500, color: "var(--n-3)" }}>Player</span>
              {list.cols.map((cid) => (
                <span key={cid} style={{ width: 60, flexShrink: 0, textAlign: "right", fontSize: 9.5, fontWeight: 500, color: "var(--n-3)" }}>{PP.STAT[cid].label}</span>
              ))}
            </div>
            {buckets.map((bk) => (
              <div key={bk.key}>
                {bk.label && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", height: 26, minWidth: rowW, background: bk.color, color: bk.textColor, borderBottom: "var(--border)", borderTop: "var(--border)" }}>
                    <span style={{ fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{bk.label}</span>
                    <span className="fs-num" style={{ fontSize: 10, fontWeight: 500, opacity: 0.85 }}>{bk.entries.length}</span>
                  </div>
                )}
                {bk.entries.map((en, i) => {
                  n += 1;
                  const pl = st.player(en);
                  if (!pl) return null;
                  return (
                    <React.Fragment key={en.name}>
                    <DropGap dnd={dnd} bucket={bk} index={i} minWidth={rowW} />
                    <div {...dnd.rowProps(en.name, bk, i)} className="fs-rowh" style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", height: 36, minWidth: rowW, borderBottom: "1px solid var(--n-4)", background: en.drafted ? "rgba(255,255,255,0.05)" : "transparent", cursor: "grab", opacity: dnd.drag === en.name ? 0.35 : 1 }}>
                      <button onClick={() => st.toggleDrafted(list, en.name)} title={en.drafted ? "Mark undrafted" : "Mark drafted"}
                        style={{ width: 20, height: 20, flexShrink: 0, border: "none", background: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                        <span style={{ width: 14, height: 14, border: "1.25px solid rgba(255,255,255,0.75)", borderRadius: "var(--radius-sm)", background: en.drafted ? "var(--positive)" : "rgba(255,255,255,0.08)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                          {en.drafted && <Icon name="check" size={9} fill="#000" />}
                        </span>
                      </button>
                      <span className="fs-num" style={{ width: 18, fontSize: 11, fontWeight: 500, color: "var(--n-3)", flexShrink: 0 }}>{n}</span>
                      <span style={{ minWidth: 108, flex: 1, display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                        <span style={{ minWidth: 48, fontWeight: 400, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: en.drafted ? "line-through" : "none", opacity: en.drafted ? 0.45 : 1 }}>{shortName(pl.name, 18)}</span>
                        <NS.PositionBadge position={pl.pos} style={{ height: 16, minWidth: 24, fontSize: 9, padding: "0 5px", flexShrink: 0 }} />
                      </span>
                      {list.cols.map((cid) => (
                        <span key={cid} className="fs-num" style={{ width: 60, flexShrink: 0, textAlign: "right", fontSize: 11.5, fontWeight: 500 }}>{PP.fmt(pl, cid)}</span>
                      ))}
                    </div>
                    {i === bk.entries.length - 1 && <DropGap dnd={dnd} bucket={bk} index={bk.entries.length} minWidth={rowW} />}
                    </React.Fragment>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {!min && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderTop: "var(--border)", flexShrink: 0 }}>
            <SocialBar list={list} size="sm" />
            <span style={{ marginLeft: "auto" }}>
              <button onClick={() => window.FS_TOAST && window.FS_TOAST("Link copied")}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", border: "none", background: "var(--brand)", color: "#000", font: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                <Icon name="send" size={13} fill="#000" />Share
              </button>
            </span>
          </div>
        )}
        </div>
        {!min && (
          <span onMouseDown={onResize} title="Drag to resize"
            style={{ position: "absolute", right: 0, bottom: 0, width: 16, height: 16, cursor: "nwse-resize", backgroundImage: "linear-gradient(135deg, transparent 0 46%, rgba(255,255,255,0.55) 46% 54%, transparent 54% 72%, rgba(255,255,255,0.55) 72% 80%, transparent 80%)" }} />
        )}
        <StatsModal list={list} open={stats} onClose={() => setStats(false)} />
      </div>
    );
  }

  function PopoutHost() {
    const st = S();
    if (!st.popouts.length) return null;
    return <React.Fragment>{st.popouts.map((p) => <PopoutWindow key={p.id} p={p} />)}</React.Fragment>;
  }

  // Secondary action — the design system's stroke button, which fills ink on
  // hover. It rests flat; the lift belongs to the hover state.
  function KeyButton(props) {
    return <Button variant="stroke" {...props} />;
  }

  window.FS_ListsCommon = {
    useStore, useDrag, DropGap, Grip, Gear, Expand, Collapse, fmtNum, shortName, CoverTile, SocialBar, StatsModal,
    AddPlayers, NoteEditor, LinkCard, AddLink, ShareModal, ListSettings, CommentThread,
    RowMenu, PopoutHost, KeyButton,
  };
})();
