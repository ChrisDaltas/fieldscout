// Field Scout — player lists. Sits on top of FS_PLAYERS (pool + stat engine)
// and FS_PLATFORM. Real player names; every stat is illustrative.
// Exposes window.FS_LISTS: the data model + a tiny store the three list
// screens share, so edits made in one version show up in the others.
window.FS_LISTS = (function () {
  const A = "../../assets/avatars/";

  // e(name, tier, round, cost, drafted, note)
  const e = (name, tier, round, cost, drafted, note) =>
    ({ name, tier, round, cost, drafted: !!drafted, note: note || "" });

  const lists = [
    {
      id: "favorites", name: "Favorites", fav: true,
      desc: "Everything you starred, in one place. Star a player anywhere in Field Scout and it lands here.",
      cover: { color: "var(--brand)", mono: "★", icon: "star" },
      kind: "list", scope: "ros", visibility: "private", org: "rank", view: "list",
      cols: ["proj", "adp", "rost", "bye"], budget: 200,
      author: { name: "You", handle: "@gridironguru", avatar: A + "avatar-1.jpg" },
      tags: [],
      created: "2026-08-08", stats: { views: 0, likes: 0 }, links: [],
      entries: [
        e("Malik Nabers", 1, 1, 47), e("Jayden Daniels", 1, 2, 30), e("Brian Thomas Jr.", 1, 2, 45),
        e("Jaylen Warren", 2, 5, 12), e("Brock Bowers", 2, 4, 40),
      ],
    },
    {
      id: "bigboard", name: "My 2026 big board",
      desc: "Full-league PPR board. The tiers are where I actually draft from — 1–N order is just tiebreakers.",
      cover: { color: "var(--accent)", mono: "BB", icon: "cup" },
      kind: "ranking", scope: "predraft", visibility: "public", org: "tier", view: "table",
      cols: ["adp", "cost", "proj", "bye", "sos"], budget: 200,
      author: { name: "You", handle: "@gridironguru", avatar: A + "avatar-1.jpg" },
      tags: ["half-ppr", "12-team", "superflex"],
      created: "2026-07-02", stats: { views: 4820, likes: 316 },
      links: [{ type: "youtube", title: "Round 1 walkthrough — every pick, ranked", source: "Field Scout on YouTube", meta: "18:42" }],
      entries: [
        e("Saquon Barkley", 1, 1, 63, false, "Only back I take over Chase. Goal-line work is locked in."),
        e("Ja'Marr Chase", 1, 1, 64, true), e("Bijan Robinson", 1, 1, 60), e("Justin Jefferson", 1, 1, 61),
        e("CeeDee Lamb", 2, 2, 58, true), e("Jahmyr Gibbs", 2, 2, 56, false, "Committee risk is real, but the receiving floor covers it."),
        e("Amon-Ra St. Brown", 2, 2, 52), e("Puka Nacua", 2, 3, 50),
        e("Malik Nabers", 3, 3, 47, false, "32% target share on a bad offense. That is the profile I want."),
        e("De'Von Achane", 3, 3, 49), e("Brian Thomas Jr.", 3, 3, 45), e("Nico Collins", 3, 4, 43),
        e("Josh Allen", 4, 4, 38, false, "Taking a QB this early only works if I punt TE."),
        e("Drake London", 4, 4, 41), e("Jonathan Taylor", 4, 5, 44), e("Brock Bowers", 4, 5, 40, false, "Last TE I would pay up for."),
        e("Christian McCaffrey", 5, 5, 36, false, "Fading. Third straight year of an injury-shortened season."),
        e("A.J. Brown", 5, 6, 39), e("Ladd McConkey", 5, 6, 33), e("Trey McBride", 6, 6, 37),
      ],
    },
    {
      id: "wrroom", name: "WR room I actually trust",
      desc: "Route volume first, touchdowns second. Anyone under a 20% target rate is off the list.",
      cover: { color: "var(--pos-wr)", mono: "WR", icon: "chart" },
      kind: "list", scope: "ros", visibility: "public", org: "tier", view: "list",
      cols: ["targets", "tgtRate", "recShare", "adot", "proj"], budget: 200,
      author: { name: "You", handle: "@gridironguru", avatar: A + "avatar-1.jpg" },
      tags: ["wr", "target-share"],
      created: "2026-06-18", stats: { views: 1930, likes: 148 },
      links: [{ type: "article", title: "Route participation is still the most predictive WR stat", source: "fieldscout.com", meta: "6 min read" }],
      entries: [
        e("Ja'Marr Chase", 1, 1, 64), e("Justin Jefferson", 1, 1, 61), e("CeeDee Lamb", 1, 2, 58),
        e("Malik Nabers", 2, 2, 47, false, "Volume is the whole case. Efficiency will come with the offense."),
        e("Puka Nacua", 2, 3, 50), e("Amon-Ra St. Brown", 2, 3, 52), e("Garrett Wilson", 3, 3, 32),
        e("Brian Thomas Jr.", 3, 4, 45), e("Jaxon Smith-Njigba", 3, 4, 29), e("Nico Collins", 4, 5, 43),
        e("Ladd McConkey", 4, 5, 33), e("Tee Higgins", 4, 6, 27, false, "Air yards say buy, target rate says wait a round."),
      ],
    },
    {
      id: "auction", name: "Auction targets — $200",
      desc: "Where I will go over market, and where I refuse to.",
      cover: { color: "var(--pos-qb)", mono: "$", icon: "level" },
      kind: "list", scope: "predraft", visibility: "link", org: "budget", view: "table",
      cols: ["cost", "adp", "proj", "rost", "bye"], budget: 200,
      author: { name: "You", handle: "@gridironguru", avatar: A + "avatar-1.jpg" },
      created: "2026-07-24", stats: { views: 640, likes: 39 }, links: [],
      entries: [
        e("Ja'Marr Chase", 1, 1, 68, false, "Will pay 34% of the budget. Will not blink."),
        e("Saquon Barkley", 1, 1, 63), e("Bijan Robinson", 1, 1, 55), e("Josh Allen", 2, 2, 30),
        e("Brock Bowers", 2, 2, 34, false, "Positional edge at TE is worth real money this year."),
        e("De'Von Achane", 3, 3, 24), e("Tee Higgins", 3, 4, 18),
        e("Chase Brown", 4, 5, 12, false, "Last dollars I spend."), e("Jaylen Warren", 4, 6, 4),
      ],
    },
    {
      id: "week11", name: "Week 11 starts",
      desc: "", cover: { color: "var(--brand)", mono: "11", icon: "fire" },
      kind: "list", scope: "week", visibility: "private", org: "rank", view: "card",
      cols: ["proj", "rost", "snap", "sos", "bye"], budget: 200,
      author: { name: "You", handle: "@gridironguru", avatar: A + "avatar-1.jpg" },
      created: "2026-08-01", stats: { views: 0, likes: 0 }, links: [],
      entries: [
        e("Lamar Jackson", 1, 1, 0), e("Jahmyr Gibbs", 1, 1, 0),
        e("Malik Nabers", 1, 2, 0, false, "Easiest matchup on the board this week."),
        e("Trey McBride", 2, 2, 0), e("Kyren Williams", 2, 3, 0), e("George Kittle", 3, 3, 0),
      ],
    },
    {
      id: "rookies", name: "Rookie stash — dynasty",
      desc: "Year-two leaps I am buying before the price moves.",
      cover: { color: "var(--pos-te)", mono: "RK", icon: "rocket" },
      kind: "list", scope: "ros", visibility: "public", org: "round", view: "card",
      cols: ["proj", "adp", "rost", "snap", "bye"], budget: 200,
      author: { name: "You", handle: "@gridironguru", avatar: A + "avatar-1.jpg" },
      tags: ["rookies", "dynasty"],
      created: "2025-11-09", stats: { views: 2410, likes: 205 },
      links: [{ type: "youtube", title: "Every rookie snap that mattered, weeks 1–5", source: "Field Scout on YouTube", meta: "24:10" }],
      entries: [
        e("Brian Thomas Jr.", 1, 1, 45), e("Malik Nabers", 1, 1, 47), e("Ladd McConkey", 1, 2, 33),
        e("Bucky Irving", 2, 2, 26), e("Rome Odunze", 2, 3, 9, false, "Snap share is the only thing in the way."),
        e("Jalen McMillan", 3, 3, 6), e("Braelon Allen", 3, 4, 7),
      ],
    },
    {
      id: "zerorb", name: "Zero-RB survival kit",
      desc: "", cover: { color: "var(--tier-1)", mono: "0R", icon: "level" },
      kind: "ranking", scope: "predraft", visibility: "public", org: "round", view: "list",
      cols: ["carries", "carryShare", "snap", "adp", "proj"], budget: 200,
      author: { name: "You", handle: "@gridironguru", avatar: A + "avatar-1.jpg" },
      created: "2026-06-30", stats: { views: 3105, likes: 271 }, links: [],
      entries: [
        e("Chase Brown", 1, 3, 30), e("Kenneth Walker III", 1, 4, 28), e("Tyjae Spears", 2, 4, 14),
        e("Jaylen Warren", 2, 5, 11, false, "Handcuff value alone justifies the pick."),
        e("Zach Charbonnet", 3, 6, 8), e("Braelon Allen", 3, 6, 7),
      ],
    },
    {
      id: "svflex", name: "Week 11 flex rankings (PPR)", saved: true,
      desc: "Every flex-eligible starter for the week, ranked on projected touches and matchup. Updated Thursday night.",
      cover: { color: "var(--pos-rb)", mono: "FL", icon: "chart" },
      kind: "ranking", scope: "week", visibility: "public", org: "tier", view: "list",
      cols: ["proj", "rost", "snap", "sos", "bye"], budget: 200,
      author: { name: "Marcus W.", handle: "@thediesel", avatar: A + "avatar-2.jpg" },
      tags: ["weekly", "flex"],
      created: "2026-08-03", stats: { views: 18400, likes: 1240 }, links: [],
      entries: [
        e("Jahmyr Gibbs", 1, 1, 56), e("Puka Nacua", 1, 1, 50), e("De'Von Achane", 1, 1, 49),
        e("Ladd McConkey", 2, 2, 33), e("Jaylen Warren", 2, 3, 12), e("Chase Brown", 3, 4, 30),
      ],
    },
    {
      id: "svrookie", name: "Dynasty rookie big board 2.0", saved: true,
      desc: "Post-camp refresh. Landing spot matters more than draft capital in this class.",
      cover: { color: "var(--pos-wr)", mono: "RK", icon: "cup" },
      kind: "ranking", scope: "predraft", visibility: "public", org: "tier", view: "table",
      cols: ["adp", "proj", "rost", "bye"], budget: 200,
      author: { name: "Priya N.", handle: "@airraid", avatar: A + "avatar-3.jpg" },
      tags: ["dynasty", "rookies"],
      created: "2026-07-15", stats: { views: 12600, likes: 980 }, links: [],
      entries: [
        e("Brian Thomas Jr.", 1, 1, 45), e("Malik Nabers", 1, 1, 47), e("Ladd McConkey", 2, 2, 33),
        e("Bucky Irving", 2, 2, 26), e("Rome Odunze", 3, 3, 9),
      ],
    },
  ];

  // Column presets — the "show me a useful set fast" shortcut in the stat picker.
  const presets = [
    { id: "draft", label: "Draft basics", cols: ["adp", "cost", "proj", "bye", "sos"] },
    { id: "value", label: "Value", cols: ["adp", "cost", "rost", "pts", "proj"] },
    { id: "receiving", label: "Receiving volume", cols: ["targets", "tgtRate", "recShare", "adot", "snap"] },
    { id: "rushing", label: "Rushing volume", cols: ["carries", "carryShare", "yacon", "brokenTackles", "snap"] },
    { id: "passing", label: "Passing", cols: ["passRate", "compPct", "rating", "carries", "proj"] },
  ];

  const covers = ["var(--accent)", "var(--brand)", "var(--tier-1)", "var(--pos-qb)", "var(--pos-te)", "var(--pos-wr)"];

  const comments = {
    bigboard: [
      { name: "Marcus W.", handle: "@thediesel", avatar: A + "avatar-2.jpg", when: "2h", likes: 12, text: "Barkley over Chase is the whole board for me. How much of that is the goal-line note vs. the raw projection?" },
      { name: "Priya N.", handle: "@airraid", avatar: A + "avatar-3.jpg", when: "5h", likes: 8, text: "Tier 3 is doing a lot of work here. Six names, and I would bet you do not actually treat them as interchangeable." },
      { name: "Sara L.", handle: "@checkdown", avatar: A + "avatar-5.jpg", when: "1d", likes: 4, text: "Allen in tier 4 with this much WR depth left feels like a trap. Good list though." },
    ],
    wrroom: [
      { name: "Marcus W.", handle: "@thediesel", avatar: A + "avatar-2.jpg", when: "6h", likes: 9, text: "Nabers in tier 2 on target rate alone is the sharpest call on here." },
      { name: "Devon K.", handle: "@lambeau", avatar: A + "avatar-4.jpg", when: "1d", likes: 3, text: "Where is Evans? Under the 20% cutoff, I assume. Fair." },
    ],
    auction: [
      { name: "Tom R.", handle: "@thetom", avatar: A + "avatar-6.jpg", when: "2d", likes: 6, text: "Spending 34% on one receiver only works if you hit on the $1 backs. What is the plan there?" },
    ],
    rookies: [
      { name: "Priya N.", handle: "@airraid", avatar: A + "avatar-3.jpg", when: "3d", likes: 15, text: "Odunze's snap share is the risk nobody prices in. Glad you flagged it." },
    ],
    zerorb: [
      { name: "Sara L.", handle: "@checkdown", avatar: A + "avatar-5.jpg", when: "4d", likes: 11, text: "Warren at pick 5 of the handcuff run is where this build lives or dies." },
    ],
  };

  // ---- shared store ----
  const subs = [];
  const store = {
    lists, comments, presets, covers,
    bump() { subs.forEach((f) => f()); },
    subscribe(f) { subs.push(f); return () => { const i = subs.indexOf(f); if (i >= 0) subs.splice(i, 1); }; },
    get(id) { return lists.find((l) => l.id === id) || lists[0]; },
    liked: {},
    // "rail" = list rail + one list open · "gallery" = cover-card gallery
    mode: "rail",
    // Pop-out list windows the user can drag around, side by side.
    popouts: [],
  };

  // Expanding remembers where it came from, so minimize and Back both put the
  // user back where they were rather than dumping them in the gallery.
  store.expandedFrom = null;
  store.setMode = (m) => { store.mode = m; store.expandedFrom = null; store.bump(); };
  store.expand = (id) => {
    store.expandedFrom = store.mode;
    store.mode = "gallery";
    store.openId = id;
    store.selId = id;
    store.bump();
  };
  store.minimize = () => {
    const back = store.expandedFrom;
    store.expandedFrom = null;
    if (back && back !== "gallery") { store.mode = back; store.openId = null; }
    else store.openId = null;
    store.bump();
  };
  // Drafted is global, so the seed has to agree with itself: if a player is
  // drafted in any list, he is drafted in all of them.
  (function normalizeDrafted() {
    const gone = {};
    lists.forEach((l) => l.entries.forEach((e) => { if (e.drafted) gone[e.name] = true; }));
    lists.forEach((l) => l.entries.forEach((e) => { if (gone[e.name]) e.drafted = true; }));
  })();

  // Side-by-side: the ids showing as columns. Empty = the picker.
  store.compare = [];
  store.setCompare = (ids) => { store.compare = ids.slice(); store.bump(); };
  store.toggleCompare = (id) => {
    const i = store.compare.indexOf(id);
    if (i >= 0) store.compare.splice(i, 1); else store.compare.push(id);
    store.bump();
  };
  store.tab = "mine";
  store.setTab = (t) => { store.tab = t; store.bump(); };
  store.tabLists = () => (store.tab === "saved" ? store.savedLists() : store.myLists());
  store.ME = "@gridironguru";
  store.mine = (l) => l.author.handle === store.ME;
  // Rail tabs: your own lists (Favorites always first) vs. lists you saved from others.
  store.myLists = () => lists.filter((l) => store.mine(l) && !l.archived).sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0));
  store.savedLists = () => lists.filter((l) => !store.mine(l) && !l.archived);
  store.byAuthor = (handle) => lists.filter((l) => l.author.handle === handle && l.visibility === "public" && !l.archived);
  // Favorites is permanent; everything else can go.
  store.destroy = (id) => {
    const l = store.get(id);
    if (l.fav) return;
    const i = lists.indexOf(l);
    if (i >= 0) lists.splice(i, 1);
    if (store.selId === id) store.selId = null;
    if (store.openId === id) store.openId = null;
    store.popouts = store.popouts.filter((p) => p.id !== id);
    store.bump();
  };
  store.archive = (id) => {
    const l = store.get(id);
    l.archived = !l.archived;
    if (l.archived && store.selId === id) store.selId = null;
    store.bump();
  };
  store.popout = (id) => {
    const open = store.popouts.find((p) => p.id === id);
    if (open) { open.z = Date.now(); store.bump(); return; }
    const n = store.popouts.length;
    store.popouts.push({ id: id, x: 120 + n * 46, y: 120 + n * 34, w: 440, h: 520, z: Date.now(), min: false });
    store.bump();
  };
  store.closePopout = (id) => { store.popouts = store.popouts.filter((p) => p.id !== id); store.bump(); };
  store.movePopout = (id, x, y) => { const p = store.popouts.find((q) => q.id === id); if (p) { p.x = x; p.y = y; store.bump(); } };
  store.raisePopout = (id) => { const p = store.popouts.find((q) => q.id === id); if (p) { p.z = Date.now(); store.bump(); } };
  // Widening the window is how you get more stats on screen at once.
  store.sizePopout = (id, w, h) => {
    const p = store.popouts.find((q) => q.id === id);
    if (!p) return;
    p.w = Math.max(330, Math.min(1200, w));
    p.h = Math.max(220, Math.min(900, h));
    store.bump();
  };

  // ---- helpers ----
  const P = () => window.FS_PLAYERS;

  // Player object for an entry.
  store.player = (entry) => P().byName(entry.name) || null;

  // Which stats actually have values for the players in this list. Drives the
  // "relevant metrics" behaviour — a WR list surfaces receiving stats first.
  store.coverage = (list) => {
    const ps = list.entries.map(store.player).filter(Boolean);
    const out = {};
    P().STATS.forEach((s) => {
      const n = ps.filter((p) => p[s.id] != null).length;
      out[s.id] = ps.length ? n / ps.length : 0;
    });
    return out;
  };

  // Position mix, e.g. { WR: 12 } for a pure WR list.
  store.posMix = (list) => {
    const mix = {};
    list.entries.forEach((en) => { const p = store.player(en); if (p) mix[p.pos] = (mix[p.pos] || 0) + 1; });
    return mix;
  };
  store.dominantPos = (list) => {
    const mix = store.posMix(list);
    const keys = Object.keys(mix);
    if (!keys.length) return null;
    const top = keys.sort((a, b) => mix[b] - mix[a])[0];
    return mix[top] / list.entries.length >= 0.8 ? top : null;
  };

  // ---- mutations ----
  store.patch = (list, changes) => { Object.assign(list, changes); store.bump(); };
  store.setNote = (list, name, note) => { const en = list.entries.find((x) => x.name === name); if (en) en.note = note; store.bump(); };
  // Drafted is a fact about the draft, not an annotation on one list — once a
  // player is gone he reads as gone everywhere he appears.
  store.toggleDrafted = (list, name) => {
    const en = list.entries.find((x) => x.name === name);
    if (!en) return;
    const on = !en.drafted;
    lists.forEach((l) => {
      const e = l.entries.find((x) => x.name === name);
      if (e) e.drafted = on;
    });
    store.bump();
  };
  store.remove = (list, name) => { list.entries = list.entries.filter((x) => x.name !== name); store.bump(); };
  // bucket (optional) drops the player straight into a tier / round.
  store.add = (list, name, bucket) => {
    if (list.entries.some((x) => x.name === name)) return;
    const last = list.entries[list.entries.length - 1];
    const p = P().byName(name);
    const en = e(name, last ? last.tier : 1, last ? last.round : 1, p ? p.cost : 1);
    if (bucket && bucket.bucketKey) {
      en[bucket.bucketKey] = bucket.value;
      const key = bucket.bucketKey;
      let at = list.entries.length;
      list.entries.forEach((x, i) => { if (x[key] === bucket.value) at = i + 1; });
      list.entries.splice(at, 0, en);
    } else if (bucket && bucket.band) {
      en.cost = Math.round(list.budget * (bucket.band.min || 0.02)) + 1;
      list.entries.push(en);
    } else {
      list.entries.push(en);
    }
    store.bump();
  };
  store.setCost = (list, name, cost) => { const en = list.entries.find((x) => x.name === name); if (en) en.cost = Math.max(0, cost); store.bump(); };
  store.toggleCol = (list, id) => {
    const i = list.cols.indexOf(id);
    if (i >= 0) list.cols.splice(i, 1); else list.cols.push(id);
    store.bump();
  };
  store.setCols = (list, cols) => { list.cols = cols.slice(); store.bump(); };
  store.like = (list) => {
    store.liked[list.id] = !store.liked[list.id];
    list.stats.likes += store.liked[list.id] ? 1 : -1;
    store.bump();
  };
  store.addComment = (list, text) => {
    const c = comments[list.id] || (comments[list.id] = []);
    c.unshift({ name: "You", handle: "@gridironguru", avatar: A + "avatar-1.jpg", when: "now", likes: 0, text });
    store.bump();
  };
  store.addLink = (list, link) => { list.links.push(link); store.bump(); };
  store.removeLink = (list, i) => { list.links.splice(i, 1); store.bump(); };
  store.create = (name, opts) => {
    const l = Object.assign({
      id: "l" + Date.now(), name: name || "Untitled list", desc: "",
      cover: { color: covers[lists.length % covers.length], mono: (name || "UL").slice(0, 2).toUpperCase(), icon: "list" },
      kind: "list", scope: "predraft", visibility: "private", org: "rank", view: "list",
      cols: ["adp", "cost", "proj", "bye", "sos"], budget: 200,
      author: { name: "You", handle: "@gridironguru", avatar: A + "avatar-1.jpg" },
      tags: [],
      created: new Date().toISOString().slice(0, 10),
      stats: { views: 0, likes: 0 }, links: [], entries: [],
    }, opts || {});
    lists.unshift(l);
    store.bump();
    return l;
  };

  // Move `name` so it sits directly before `beforeName` (null = end of list).
  // When the target sits in another bucket, the player adopts that bucket.
  store.move = (list, name, beforeName, bucket) => {
    const from = list.entries.findIndex((x) => x.name === name);
    if (from < 0) return;
    const [en] = list.entries.splice(from, 1);
    if (bucket) Object.assign(en, bucket);
    let to = beforeName ? list.entries.findIndex((x) => x.name === beforeName) : list.entries.length;
    if (to < 0) to = list.entries.length;
    list.entries.splice(to, 0, en);
    store.bump();
  };
  // Insert `name` directly after `afterName` — the "last slot in a bucket" case.
  store.moveAfter = (list, name, afterName, bucket) => {
    const from = list.entries.findIndex((x) => x.name === name);
    if (from < 0) return;
    const [en] = list.entries.splice(from, 1);
    if (bucket) Object.assign(en, bucket);
    let to = list.entries.findIndex((x) => x.name === afterName);
    to = to < 0 ? list.entries.length : to + 1;
    list.entries.splice(to, 0, en);
    store.bump();
  };
  store.moveToBucket = (list, name, bucket) => {
    const en = list.entries.find((x) => x.name === name);
    if (!en) return;
    Object.assign(en, bucket);
    // keep bucket members contiguous
    const key = list.org === "round" ? "round" : list.org === "cost" ? "cost" : "tier";
    list.entries = list.entries.filter((x) => x.name !== name);
    let last = -1;
    list.entries.forEach((x, i) => { if (x[key] === en[key]) last = i; });
    list.entries.splice(last + 1, 0, en);
    store.bump();
  };

  // Buckets for the current organise mode. Returns [{ key, label, meta, color,
  // textColor, entries }] — a single unlabelled bucket for plain 1–N rank.
  store.buckets = (list) => {
    const org = list.org;
    if (org === "rank") return [{ key: "all", label: null, entries: list.entries }];
    // Avg cost works exactly like tiers — assigned bands, drag between them —
    // except the creator writes the band labels themselves ("$45 – $60").
    if (org === "cost") {
      if (!list.costBands) list.costBands = store.defaultCostBands();
      const bands = list.costBands;
      return bands.map((b, i) => {
        const hi = i === 0 ? Infinity : bands[i - 1].min;
        const entries = list.entries.filter((en) => en.cost >= b.min && en.cost < hi).sort((a, b2) => b2.cost - a.cost);
        return {
          key: b.key, value: b.min, bucketKey: "cost", band: b, editable: true,
          label: b.label, meta: "$" + entries.reduce((s, en) => s + en.cost, 0),
          color: "var(--tier-" + (i + 1) + ")", textColor: "var(--tier-" + (i + 1) + "-text)", entries,
        };
      });
    }
    if (org === "budget") {
      const bands = [
        { key: "b1", label: "Over 20% of budget", min: 0.2 },
        { key: "b2", label: "10–20%", min: 0.1 },
        { key: "b3", label: "5–10%", min: 0.05 },
        { key: "b4", label: "Under 5%", min: 0 },
      ];
      return bands.map((b, i) => {
        const hi = i === 0 ? Infinity : bands[i - 1].min;
        const entries = list.entries.filter((en) => {
          const share = en.cost / list.budget;
          return share >= b.min && share < hi;
        }).sort((a, b2) => b2.cost - a.cost);
        const spend = entries.reduce((s, en) => s + en.cost, 0);
        return { key: b.key, label: b.label, meta: "$" + spend, color: "var(--tier-" + (i + 1) + ")", textColor: "var(--tier-" + (i + 1) + "-text)", entries, band: b };
      }).filter((g) => g.entries.length);
    }
    const key = org === "round" ? "round" : "tier";
    const seen = [];
    list.entries.forEach((en) => { if (seen.indexOf(en[key]) < 0) seen.push(en[key]); });
    // Empty tiers still render — they are slots to drag into, not absences.
    const max = Math.max(1, list[key + "Count"] || 0, ...seen);
    const all = [];
    for (let v = 1; v <= max; v++) all.push(v);
    return all.map((v) => ({
      key: key + v, value: v, bucketKey: key,
      label: (key === "round" ? "Round " : "Tier ") + v,
      meta: null,
      color: "var(--tier-" + Math.min(7, v) + ")",
      textColor: "var(--tier-" + Math.min(7, v) + "-text)",
      entries: list.entries.filter((en) => en[key] === v),
    }));
  };

  store.defaultCostBands = () => ([
    { key: "c1", label: "$40 and up", min: 40 },
    { key: "c2", label: "$25 – $39", min: 25 },
    { key: "c3", label: "$10 – $24", min: 10 },
    { key: "c4", label: "Under $10", min: 0 },
  ]);
  store.setBandLabel = (list, key, label) => {
    const b = (list.costBands || []).find((x) => x.key === key);
    if (b) { b.label = label.trim() || b.label; store.bump(); }
  };

  // "Jul 2" for this year, "Nov 9, 2025" for anything older.
  store.fmtCreated = (iso) => {
    const d = new Date(iso + "T12:00:00");
    if (isNaN(d)) return iso;
    const opts = { month: "short", day: "numeric" };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
    return d.toLocaleDateString("en-US", opts);
  };

  store.ORGS = [
    { id: "rank", label: "Ranked" },
    { id: "tier", label: "Tiers" },
    { id: "round", label: "Rounds" },
    { id: "cost", label: "Avg cost" },
    { id: "budget", label: "Budget %" },
  ];
  store.SCOPES = [
    { id: "predraft", label: "Pre-draft" },
    { id: "week", label: "This week" },
    { id: "ros", label: "Rest of season" },
  ];
  // View style. Tiers/rounds run VERTICALLY in list + table, and HORIZONTALLY
  // (one column per tier) in card view.
  store.VIEWS = [
    { id: "list", label: "List", icon: "list" },
    { id: "table", label: "Table", icon: "table" },
    { id: "card", label: "Cards", icon: "layers" },
  ];
  store.VISIBILITY = [
    { id: "private", label: "Private", icon: "eye", note: "Only you" },
    { id: "link", label: "Anyone with the link", icon: "external-link", note: "Not listed publicly" },
    { id: "public", label: "Public", icon: "team", note: "Shows in Community" },
  ];

  return store;
})();
