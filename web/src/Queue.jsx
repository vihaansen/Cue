import { useEffect, useMemo, useRef, useState } from "react";
import {
  CreditCard, Wallet, PiggyBank, Home, Car, ArrowLeftRight, GraduationCap, HandCoins, Gavel, Receipt,
  HelpCircle, Info, ChevronDown, Phone, X, Inbox, Sparkles, PhoneCall,
} from "lucide-react";
import {
  api, TIERS, TIER_LABEL, LABELS, isNS, firstName, initials, money, clock, greeting, phoneFmt, wc,
  productLabel, shortIssue, useRankFlags, useFlip,
} from "./lib";

const ICONS = {
  "Credit card": CreditCard, Checking: Wallet, Savings: PiggyBank, Mortgage: Home, "Auto loan": Car,
  "Money transfer": ArrowLeftRight, "Student loan": GraduationCap, "Personal loan": HandCoins,
  "Debt collection": Gavel, "Prepaid card": Receipt,
};
export function ProductIcon({ c, size = 20 }) {
  const I = ICONS[productLabel(c)] || HelpCircle;
  return <I size={size} strokeWidth={2} />;
}

/* ---------- tiles ---------- */
function TimeReturned({ t }) {
  const tip = `${t.callers} × ${t.baselineHoldMin} min hold avoided${t.returningCallers ? ` + ${t.returningCallers} × ${t.reexplainMin} min re-explaining avoided` : ""} = ${t.totalMin} min`;
  return (
    <section className="tile tile-accent" aria-label="Time returned today" data-tip={tip} title={tip}>
      <p className="tile-label">Time returned</p>
      <p className="tile-num tnum">{t.totalMin.toLocaleString("en-US")}<span className="tile-unit">min</span></p>
      <p className="tile-cap tnum">{t.callers === 1 ? "to 1 caller today" : `to ${t.callers} callers today`}</p>
      <span className="tile-deco" aria-hidden="true"><i /><i /></span>
    </section>
  );
}
function WaitingNow({ queued, now }) {
  const rows = queued.map((e) => ({ id: e.id, tier: e.tier, ms: Math.max(0, now - e.createdAt * 1000), name: e.name }));
  const max = Math.max(60000, ...rows.map((r) => r.ms));
  const longest = rows.length ? Math.max(...rows.map((r) => r.ms)) : 0;
  return (
    <section className="tile" aria-label="Waiting now">
      <p className="tile-label">Waiting now</p>
      <div className="tile-row">
        <p className="tile-num tnum">{queued.length}</p>
        <div className="mini-bars" aria-hidden="true">
          {rows.slice(0, 10).map((r) => (
            <i key={r.id} className={`tier-${r.tier}`} style={{ height: `${Math.max(10, (r.ms / max) * 100)}%` }} title={`${r.name} · ${wc(r.ms)}`} />
          ))}
        </div>
      </div>
      <p className="tile-cap tnum">{rows.length ? `longest ${wc(longest)}` : "queue is clear"}</p>
    </section>
  );
}
function ByUrgency({ queued }) {
  const c = Object.fromEntries(TIERS.map((t) => [t, queued.filter((e) => e.tier === t).length]));
  const n = queued.length || 1;
  return (
    <section className="tile" aria-label="Waiting by urgency">
      <p className="tile-label">By urgency</p>
      <dl className="tier-stats">
        {TIERS.map((t) => (
          <div key={t} className={`tier-${t}${c[t] ? "" : " is-zero"}`}>
            <dt><i className="tier-dot" aria-hidden="true" />{TIER_LABEL[t]}</dt><dd className="tnum">{c[t]}</dd>
          </div>
        ))}
      </dl>
      <div className="seg-bar" aria-hidden="true">
        {TIERS.map((t) => c[t] ? <i key={t} className={`tier-${t}`} style={{ width: `${(c[t] / n) * 100}%` }} /> : null)}
      </div>
    </section>
  );
}
function NextCallback({ next, now, settings }) {
  if (!next) return (
    <section className="tile tile-tint" aria-label="Next callback">
      <p className="tile-label">Next callback</p><p className="tile-name">No one</p><p className="tile-cap">nothing to return</p>
    </section>
  );
  const waited = Math.max(0, (now - next.createdAt * 1000) / 60000);
  const hold = settings?.baselineHoldMin || 23;
  const frac = Math.min(1, waited / hold), L = 2 * Math.PI * 22;
  const inMin = Math.max(1, Math.ceil((settings?.avgHandleMin || 3) / Math.max(1, settings?.repsOnShift || 1)));
  const tip = `Waited ${Math.floor(waited)} of the ${hold} min a typical hold would take`;
  return (
    <section className="tile tile-tint" aria-label="Next callback" data-tip={tip} title={tip}>
      <p className="tile-label">Next callback</p>
      <div className="tile-row">
        <div className="tile-raise">
          <p className="tile-name">{firstName(next.name)}</p>
          <p className="tile-cap tnum">in ~{inMin} min</p>
        </div>
        <svg className={`ring${frac >= 0.8 ? " is-hot" : ""}`} viewBox="0 0 52 52" aria-hidden="true">
          <defs><linearGradient id="ring-grad" x1="0" y1="1" x2="1" y2="0"><stop offset="0" className="ring-grad-a" /><stop offset="1" className="ring-grad-b" /></linearGradient></defs>
          <circle cx="26" cy="26" r="22" className="ring-track" />
          <circle cx="26" cy="26" r="22" className="ring-fill" stroke="url(#ring-grad)" strokeDasharray={L} strokeDashoffset={L * (1 - frac)} />
        </svg>
      </div>
    </section>
  );
}

/* ---------- on the line now ---------- */
const STAGES = { listening: { label: "Listening", step: 1 }, scoring: { label: "Scoring", step: 2 }, queued: { label: "Added to queue", step: 3 } };
function LiveCalls({ call, now }) {
  if (!call) return null;
  const st = STAGES[call.stage] || STAGES.listening;
  return (
    <section className="live" aria-labelledby="live-h">
      <h2 id="live-h" className="live-head"><i className="call-dot" aria-hidden="true" />On the line now</h2>
      <div className={`live-card${call.tier ? ` tier-${call.tier}` : ""}`}>
        <span className="avatar avatar-md">{call.name ? initials(call.name) : "?"}</span>
        <span className="live-who"><b>{call.name || phoneFmt(call.phone)}</b><span className="muted small">{call.known ? "Returning" : "New caller"}</span></span>
        <span className="live-time">{wc((call.queuedAt || now) - call.startedAt)}</span>
        <span className="live-stage" aria-label={`Step ${st.step} of 3: ${st.label}`}>
          <span className="live-steps" aria-hidden="true">{[1, 2, 3].map((n) => <i key={n} className={n <= st.step ? "on" : undefined} />)}</span>{st.label}
        </span>
      </div>
    </section>
  );
}

/* ---------- queue row ---------- */
function ScoreBar({ s, scaleMax }) {
  const w = (v) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100))}%`;
  return (
    <div className="bar" aria-hidden="true"><div className="bar-fill">
      {s.urgency > 0 && <i className="seg-urgency" style={{ width: w(s.urgency) }} />}
      {s.value > 0 && <i className="seg-value" style={{ width: w(s.value) }} />}
      {s.aging > 0 && <i className="seg-aging" style={{ width: w(s.aging) }} />}
    </div></div>
  );
}
function Row({ item: e, now, flag, selected, onSelect, scaleMax }) {
  const onCall = e.status === "in_progress";
  const since = onCall ? (e.claimedAt || e.createdAt) : e.createdAt;
  const f = !onCall && flag && flag.until > Date.now() ? flag : null;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; }, []);
  return (
    <li data-id={e.id} className={`lrow-wrap tier-${e.tier}${selected ? " is-selected" : ""}${f?.kind === "new" ? " is-new" : ""}${onCall ? " is-call" : ""}`}>
      <button type="button" className="lrow" aria-pressed={selected} onClick={() => onSelect(e.id)}
        aria-label={`${onCall ? "On a call" : `Rank ${e.position}`}: ${e.name}, ${e.summary}${e.amount_usd != null ? `, ${money(e.amount_usd)}` : ""}`}>
        <span className="lrow-rank tnum" aria-hidden="true">
          {onCall ? <i className="call-dot" /> : <span key={e.position} className={mounted.current ? "rank-n roll" : "rank-n"}>{e.position}</span>}
        </span>
        <span className="intent-av" aria-hidden="true"><ProductIcon c={e.categories} size={21} /></span>
        <span className="lrow-main">
          <span className="lrow-name">
            <span className={e.name === "Unknown caller" ? "unknown-name" : undefined}>{e.name}</span>
            {f && <span className={`flag${f.kind === "up" ? " up" : ""}`}>{f.kind === "new" ? "New" : `Up from #${f.from}`}</span>}
          </span>
          <span className="lrow-sub">{e.summary}{e.amount_usd != null && <span className="tnum"> · {money(e.amount_usd)}</span>}</span>
        </span>
        <span className="lrow-end">
          {!onCall && <span className="score-mini"><ScoreBar s={e.score} scaleMax={scaleMax} /><b className="tnum">{e.score.total}</b></span>}
          <span className={`time-pill tnum${onCall ? " is-call" : ""}`}>{onCall ? "on call " : ""}{wc(now - since * 1000)}</span>
        </span>
      </button>
    </li>
  );
}

/* ---------- brief (detail) ---------- */
const LANGS = { en: "EN", es: "ES", zh: "中文", vi: "VI" };
function parseLines(text) {
  return String(text).split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([^:：]{1,40})[:：]\s*(.*)$/); return m ? [m[1], m[2]] : ["", l];
  });
}
function Brief({ item: e, now, scaleMax, busy, onCallBack, onDone, onRelease, onClose }) {
  const [more, setMore] = useState(false), [tx, setTx] = useState(false);
  const [lang, setLang] = useState("en"), [trs, setTrs] = useState({});
  useEffect(() => { setLang("en"); setMore(false); setTx(false); }, [e?.id]);
  if (!e) return <div className="detail is-empty"><p>Briefs appear here when someone calls.</p></div>;
  const onCall = e.status === "in_progress";
  const s = e.score;
  const trust = e.trust === "recognized" ? "Recognized" : "New caller";
  const lines = lang === "en" ? LABELS.map((k) => [k, e.brief?.[k] ?? "not stated"]) : trs[`${e.id}:${lang}`];
  async function pick(l) {
    setLang(l);
    if (l === "en" || trs[`${e.id}:${l}`]) return;
    try { const d = await api(`/api/translate/${e.id}/${l}`, {}); setTrs((t) => ({ ...t, [`${e.id}:${l}`]: parseLines(d.text) })); }
    catch (err) { setTrs((t) => ({ ...t, [`${e.id}:${l}`]: [["", `Translation failed (${err.message}). Try again.`]] })); setTimeout(() => setTrs(({ [`${e.id}:${l}`]: _, ...r }) => r), 50); }
  }
  const reasonLabel = `urgency ${s.urgency} (learned) + amount ${s.value} + waiting ${s.aging} = ${s.total} points`;
  return (
    <div className={`detail tier-${e.tier}`}>
      <button type="button" className="icon-btn detail-close" aria-label="Close" onClick={onClose}><X size={16} /></button>
      <div className="detail-top">
        <div className="detail-who">
          <span className="avatar avatar-lg">{initials(e.name)}</span>
          <div>
            <h3 className="detail-name">{e.name}</h3>
            <p className="detail-phone tnum">{phoneFmt(e.phone)} · {trust}{e.trust === "recognized" && e.calls > 1 ? ` · call ${e.calls}` : ""}</p>
          </div>
        </div>
        <span className="id-pill tnum">{onCall ? "On a call" : `#${e.position} · ${s.total} pts`}</span>
      </div>
      <div className="chips">
        <span className="chip chip-tier"><i className="tier-dot" aria-hidden="true" />{TIER_LABEL[e.tier]}</span>
        <span className="chip"><ProductIcon c={e.categories} size={14} />{productLabel(e.categories)}</span>
        {e.amount_usd != null && <span className="chip tnum">{money(e.amount_usd)}</span>}
        <span className="chip">{e.trust === "recognized" ? "Returning" : "First call"}</span>
        {e.synthetic && <span className="chip chip-quiet">Synthetic</span>}
      </div>
      <dl className="facts">
        <div><dt>Issue</dt><dd>{e.summary}</dd></div>
        <div><dt>{onCall ? "On call" : "Waiting"}</dt><dd className="tnum">{wc(now - (onCall ? (e.claimedAt || e.createdAt) : e.createdAt) * 1000)}{!onCall && <span className="muted">· callback in ~{e.eta_minutes} min</span>}</dd></div>
      </dl>
      <div className="detail-actions">
        {onCall ? (<>
          <p className="muted small" style={{ flexBasis: "100%", margin: "0 0 .2rem" }}>Reserved for you, so no other rep takes them. Click the number to call through your iPhone, then mark it done.</p>
          <a className="btn btn-lg" href={`tel:${e.phone.replace(/[^\d+]/g, "")}`} title="Call through your iPhone"><Phone size={16} /><span className="tnum">{phoneFmt(e.phone)}</span><span className="muted small">Call</span></a>
          <button type="button" className="btn btn-primary btn-lg" disabled={!!busy} onClick={() => onDone(e)}>{busy === "done" ? "Finishing…" : "Mark done"}</button>
          <button type="button" className="ghost-btn" disabled={!!busy} onClick={() => onRelease(e)} title="Put them back in the queue at their place">{busy === "release" ? "Cancelling…" : "Cancel callback"}</button>
        </>) : (
          <button type="button" className="btn btn-primary btn-lg" disabled={!!busy} onClick={() => onCallBack(e)}><PhoneCall size={16} />{busy === "call" ? "Reserving…" : "Start callback"}</button>
        )}
      </div>
      <div className="brief-box">
        <div className="brief-head">
          <span className="label">Six-line brief</span>
          <div className="seg-toggle" role="group" aria-label="Brief language">
            {Object.entries(LANGS).map(([k, v]) => <button key={k} type="button" aria-pressed={lang === k} onClick={() => pick(k)}>{v}</button>)}
          </div>
        </div>
        <dl className="facts">
          {lines ? lines.map(([k, v], i) => {
            const ns = isNS(lang === "en" ? v : e.brief?.[LABELS[i]]);
            return <div key={i}><dt>{k}</dt><dd className={ns ? "ns" : ""}><span className="ck" aria-hidden="true">{ns ? "" : "✓"}</span><span>{v}</span></dd></div>;
          }) : <div><dt /><dd className="ns"><span className="scoring-dots"><i /><i /><i /></span>Translating…</dd></div>}
        </dl>
      </div>
      <button type="button" className="link-btn" aria-expanded={more} onClick={() => setMore((m) => !m)}>{more ? "View less" : "Why it ranks here"}</button>
      {more && (
        <div className="facts">
          <div><dt>Priority</dt><dd className="fact-score"><div className="bar" role="img" aria-label={reasonLabel}><div className="bar-fill">
            {s.urgency > 0 && <i className="seg-urgency" style={{ width: `${(s.urgency / scaleMax) * 100}%` }} />}
            {s.value > 0 && <i className="seg-value" style={{ width: `${(s.value / scaleMax) * 100}%` }} />}
            {s.aging > 0 && <i className="seg-aging" style={{ width: `${(s.aging / scaleMax) * 100}%` }} />}
          </div></div><span className="tnum mono">{s.total}</span></dd></div>
          <div><dt>Breakdown</dt><dd className="muted small">urgency <b>{s.urgency}</b> learned · amount <b>+{s.value}</b> rule · waiting <b>+{s.aging}</b> rule</dd></div>
          <div><dt>Model</dt><dd style={{ display: "block" }}>
            <div className="why">
              {(e.reasons || []).map((r, i) => {
                const [lab, ...rest] = r.label.split(": ");
                const pct = Math.min(50, (Math.abs(r.weight) / 1.6) * 50);
                return (
                  <div key={i} className="why-row">
                    <span><b>{lab}:</b> {shortIssue(rest.join(": "))}</span>
                    <span className="wbar"><i className={r.weight >= 0 ? "pos" : "neg"} style={{ width: `${pct}%` }} /></span>
                    <span className="wv">{r.weight >= 0 ? "+" : "−"}{Math.abs(r.weight).toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          </dd></div>
        </div>
      )}
      {e.transcript?.length > 0 && (
        <div>
          <button type="button" className="link-btn" aria-expanded={tx} onClick={() => setTx((t) => !t)}>{tx ? "Hide transcript" : `Show transcript · ${e.transcript.length} lines`}</button>
          {tx && <div className="transcript">{e.transcript.map((t, i) => <p key={i}><b>{t.speaker === "agent" ? "Cue" : "Caller"}</b>{t.text}</p>)}</div>}
        </div>
      )}
    </div>
  );
}

/* ---------- today ---------- */
export function Today({ items, settings, onReopen }) {
  const [tier, setTier] = useState("all");
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const ev = [];
  for (const t of items) {
    const fn = firstName(t.name);
    ev.push({ key: t.id + ":in", id: t.id, at: t.createdAt * 1000, kind: "in", title: `${t.name} called`, sub: `${t.summary} · ${t.trust === "new" ? "new caller" : "known caller"}`, tier: t.tier });
    if (t.claimedAt) ev.push({ key: t.id + ":call", id: t.id, at: t.claimedAt * 1000, kind: "call", title: `Called back ${fn}`, sub: `after ${wc((t.claimedAt - t.createdAt) * 1000)}`, tier: t.tier });
    if (t.doneAt && t.status === "done") {
      const saved = (settings?.baselineHoldMin || 23) + (t.trust === "recognized" ? settings?.reexplainMin || 3 : 0);
      ev.push({ key: t.id + ":done", id: t.id, name: t.name, at: t.doneAt * 1000, kind: "done", title: `${fn} handled`, sub: `+${saved} min returned`, tier: t.tier });
    }
  }
  const list = ev.filter((e) => e.at >= day0.getTime()).filter((e) => tier === "all" || e.tier === tier).sort((a, b) => b.at - a.at).slice(0, 12);
  return (
    <section className="card" aria-labelledby="tl-h">
      <h2 id="tl-h" className="card-title">Today</h2>
      <div className="tl-filters" role="group" aria-label="Filter today by urgency">
        {["all", ...TIERS].map((t) => <button key={t} type="button" className={`tl-filter${tier === t ? " is-on" : ""}`} aria-pressed={tier === t} onClick={() => setTier(t)}>{t === "all" ? "All" : TIER_LABEL[t]}</button>)}
      </div>
      {list.length === 0 ? <p className="muted small">{tier === "all" ? "No calls yet today." : `No ${tier} events today.`}</p> : (
        <ol className="tl">
          {list.map((e) => (
            <li key={e.key} className={`tl-item tl-${e.kind} tier-${e.tier}`}>
              <span className="tl-time tnum">{clock(e.at)}</span><i className="tl-dot" aria-hidden="true" />
              <span className="tl-text"><b>{e.title}</b><span>{e.sub}</span></span>
              {e.kind === "done" ? <button type="button" className="tl-action" onClick={() => onReopen(e.id, e.name)}>Reopen</button> : <span />}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ---------- how ranking works ---------- */
function RankingInfo({ settings }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const off = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  const reps = settings?.repsOnShift || 1, h = settings?.avgHandleMin || 3;
  return (
    <div className="pop-wrap" ref={ref}>
      <button type="button" className="icon-btn" aria-label="How ranking works" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Info size={16} /></button>
      {open && (
        <div className="popover" role="dialog" aria-label="How ranking works">
          <p className="muted">Score = urgency + value + waiting. Highest score is called back first.</p>
          <h3>Urgency · learned</h3>
          <p>0–100: where this caller's three answers rank among <b>60,000 real CFPB complaints</b>, by how often the company had to act. Not an AI guess.</p>
          <dl>
            {[["critical", "90+"], ["high", "70–89"], ["normal", "30–69"], ["low", "0–29"]].map(([t, r]) => (
              <div key={t} className={`rule-line tier-${t}`}><dt><i className="tier-dot" />{TIER_LABEL[t]} <span className="pts">{r}</span></dt><dd>{t === "critical" ? "top tenth of real outcomes" : t === "low" ? "rarely needed action" : t === "high" ? "often needed action" : "around the 20% base rate"}</dd></div>
            ))}
          </dl>
          <h3>Value · rule</h3><p>+5 points at $1,000 or more, +10 at $10,000 or more.</p>
          <h3>Waiting · rule</h3><p>+1 point per minute waited, up to 30, so no one waits forever.</p>
          <h3>Callback estimate</h3><p>{reps} {reps === 1 ? "rep" : "reps"} on shift at about {h} min a call, so rank #n is called back in roughly n × {h} ÷ {reps} min.</p>
        </div>
      )}
    </div>
  );
}

/* ---------- page ---------- */
export default function QueuePage({ board, now, org, liveCall, holdId, prefs, onStartCall, toast, refresh }) {
  const [show, setShow] = useState("all");
  const [selId, setSelId] = useState(null), [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(null);
  const listRef = useRef(null);

  const queued = useMemo(() => {
    let q = board?.queued || [];
    if (holdId && q.some((x) => x.id === holdId)) q = [...q.filter((x) => x.id !== holdId), q.find((x) => x.id === holdId)];
    return q;
  }, [board, holdId]);
  const inProgress = board?.inProgress || [];
  const flags = useRankFlags(board ? (board.queued || []).map((x) => x.id) : null);
  const visible = show === "waiting" ? queued : show === "call" ? inProgress : [...inProgress, ...queued];
  useFlip(listRef, visible.map((x) => x.id).join(","), holdId ? null : Object.keys(flags).find((k) => flags[k].kind === "new" && flags[k].until > Date.now()));
  const all = [...inProgress, ...queued];
  const sel = (pinned && all.find((x) => x.id === selId)) || all.find((x) => x.id === selId) || queued[0] || inProgress[0] || null;
  const scaleMax = Math.max(130, ...all.map((x) => x.score.total + 10));

  useEffect(() => { if (holdId) { setSelId(holdId); setPinned(true); } }, [holdId]);

  async function act(e, kind, fn, okText, action) {
    setBusy(kind);
    try { await fn(); await refresh(); if (okText) toast({ text: okText, action }); }
    catch (err) { toast({ text: `${err.message}`, tone: "error" }); await refresh(); }
    finally { setBusy(null); }
  }
  const reopen = (id, name) => { const nm = name || (board?.done || []).find((x) => x.id === id)?.name; return act(null, "release", () => api(`/api/queue/${id}/reopen`, {}), `${firstName(nm)} is back in the queue.`); };
  const callBack = (e) => act(e, "call", () => api(`/api/queue/${e.id}/callback`, { rep: "You" }).then(() => { setSelId(e.id); setPinned(true); }));
  const done = (e) => act(e, "done", () => api(`/api/queue/${e.id}/done`, {}), `${firstName(e.name)} marked done.`, { label: "Reopen", run: () => reopen(e.id) });
  const release = (e) => act(e, "release", () => api(`/api/queue/${e.id}/release`, {}), `Callback cancelled. ${firstName(e.name)} keeps their place in the queue.`);
  async function takeNext() {
    setBusy("next");
    try { const x = await api("/api/queue/next", { rep: "You" }); setSelId(x.id); setPinned(true); await refresh(); }
    catch (err) { toast({ text: err.status === 404 ? "No one is waiting." : err.message, tone: err.status === 404 ? undefined : "error" }); }
    finally { setBusy(null); }
  }

  // keyboard: ↑ ↓ to move, Enter to call back (same shortcuts as Rung, our friends' project)
  useEffect(() => {
    const h = (ev) => {
      const t = ev.target;
      if (t.closest?.("input, textarea, select, [contenteditable], .drawer, .assist") || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        if (!visible.length) return; ev.preventDefault();
        const i = Math.max(0, visible.findIndex((x) => x.id === sel?.id));
        const n = visible[Math.min(visible.length - 1, Math.max(0, i + (ev.key === "ArrowDown" ? 1 : -1)))];
        setSelId(n.id); setPinned(true);
        document.querySelector(`[data-id="${CSS.escape(n.id)}"]`)?.scrollIntoView({ block: "nearest" });
      } else if (ev.key === "Enter" && !t.closest?.("button, a") && sel?.status === "waiting" && !busy) { ev.preventDefault(); callBack(sel); }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  });

  const longest = queued.length ? Math.floor(Math.max(...queued.map((x) => now - x.createdAt * 1000)) / 60000) : 0;
  const doneToday = (board?.done || []).filter((x) => (x.doneAt || 0) * 1000 >= new Date().setHours(0, 0, 0, 0));
  const top = queued[0];
  const summary = [
    top ? `${firstName(top.name)} is first in line${top.amount_usd != null ? ` with ${money(top.amount_usd)} at stake` : ""}, ranked ${TIER_LABEL[top.tier].toLowerCase()} by the model.` : "Nobody is waiting right now.",
    inProgress.length ? `${inProgress.length} ${inProgress.length === 1 ? "callback is" : "callbacks are"} in progress.` : "",
    doneToday.length ? `${doneToday.length} handled today, ${board?.timeSaved?.totalMin ?? 0} minutes of hold time returned.` : "No callbacks finished yet today.",
  ].filter(Boolean).join(" ");
  const sentence = !board ? " " : queued.length === 0
    ? (inProgress.length ? `No one waiting. ${inProgress.length} on a call.` : "No one waiting. Your queue is clear.")
    : `${queued.length} ${queued.length === 1 ? "caller" : "callers"} waiting. Longest wait ${longest < 1 ? "under a minute" : `${longest} min`}.${liveCall && liveCall.stage !== "queued" ? " 1 on the line with the agent." : ""}`;

  return (
    <>
      <header className="page-head">
        <div className="hello">
          <h1>{greeting()}, <span className="hello-org">{org}</span></h1>
          <p className="sentence">{sentence}</p>
          {board && <p className="hello-summary">{summary}</p>}
        </div>
        <div className="head-right">
          <span className="status-pill">
            <span className="seg"><Sparkles size={14} />Learned ranking</span>
            <span className="ready"><i className={`ready-dot${board ? "" : " off"}`} />{board ? "Ready for callback" : "Offline"}</span>
          </span>
          {board?.settings?.phoneNumber && <a className="btn btn-ink" href={`tel:${board.settings.phoneNumber}`}><Phone size={15} />Call Cue · {phoneFmt(board.settings.phoneNumber)}</a>}
        </div>
      </header>

      <div className="tiles">
        {board ? (<>
          <TimeReturned t={board.timeSaved} />
          <WaitingNow queued={board.queued} now={now} />
          <ByUrgency queued={board.queued} />
          <NextCallback next={board.queued[0]} now={now} settings={board.settings} />
        </>) : [0, 1, 2, 3].map((i) => <div key={i} className={`tile${i === 0 ? " tile-accent" : ""}`} />)}
      </div>

      <LiveCalls call={liveCall} now={now} />

      <div className="md">
        <section aria-labelledby="list-h">
          <div className="section-head">
            <h2 id="list-h">Callback queue</h2>
            <div className="section-tools">
              <button type="button" className="btn btn-primary btn-sm" disabled={busy === "next" || !queued.length} onClick={takeNext}>{busy === "next" ? "Taking…" : "Take next"}</button>
              <label className="pill-select">
                <span className="sr">Show</span>
                <select value={show} onChange={(e) => setShow(e.target.value)}>
                  <option value="all">All · {all.length}</option>
                  <option value="waiting">Waiting · {queued.length}</option>
                  <option value="call">On a call · {inProgress.length}</option>
                </select>
                <ChevronDown size={14} />
              </label>
              <RankingInfo settings={board?.settings} />
            </div>
          </div>
          {visible.length === 0 ? (
            <div className="list-empty">
              <span className="mark"><Inbox size={22} /></span>
              <b>{show === "call" ? "No one on a call." : "No one waiting."}</b>
              <span className="muted small">{board ? "Your queue is clear." : "Can't reach the server. Retrying."}</span>
            </div>
          ) : (
            <ul className="list" ref={listRef}>
              {visible.map((x) => <Row key={x.id} item={x} now={now} flag={flags[x.id]} selected={sel?.id === x.id} scaleMax={scaleMax} onSelect={(id) => { setSelId(id); setPinned(true); }} />)}
            </ul>
          )}
        </section>
        <section aria-labelledby="brief-h">
          <div className="section-head"><h2 id="brief-h">Caller brief</h2>{sel && <span className="muted small">↑ ↓ to move · Enter to start a callback</span>}</div>
          <Brief item={sel} now={now} scaleMax={scaleMax} busy={busy} onCallBack={callBack} onDone={done} onRelease={release} onClose={() => { setPinned(false); setSelId(null); }} />
        </section>
      </div>

      {prefs.showToday && <Today items={[...all, ...(board?.done || [])]} settings={board?.settings} onReopen={reopen} />}
    </>
  );
}
