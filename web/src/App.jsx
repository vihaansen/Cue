import { useCallback, useEffect, useRef, useState } from "react";
import { Home as HomeIcon, ListOrdered, Users, BarChart3, SlidersHorizontal, ChevronLeft, X, ArrowUp, RotateCcw } from "lucide-react";
import { api, usePoll, useNow, loadPrefs, savePrefs, applyAccent, initials } from "./lib";
import QueuePage from "./Queue";
import HomePage from "./Home";
import { CallersPage, InsightsPage, SetupPage } from "./Pages";

export function Mark({ size = 18, ring = "#f4f1ea" }) {
  // Cue: a Q whose tail is an arrow jumping forward
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="18" r="12.5" stroke={ring} strokeWidth="4.5" />
      <path d="M24 30 L33 21" stroke="#ff5b35" strokeWidth="4.5" />
      <path d="M27 20 L33 21 L32 27" stroke="#ff5b35" strokeWidth="4.5" />
    </svg>
  );
}

/* Toasts: 3.5 s, 6 s with an action, 7 s for errors */
function useToast() {
  const [t, setT] = useState(null), tm = useRef();
  const show = useCallback((x) => { clearTimeout(tm.current); setT({ ...x, id: Date.now() }); tm.current = setTimeout(() => setT(null), x.tone === "error" ? 7000 : x.action ? 6000 : 3500); }, []);
  return { toast: t, show, hide: () => setT(null) };
}

/* Ask Cue: the floating assistant */
const SUGGEST = [
  ["Who should I call first, and why?", "Reads the ranking"],
  ["Summarize the queue in one line", "For a quick handover"],
  ["Anyone with more than $1,000 at stake?", "Checks the briefs"],
];
function Assistant({ onClose, org }) {
  const [msgs, setMsgs] = useState([]), [q, setQ] = useState(""), [busy, setBusy] = useState(false);
  const body = useRef(null);
  useEffect(() => { body.current && (body.current.scrollTop = body.current.scrollHeight); }, [msgs, busy]);
  async function ask(text) {
    if (!text.trim() || busy) return;
    const history = msgs; setMsgs((m) => [...m, { role: "user", text }]); setQ(""); setBusy(true);
    try { const d = await api("/api/assistant", { question: text, history }); setMsgs((m) => [...m, { role: "assistant", text: d.answer }]); }
    catch (e) { setMsgs((m) => [...m, { role: "assistant", text: `I couldn't reach the model (${e.message}). The queue itself still works.` }]); }
    finally { setBusy(false); }
  }
  return (
    <div className="assist" role="dialog" aria-label="Ask Cue">
      <div className="assist-head">
        <b><span className="logo-mark" style={{ background: "var(--ink)" }}><Mark size={15} /></span>Ask Cue</b>
        <div style={{ display: "flex", gap: ".3rem" }}>
          {msgs.length > 0 && <button type="button" className="icon-btn" aria-label="New chat" onClick={() => setMsgs([])}><RotateCcw size={15} /></button>}
          <button type="button" className="icon-btn" aria-label="Close Ask Cue" onClick={onClose}><X size={16} /></button>
        </div>
      </div>
      <div className="assist-body" ref={body}>
        {msgs.length === 0 ? (<>
          <div className="assist-hello"><span className="avatar avatar-lg" style={{ background: "var(--ink)" }}><Mark size={26} /></span><h3>What do you need?</h3><p className="muted small">I read {org}'s live queue. I never change it.</p></div>
          <div className="suggest">{SUGGEST.map(([t, d]) => <button key={t} type="button" onClick={() => ask(t)}><b>{t}</b><span>{d}</span></button>)}</div>
        </>) : msgs.map((m, i) => <div key={i} className={m.role === "user" ? "msg-user" : "msg-bot"}>{m.text}</div>)}
        {busy && <div className="msg-bot"><span className="scoring-dots"><i /><i /><i /></span></div>}
      </div>
      <div className="assist-foot">
        <form onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <label className="sr" htmlFor="ask">Ask about callers</label>
          <input id="ask" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about callers or the ranking" autoFocus />
          <button type="submit" className="icon-btn" aria-label="Send" disabled={!q.trim() || busy} style={{ background: "var(--accent)", color: "#fff" }}><ArrowUp size={16} /></button>
        </form>
        <p className="assist-note">Answers come from the live queue through Adaption. Check before you act.</p>
      </div>
    </div>
  );
}

const ROUTES = [
  ["home", "Home", HomeIcon],
  ["queue", "Queue", ListOrdered], ["callers", "Callers", Users], ["insights", "Insights", BarChart3], ["setup", "Setup", SlidersHorizontal],
];

export default function App() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || "home");
  const [collapsed, setCollapsed] = useState(false);
  const [prefs, setPrefsState] = useState(loadPrefs);
  const [assist, setAssist] = useState(false);
  const [holdId] = useState(null);
  const board = usePoll("/api/board", 1500);
  const now = useNow(1000);
  const { toast, show, hide } = useToast();
  const org = board.data?.settings?.company || "Bank of Bridgegood";

  useEffect(() => { const h = () => setRoute(location.hash.slice(1) || "home"); addEventListener("hashchange", h); return () => removeEventListener("hashchange", h); }, []);
  useEffect(() => { applyAccent(prefs.accent); }, [prefs.accent, route]);
  useEffect(() => { document.title = route === "queue" ? `Cue · ${board.data ? `${board.data.queued.length} waiting` : "Queue"}` : `Cue · ${route[0].toUpperCase()}${route.slice(1)}`; }, [route, board.data?.queued.length]);
  const setPrefs = (p) => { setPrefsState(p); savePrefs(p); };
  const go = (r) => { location.hash = r; setRoute(r); };
  const visibleRoutes = ROUTES.filter(([id]) => id !== "insights" || prefs.showInsights);


  async function resetDemo() {
    try { await api("/api/reset", {}); await board.refresh(); show({ text: "Demo reset: the four seed callers are back, and Maria is the only saved caller." }); }
    catch (e) { show({ text: e.message, tone: "error" }); }
  }

  const lv = board.data?.live?.[0];
  const liveCall = lv ? { ...lv, stage: lv.stage || "listening" } : null;
  const page = route === "home" ? <HomePage board={board.data} now={now} org={org} prefs={prefs} toast={show} refresh={board.refresh} go={go} />
    : route === "callers" ? <CallersPage board={board.data} toast={show} refresh={board.refresh} />
    : route === "insights" && prefs.showInsights ? <InsightsPage board={board.data} refresh={board.refresh} />
    : route === "setup" ? <SetupPage board={board.data} prefs={prefs} setPrefs={setPrefs} toast={show} refresh={board.refresh} />
    : <QueuePage board={board.data} now={now} org={org} liveCall={liveCall} holdId={holdId} prefs={prefs} toast={show} refresh={board.refresh} />;

  return (
    <div className={`app${collapsed ? " is-collapsed" : ""}`}>
      <a href="#main" className="sr" onFocus={(e) => e.currentTarget.classList.remove("sr")} onBlur={(e) => e.currentTarget.classList.add("sr")}>Skip to content</a>
      <nav className="sidebar" aria-label="Main">
        <div className="sb-top">
          <a className="logo" href="#home" onClick={() => go("home")}><span className="logo-mark"><Mark /></span><span className="logo-word">cue</span></a>
          <button type="button" className="sb-collapse" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed((c) => !c)}><ChevronLeft size={15} /></button>
        </div>
        <div className="sb-nav">
          {visibleRoutes.map(([id, label, Icon]) => (
            <button key={id} type="button" className={`sb-link${route === id || (id === "queue" && !ROUTES.some(([r]) => r === route)) ? " is-on" : ""}`} aria-current={route === id ? "page" : undefined} onClick={() => go(id)} title={label}>
              <Icon size={18} /><span>{label}</span>{id === "queue" && board.data && board.data.queued.length > 0 && <span className="count">{board.data.queued.length}</span>}
            </button>
          ))}
        </div>
        <div className="sb-foot">
          <button type="button" className="sb-link" onClick={resetDemo} title="Reset demo queue"><RotateCcw size={17} /><span>Reset demo</span></button>
          <div className="sb-org"><span className="av">{initials(org)}</span><span>{org}</span></div>
          <p className="sb-note">Callers are synthetic · recognized, not verified · urgency = learned stand-in (relief granted)</p>
        </div>
      </nav>
      <main className="main" id="main">{page}</main>

      {prefs.showAssistant && (assist ? <Assistant org={org} onClose={() => setAssist(false)} /> : (
        <button type="button" className="fab" onClick={() => setAssist(true)}><span className="logo-mark" style={{ background: "#ffffff14" }}><Mark size={15} /></span>Ask Cue</button>
      ))}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div key={toast.id} className={`toast${toast.tone === "error" ? " is-error" : ""}`}>
            <span>{toast.text}</span>
            {toast.action && <button type="button" className="toast-action" onClick={() => { toast.action.run(); hide(); }}>{toast.action.label}</button>}
            <button type="button" className="toast-x" aria-label="Dismiss" onClick={hide}>×</button>
          </div>
        )}
      </div>
    </div>
  );
}
