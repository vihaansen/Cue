# Voicemate: builder handoff (read top to bottom)

> Rung, mentioned in this file, is our friends' project, not ours.
**Acalanes Data Fest 2026 · BRIDGEGOOD Oakland · Sat Nov 21 · Demos 3:30 PM, done by 3:25 PM**
Written 12:25 PM. The person who wrote this is out of time. **This file is everything you need. You don't need the chat it came from.**

---

## 0. The 60-second version

**What Voicemate is:** a **triage engine that learns who needs help first.** Requests come in (by phone in our demo; email and web forms work the same way). Voicemate:
1. asks **only the 3 questions** that real data showed matter,
2. **scores** the request with a model learned from **60,000 real government complaint outcomes**,
3. puts it in a **ranked callback queue**, with a reason for every spot,
4. hands the human rep a **6-line brief** that was tested for invented facts.

**What it is NOT:** an AI that "does what you ask on a call." Any chatbot can take a complaint. **The new part is the ranking:** a generic AI can only guess urgency from how a complaint *sounds*. Voicemate's ranking comes from what actually happened to 60,000 similar complaints, and we can prove it works with numbers (§2).

**Your job (builder):** build the app in `index.html` (the screen) on top of `server.py` (already written and tested, §6). Checkpoint at **1:15 PM**: one call lands in the queue with a score and a brief.

**Pitch line:** *"Any AI can take a complaint. Ours knows, from 60,000 real outcomes, which complaints need help first, and it proves it."*

---

## 1. Why this is useful (the answer when someone asks "isn't it just an agent?")

- **The front door doesn't matter.** Phone, email or a web form all lead to the same engine. Voice is just the most fun to demo.
- **What a regular agent can't do:** know which requests *actually* end up needing action. That knowledge comes from **labeled outcomes** (the CFPB data records whether the company had to fix the problem), not from a language model.
- **Who it helps:**
  - **The business:** reps start with the cases most likely to need real action, with a brief ready.
  - **People with real problems:** they stop waiting behind easy questions. In our test, the first 20% of callbacks reached **40%** of the people who needed action, against **15%** for first-come.
- **It gets better over time:** every callback outcome becomes new training data for *that* business. A plain agent never learns to prioritize.

---

## 2. The data results (final; use these exact numbers)

| What | Number |
|---|---|
| Data | **60,000** CFPB complaints, received Nov 2024 – Sep 2026, 6,000 from each of 10 products (credit reporting excluded: it's 90% of volume and mostly template filings) |
| Outcome label "needed action" | company gave monetary/non-monetary relief, **or** responded late: **19.9%** of complaints |
| The 3 questions the data picked (forward selection) | **1. What type of account? 2. What specifically happened? 3. What went wrong?** |
| AUC with 3 questions / all 6 fields plus interactions | **0.711 / 0.712**, so 3 questions get **99.5%** of the lift |
| Adding product, age 62+/servicemember, or state | adds **nothing** to AUC |
| Cases needing action reached in the first 20% of callbacks | **Voicemate 40%** · random 21% · **first-come 15%** (2.7×) |
| Precision / recall at the top 20% | 0.39 / 0.39 (base rate 0.20) |
| Fairness, top 10 states | every one within ±2 points of its actual rate |
| Fairness, older Americans | 3-question score 0.194 vs actual 0.222 (**under-ranked**); with the 62+ flag, 0.221 (**fixed**) |
| Brief accuracy (Adaption deepseek-v4-flash, 50 real narratives) | **0%** invented dollar amounts · **98%** nothing invented · **77%** kept the key amount (v1 was 52%; we added an Amount line) · 88% "Wants" faithful |

**Limits. Say them before judges ask:**
1. "Company gave relief" is a **stand-in** for urgency, not urgency itself.
2. **Which company it is** predicts relief best (AUC 0.82 alone). Voicemate serves one company, so that question is excluded.
3. **Inside a single company the lift is modest:** median AUC **0.60** (17 big companies, range 0.41–0.74). That's why the learning loop matters.
4. The 2026 CFPB release has **no complaint text**, so the model uses structured answers only. The brief test used text from an older public CFPB copy.

**Surprise worth showing:** an unauthorized charge on a checking account scores **61**, while a credit-card statement dispute scores **82**. That's the data, not our opinion; it proves we didn't hand-tune the ranking.

---

## 3. What's in the zip

| File | What |
|---|---|
| `HANDOFF.md` | this file |
| `server.py` | **working back end** (FastAPI). Scoring, queue, claim, returning callers, AI briefs |
| `voicemate_scoring.json` | the learned model: weights, score percentiles, valid CFPB categories |
| `FINDINGS.md` | longer write-up of the results, plus Q&A |
| `charts/chart1_auc_vs_questions.png` | slide 2: "3 questions are enough" |
| `charts/chart2_ranking_vs_fcfs.png` | slide 2: 40% vs 15% |
| `charts/chart3_fairness_older.png` | slide 3: fairness |
| `results.json`, `brief_check_summary.json`, `brief_check_v1_summary.json` | all the numbers |
| `prep.py`, `model.py`, `brief_check.py` | the reproducible analysis (show judges if asked) |
| `scoring_3q_v1.json` | older copy of the weights (ignore) |

---

## 4. Setup (5 minutes, Mac)

```bash
mkdir -p ~/voicemate && cd ~/voicemate && unzip ~/Downloads/voicemate_handoff.zip
```
```bash
python3 -m venv .venv && .venv/bin/pip install fastapi uvicorn adaption
```
**Adaption API key:** ask Vihaan to create or copy it from adaptionlabs.ai → Settings → API keys. **Never paste a key into chat, code, slides or git.** Copy it to the clipboard, then in the terminal you'll run the server from:
```bash
export ADAPTION_API_KEY="$(pbpaste)"; pbcopy </dev/null
```
```bash
.venv/bin/uvicorn server:app --port 8000 --reload
```
Open **Chrome** at http://localhost:8000. It must be Chrome: the speech recognition only works well there.

**Python 3.9 note:** the Mac's built-in Python is 3.9. `server.py` already avoids newer syntax. Don't use `str | None`; use `Optional[str]`.

---

## 5. How it fits together

```
Chrome: index.html  (you build this)
 ├─ Call panel   mic (webkitSpeechRecognition) + voice (speechSynthesis) + transcript
 ├─ Brief card   6 lines, tier pill, score, "why it ranks here", EN/ES/中文/VI
 └─ Queue        ranked list, polls every 2s, "Take next"
        │  fetch JSON
        ▼
server.py (done)  localhost:8000
 ├─ POST /api/lookup_caller      phone → new / recognized (+ greeting)
 ├─ POST /api/triage_call        answers + transcript → AI classify + AI brief → model score → queued
 ├─ GET  /api/queue              ranked list with live wait points
 ├─ POST /api/queue/next         atomic claim (two reps never get the same caller)
 ├─ POST /api/queue/{id}/done
 ├─ POST /api/translate/{id}/{es|zh|vi}   cached
 └─ POST /api/reset              clear the queue, reload the 4 seed callers
        ▼
Adaption Responses API (deepseek-v4-flash), about 20–30 s per call
```

**Why the score isn't an AI guess:** the AI only *sorts the caller's words into official CFPB categories*. The score itself is plain math from the trained model in `voicemate_scoring.json`. That's what makes the ranking validated rather than vibes.

---

## 6. The server (`server.py`): already built

**Tested (works without a key):** the queue loads 4 seed callers ranked by the model, returning-caller lookup, atomic take-next, reset. Test output:
```
1 Luis Ortega  high   {'urgency': 82, 'value': 0, 'aging': 9,  'total': 91}
2 Ana Lopez    normal {'urgency': 61, 'value': 0, 'aging': 5,  'total': 66}
3 Priya Nair   normal {'urgency': 47, 'value': 0, 'aging': 18, 'total': 65}
4 Omar Haddad  low    {'urgency': 17, 'value': 5, 'aging': 22, 'total': 44}
```
**Not yet tested (needs the key):** `triage_call` and `translate`. Test them first, as soon as you have the key:
```bash
curl -s localhost:8000/api/triage_call -H 'content-type: application/json' -d '{"phone":"+15105550101","answers":{"account":"my checking account","wrong":"there is a charge I did not make","specific":"4200 dollars on Tuesday, I never authorized it"}}'
```
It takes about 30 seconds and should return `{"item": {...}, "position": N, "eta_minutes": ...}`.

**The score (same field names as Rung's real dashboard):**
| Field | Meaning | Learned or rule? |
|---|---|---|
| `score.urgency` | 0–100: percentile of the model's probability among 60k real complaints | **learned** |
| `score.value` | +5 if the amount is ≥ $1k, +10 if ≥ $10k | rule |
| `score.aging` | +1 per minute waited, capped at 30 (so nobody starves) | rule |
| `score.total` | the sum, used to sort the queue | |
| `tier` | from urgency: critical ≥90 · high ≥70 · normal ≥30 · low | |
| `trust` | `new` or `recognized`. **Never "verified"** (no SMS check) | |
| `reasons` | the 3 answer weights, e.g. "What went wrong: … +0.45" | **learned** |

**Request and response shapes:**
- `POST /api/lookup_caller {"phone": "+15105550101"}` → `{"trust": "recognized", "name": "Maria Reyes", "last": {...}, "greeting": "Hi Maria, I've got your details up. What can I help you with today?"}` or `{"trust": "new"}`
- `POST /api/triage_call {"phone": "...", "caller_name": "optional for new callers", "answers": {"account": "...", "wrong": "...", "specific": "..."}, "transcript": [{"speaker": "agent|caller", "text": "..."}]}` → `{"item": {...}, "position": 2, "eta_minutes": 6}`
- `GET /api/queue` → `{"items": [{id, name, phone, trust, tier, summary, reason, reasons, score: {urgency, value, aging, total}, brief: {Headline, Amount, When, Tried, Wants, Best time}, position, eta_minutes, minutes_waited, categories, synthetic}], "waiting": 4}`
- `POST /api/queue/next {"rep": "Vihaan"}` → the claimed item
- `POST /api/translate/{id}/es` → `{"lang": "es", "text": "6 translated lines"}`

**Demo phone numbers (all synthetic):** Maria Reyes `+15105550101` (returning; last call "Card charge she didn't make, $4,200"). Seeds: Omar `…0102`, Priya `…0103`, Luis `…0104`, Ana `…0105`. Anything else counts as a new caller.

---

## 7. The call flow (build this in `index.html`)

| Step | The screen / voice does | API |
|---|---|---|
| 0 | Caller-ID dropdown: "Maria Reyes (returning)", "New caller (+1 510 555 0199)" → **Call** | `lookup_caller` |
| 1, recognized | Speaks the `greeting` from the server | |
| 1, new | "Thanks for calling Bank of Antarctica. This is Voicemate, an AI assistant. Who am I speaking with?" → captures the name | |
| 2 (Q1) | "What kind of account is this about: checking, savings, credit card, a loan, a mortgage, or something else?" | |
| 3 (Q2) | "What went wrong?" | |
| 4 (Q3) | "What specifically happened? Any amount or date helps." | |
| 5 | "One moment while I get this to the right person." Show a "Scoring with 60,000 real outcomes…" spinner | `triage_call` (~30 s) |
| 6 | "Thanks, {first name}. So: {brief.Headline}. A specialist will call you back in about {eta} minutes. You're number {position} in line." | |
| 7 | On screen: a text-message bubble: "Hi {name}, we have your request. A specialist will call you back in about {eta} minutes, around {clock time}. You are #{position} in line." The new row **animates into its spot** in the queue | |

**Speech code (Chrome):**
```js
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function listen() {            // resolves with the final transcript of one answer
  return new Promise((resolve, reject) => {
    const r = new SR(); r.lang = "en-US"; r.interimResults = true; r.continuous = false;
    let final = "";
    r.onresult = e => { for (const res of e.results) if (res.isFinal) final += res[0].transcript;
                        showInterim([...e.results].map(x => x[0].transcript).join("")); };
    r.onerror = e => reject(e.error); r.onend = () => resolve(final.trim());
    r.start();
  });
}
function say(text) {           // resolves when finished speaking
  return new Promise(res => { const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05; u.onend = res; speechSynthesis.speak(u); });
}
```
- Re-ask once if the answer comes back empty. After that, use the **text box fallback** (always visible under the transcript). If the room is loud, the whole demo works by typing.
- **Don't listen while speaking.** Await `say()` before calling `listen()`, or the mic hears the laptop.
- Mic permission only works on `http://localhost` or https. Use localhost.

---

## 8. Making it look good (Rung's actual design system)

Taken directly from Rung's site CSS. Use it and Voicemate will look like a real product.

**Colors (CSS variables):**
```css
:root{
  --bg:#f7f7f2;  --panel:#eeeee7; --panel-hover:#e7e7df; --card:#ffffff;
  --ink:#111111; --muted:#11111194; --line:#1111111a;
  --cobalt:#345cff; --cobalt-ink:#2443cc; --cobalt-soft:#345cff1f;
  --critical:#e5391f; --critical-ink:#b52a14; --critical-soft:#e5391f21;
  --high:#e8a200;     --high-ink:#7a5300;     --high-soft:#e8a20029;
  --normal:#345cff;   --normal-ink:#2443cc;   --normal-soft:#345cff1f;
  --low:#8a97ae;      --low-ink:#4f5d78;      --low-soft:#8a97ae33;
  --ease-out:cubic-bezier(.23,1,.32,1);
  --press-key:inset 0 1px 0 #fff6, inset 0 -2px 0 #1111112e;
  --press-key-down:inset 0 2px 4px #1111114d;
}
.tier-critical{--tier:var(--critical);--tier-ink:var(--critical-ink);--tier-tint:var(--critical-soft)}
.tier-high{--tier:var(--high);--tier-ink:var(--high-ink);--tier-tint:var(--high-soft)}
.tier-normal{--tier:var(--normal);--tier-ink:var(--normal-ink);--tier-tint:var(--normal-soft)}
.tier-low{--tier:var(--low);--tier-ink:var(--low-ink);--tier-tint:var(--low-soft)}
```
**Type:** Inter from Google Fonts (`<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">`). Use `ui-monospace, "SF Mono", Menlo, monospace` for scores, numbers and JSON.
- Body 15px.
- Small labels `.78rem`, uppercase, `letter-spacing:.08em`, color `--muted`.
- Big headings: weight 700–800 with tight tracking, `letter-spacing:-.02em` to `-.05em`.

**Shapes:**
- Pills and buttons: `border-radius:999px`. Cards: `14px`–`16px`. Big panels: `22px`.
- Borders: `1px solid var(--line)`. No heavy shadows; Rung's look is flat.
- Buttons get a "keycap" feel: `box-shadow:var(--press-key)`, and on `:active`, `var(--press-key-down)`.
- Transitions: `background-color .16s var(--ease-out)`.

**Components (copy Rung's patterns):**
- **Tier pill:** `background:var(--tier-tint); color:var(--tier-ink)`, uppercase, 11px, weight 700, `letter-spacing:.08em`, padding `3px 8px`, radius 999px. The text is "CRITICAL", "HIGH", "NORMAL" or "LOW".
- **Score:** monospace, 28–40px, weight 700, color `var(--tier)`. Put "#2 in queue" under it in muted text.
- **Queue row:** white card, radius 14px, padding 12px 14px, with a 4px left bar in `var(--tier)`. Layout: position number (muted, mono), summary (600), "Maria R. · Recognized" (muted, small), and the total score on the right (mono). Show a small "+9 wait" chip when aging > 0. Hover uses `--panel-hover`. The selected row gets a `2px var(--cobalt)` outline.
- **Brief card:** white, radius 16px, padding 20px. Top line: name, a trust tag ("Recognized · 2nd call" or "New caller"), the tier pill and the big score. Then the 6 rows as a 2-column grid (label `.78rem` uppercase muted | value 15px). A small green ✓ appears next to each line that isn't "not stated".
- **Why it ranks here:** 3 rows. Label text plus a thin horizontal bar: grows right in `--tier` for a positive weight, left in `--low` for a negative one, with the number in mono.
- **Transcript:** Rung-style bubbles. Agent lines left-aligned on `--panel`, caller lines right-aligned on `--cobalt-soft`. A "● Live" pill in red while listening, and interim text shown in muted italics.
- **Text-message bubble:** iMessage style: a gray bubble, "Bank of Antarctica · now" above it.
- **Language toggle:** a segmented pill `EN | ES | 中文 | VI`. Active segment is white on `--panel`.
- **Empty or loading:** "Scoring with 60,000 real outcomes…" plus a subtle pulsing dot. Never a bare spinner.

**Layout:** a 3-column grid on a laptop (`grid-template-columns: 360px 1fr 380px; gap:16px; padding:16px`), stacked under 1000px wide.
- Header: "Voicemate" wordmark (800 weight, -.04em) on the left; on the right, a small muted line: "Ranked by a model trained on 60,000 CFPB complaints".
- Footer (honesty): "Callers are synthetic · identity recognized, not verified · urgency score = learned stand-in (relief granted)".

**Motion:** when a new call is queued, slide its row in from the right and move it to its rank with a 300ms `transform` transition, using `--ease-out`. That re-rank moment is the most important visual in the demo. Make it obvious.

---

## 9. Build timeline (from 12:30)

| Time | Task | Done when |
|---|---|---|
| 12:30–12:45 | Setup (§4), run the `triage_call` curl test with the key | the curl returns a queued item |
| 12:45–1:15 | `index.html`: 3 panels, queue polling, brief card, **text-box** call → `triage_call` | **CHECKPOINT 1:15: a typed call lands ranked, with a brief** |
| 1:15–1:45 | Voice: `listen()` / `say()`, the call script, returning-caller greeting | a spoken Maria call works in a quiet spot |
| 1:45–2:10 | Polish (§8): tier colors, re-rank animation, "why it ranks here", text bubble | looks like Rung |
| 2:10–2:30 | **Record the 60–90 s backup video** (a screen recording of one full call); pre-translate the demo items (click ES/中文/VI once each) | video saved on 2 laptops |
| **2:30 FEATURE FREEZE** | | |
| 2:30–3:25 | Slides (§10) and two timed run-throughs under 4:45 | done |

**Cut order if behind:** translation → returning caller → voice (demo by typing). **Never cut:** the ranked queue using the learned score, Chart 1, and a live call or the backup video.

**Before going on stage:** run `curl -X POST localhost:8000/api/reset` so the queue holds only the 4 seeds. Close other tabs. Turn the volume up.

---

## 10. Slides (3 maximum) and the 5-minute demo

**Slide 1, the problem:** "Support lines serve whoever called first." Outside credit reports, the CFPB received **1.2 million** complaints in two years, and companies had to fix or answer late on about **1 in 5**. Which ones?
**Slide 2, the proof:** Chart 1 ("3 questions = 99.5% of the signal") next to Chart 2 ("first 20% of callbacks: 40% vs 15%").
**Slide 3, trust and limits:** brief accuracy (0 invented amounts, v1 52% → v2 77% amounts kept), Chart 3 (older callers fixed), limits (stand-in label; within-company AUC 0.60), and what lasts (it learns from every callback; works for email and forms; clinics, food banks, 311).

| Time | What |
|---|---|
| 0:00–0:30 | Slide 1 |
| 0:30–1:45 | **Live:** pick "Maria Reyes" → greeting → 3 questions → the row slides into the queue. Point at the tier, the score, "why it ranks here" and the +wait points. Click ES. |
| 1:45–3:00 | Slide 2: "We tested every question. Three are enough. And ranking reaches 2.7× more of the people who needed help." |
| 3:00–4:15 | Slide 3: accuracy, fairness, limits, said plainly |
| 4:15–5:00 | "Any AI can take a complaint. Ours knows which ones need help first, and proves it." Then questions. |

---

## 11. Judge Q&A

- **"Isn't this just an agent?"** "The agent is just the front door; email works too. What's new is the ranking: it comes from 60,000 real outcomes, and we measured it. 40% vs 15% in the first 20% of callbacks."
- **"Is relief a good stand-in for urgency?"** "Partly. The company alone predicts it at 0.82, so we excluded company and report the within-company number honestly: 0.60. That's why it learns from each business's own callbacks."
- **"Why 3 questions?"** "Chart 1. The curve is flat after three."
- **"Why isn't the fraud caller #1?"** "In the data, unauthorized checking charges got relief less often than card disputes. We let the data rank. A business can add its own rule on top, and our wait and amount points are rules we label as rules."
- **"How do you know the briefs are right?"** "We tested 50 real complaints: zero invented amounts, 98% with nothing invented. v1 dropped the amount half the time; we fixed it to 77%."
- **"Is it fair?"** "States are within 2 points. Older callers were under-ranked by the 3 questions, so we keep an age flag."
- **"Why not accuracy?"** "80% of complaints don't need action. 'Never urgent' would be 80% accurate and useless. We report AUC, precision and recall."
- **"Is this a real phone line?"** "Not today. It's the engine, running through the laptop mic. In production it plugs into a phone provider, the way our friends' project Rung runs on Dial."

---

## 12. Rules

- **Keys:** environment variable only. Never in chat, code, slides, screenshots or git.
- **Callers:** synthetic, labeled as synthetic. No real personal data.
- **Video:** record only teammates' voices (California requires every party's consent).
- **Never claim:** verified callers, SMS codes, a real phone line, or that the score *is* urgency.
- **Credit:** Rung is our friends' project. Today's work is the data analysis and Voicemate (now Cue).

---

## 13. Reference: what Rung's own files showed (for context only)

`Rung.html` / `tryrung-site.zip` contain only Rung's website and dashboard front end; there's **no server code**. From its `llms.txt`:
- **Dial hosts the voice agent** and calls Rung's tools during a call: `lookup_caller`, `send_code`, `check_code`, `save_profile`, `triage_call {intent, amount_usd?, summary, caller_name?}`.
- The dashboard API: `/api/queue`, `/api/queue/next`, `/api/queue/:id/callback|done|release|reopen`, `/api/insights`.
- Each queue item has `score {urgency, value, aging, total}`, `tier`, `trust`, `intent`, `summary` and `reason`.

**Voicemate deliberately uses the same names**, so if the Dial account ever comes back, Dial's agent could call Voicemate's `lookup_caller` / `triage_call` the same way (that would take a tunnel and about an hour; not today). **Don't touch Rung's live Supabase project.**

---

## 14. Sponsors

| Sponsor | Use | Status |
|---|---|---|
| **Adaption** | AI classification, briefs, translation; the 50-brief accuracy test | ✅ 1,250 credits, working |
| **Momen** | $130 credit, empty project "Rung Queue". Only if everything is done by 2:00: mirror the queue there for sponsor visibility | set up, optional |
| **ArgosX** | Free security scan (team code `ACALANES-DF26`), 5 minutes, scan only our own site | optional |
| CFPB | the dataset (government source, not a sponsor) | used |
