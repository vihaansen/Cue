import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export async function api(path, body, method) {
  const opts = body === undefined && !method ? {} : {
    method: method || "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  const r = await fetch(path, opts);
  if (!r.ok) {
    let msg = `${r.status}`;
    try { const j = await r.json(); msg = j.detail || msg; } catch { /* not json */ }
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return r.json();
}

export const TIERS = ["critical", "high", "normal", "low"];
export const TIER_LABEL = { critical: "Critical", high: "High", normal: "Normal", low: "Low" };
export const LABELS = ["Headline", "Amount", "When", "Tried", "Wants", "Best time"];
export const isNS = (v) => !v || /^not stated\.?$/i.test(String(v).trim());
export const firstName = (n) => (n || "").trim().split(/\s+/)[0] || "The caller";
export const initials = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
export const money = (n) => n == null ? "" : `$${Math.round(n).toLocaleString("en-US")}`;
export const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
export function phoneFmt(p) {
  const d = String(p || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}
export function wc(ms) {            // waiting clock: 45s · 4:12 · 1h 3m
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
export function productLabel(c = {}) {
  const p = `${c.product || ""} ${c.sub_product || ""}`.toLowerCase();
  if (!c.product) return "Unclassified";
  if (p.includes("credit card")) return "Credit card";
  if (p.includes("savings account") && !p.includes("checking account")) return "Savings";
  if (p.includes("savings")) return (c.sub_product || "").toLowerCase().includes("savings") ? "Savings" : "Checking";
  if (p.includes("mortgage")) return "Mortgage";
  if (p.includes("vehicle")) return "Auto loan";
  if (p.includes("student")) return "Student loan";
  if (p.includes("money transfer") || p.includes("virtual currency")) return "Money transfer";
  if (p.includes("debt collection")) return "Debt collection";
  if (p.includes("prepaid")) return "Prepaid card";
  if (p.includes("payday") || p.includes("personal loan") || p.includes("title loan")) return "Personal loan";
  if (p.includes("debt or credit management")) return "Credit management";
  return c.product;
}
export const shortIssue = (s) => (s || "").replace(/^Problem (with|when) /i, "").replace(/^./, (m) => m.toUpperCase());

/* Poll a JSON endpoint. */
export function usePoll(path, ms) {
  const [state, setState] = useState({ data: null, error: null, fetchedAt: 0 });
  const tick = useCallback(async () => {
    try { const data = await api(path); setState({ data, error: null, fetchedAt: Date.now() }); }
    catch (error) { setState((s) => ({ ...s, error })); }
  }, [path]);
  useEffect(() => { tick(); const t = setInterval(tick, ms); return () => clearInterval(t); }, [tick, ms]);
  return { ...state, refresh: tick };
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/* Rank flags: "New" for a fresh id, "Up from #n" when it overtook someone. 8 s each. */
export function useRankFlags(ids) {
  const prev = useRef(null), seen = useRef(new Set());
  const [flags, setFlags] = useState({});
  const key = ids ? ids.join(",") : "";
  useEffect(() => {
    if (!ids) return;
    const before = prev.current, next = {};
    if (before) ids.forEach((id, i) => {
      const o = before.indexOf(id);
      if (o === -1) { if (!seen.current.has(id)) next[id] = { kind: "new", until: Date.now() + 8000 }; }
      else if (before.slice(0, o).some((b) => ids.indexOf(b) > i)) next[id] = { kind: "up", from: o + 1, until: Date.now() + 8000 };
    });
    if (Object.keys(next).length) setFlags((f) => ({ ...f, ...next }));
    prev.current = ids; ids.forEach((id) => seen.current.add(id));
  }, [key]); // eslint-disable-line
  return flags;
}

/* FLIP: rows glide to their new rank; new rows slide in from the right. */
export function useFlip(containerRef, key, slowId) {
  const rects = useRef(new Map());
  useLayoutEffect(() => {
    const el = containerRef.current; if (!el) return;
    const rows = [...el.querySelectorAll("[data-id]")];
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    rows.forEach((r) => {
      const id = r.dataset.id, top = r.getBoundingClientRect().top, old = rects.current.get(id);
      if (reduce) return;
      if (old === undefined) {
        r.animate([{ transform: "translateX(70px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, easing: "cubic-bezier(.23,1,.32,1)" });
      } else if (old !== top) {
        r.animate([{ transform: `translateY(${old - top}px)` }, { transform: "none" }],
          { duration: id === slowId ? 700 : 300, easing: "cubic-bezier(.23,1,.32,1)" });
      }
    });
    rects.current = new Map(rows.map((r) => [r.dataset.id, r.getBoundingClientRect().top]));
  }, [key]); // eslint-disable-line
}

/* Per-viewer preferences (theme, toggles, voice). */
const PREF_KEY = "cue.prefs";
export const DEFAULT_PREFS = { accent: "#ff5b35", showAssistant: true, showToday: true, showInsights: true, voiceURI: "", rate: 1.05 };
export function loadPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREF_KEY) || "{}") }; } catch { return { ...DEFAULT_PREFS }; }
}
export function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* private mode */ } }
export function applyAccent(hex) {
  const r = document.documentElement.style;
  r.setProperty("--accent", hex);
  r.setProperty("--accent-ink", `color-mix(in srgb, ${hex} 70%, #1b1b1d)`);
  r.setProperty("--accent-soft", `color-mix(in srgb, ${hex} 12%, transparent)`);
}
