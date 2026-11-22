import { ArrowRight, Phone, Sparkles, TrendingUp } from "lucide-react";
import { TIERS, TIER_LABEL, firstName, greeting, money, wc, api, phoneFmt, initials } from "./lib";
import { ProductIcon, Today } from "./Queue";

export default function HomePage({ board, now, org, go, toast, refresh, prefs }) {
  const q = board?.queued || [], onCall = board?.inProgress || [], done = board?.done || [];
  const top = q[0];
  const phone = board?.settings?.phoneNumber;
  const live = board?.live || [];
  const longest = q.length ? Math.max(...q.map((x) => now - x.createdAt * 1000)) : 0;
  const counts = Object.fromEntries(TIERS.map((t) => [t, q.filter((x) => x.tier === t).length]));
  const arrival = [...q].sort((a, b) => a.createdAt - b.createdAt);
  const topArrival = top ? arrival.findIndex((x) => x.id === top.id) + 1 : 0;
  async function takeNext() {
    try { await api("/api/queue/next", { rep: "You" }); await refresh(); go("queue"); }
    catch (e) { toast({ text: e.status === 404 ? "No one is waiting." : e.message }); }
  }
  return (
    <div className="home">
      <section className="hero-dark">
        <div className="hero-copy">
          <p className="hero-kicker"><Sparkles size={14} />{org} · callback line</p>
          <h1>{greeting()}.</h1>
          <p className="hero-sub">
            {!board ? "Connecting…" : q.length === 0 ? "No one is waiting. Your queue is clear."
              : <>{q.length} {q.length === 1 ? "caller is" : "callers are"} waiting. <b>{firstName(top.name)}</b> needs help first{topArrival > 1 ? `, though first-come would put them #${topArrival}` : ""}.</>}
          </p>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={takeNext} disabled={!q.length}>Take next caller<ArrowRight size={16} /></button>
            {phone && <a className="btn btn-glass-dark btn-lg" href={`tel:${phone}`}><Phone size={15} />Call {phoneFmt(phone)}</a>}
          </div>
        </div>
        <dl className="hero-stats">
          <div><dt>Waiting</dt><dd className="tnum">{q.length}</dd></div>
          <div><dt>On a call</dt><dd className="tnum">{onCall.length}</dd></div>
          <div><dt>Longest wait</dt><dd className="tnum">{q.length ? wc(longest) : "—"}</dd></div>
          <div><dt>Hold time saved</dt><dd className="tnum">{board ? board.timeSaved.totalMin : 0}<small>min</small></dd></div>
        </dl>
        <span className="hero-glow" aria-hidden="true" />
      </section>

      {phone && (
        <section className="call-band" aria-label="Try Cue by phone">
          <span className="call-band-ic"><Phone size={20} /></span>
          <div className="call-band-copy">
            <b>Try it: call <a href={`tel:${phone}`}>{phoneFmt(phone)}</a></b>
            <span>Cue answers, asks what happened, and your call lands in the queue below while you're still on the line.</span>
          </div>
          <span className="call-band-note">Demo line · limited calls per day</span>
        </section>
      )}

      {live.length > 0 && (
        <section className="live" aria-labelledby="live-h">
          <h2 id="live-h" className="live-head"><i className="call-dot" aria-hidden="true" />On the line now</h2>
          {live.map((c) => (
            <div key={c.key} className={`live-card${c.tier ? ` tier-${c.tier}` : ""}`}>
              <span className="avatar avatar-md">{c.name ? initials(c.name) : "?"}</span>
              <span className="live-who"><b>{c.name || "Caller"}</b><span className="muted small">{c.known ? "Returning" : "New caller"}</span></span>
              <span className="live-time">{wc((c.queuedAt || now) - c.startedAt)}</span>
              <span className="live-stage">{c.stage === "queued" ? "Added to queue" : c.stage === "scoring" ? "Scoring" : "Listening"}</span>
            </div>
          ))}
        </section>
      )}

      <div className="home-grid">
        <section className="card home-next">
          <div className="section-head"><h2>Example calls, ranked</h2><button type="button" className="link-btn" onClick={() => go("queue")}>Open queue<ArrowRight size={14} /></button></div>
          {q.length === 0 ? <p className="muted">Nobody waiting. Call the number above to see a caller land.</p> : (
            <ol className="next-list">
              {q.slice(0, 4).map((x) => (
                <li key={x.id} className={`tier-${x.tier}`}>
                  <button type="button" onClick={() => go("queue", x.id)}>
                    <span className="next-rank tnum">{x.position}</span>
                    <span className="intent-av"><ProductIcon c={x.categories} size={18} /></span>
                    <span className="next-main"><b>{x.name}</b><span className="muted small">{x.summary}{x.amount_usd != null ? ` · ${money(x.amount_usd)}` : ""}</span></span>
                    <span className="chip chip-tier"><i className="tier-dot" />{TIER_LABEL[x.tier]}</span>
                    <span className="next-score tnum">{x.score.total}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="card-dark home-proof">
          <p className="hero-kicker"><TrendingUp size={14} />Why ranking matters</p>
          <h2>The first fifth of callbacks reach</h2>
          <div className="proof-bars">
            <div className="is-us"><span>Cue</span><i style={{ width: "100%" }} /><b>40%</b></div>
            <div><span>Random</span><i style={{ width: "52%" }} /><b>21%</b></div>
            <div><span>First-come</span><i style={{ width: "37%" }} /><b>15%</b></div>
          </div>
          <p className="proof-foot">of the people who needed action, tested on real CFPB complaints.</p>
          <button type="button" className="link-btn light" onClick={() => go("insights")}>See the evidence<ArrowRight size={14} /></button>
        </section>

        <section className="card home-mix">
          <h2 className="card-title">Waiting by urgency</h2>
          <div className="mix-bar" aria-hidden="true">{TIERS.map((t) => counts[t] ? <i key={t} className={`tier-${t}`} style={{ flex: counts[t] }} /> : null)}</div>
          <dl className="tier-stats">{TIERS.map((t) => <div key={t} className={`tier-${t}${counts[t] ? "" : " is-zero"}`}><dt><i className="tier-dot" />{TIER_LABEL[t]}</dt><dd className="tnum">{counts[t]}</dd></div>)}</dl>
          <p className="muted small" style={{ marginTop: ".7rem" }}>{done.length} handled today · {onCall.length} on a call right now</p>
        </section>

        {prefs.showToday && <div className="home-today"><Today items={[...onCall, ...q, ...done]} settings={board?.settings} onReopen={async (id, name) => { await api(`/api/queue/${id}/reopen`, {}); await refresh(); toast({ text: `${firstName(name)} is back in the queue.` }); }} /></div>}
      </div>
    </div>
  );
}
