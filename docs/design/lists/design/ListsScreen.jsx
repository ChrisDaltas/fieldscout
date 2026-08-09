// Lists — the page. Two ways in, one list design.
//   rail    · every list down the left, the open one on the right
//   gallery · cover cards, click through to the same list design
// Toggle lives in the page header next to the title.
(function () {
  const NS = window.FieldScoutDesignSystem_d5e2dc;
  const { Icon, Button, IconButton, Badge, Avatar, Menu } = NS;
  const C = window.FS_ListsCommon;
  const B = window.FS_ListsBody;
  const S = () => window.FS_LISTS;

  // Selection lives on the store so the page header can drive it too.
  function ensure() {
    const st = S();
    if (st.selId === undefined) st.selId = st.lists[0].id;
    if (!st.select) {
      st.select = (id) => { st.selId = id; st.bump(); };
      st.setOpen = (id) => { st.openId = id; st.bump(); };
      st.closeList = () => { st.openId = null; st.selId = null; st.bump(); };
      st.newList = () => { const l = st.create("Untitled list"); st.selId = l.id; st.settingsFor = l.id; st.bump(); };
    }
    return st;
  }

  // ---------- page header (rendered by the app shell) ----------
  function ListsHeader() {
    const st = C.useStore();
    ensure();
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 14, width: "100%" }}>
        {st.mode === "gallery" && st.openId ? (
          <React.Fragment>
            <C.KeyButton size="sm" iconLeft="arrow-prev" onClick={() => (st.expandedFrom ? st.minimize() : st.setOpen(null))}>
              {st.expandedFrom ? "Back" : "All lists"}
            </C.KeyButton>
            <h3 style={{ fontSize: "var(--text-h3)", fontWeight: 700, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{st.get(st.openId).name}</h3>
          </React.Fragment>
        ) : (
          <h3 style={{ fontSize: "var(--text-h3)", fontWeight: 700, margin: 0, whiteSpace: "nowrap" }}>Lists</h3>
        )}
        <div style={{ display: st.mode === "gallery" && st.openId ? "none" : "flex", border: "var(--border)", background: "var(--surface-card)", flexShrink: 0 }}>
          {[{ id: "rail", icon: "list", label: "List" }, { id: "gallery", icon: "layers", label: "Cards" }, { id: "compare", icon: "table", label: "Side by side" }].map((m) => (
            <button key={m.id} onClick={() => st.setMode(m.id)} title={m.label + " view"} className="fs-seg" data-active={st.mode === m.id ? "true" : undefined}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", border: "none", borderRight: "1px solid var(--n-4)", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
              <Icon name={m.icon} size={15} fill="currentColor" />{m.label}
            </button>
          ))}
        </div>
        {!(st.mode === "gallery" && st.openId) && st.mode !== "compare" && (
          <div style={{ display: "flex", alignItems: "stretch", gap: 2, marginLeft: 2 }}>
            {[{ id: "mine", label: "My lists", n: st.myLists().length }, { id: "saved", label: "Saved", n: st.savedLists().length }].map((t) => (
              <button key={t.id} onClick={() => st.setTab(t.id)} className="fs-tab" data-active={st.tab === t.id ? "true" : undefined}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 14px", border: "none", cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                {t.label}<span className="fs-num" style={{ fontSize: 11, fontWeight: 500, opacity: 0.75 }}>{t.n}</span>
              </button>
            ))}
          </div>
        )}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {st.mode === "compare" && !!st.compare.length && (
            <C.KeyButton size="sm" iconLeft="setup" onClick={() => st.setCompare([])}>Change lists</C.KeyButton>
          )}
          <Button size="sm" variant="purple" shadow iconLeft="plus" onClick={() => st.newList()}>New list</Button>
        </span>
      </div>
    );
  }

  // ---------- rail ----------
  function Rail({ sel, onSel }) {
    const st = S();
    const rows = st.tabLists();
    return (
      <div className="fs-lift" style={{ position: "sticky", top: 92, display: "flex", flexDirection: "column", maxWidth: 200, border: "var(--border)", borderRight: "none", background: "var(--surface-card)", maxHeight: "calc(100vh - 150px)", overflow: "auto" }}>
        {!rows.length && (
          <div style={{ padding: "22px 14px", fontSize: 12, fontWeight: 600, color: "var(--n-3)", textAlign: "center" }}>
            Lists you save from other people show up here.
          </div>
        )}
        {rows.map((l) => {
          const on = !!sel && l.id === sel.id;
          return (
            <div key={l.id} onClick={() => onSel(l)} className="fs-rowh" role="button" tabIndex={0}
              style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderBottom: "1px solid var(--n-4)", background: on ? "var(--accent-soft)" : "transparent", borderLeft: on ? "3px solid var(--accent)" : "3px solid transparent", cursor: "pointer", textAlign: "left", width: "100%", boxSizing: "border-box" }}>
              <C.CoverTile list={l} size={30} />
              <span style={{ minWidth: 0, marginRight: "auto" }}>
                <span style={{ display: "block", fontWeight: 700, fontSize: 13, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</span>
                <span style={{ display: "block", fontSize: 10.5, fontWeight: 500, lineHeight: 1.3, color: "var(--n-3)", marginTop: 2, whiteSpace: "nowrap" }}>{l.entries.length} players · {st.fmtCreated(l.created)}</span>
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  // ---------- gallery ----------
  function GalleryCard({ list, onOpen }) {
    const st = S();
    const mix = st.posMix(list);
    return (
      <div className="fs-lift" style={{ border: "var(--border)", background: "var(--surface-card)", display: "flex", flexDirection: "column" }}>
        <button onClick={onOpen} style={{ border: "none", padding: 0, background: "none", cursor: "pointer", display: "block" }}>
          <span style={{ display: "block", height: 116, borderBottom: "var(--border)", background: list.cover.src ? "var(--n-4)" : list.cover.color, position: "relative", overflow: "hidden" }}>
            {list.cover.src
              ? <img src={list.cover.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <React.Fragment>
                  <span className="fs-num" style={{ position: "absolute", left: 14, bottom: 8, fontSize: 46, fontWeight: 700, letterSpacing: "-0.05em", lineHeight: 1, color: list.cover.color === "var(--brand)" ? "rgba(0,0,0,.75)" : "rgba(255,255,255,.9)" }}>{list.cover.mono}</span>
                  <Icon name={list.cover.icon || "list"} size={30} fill={list.cover.color === "var(--brand)" ? "rgba(0,0,0,.35)" : "rgba(255,255,255,.45)"} style={{ position: "absolute", right: 12, top: 12 }} />
                </React.Fragment>}
          </span>
        </button>
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Badge variant="stroke" style={{ height: 18, fontSize: 9 }}>{list.kind === "ranking" ? "Ranking" : "List"}</Badge>
            <Badge variant="stroke" style={{ height: 18, fontSize: 9 }}>{st.SCOPES.find((s) => s.id === list.scope).label}</Badge>
            <span style={{ marginLeft: "auto" }}>
              <Menu align="right" trigger={<IconButton icon="dots" variant="ghost" size="sm" />}
                items={[{ id: "popout", label: "Pop out into a window", icon: "arrow-up-right" }, { id: "copy", label: "Copy share link", icon: "send" }, { separator: true }, { id: "archive", label: "Archive", icon: "save" }].concat(list.fav ? [] : [{ id: "del", label: "Delete list", icon: "remove", danger: true }])}
                onSelect={(it) => { if (it.id === "popout") st.popout(list.id); else if (it.id === "copy") window.FS_TOAST && window.FS_TOAST("Link to “" + list.name + "” copied"); else if (it.id === "archive") { st.archive(list.id); window.FS_TOAST && window.FS_TOAST("“" + list.name + "” archived"); } else if (it.id === "del") { st.destroy(list.id); window.FS_TOAST && window.FS_TOAST("“" + list.name + "” deleted"); } }} />
            </span>
          </div>
          <button onClick={onOpen} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", textAlign: "left", font: "inherit" }}>
            <span style={{ display: "block", fontWeight: 700, fontSize: 15, lineHeight: 1.2, letterSpacing: "-0.01em" }}>{list.name}</span>
          </button>
          {list.desc && <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--n-3)", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{list.desc}</span>}
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: "auto", paddingTop: 6 }}>
            {Object.keys(mix).slice(0, 4).map((k) => <NS.PositionBadge key={k} position={k} style={{ height: 17, minWidth: 25, fontSize: 9, padding: "0 5px" }} />)}
            <span style={{ fontSize: 10.5, fontWeight: 500, lineHeight: 1.2, color: "var(--n-3)", marginLeft: "auto", whiteSpace: "nowrap", flexShrink: 0 }}>{list.entries.length} players</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 8, borderTop: "1px solid var(--n-4)" }}>
            <Avatar src={list.author.avatar} size="xs" />
            <span style={{ fontSize: 10.5, fontWeight: 500, lineHeight: 1.2, color: "var(--n-3)", marginRight: "auto", whiteSpace: "nowrap", flexShrink: 0, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{st.fmtCreated(list.created)}</span>
            <C.SocialBar list={list} size="sm" onComments={onOpen} />
          </div>
        </div>
      </div>
    );
  }

  function Gallery({ onOpen }) {
    const st = S();
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(268px, 1fr))", gap: 16 }}>
        {st.tabLists().map((l) => <GalleryCard key={l.id} list={l} onOpen={() => onOpen(l)} />)}
        <button onClick={() => st.newList()}
          style={{ minHeight: 240, border: "1px dashed var(--n-1)", background: "transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, font: "inherit", color: "var(--n-3)" }}>
          <Icon name="plus" size={22} fill="currentColor" />
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>New list</span>
        </button>
      </div>
    );
  }

  // ---------- one list ----------
  function Hero({ list, open, onClose }) {
    const st = S();
    const [renaming, setRenaming] = React.useState(false);
    const [hover, setHover] = React.useState(false);
    const [draft, setDraft] = React.useState(list.name);
    React.useEffect(() => { setDraft(list.name); setRenaming(false); }, [list.id]);
    const saveName = () => { st.patch(list, { name: draft.trim() || list.name }); setRenaming(false); };
    return (
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <button onClick={() => open("settings")} title="Change cover" style={{ border: "none", background: "none", padding: 0, cursor: "pointer", flexShrink: 0, alignSelf: "flex-start" }}>
          <C.CoverTile list={list} size={64} />
        </button>
        <div style={{ flex: "1 1 320px", minWidth: 240 }}>
          {renaming ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <input autoFocus value={draft} onChange={(ev) => setDraft(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === "Enter") saveName(); if (ev.key === "Escape") { setDraft(list.name); setRenaming(false); } }}
                className="fs-input" style={{ height: 38, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", minWidth: 240, maxWidth: 420, flex: "1 1 240px" }} />
              <Button size="sm" variant="purple" shadow onClick={saveName}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setDraft(list.name); setRenaming(false); }}>Cancel</Button>
            </div>
          ) : (
            <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.01em" }}>{list.name}</h3>
              {st.mine(list) && <IconButton icon="edit" variant="ghost" size="sm" onClick={() => { setDraft(list.name); setRenaming(true); }} title="Rename"
                style={{ opacity: hover ? 1 : 0, pointerEvents: hover ? "auto" : "none", transition: "opacity 150ms linear" }} />}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <Avatar src={list.author.avatar} size="xs" />
            <button onClick={() => window.FS_NAV && window.FS_NAV("user:" + list.author.handle)} title={"View " + list.author.handle}
              style={{ border: "none", background: "none", padding: 0, font: "inherit", fontSize: 12, fontWeight: 700, color: "inherit", cursor: "pointer", textDecoration: "underline", textDecorationColor: "transparent", textUnderlineOffset: 3 }}
              onMouseEnter={(ev) => { ev.currentTarget.style.textDecorationColor = "currentColor"; }}
              onMouseLeave={(ev) => { ev.currentTarget.style.textDecorationColor = "transparent"; }}>{list.author.handle}</button>
            <span style={{ fontSize: 11, fontWeight: 500, color: "var(--n-3)", whiteSpace: "nowrap" }}>created {st.fmtCreated(list.created)}</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: "var(--n-3)", whiteSpace: "nowrap" }}>· {list.entries.length} players</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: "auto" }}>
          <Button size="sm" variant="brand" shadow iconLeft="send" onClick={() => open("share")} style={{ background: "var(--brand)", color: "var(--on-brand)" }}>Share</Button>
          <Menu align="right" width={230} trigger={<IconButton icon="dots" variant="stroke" size="sm" title="List options" />}
            onSelect={(it) => {
              if (it.id === "settings") open("settings");
              else if (it.id === "insights") open("insights");
              else if (it.id === "duplicate") window.FS_TOAST && window.FS_TOAST("“" + list.name + "” duplicated");
              else if (it.id === "archive") { st.archive(list.id); window.FS_TOAST && window.FS_TOAST("“" + list.name + "” archived"); }
              else if (it.id === "del") { st.destroy(list.id); window.FS_TOAST && window.FS_TOAST("“" + list.name + "” deleted"); }
              else if (String(it.id).indexOf("vis:") === 0) st.patch(list, { visibility: String(it.id).slice(4) });
              else if (String(it.id).indexOf("scope:") === 0) st.patch(list, { scope: String(it.id).slice(6) });
            }}
            items={[
              { id: "settings", label: "Change image", icon: "document" },
              { id: "scope", label: "List type", icon: "clock", items: st.SCOPES.map((sc) => ({ id: "scope:" + sc.id, label: sc.label, icon: list.scope === sc.id ? "check" : "clock" })) },
              { id: "visibility", label: "Visibility", icon: "eye", items: st.VISIBILITY.map((v) => ({ id: "vis:" + v.id, label: v.label, icon: list.visibility === v.id ? "check" : v.icon })) },
              { id: "insights", label: "Insights", icon: "chart" },
              { separator: true },
              { id: "duplicate", label: "Duplicate", icon: "layers" },
              { id: "archive", label: "Archive", icon: "save" },
            ].concat(list.fav ? [] : [{ id: "del", label: "Delete list", icon: "remove", danger: true }])} />
          {st.mode === "rail" && (
            <button title="Expand to full width" className="fs-btn fs-btn--square fs-btn--sm fs-btn--stroke"
              onClick={() => st.expand(list.id)}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <C.Expand size={16} />
            </button>
          )}
          {!!st.expandedFrom && (
            <button title="Minimize" className="fs-btn fs-btn--square fs-btn--sm fs-btn--stroke"
              onClick={() => st.minimize()}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <C.Collapse size={16} />
            </button>
          )}
          <IconButton icon="arrow-up-right" variant="stroke" size="sm" title="Pop out into a window" onClick={() => st.popout(list.id)} />
          <IconButton icon="close" variant="stroke" size="sm" title="Close list" onClick={onClose} />
        </div>
      </div>
    );
  }

  function EmptyDetail() {
    const st = S();
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, minHeight: 360, padding: 40, textAlign: "center", background: "var(--surface-card)", border: "var(--border)", boxShadow: "var(--shadow-4)" }}>
        <Icon name="list" size={26} fill="var(--n-3)" />
        <span style={{ fontSize: 16, fontWeight: 700 }}>Select or create a new list</span>
        <Button size="sm" variant="purple" shadow iconLeft="plus" onClick={() => st.newList()}>New list</Button>
      </div>
    );
  }

  // ---------- details tab ----------
  function Tags({ list, mine }) {
    const st = S();
    const [adding, setAdding] = React.useState(false);
    const [val, setVal] = React.useState("");
    React.useEffect(() => { setAdding(false); setVal(""); }, [list.id]);
    const tags = list.tags || [];
    const add = () => {
      const t = val.trim().replace(/^#/, "");
      if (t && tags.indexOf(t) === -1) st.patch(list, { tags: tags.concat(t) });
      setVal(""); setAdding(false);
    };
    const fixed = [
      list.kind === "ranking" ? "Ranking" : "List",
      st.SCOPES.find((sc) => sc.id === list.scope).label,
      st.VISIBILITY.find((v) => v.id === list.visibility).label,
    ];
    return (
      <div>
        <div className="fs-field__label">Tags</div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          {fixed.map((f) => <Badge key={f} variant="stroke" style={{ height: 24, fontSize: 10.5 }} title="Set in list options">{f}</Badge>)}
          {tags.map((t) => (
            <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 24, padding: mine ? "0 4px 0 9px" : "0 9px", border: "var(--border)", background: "var(--accent-soft)", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.02em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
              {t}
              {mine && (
                <button onClick={() => st.patch(list, { tags: tags.filter((x) => x !== t) })} title={"Remove " + t}
                  className="fs-icon-ghost" style={{ padding: 2, lineHeight: 0 }}>
                  <Icon name="close" size={11} fill="currentColor" />
                </button>
              )}
            </span>
          ))}
          {mine && (adding ? (
            <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onBlur={add}
              onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") { setVal(""); setAdding(false); } }}
              placeholder="tag name" className="fs-input" style={{ height: 24, width: 130, fontSize: 11, padding: "0 8px" }} />
          ) : (
            <button onClick={() => setAdding(true)} style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 24, padding: "0 9px", border: "1px dashed var(--n-3)", background: "transparent", cursor: "pointer", font: "inherit", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.02em", color: "var(--n-3)", whiteSpace: "nowrap" }}>
              <Icon name="plus" size={11} fill="currentColor" />Add tag
            </button>
          ))}
        </div>
      </div>
    );
  }

  function Details({ list, open }) {
    const st = S();
    const [editing, setEditing] = React.useState(false);
    const [desc, setDesc] = React.useState(list.desc);
    React.useEffect(() => { setDesc(list.desc); setEditing(false); }, [list.id]);
    const mine = list.author.handle === "@gridironguru";
    const save = () => { st.patch(list, { desc: desc }); setEditing(false); };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 760 }}>
        <Tags list={list} mine={mine} />
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span className="fs-field__label" style={{ marginBottom: 0, marginRight: "auto" }}>Description</span>
            {mine && !editing && <button onClick={() => setEditing(true)} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", font: "inherit", fontSize: 11.5, fontWeight: 500, color: "var(--accent)" }}>Edit</button>}
          </div>
          {editing ? (
            <React.Fragment>
              <textarea autoFocus value={desc} onChange={(ev) => setDesc(ev.target.value)} rows={4}
                placeholder="What is this list for? What rule decides who makes it?"
                className="fs-input fs-input--textarea" style={{ width: "100%", height: 120 }} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
                <C.KeyButton size="sm" onClick={() => { setDesc(list.desc); setEditing(false); }}>Cancel</C.KeyButton>
                <Button size="sm" variant="purple" onClick={save}>Save</Button>
              </div>
            </React.Fragment>
          ) : (
            <p style={{ margin: 0, fontSize: 14.5, fontWeight: 500, lineHeight: 1.6, color: list.desc ? "var(--text-primary)" : "var(--n-3)", textWrap: "pretty" }}>
              {list.desc || (mine ? "No description yet. Edit to say what this list is for." : "No description.")}
            </p>
          )}
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span className="fs-field__label" style={{ marginBottom: 0, marginRight: "auto" }}>Attached links</span>
            {mine && <button onClick={() => open("link")} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", font: "inherit", fontSize: 11.5, fontWeight: 500, color: "var(--accent)" }}>Attach a video or article</button>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10 }}>
            {list.links.map((l, i) => <C.LinkCard key={i} link={l} onRemove={mine ? () => st.removeLink(list, i) : null} />)}
            {!list.links.length && <div style={{ fontSize: 13, fontWeight: 500, color: "var(--n-3)" }}>Nothing attached yet. A film breakdown or an article gives readers the reasoning behind the order.</div>}
          </div>
        </div>

        <div>
          <div className="fs-field__label">Position mix</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {Object.keys(st.posMix(list)).map((k) => (
              <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", border: "var(--border)" }}>
                <NS.PositionBadge position={k} style={{ height: 18, minWidth: 26, fontSize: 9.5, padding: "0 6px" }} />
                <span className="fs-num" style={{ fontSize: 13, fontWeight: 700 }}>{st.posMix(list)[k]}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function Insights({ list, open, onClose }) {
    const st = S();
    const rows = [["Views", C.fmtNum(list.stats.views)], ["Likes", C.fmtNum(list.stats.likes)], ["Comments", String((st.comments[list.id] || []).length)], ["Saved by", C.fmtNum(Math.round(list.stats.likes * 0.4))]];
    return (
      <NS.Modal open={open} onClose={onClose} title="Insights" width={420}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: "flex", alignItems: "baseline", gap: 8, borderBottom: "1px solid var(--n-4)", paddingBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--n-3)", marginRight: "auto" }}>{k}</span>
              <span className="fs-num" style={{ fontSize: 20, fontWeight: 700 }}>{v}</span>
            </div>
          ))}
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--n-3)" }}>Visible at fieldscout.com/l/{list.id}</div>
        </div>
      </NS.Modal>
    );
  }

  function Detail({ list }) {
    const st = S();
    const [tab, setTab] = React.useState("list");
    const [note, setNote] = React.useState(null);
    const [modal, setModal] = React.useState(null);
    const [bucket, setBucket] = React.useState(null);
    const open = (m) => { try { window.scrollTo({ top: 0 }); } catch (e) {} setModal(m); };
    const openNote = (n) => { try { window.scrollTo({ top: 0 }); } catch (e) {} setNote(n); };
    const addTo = (b) => { setBucket(b); open("add"); };
    React.useEffect(() => {
      if (st.settingsFor === list.id) { st.settingsFor = null; setModal("settings"); }
    }, [list.id, st.settingsFor]);

    return (
      <div className="fs-lift" style={{ display: "flex", flexDirection: "column", gap: 16, background: "var(--surface-card)", border: "var(--border)", padding: 22 }}>
        <Hero list={list} open={open} onClose={() => st.closeList()} />
        <div style={{ display: "flex", alignItems: "stretch", gap: 4, rowGap: 4, flexWrap: "wrap", borderBottom: "var(--border)" }}>
          {[
            { v: "list", label: "List" },
            { v: "details", label: "Details" },
            { v: "comments", label: "Comments", count: (st.comments[list.id] || []).length },
          ].map((t) => (
            <button key={t.v} onClick={() => setTab(t.v)} className="fs-tab" data-active={tab === t.v ? "true" : undefined}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0 16px", height: 34, border: "none", cursor: "pointer", font: "inherit", fontSize: 13.5, fontWeight: 700 }}>
              {t.label}
              {t.count != null && <span className="fs-num" style={{ fontSize: 11.5, fontWeight: 500, opacity: 0.75 }}>{t.count}</span>}
            </button>
          ))}
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", paddingBottom: 6 }}><C.SocialBar list={list} comments={false} /></span>
        </div>

        {tab === "list" && (
          <React.Fragment>
            <B.ListToolbar list={list} onStats={() => open("stats")} onAdd={() => { setBucket(null); open("add"); }} />
            <B.ListBody list={list} onNote={openNote} onAdd={() => { setBucket(null); open("add"); }} onAddTo={addTo} />
          </React.Fragment>
        )}
        {tab === "details" && <Details list={list} open={open} />}
        {tab === "comments" && (
          <div style={{ maxWidth: 720 }}><C.CommentThread list={list} /></div>
        )}

        <C.NoteEditor list={list} name={note} onClose={() => setNote(null)} />
        <C.StatsModal list={list} open={modal === "stats"} onClose={() => setModal(null)} />
        <C.AddPlayers list={list} bucket={bucket} open={modal === "add"} onClose={() => setModal(null)} />
        <C.ShareModal list={list} open={modal === "share"} onClose={() => setModal(null)} />
        <C.ListSettings list={list} open={modal === "settings"} onClose={() => setModal(null)} />
        <C.AddLink list={list} open={modal === "link"} onClose={() => setModal(null)} />
        <Insights list={list} open={modal === "insights"} onClose={() => setModal(null)} />
      </div>
    );
  }

  // ---------- side by side ----------
  // Built for a live draft: several lists as columns, every row one click from
  // being crossed off. Picking the lists is its own step so the columns stay
  // stable while you work.
  function ComparePicker() {
    const st = S();
    const [picked, setPicked] = React.useState([]);
    const rows = st.myLists().concat(st.savedLists());
    const toggle = (id) => setPicked((p) => (p.indexOf(id) >= 0 ? p.filter((x) => x !== id) : p.concat(id)));
    return (
      <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <h4 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Pick the lists to compare</h4>
          <p style={{ margin: "6px 0 0", fontSize: 13, fontWeight: 500, color: "var(--n-3)", maxWidth: 520, textWrap: "pretty" }}>
            They show up as columns across the page. Mark players off as they go in your draft and every column updates.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(232px, 1fr))", gap: 10 }}>
          {rows.map((l) => {
            const on = picked.indexOf(l.id) >= 0;
            return (
              <button key={l.id} onClick={() => toggle(l.id)} className="fs-lift"
                style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, textAlign: "left", border: "var(--border)", background: on ? "var(--accent-soft)" : "var(--surface-card)", outline: on ? "2px solid var(--accent)" : "none", outlineOffset: -2, cursor: "pointer", font: "inherit" }}>
                <span style={{ width: 16, height: 16, flexShrink: 0, border: "2px solid var(--n-1)", borderRadius: "var(--radius-sm)", background: on ? "var(--accent)" : "var(--surface-card)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  {on && <Icon name="check" size={10} fill="#fff" />}
                </span>
                <C.CoverTile list={l} size={30} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</span>
                  <span className="fs-num" style={{ display: "block", marginTop: 2, fontSize: 11, fontWeight: 500, color: "var(--n-3)" }}>{l.entries.length} players</span>
                </span>
              </button>
            );
          })}
        </div>
        <div>
          <Button variant="purple" shadow disabled={!picked.length} onClick={() => st.setCompare(picked)}>
            {picked.length ? "Show " + picked.length + " list" + (picked.length === 1 ? "" : "s") + " side by side" : "Select at least one list"}
          </Button>
        </div>
      </div>
    );
  }

  function CompareRow({ list, en, rank }) {
    const st = S(); const P = window.FS_PLAYERS;
    const p = st.player(en);
    if (!p) return null;
    return (
      <div className="fs-rowh" style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", height: 38, borderBottom: "1px solid var(--n-4)", background: en.drafted ? "var(--surface-sunken)" : "var(--surface-card)" }}>
        <button onClick={() => st.toggleDrafted(list, en.name)} title={en.drafted ? "Mark undrafted" : "Mark drafted"}
          style={{ width: 20, height: 20, flexShrink: 0, border: "none", background: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
          <span style={{ width: 14, height: 14, border: "2px solid var(--n-1)", borderRadius: "var(--radius-sm)", background: en.drafted ? "var(--positive)" : "var(--surface-card)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            {en.drafted && <Icon name="check" size={9} fill="var(--n-1)" />}
          </span>
        </button>
        <span className="fs-num" style={{ width: 26, flexShrink: 0, fontSize: 11.5, fontWeight: 500, color: "var(--text-primary)" }}>#{rank}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: en.drafted ? "line-through" : "none", opacity: en.drafted ? 0.55 : 1 }}>
          {window.FS_PlayerLink ? <window.FS_PlayerLink name={p.name}>{C.shortName(p.name, 18)}</window.FS_PlayerLink> : C.shortName(p.name, 18)}
        </span>
        <NS.PositionBadge position={p.pos} style={{ height: 16, minWidth: 24, fontSize: 9, padding: "0 4px", flexShrink: 0 }} />
        <span style={{ width: 26, flexShrink: 0, fontSize: 10.5, fontWeight: 500, color: "var(--n-3)", textAlign: "right" }}>{p.team}</span>
      </div>
    );
  }

  function CompareColumn({ list }) {
    const st = S();
    const buckets = B.bucketsFor(list, "list");
    const left = list.entries.filter((e) => !e.drafted).length;
    let n = 0;
    return (
      <div className="fs-lift" style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column", border: "var(--border)", background: "var(--surface-card)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 8px 9px 10px", borderBottom: "var(--border)" }}>
          <C.CoverTile list={list} size={26} />
          <span style={{ minWidth: 0, marginRight: "auto" }}>
            <span style={{ display: "block", fontSize: 13, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{list.name}</span>
            <span className="fs-num" style={{ display: "block", marginTop: 2, fontSize: 10.5, fontWeight: 500, color: "var(--n-3)" }}>{left} of {list.entries.length} left</span>
          </span>
          <Menu align="right" width={180} trigger={<IconButton icon="dots" variant="stroke" size="sm" title="Column options" />}
            onSelect={(it) => { if (it.id === "remove") st.toggleCompare(list.id); else st.patch(list, { org: it.id }); }}
            items={st.ORGS.map((o) => ({ id: o.id, label: o.label }))
              .concat([{ separator: true }, { id: "remove", label: "Remove column", icon: "close" }])} />
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {buckets.map((b) => (
            <div key={b.key}>
              {b.label && (
                <div style={{ display: "flex", alignItems: "center", padding: "0 10px", height: 26, background: b.color, color: b.textColor, borderBottom: "var(--border)", fontSize: 11.5, fontWeight: 700 }}>{b.label}</div>
              )}
              {b.entries.map((en) => { n += 1; return <CompareRow key={en.name} list={list} en={en} rank={n} />; })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function Compare() {
    const st = S();
    const lists = st.compare.map((id) => st.get(id)).filter(Boolean);
    if (!lists.length) return <ComparePicker />;
    return (
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", overflowX: "auto", margin: "0 -36px", padding: "0 36px 8px", scrollPaddingInline: 36 }}>
        {lists.map((l) => <CompareColumn key={l.id} list={l} />)}
      </div>
    );
  }

  // ---------- screen ----------
  function Lists() {
    const st = C.useStore();
    ensure();
    const list = st.selId ? st.get(st.selId) : null;
    const galleryList = st.openId ? st.get(st.openId) : null;

    const body = st.mode === "compare"
      ? <Compare />
      : st.mode === "rail"
      ? (
        <div style={{ display: "grid", gridTemplateColumns: "200px minmax(0, 1fr)", alignItems: "start" }}>
          <Rail sel={list} onSel={(l) => st.select(l.id)} />
          {list ? <Detail list={list} /> : <EmptyDetail />}
        </div>
      )
      : galleryList
      ? <Detail list={galleryList} />
      : <Gallery onOpen={(l) => { st.select(l.id); st.setOpen(l.id); }} />;

    return (
      <React.Fragment>{body}</React.Fragment>
    );
  }

  window.FS_Lists2 = Lists;
  window.FS_ListsHeader = ListsHeader;
})();
