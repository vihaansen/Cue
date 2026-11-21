import { useEffect, useRef, useState } from "react";
import { X, Phone, PhoneOff, Mic, MicOff, Send } from "lucide-react";
import { api, firstName, clock } from "./lib";

const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
const CALLERS = [
  { phone: "+15105550101", label: "Maria Reyes (returning)" },
  { phone: "+15105550199", label: "New caller (+1 510 555 0199)" },
];

function cleanName(s) {
  const n = s.replace(/[.!,]+$/, "").replace(/^(hi|hello|hey)[, ]+/i, "")
    .replace(/^(this is|my name is|it's|it is|i'm|i am|name's)\s+/i, "").trim();
  return n.split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || "Caller";
}

export default function CallDrawer({ open, onClose, company, prefs, onLive, onQueued }) {
  const [phone, setPhone] = useState(CALLERS[0].phone);
  const [lines, setLines] = useState([]);          // {kind:'agent'|'caller'|'interim'|'scoring'|'error', text}
  const [status, setStatus] = useState("Pick a caller and press Call.");
  const [inCall, setInCall] = useState(false), [listening, setListening] = useState(false);
  const [typing, setTyping] = useState(false), [typed, setTyped] = useState("");
  const [voiceOn, setVoiceOn] = useState(!!SR && "speechSynthesis" in window);
  const [sms, setSms] = useState(null), [retry, setRetry] = useState(null);
  const waiting = useRef(null), rec = useRef(null), voiceRef = useRef(voiceOn), alive = useRef(false);
  const convoRef = useRef(null), inputRef = useRef(null), transcript = useRef([]);
  voiceRef.current = voiceOn;

  useEffect(() => { convoRef.current && (convoRef.current.scrollTop = convoRef.current.scrollHeight); }, [lines, sms]);
  useEffect(() => { if (typing) inputRef.current?.focus(); }, [typing]);
  useEffect(() => { const k = (e) => e.key === "Escape" && open && !inCall && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [open, inCall, onClose]);

  const add = (kind, text) => { setLines((l) => [...l.filter((x) => x.kind !== "interim"), { kind, text }]); if (kind === "agent" || kind === "caller") transcript.current.push({ speaker: kind, text }); };

  function speak(text) {               // resolves when finished (timeout guards Chrome's dropped onend)
    if (!voiceRef.current) return Promise.resolve();
    return new Promise((res) => {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = prefs.rate || 1.05; u.lang = "en-US";
      const v = speechSynthesis.getVoices().find((x) => x.voiceURI === prefs.voiceURI); if (v) u.voice = v;
      const t = setTimeout(res, 1500 + text.split(/\s+/).length * 430);
      u.onend = u.onerror = () => { clearTimeout(t); res(); };
      speechSynthesis.speak(u);
    });
  }
  function listen() {                  // one answer; "" if nothing heard
    let r;
    const p = new Promise((resolve) => {
      r = new SR(); r.lang = "en-US"; r.interimResults = true; r.continuous = false;
      let final = "";
      r.onresult = (e) => {
        final = ""; let all = "";
        for (const x of e.results) { all += x[0].transcript; if (x.isFinal) final += x[0].transcript; }
        setLines((l) => [...l.filter((x) => x.kind !== "interim"), { kind: "interim", text: all }]);
      };
      r.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { setVoiceOn(false); setStatus("Mic blocked. Type the answers instead."); } };
      r.onend = () => { setListening(false); setLines((l) => l.filter((x) => x.kind !== "interim")); resolve(final.trim()); };
      try { r.start(); setListening(true); } catch { resolve(""); }
    });
    rec.current = { p, stop: () => { try { r.abort(); } catch { /* already stopped */ } } };
    return rec.current;
  }

  async function ask(text) {           // Cue asks; caller answers by voice or the text box
    add("agent", text);
    const typedP = new Promise((res) => { waiting.current = res; });
    setTyping(true);
    let answer = "";
    if (voiceRef.current && SR) {
      for (let attempt = 0; attempt < 2 && voiceRef.current && !answer; attempt++) {
        if (attempt === 1) { const again = "Sorry, I didn't catch that. " + text; add("agent", again); await speak(again); }
        else await speak(text);        // never listen while speaking
        if (!waiting.current || !alive.current) break;
        setStatus("Listening… or type the answer below.");
        const L = listen();
        const got = await Promise.race([L.p.then((v) => ({ v })), typedP.then((t) => ({ t }))]);
        if ("t" in got) { L.stop(); answer = got.t; break; }
        answer = got.v;
      }
    }
    if (!answer && alive.current) { setStatus(voiceRef.current ? "Didn't catch that. Type the answer below." : "Type the caller's answer below."); answer = await typedP; }
    waiting.current = null; setTyping(false);
    if (!alive.current) throw new Error("hung up");
    add("caller", answer);
    return answer;
  }
  async function say(text) { add("agent", text); await speak(text); }

  async function triage(payload, live) {
    setLines((l) => [...l, { kind: "scoring", text: "Scoring with 60,000 real outcomes…" }]);
    setStatus("Sorting the answers into CFPB categories and writing the brief…");
    onLive({ ...live, stage: "scoring" });
    try {
      const d = await api("/api/triage_call", { ...payload, transcript: transcript.current });
      setLines((l) => l.filter((x) => x.kind !== "scoring"));
      const it = d.item;
      onLive({ ...live, stage: "queued", queuedAt: Date.now(), tier: it.tier, name: it.name });
      onQueued(it);
      const at = clock(Date.now() + d.eta_minutes * 60000);
      setSms(`Hi ${firstName(live.name)}, we have your request. A specialist will call you back in about ${d.eta_minutes} minutes, around ${at}. You are #${d.position} in line.`);
      setStatus(`Queued at #${d.position} · ${it.tier} · ${it.score.total} pts`);
      await say(`Thanks, ${firstName(live.name)}. So: ${it.brief.Headline}. A specialist will call you back in about ${d.eta_minutes} minutes. You're number ${d.position} in line.`);
    } catch (e) {
      setLines((l) => [...l.filter((x) => x.kind !== "scoring"), { kind: "error", text: `Scoring failed (${String(e.message).slice(0, 90)}). The answers are kept.` }]);
      setStatus("Scoring failed.");
      await new Promise((res) => setRetry(() => res));
      setRetry(null); setLines((l) => l.filter((x) => x.kind !== "error"));
      return triage(payload, live);
    }
  }

  async function start() {
    if (inCall) return;
    alive.current = true; setInCall(true); setSms(null); setLines([]); transcript.current = [];
    const live = { key: Date.now(), phone, startedAt: Date.now(), stage: "listening", known: false, name: null };
    try {
      setStatus("Looking up caller ID…");
      const who = await api("/api/lookup_caller", { phone });
      live.known = who.trust === "recognized"; live.name = who.name || null;
      onLive({ ...live });
      if (live.known) await ask(who.greeting);
      else { live.name = cleanName(await ask(`Thanks for calling ${company}. This is Cue, an AI assistant. Who am I speaking with?`)); onLive({ ...live }); }
      const answers = {};
      answers.account = await ask("What kind of account is this about: checking, savings, credit card, a loan, a mortgage, or something else?");
      answers.wrong = await ask("What went wrong?");
      answers.specific = await ask("What specifically happened? Any amount or date helps.");
      await say("One moment while I get this to the right person.");
      await triage({ phone, caller_name: live.known ? null : live.name, answers }, live);
    } catch (e) {
      if (e.message !== "hung up") setLines((l) => [...l, { kind: "error", text: e.message }]);
    }
    end(false);
  }
  function end(hangup = true) {
    alive.current = false; rec.current?.stop(); if ("speechSynthesis" in window) speechSynthesis.cancel();
    if (waiting.current) { const w = waiting.current; waiting.current = null; w(""); }
    setTyping(false); setListening(false); setInCall(false);
    if (hangup) { setStatus("Call ended."); onLive(null); }
    else setTimeout(() => onLive(null), 6000);
  }
  function submitTyped(e) {
    e.preventDefault();
    const v = typed.trim(); if (!v || !waiting.current) return;
    setTyped(""); const w = waiting.current; waiting.current = null; w(v);
  }

  return (
    <div className={`drawer-root${open ? " is-open" : ""}`} inert={open ? undefined : ""}>
      <div className="drawer-backdrop" onClick={() => !inCall && onClose()} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Test call">
        <div className="drawer-head">
          <h2>{inCall ? <i className="call-dot" aria-hidden="true" /> : <Phone size={18} />}Test call</h2>
          <div style={{ display: "flex", gap: ".4rem", alignItems: "center" }}>
            <button type="button" className="toggle" aria-pressed={voiceOn} disabled={!SR} title={SR ? "Speak and listen (Chrome)" : "Speech recognition needs Chrome"}
              onClick={() => { const v = !voiceOn; setVoiceOn(v); if (!v) { rec.current?.stop(); speechSynthesis.cancel(); } }}>
              {voiceOn ? <Mic size={14} /> : <MicOff size={14} />}{voiceOn ? "Voice on" : "Voice off"}
            </button>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
          </div>
        </div>
        <div className="drawer-body">
          <div className="caller-row">
            <label className="sr" htmlFor="callerid">Caller ID</label>
            <select id="callerid" value={phone} disabled={inCall} onChange={(e) => setPhone(e.target.value)}>
              {CALLERS.map((c) => <option key={c.phone} value={c.phone}>{c.label}</option>)}
            </select>
            {inCall
              ? <button type="button" className="btn btn-danger" onClick={() => end(true)}><PhoneOff size={15} />Hang up</button>
              : <button type="button" className="btn btn-primary" onClick={start}><Phone size={15} />Call</button>}
          </div>
          <div className="call-status"><span>{status}</span>{listening && <span className="live-pill">Live</span>}</div>
          <div className="convo" ref={convoRef} aria-live="polite">
            {lines.length === 0 && !sms && (
              <div className="convo-empty"><span className="avatar avatar-md"><Phone size={18} /></span>Cue greets the caller, asks the three questions the data picked, then scores the call.</div>
            )}
            {lines.map((l, i) => l.kind === "scoring"
              ? <div key={i} className="scoring"><span className="scoring-dots"><i /><i /><i /></span>{l.text}</div>
              : l.kind === "error"
                ? <div key={i} className="err"><span>{l.text}</span>{retry && <button type="button" className="btn btn-sm" onClick={() => retry()}>Retry</button>}</div>
                : <div key={i} className={`bubble ${l.kind === "interim" ? "caller interim" : l.kind}`}>{l.kind !== "interim" && <span className="who">{l.kind === "agent" ? "Cue" : "Caller"}</span>}{l.text}</div>)}
            {sms && <div className="sms"><div className="from">{company} · now</div><div className="msg">{sms}</div></div>}
          </div>
          <form className="typebox" onSubmit={submitTyped} autoComplete="off">
            <label className="sr" htmlFor="typed">Type the caller's answer</label>
            <input id="typed" ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} disabled={!typing} placeholder={typing ? "Type the caller's answer…" : "The text box opens when Cue asks"} />
            <button type="submit" className="btn btn-primary" disabled={!typing || !typed.trim()} aria-label="Send answer"><Send size={15} /></button>
          </form>
        </div>
      </aside>
    </div>
  );
}
