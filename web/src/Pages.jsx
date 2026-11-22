import { useEffect, useMemo, useState } from "react";
import { Search, RotateCw, Trash2, MessageSquare, Volume2 } from "lucide-react";
import { api, TIERS, TIER_LABEL, initials, phoneFmt, clock, firstName, usePoll, applyAccent } from "./lib";

/* ================= Callers ================= */
export function CallersPage({ board, toast, refresh }) {
  const { data, refresh: reload, fetchedAt } = usePoll("/api/callers", 4000);
  const [tab, setTab] = useState("callers"), [q, setQ] = useState(""), [open, setOpen] = useState(false);
  const [forget, setForget] = useState(null);
  const callers = (data?.callers || []).filter((c) => !q || `${c.name} ${c.phone}`.toLowerCase().includes(q.toLowerCase()));
  const history = (board?.done || []).filter((x) => !q || `${x.name} ${x.summary}`.toLowerCase().includes(q.toLowerCase()));
  async function doForget() {
    const c = forget; setForget(null);
    try { await api(`/api/callers/${encodeURIComponent(c.phone)}`, undefined, "DELETE"); toast({ text: `${firstName(c.name)} forgotten. They'll be treated as a new caller.` }); reload(); }
    catch (e) { toast({ text: e.message, tone: "error" }); }
  }
  async function reopen(x) {
    try { await api(`/api/queue/${x.id}/reopen`, {}); await refresh(); toast({ text: `${firstName(x.name)} is back in the queue.` }); }
    catch (e) { toast({ text: e.message, tone: "error" }); }
  }
  return (
    <>
      <header className="page-head"><div><h1>Callers</h1><p className="sentence">Everyone who has called, and every callback you've finished.</p></div></header>
      <section className="card callers-card">
        <div className="section-head">
          <h2>Caller list</h2>
          <div className="section-tools">
            {open ? (
              <label className="search"><Search size={15} /><span className="sr">Search callers</span>
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or number" onBlur={() => !q && setOpen(false)} /></label>
            ) : <button type="button" className="icon-btn" aria-label="Search callers" onClick={() => setOpen(true)}><Search size={16} /></button>}
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "callers"} className={tab === "callers" ? "is-on" : ""} onClick={() => setTab("callers")}>Callers · {data?.callers?.length ?? 0}</button>
              <button type="button" role="tab" aria-selected={tab === "history"} className={tab === "history" ? "is-on" : ""} onClick={() => setTab("history")}>History · {board?.done?.length ?? 0}</button>
            </div>
          </div>
        </div>
        {tab === "callers" ? (callers.length === 0 ? <div className="list-empty" style={{ boxShadow: "none" }}><span className="mark"><MessageSquare size={20} /></span><span className="muted">{q ? "No callers match." : "No one has called yet."}</span></div> : (
          <div>
            {callers.map((c) => (
              <div key={c.phone} className={`crow${c.tier ? ` tier-${c.tier}` : ""}`}>
                <span className="avatar avatar-md">{initials(c.name)}</span>
                <span><span className="nm">{c.name}</span><br /><span className="ph">{phoneFmt(c.phone)}</span></span>
                <span className="last">{c.calls?.length ? `${c.calls[c.calls.length - 1].summary} · ${c.calls[c.calls.length - 1].at}` : "No calls yet"}</span>
                <span className="chip">{c.saved ? `Remembered · ${c.calls?.length || 0} ${c.calls?.length === 1 ? "call" : "calls"}` : "Not saved"}</span>
                {c.saved ? <button type="button" className="ghost-btn" onClick={() => setForget(c)} aria-label={`Forget ${c.name}`}><Trash2 size={15} /></button> : <span />}
              </div>
            ))}
          </div>
        )) : (history.length === 0 ? <p className="muted">No finished callbacks yet.</p> : (
          <div>
            {history.map((x) => (
              <div key={x.id} className={`crow tier-${x.tier}`}>
                <span className="avatar avatar-md">{initials(x.name)}</span>
                <span><span className="nm">{x.name}</span><br /><span className="ph">{x.doneAt ? clock(x.doneAt * 1000) : ""}</span></span>
                <span className="last">{x.summary}</span>
                <span className="chip chip-tier"><i className="tier-dot" />{TIER_LABEL[x.tier]}</span>
                <button type="button" className="tl-action" onClick={() => reopen(x)}>Reopen</button>
              </div>
            ))}
          </div>
        ))}
      </section>
      <p className="muted small">Updated {fetchedAt ? clock(fetchedAt) : "…"} · callers are recognized by number, never verified</p>
      {forget && (
        <div className="dialog-back" onClick={() => setForget(null)}>
          <div className="dialog" role="alertdialog" aria-labelledby="fg-h" onClick={(e) => e.stopPropagation()}>
            <h2 id="fg-h">Forget this caller?</h2>
            <p className="muted">Cue stops greeting {forget.name} by name and deletes their saved call notes. Callbacks already in the queue stay.</p>
            <div className="acts"><button type="button" className="btn" onClick={() => setForget(null)}>Keep</button><button type="button" className="btn btn-danger" onClick={doForget} autoFocus>Forget</button></div>
          </div>
        </div>
      )}
    </>
  );
}

/* ================= Insights ================= */
function TierCard({ title, n, empty, items }) {
  const c = Object.fromEntries(TIERS.map((t) => [t, items.filter((x) => x.tier === t).length]));
  return (
    <section className="tile stat-card">
      <p className="tile-label">{title}</p>
      <p className="tile-num tnum">{n}</p>
      <p className="tile-cap">{n ? `in the last 24 hours` : empty}</p>
      <div className="seg-bar" aria-hidden="true">{TIERS.map((t) => c[t] ? <i key={t} className={`tier-${t}`} style={{ width: `${(c[t] / (n || 1)) * 100}%` }} /> : null)}</div>
      <dl className="tier-stats">{TIERS.map((t) => <div key={t} className={`tier-${t}${c[t] ? "" : " is-zero"}`}><dt><i className="tier-dot" />{TIER_LABEL[t]}</dt><dd className="tnum">{c[t]}</dd></div>)}</dl>
    </section>
  );
}
function Compare({ rows, unit = "%" }) {
  const max = Math.max(...rows.map((r) => r[1]));
  return (
    <div className="compare">
      {rows.map(([label, v, us]) => (
        <div key={label} className={`compare-row${us ? " is-us" : ""}`}>
          <span>{label}</span><span className="track"><i style={{ width: `${(v / max) * 100}%` }} /></span><b>{v}{unit}</b>
        </div>
      ))}
    </div>
  );
}
export function InsightsPage({ board, refresh }) {
  const [tab, setTab] = useState("queue");
  const { data: callers } = usePoll("/api/callers", 10000);
  const since = Date.now() / 1000 - 86400;
  const all = [...(board?.queued || []), ...(board?.inProgress || []), ...(board?.done || [])].filter((x) => x.createdAt >= since);
  const called = all.filter((x) => x.claimedAt && x.claimedAt >= since);
  const ret = all.filter((x) => x.trust === "recognized").length;
  const texts = all.filter((x) => x.transcript?.length).length;
  const cards = {
    queue: [<TierCard key="q" title="Calls queued" n={all.length} empty="No calls queued yet" items={all} />],
    callbacks: [<TierCard key="c" title="Callbacks made" n={called.length} empty="No callbacks yet" items={called} />],
    callers: [
      <section key="r" className="tile stat-card"><p className="tile-label">Returning callers</p><p className="tile-num tnum">{ret}</p><p className="tile-cap">{all.length ? `of ${all.length} calls` : "No calls yet"}</p>
        <dl className="tier-stats"><div className="tier-normal"><dt><i className="tier-dot" />Returning</dt><dd>{ret}</dd></div><div className="tier-low"><dt><i className="tier-dot" />New</dt><dd>{all.length - ret}</dd></div></dl></section>,
      <section key="d" className="tile stat-card"><p className="tile-label">Details remembered</p><p className="tile-num tnum">{callers?.callers?.filter((c) => c.saved).length ?? 0}</p><p className="tile-cap">callers recognized by number</p></section>,
    ],
    texts: [
      <section key="t" className="tile stat-card"><p className="tile-label">Callback-time texts</p><p className="tile-num tnum">{texts}</p><p className="tile-cap">{texts ? "shown on screen in the demo" : "No texts yet"}</p>
        <dl className="tier-stats"><div className="tier-normal"><dt><i className="tier-dot" />Sent</dt><dd>{texts}</dd></div><div className="tier-low"><dt><i className="tier-dot" />Failed</dt><dd>0</dd></div></dl></section>,
    ],
  };
  const shown = tab === "queue" ? [...cards.queue, ...cards.callbacks, ...cards.callers, ...cards.texts] : cards[tab] || [];
  return (
    <>
      <header className="page-head">
        <div><h1>Insights</h1><p className="sentence">How the last 24 hours went, and why the ranking can be trusted.</p></div>
        <button type="button" className="icon-btn" aria-label="Refresh" onClick={refresh}><RotateCw size={16} /></button>
      </header>
      <div className="tabs" role="tablist">
        {["queue", "callbacks", "callers", "texts", "model"].map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-on" : ""} onClick={() => setTab(t)}>{t === "model" ? "The model" : t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {tab !== "model" && <><p className="kicker">Last 24 hours</p><div className="grid-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))" }}>{shown}</div></>}
      {(tab === "model" || tab === "queue") && (<>
        <p className="kicker">The model · tested on 60,000 CFPB complaints</p>
        <div className="grid-2">
          <section className="card"><h2 className="card-title">Needing action, reached in the first 20% of callbacks</h2>
            <Compare rows={[["Cue", 40, true], ["Random", 21], ["First-come", 15]]} />
            <p className="muted small" style={{ marginTop: ".7rem" }}>2.7× first-come. Precision and recall at the top 20%: 0.39 / 0.39, against a 0.20 base rate.</p></section>
          <section className="card"><h2 className="card-title">Three questions are enough</h2>
            <Compare unit="" rows={[["3 questions", 0.711, true], ["All 6 fields", 0.712]]} />
            <p className="muted small" style={{ marginTop: ".7rem" }}>AUC. Three questions keep 99.5% of the lift. Product, age 62+ and state add nothing.</p></section>
          <section className="card"><h2 className="card-title">Briefs, tested on 50 real complaints</h2>
            <Compare rows={[["Nothing invented", 98, true], ["“Wants” faithful", 88, true], ["Kept the amount", 77, true], ["v1 kept amount", 52]]} />
            <p className="muted small" style={{ marginTop: ".7rem" }}>0% invented dollar amounts.</p></section>
          <section className="card"><h2 className="card-title">Fairness</h2>
            <Compare unit="" rows={[["Older, actual", 0.222], ["3 questions", 0.194], ["+ 62+ flag", 0.221, true]]} />
            <p className="muted small" style={{ marginTop: ".7rem" }}>Older callers were under-ranked; the age flag fixes it. Top 10 states sit within ±2 points of their actual rate.</p></section>
        </div>
        <p className="muted small">Limits: “relief granted” stands in for urgency. Inside a single company the median AUC is 0.60, which is why every callback outcome becomes new training data.</p>
      </>)}
    </>
  );
}

/* ================= Setup ================= */
const SWATCHES = ["#ff5b35", "#ff3d6e", "#ffb21a", "#2fbf71", "#2f6bff", "#14b8c4", "#1b1b1d"];
export function SetupPage({ board, prefs, setPrefs, toast, refresh }) {
  const s = board?.settings || {};
  const [draft, setDraft] = useState({ company: s.company || "", repsOnShift: s.repsOnShift || 1, avgHandleMin: s.avgHandleMin || 3 });
  const [p, setP] = useState(prefs);
  const [tab, setTab] = useState("company");
  useEffect(() => { if (board) setDraft({ company: s.company, repsOnShift: s.repsOnShift, avgHandleMin: s.avgHandleMin }); }, [!!board]); // eslint-disable-line
  useEffect(() => { applyAccent(p.accent); return () => applyAccent(prefs.accent); }, [p.accent]); // eslint-disable-line live preview
  const dirty = JSON.stringify(p) !== JSON.stringify(prefs) || draft.company !== s.company || +draft.repsOnShift !== s.repsOnShift || +draft.avgHandleMin !== s.avgHandleMin;
  async function save() {
    try {
      await api("/api/settings", { company: draft.company, repsOnShift: +draft.repsOnShift, avgHandleMin: +draft.avgHandleMin });
      setPrefs(p); await refresh(); toast({ text: "Setup saved." });
    } catch (e) { toast({ text: e.message, tone: "error" }); }
  }
  function discard() { setP(prefs); setDraft({ company: s.company, repsOnShift: s.repsOnShift, avgHandleMin: s.avgHandleMin }); }
  const go = (id) => { setTab(id); document.getElementById(`setup-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const script = useMemo(() => `You are Cue, the phone assistant for ${draft.company || "the company"}'s callback line. Callers reach you instead of a hold queue. Understand the problem once, write it up for a human specialist, and say when they'll get a call back. You cannot move money, change accounts, or look up balances.

START OF EVERY CALL
• Look up the caller ID first.
• Recognized caller: "Hi Maria, I've got your details up. What can I help you with today?" Never ask a recognized caller for their name.
• New caller: "Thanks for calling ${draft.company}. This is Cue, an AI assistant. Who am I speaking with?"

THE THREE QUESTIONS (picked by forward selection on 60,000 outcomes)
1. What kind of account is this about: checking, savings, credit card, a loan, a mortgage, or something else?
2. What went wrong?
3. What specifically happened? Any amount or date helps.

If an answer comes back empty, ask once more, then switch to typing.

QUEUE THE CALLBACK
• The answers are sorted into official CFPB categories. The score is plain math from the trained model, never an AI guess.
• Write a six-line brief: Headline, Amount, When, Tried, Wants, Best time. Only facts the caller said; anything else is "not stated".

END OF THE CALL
"Thanks, {first name}. So: {headline}. A specialist will call you back in about {eta} minutes. You're number {position} in line." Then text the same estimate.

RULES
• Never ask for card numbers, PINs or Social Security numbers.
• Callers are recognized by number, never verified.`, [draft.company]);

  return (
    <>
      <header className="page-head">
        <div><h1>Setup</h1><p className="sentence">Callback line for {s.company || "…"} · ranking learned from 60,000 outcomes</p></div>
        <div className="head-right"><button type="button" className="ghost-btn" disabled={!dirty} onClick={discard}>Discard</button><button type="button" className="btn btn-primary" disabled={!dirty} onClick={save}>Save</button></div>
      </header>
      <div className="tabs" role="tablist">{[["company", "Company"], ["voice", "Phone line"], ["ranking", "Ranking"], ["dashboard", "Dashboard"]].map(([id, l]) => <button key={id} type="button" className={tab === id ? "is-on" : ""} onClick={() => go(id)}>{l}</button>)}</div>
      <div className="setup">
        <div style={{ display: "grid", gap: "1rem" }}>
          <section className="card setup-card" id="setup-company"><span className="num">01</span><div>
            <h2>Company</h2>
            <div className="fields"><div className="field full"><label htmlFor="co">Company name</label><input id="co" value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} /></div></div>
          </div></section>

          <section className="card setup-card" id="setup-voice"><span className="num">02</span><div>
            <h2>Phone line</h2>
            <div className="fields">
              <div className="field"><span className="lbl">Number</span><input readOnly value={s.phoneNumber ? phoneFmt(s.phoneNumber) : "Not set"} /></div>
              <div className="field"><span className="lbl">Voice</span><input readOnly value="Vapi · Elliot" /></div>
              <div className="field full"><span className="lbl">Greeting</span><input readOnly value={`Thanks for calling ${draft.company}. I'm Cue, an AI assistant, and this call may be recorded. What's going on today?`} /></div>
              <p className="muted small field full">Calls are limited to a few per caller per day and a daily total, and each call is capped at 3 minutes, so the free Vapi plan isn't used up.</p>
            </div>
          </div></section>

          <section className="card setup-card" id="setup-ranking"><span className="num">03</span><div>
            <h2>Ranking</h2>
            <p className="muted small" style={{ marginBottom: ".8rem" }}>Urgency is learned, so it isn't hand-edited: a logistic model over the three answers, read as a percentile among 60,000 real CFPB complaints. Value and waiting are rules, labelled as rules.</p>
            <table className="rules-table">
              <thead><tr><th>Part</th><th>Source</th><th>How it scores</th><th style={{ textAlign: "right" }}>Points</th></tr></thead>
              <tbody>
                <tr><td><b>Urgency</b></td><td>Learned</td><td>Percentile of the model's probability</td><td className="n">0–100</td></tr>
                {[["critical", "90+"], ["high", "70–89"], ["normal", "30–69"], ["low", "0–29"]].map(([t, r]) => <tr key={t} className={`tier-${t}`}><td style={{ paddingLeft: "1.2rem" }}><i className="tier-dot" /> {TIER_LABEL[t]}</td><td className="muted">Tier</td><td className="muted">urgency {r}</td><td className="n" /></tr>)}
                <tr><td><b>Value</b></td><td>Rule</td><td>$1,000+ is 5, $10,000+ is 10</td><td className="n">0–10</td></tr>
                <tr><td><b>Waiting</b></td><td>Rule</td><td>1 point per minute waited</td><td className="n">0–30</td></tr>
              </tbody>
            </table>
            <p className="kicker" style={{ margin: "1.1rem 0 .6rem" }}>Capacity</p>
            <div className="fields">
              <div className="field"><label htmlFor="reps">Reps on shift</label><input id="reps" type="number" min="1" value={draft.repsOnShift} onChange={(e) => setDraft({ ...draft, repsOnShift: e.target.value })} /></div>
              <div className="field"><label htmlFor="ah">Avg handle time (min)</label><input id="ah" type="number" min="1" value={draft.avgHandleMin} onChange={(e) => setDraft({ ...draft, avgHandleMin: e.target.value })} /></div>
              <div className="field"><span className="lbl">Hold time replaced (min)</span><input readOnly value={s.baselineHoldMin ?? 23} /></div>
              <div className="field"><span className="lbl">Re-explaining avoided (min)</span><input readOnly value={s.reexplainMin ?? 3} /></div>
            </div>
          </div></section>

          <section className="card setup-card" id="setup-dashboard"><span className="num">04</span><div>
            <h2>Dashboard</h2>
            <div style={{ display: "grid", gap: ".5rem" }}>
              {[["showAssistant", "Ask Cue", "The floating assistant that answers questions about the queue."], ["showToday", "Today feed", "The day's calls, callbacks and handled requests under the queue."], ["showInsights", "Insights tab", "The last 24 hours in numbers, and the model's evidence."]].map(([k, t, d]) => (
                <div key={k} className="switch-row"><div><b>{t}</b><span>{d}</span></div>
                  <button type="button" role="switch" className="switch" aria-checked={p[k]} aria-label={t} onClick={() => setP({ ...p, [k]: !p[k] })} /></div>
              ))}
            </div>
            <p className="kicker" style={{ margin: "1.1rem 0 .6rem" }}>Theme</p>
            <div className="switch-row" style={{ flexWrap: "wrap" }}>
              <div><b>Accent</b><span>Preview is live. Save to keep it.</span></div>
              <div className="swatches">
                {SWATCHES.map((c) => <button key={c} type="button" className="swatch" style={{ background: c }} aria-label={`Accent ${c}`} aria-pressed={p.accent === c} onClick={() => setP({ ...p, accent: c })} />)}
                <input aria-label="Accent hex" value={p.accent} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) ? setP({ ...p, accent: e.target.value }) : null} style={{ width: "6.5rem", border: 0, background: "var(--surface)", borderRadius: 10, padding: ".4rem .6rem", fontFamily: "var(--mono)" }} />
              </div>
            </div>
          </div></section>
        </div>
        <aside className="card prompt-card">
          <div className="section-head" style={{ marginBottom: 0 }}><h2>Call script</h2><span className="chip" style={{ color: "var(--accent-ink)" }}><i className="ready-dot" />Live</span></div>
          <div className="prompt-text">{script}</div>
        </aside>
      </div>
    </>
  );
}
