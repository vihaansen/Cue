"""Voicemate starter server (FastAPI). Run:
    export ADAPTION_API_KEY="$(pbpaste)"; pbcopy </dev/null
    .venv/bin/uvicorn server:app --port 8000
Scoring/queue work without a key; classify/brief/translate need it.
Field names follow Rung's queue (score.urgency/value/aging/total, tier, trust).
Rung is our friends' project; we did not build it and only reuse its public field names, with credit.
"""
import json
import math
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

ROOT = Path(__file__).parent
S = json.loads((ROOT / "voicemate_scoring.json").read_text())
W, B, PCT, TAX = S["weights"], S["intercept"], S["percentiles_of_p"], S["taxonomy"]
MODEL = "deepseek-v4-flash"
LOCK = threading.Lock()
import os
DATA = Path("/tmp") if os.environ.get("VERCEL") else ROOT  # Vercel's file system is read-only except /tmp
QUEUE_FILE, CALLERS_FILE = DATA / "queue.json", DATA / "callers.json"

app = FastAPI()
_client = None


def llm(instructions, text):
    global _client
    if _client is None:
        from adaption import Adaption
        _client = Adaption()  # reads ADAPTION_API_KEY
    return _client.responses.create(model=MODEL, instructions=instructions, input=text).output_text.strip()


# ---------------- scoring (the learned model; no LLM) ----------------
def tier_for(u):
    return "critical" if u >= 90 else "high" if u >= 70 else "normal" if u >= 30 else "low"


def score_categories(c):
    parts = [("Account", "sub_product"), ("What went wrong", "issue"), ("What happened", "sub_issue")]
    z, reasons = B, []
    for label, key in parts:
        w = W[key].get(c.get(key) or "", 0.0)
        z += w
        reasons.append({"label": f"{label}: {c.get(key) or 'unknown'}", "weight": round(w, 3)})
    p = 1 / (1 + math.exp(-z))
    urgency = max(0, sum(1 for q in PCT if q <= p) - 1)  # percentile 0-100 among 60k real complaints
    reasons.sort(key=lambda r: -r["weight"])
    return {"p": round(p, 4), "urgency": urgency, "tier": tier_for(urgency), "reasons": reasons}


AMT = re.compile(r"\$\s?([\d,]+(?:\.\d+)?)")
AMT_WORD = re.compile(r"([\d,]+(?:\.\d+)?)\s*(?:dollars|dollar|usd|bucks)\b", re.I)


def amount_usd(amount_text):
    m = AMT.search(amount_text or "") or AMT_WORD.search(amount_text or "")
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return None


def value_points(amount_text):
    v = amount_usd(amount_text)
    if v is None:
        return 0
    return 10 if v >= 10000 else 5 if v >= 1000 else 0  # RULE, not learned


def with_live_score(item, now=None):
    now = now or time.time()
    minutes = (now - item["createdAt"]) / 60
    aging = min(30, int(minutes))  # +1 per minute waited, cap 30 (RULE)
    s = item["score"]
    s["aging"] = aging
    s["total"] = s["urgency"] + s["value"] + aging
    item["minutes_waited"] = int(minutes)
    return item


# ---------------- storage ----------------
def load(path, default):
    return json.loads(path.read_text()) if path.exists() else default


REDIS_URL = os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL")
REDIS_TOKEN = os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN")
STATE = {"dirty": False}


def redis(*cmd):
    """One Redis command over Upstash's REST API (shared by every serverless instance)."""
    import urllib.request
    req = urllib.request.Request(REDIS_URL, data=json.dumps([str(c) for c in cmd]).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {REDIS_TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read()).get("result")


def save(path, data):
    STATE["dirty"] = True  # pushed to Redis after the request when Redis is configured
    if not REDIS_URL:
        path.write_text(json.dumps(data, indent=1))


QUEUE = load(QUEUE_FILE, [])
DEFAULT_CALLERS = {
    "+15105550101": {"name": "Maria Reyes", "calls": [
        {"at": "2026-11-14 15:36", "summary": "Card charge she didn't make, $4,200", "duration_s": 168}]}
}
CALLERS = load(CALLERS_FILE, json.loads(json.dumps(DEFAULT_CALLERS)))
SETTINGS_FILE = DATA / "settings.json"
SETTINGS = {"company": "Bank of Bridgegood", "repsOnShift": 1, "avgHandleMin": 3,
            "baselineHoldMin": 23, "reexplainMin": 3,
            "phoneNumber": os.environ.get("CUE_PHONE_NUMBER", "+19256034116")}
LIVE = {}  # Vapi call id -> caller on the line right now
SETTINGS.update(load(SETTINGS_FILE, {}))


def eta_for(pos):
    return max(1, math.ceil(pos * SETTINGS["avgHandleMin"] / max(1, SETTINGS["repsOnShift"])))

SEED = [  # synthetic callers, real CFPB categories; scores come from the model
    ("Omar Haddad", "+15105550102", 22, {"product": "Money transfer, virtual currency, or money service",
     "sub_product": "Domestic (US) money transfer", "issue": "Money was not available when promised"},
     "Wire transfer stuck 3 days", "$2,500"),
    ("Priya Nair", "+15105550103", 18, {"product": "Checking or savings account", "sub_product": "Savings account",
     "issue": "Managing an account"}, "Update mailing address", "not stated"),
    ("Luis Ortega", "+15105550104", 9, {"product": "Credit card", "sub_product": "General-purpose credit card or charge card",
     "issue": "Problem with a purchase shown on your statement"}, "Charge on statement he doesn't recognize", "$89"),
    ("Ana Lopez", "+15105550105", 5, {"product": "Checking or savings account", "sub_product": "Checking account",
     "issue": "Problem with a lender or other company charging your account",
     "sub_issue": "Transaction was not authorized"}, "Debit she didn't authorize", "$640"),
]


def seed():
    if QUEUE:
        return
    now = time.time()
    for i, (name, phone, mins, cats, headline, amount) in enumerate(SEED):
        sc = score_categories(cats)
        QUEUE.append({
            "id": f"seed{i}", "phone": phone, "name": name, "trust": "new", "intent": cats["issue"],
            "categories": cats, "summary": headline, "reason": sc["reasons"][0]["label"],
            "reasons": sc["reasons"], "tier": sc["tier"], "p": sc["p"],
            "score": {"urgency": sc["urgency"], "value": value_points(amount), "aging": 0, "total": 0},
            "brief": {"Headline": headline, "Amount": amount, "When": "not stated", "Tried": "not stated",
                      "Wants": "not stated", "Best time": "not stated"},
            "translations": {}, "transcript": [], "status": "waiting", "claimed_by": None,
            "createdAt": now - mins * 60, "synthetic": True,
        })
    save(QUEUE_FILE, QUEUE)


seed()

# ---------------- prompts ----------------
CLASSIFY = (
    "You map a caller's answers to the official CFPB complaint categories. Choose ONLY from TAXONOMY. "
    'Structure: Product -> Sub-product -> list of "Issue >> Sub-issue" pairs. Return JSON only: '
    '{"product":"...","sub_product":"...","issue":"...","sub_issue":"...","confidence":"high|medium|low"}. '
    "product and sub_product must be exact keys; issue and sub_issue must come from ONE pair under that "
    "sub_product (split at ' >> '). If unsure pick the closest pair and set confidence low. Never invent.\nTAXONOMY:\n"
    + json.dumps(TAX)
)
BRIEF = (
    "You write callback briefs for a support rep. Use only facts stated by the caller; never invent details. "
    "If something is not stated, write \"not stated\". For Wants: only what the caller explicitly asked for, "
    "else \"not stated\". Output exactly six lines:\nHeadline: <one line>\n"
    "Amount: <main dollar amount at stake, copied exactly, or \"not stated\">\nWhen: <when it happened>\n"
    "Tried: <what they already tried>\nWants: <what they want>\nBest time: <best time to call back, or \"not stated\">"
)
LANGS = {"es": "Spanish", "zh": "Simplified Chinese", "vi": "Vietnamese"}
LABELS = ["Headline", "Amount", "When", "Tried", "Wants", "Best time"]


def valid(c):
    sp = TAX.get(c.get("product") or "", {}).get(c.get("sub_product") or "")
    if sp is None:
        return False
    return f"{c.get('issue')} >> {c.get('sub_issue')}" in sp or any(x.startswith(f"{c.get('issue')} >> ") for x in sp)


def classify(answers):
    text = "\n".join(f"{k}: {v}" for k, v in answers.items())
    for _ in range(2):
        try:
            raw = llm(CLASSIFY, text)
            c = json.loads(re.search(r"\{.*\}", raw, re.S).group(0))
            if valid(c):
                return c
        except Exception:
            pass
    return {"product": None, "sub_product": None, "issue": None, "sub_issue": None, "confidence": "low"}


def parse_brief(raw):
    out = {k: "not stated" for k in LABELS}
    for line in raw.splitlines():
        for k in LABELS:
            if line.strip().lower().startswith(k.lower() + ":"):
                out[k] = line.split(":", 1)[1].strip()
    return out


# ---------------- API (names follow Rung, our friends' project) ----------------
class LookupIn(BaseModel):
    phone: str


class TriageIn(BaseModel):
    phone: str
    caller_name: Optional[str] = None
    answers: dict  # {"account":..., "wrong":..., "specific":...}
    transcript: list = []  # [{"speaker":"agent|caller","text":...}]


class TakeIn(BaseModel):
    rep: str = "Rep"


@app.get("/")
def index():
    return FileResponse(ROOT / "index.html", headers={"Cache-Control": "no-store"})  # always serve the newest build


@app.post("/api/lookup_caller")
def lookup_caller(body: LookupIn):
    c = CALLERS.get(body.phone)
    if not c:
        return {"trust": "new"}
    return {"trust": "recognized", "name": c["name"], "last": c["calls"][-1] if c["calls"] else None,
            "greeting": f"Hi {c['name'].split()[0]}, I've got your details up. What can I help you with today?"}


@app.post("/api/triage_call")
def triage_call(body: TriageIn):
    convo = "\n".join(f"{t.get('speaker')}: {t.get('text')}" for t in body.transcript) or \
        "\n".join(f"caller: {v}" for v in body.answers.values())
    with ThreadPoolExecutor(2) as ex:  # each LLM call ~20-30s; run in parallel
        f_cat = ex.submit(classify, body.answers)
        f_brief = ex.submit(lambda: parse_brief(llm(BRIEF, convo)))
        cats, brief = f_cat.result(), f_brief.result()
    sc = score_categories(cats)
    known = CALLERS.get(body.phone)
    name = body.caller_name or (known or {}).get("name") or "Unknown caller"
    item = {
        "id": f"c{int(time.time() * 1000)}", "phone": body.phone, "name": name,
        "trust": "recognized" if known else "new", "intent": cats.get("issue") or "unclassified",
        "categories": cats, "summary": brief["Headline"], "reason": sc["reasons"][0]["label"],
        "reasons": sc["reasons"], "tier": sc["tier"], "p": sc["p"],
        "score": {"urgency": sc["urgency"], "value": value_points(brief["Amount"]), "aging": 0, "total": 0},
        "brief": brief, "translations": {}, "transcript": body.transcript, "status": "waiting",
        "claimed_by": None, "createdAt": time.time(), "synthetic": True,
    }
    with LOCK:
        QUEUE.append(item)
        save(QUEUE_FILE, QUEUE)
        if body.caller_name and not known:  # consent assumed for synthetic demo callers only
            CALLERS[body.phone] = {"name": body.caller_name, "calls": []}
        CALLERS.setdefault(body.phone, {"name": name, "calls": []})["calls"].append(
            {"at": time.strftime("%Y-%m-%d %H:%M"), "summary": brief["Headline"], "duration_s": None})
        save(CALLERS_FILE, CALLERS)
    q = queue()
    pos = next(i for i, x in enumerate(q["items"], 1) if x["id"] == item["id"])
    return {"item": with_live_score(item), "position": pos, "eta_minutes": eta_for(pos)}


@app.get("/api/queue")
def queue():
    now = time.time()
    items = [with_live_score(x, now) for x in QUEUE if x["status"] == "waiting"]
    items.sort(key=lambda x: -x["score"]["total"])
    for i, x in enumerate(items, 1):
        x["position"], x["eta_minutes"] = i, eta_for(i)
    return {"items": items, "waiting": len(items)}


@app.post("/api/queue/next")
def take_next(body: TakeIn):
    with LOCK:  # atomic claim: two reps never get the same caller
        items = queue()["items"]
        if not items:
            raise HTTPException(404, "queue empty")
        top = next(x for x in QUEUE if x["id"] == items[0]["id"])
        top["status"], top["claimed_by"], top["claimedAt"] = "in_progress", body.rep, time.time()
        save(QUEUE_FILE, QUEUE)
        return top


@app.post("/api/queue/{item_id}/done")
def done(item_id: str):
    with LOCK:
        for x in QUEUE:
            if x["id"] == item_id:
                x["status"], x["doneAt"] = "done", time.time()
                save(QUEUE_FILE, QUEUE)
                return x
    raise HTTPException(404, "not found")


@app.post("/api/translate/{item_id}/{lang}")
def translate(item_id: str, lang: str):
    if lang not in LANGS:
        raise HTTPException(400, "lang must be es, zh or vi")
    x = next((x for x in QUEUE if x["id"] == item_id), None)
    if not x:
        raise HTTPException(404, "not found")
    if lang not in x["translations"]:
        text = "\n".join(f"{k}: {v}" for k, v in x["brief"].items())
        x["translations"][lang] = llm(
            f"Translate this brief fully into {LANGS[lang]}, including the six line labels and month names. "
            "Keep the six-line format. Copy every digit and dollar amount exactly.", text)
        save(QUEUE_FILE, QUEUE)
    return {"lang": lang, "text": x["translations"][lang]}


@app.post("/api/reset")
def reset():
    with LOCK:
        QUEUE.clear()
        seed()
        CALLERS.clear()
        CALLERS.update(json.loads(json.dumps(DEFAULT_CALLERS)))
        save(CALLERS_FILE, CALLERS)
    return {"ok": True}


# ---------------- dashboard extras (modelled on Rung's dashboard API; Rung is our friends' project) ----------------
def find(item_id):
    x = next((x for x in QUEUE if x["id"] == item_id), None)
    if not x:
        raise HTTPException(404, "not found")
    return x


def public(x, now):
    x = with_live_score(x, now) if x["status"] == "waiting" else x
    out = {k: v for k, v in x.items() if k != "translations"}
    out["amount_usd"] = amount_usd((x.get("brief") or {}).get("Amount"))
    out["translated"] = sorted((x.get("translations") or {}).keys())
    out["calls"] = len((CALLERS.get(x["phone"]) or {}).get("calls", []))
    return out


@app.get("/api/board")
def board():
    now = time.time()
    day0 = time.mktime(time.localtime(now)[:3] + (0, 0, 0, 0, 0, -1))
    queued = [public(x, now) for x in queue()["items"]]
    in_progress = [public(x, now) for x in QUEUE if x["status"] == "in_progress"]
    done = sorted([public(x, now) for x in QUEUE if x["status"] == "done"], key=lambda x: -(x.get("doneAt") or 0))
    done_today = [x for x in done if (x.get("doneAt") or 0) >= day0]
    returning = sum(1 for x in done_today if x["trust"] == "recognized")
    total = len(done_today) * SETTINGS["baselineHoldMin"] + returning * SETTINGS["reexplainMin"]
    live = sorted(LIVE.values(), key=lambda x: x.get("startedAt", 0))
    return {"now": now, "queued": queued, "inProgress": in_progress, "done": done, "settings": SETTINGS, "live": live,
            "timeSaved": {"callers": len(done_today), "returningCallers": returning, "totalMin": total,
                          "baselineHoldMin": SETTINGS["baselineHoldMin"], "reexplainMin": SETTINGS["reexplainMin"]}}


@app.post("/api/queue/{item_id}/callback")
def callback(item_id: str, body: TakeIn):
    with LOCK:  # claim one specific caller
        x = find(item_id)
        if x["status"] != "waiting":
            raise HTTPException(409, f"{x.get('claimed_by') or 'Someone'} is already calling them")
        x["status"], x["claimed_by"], x["claimedAt"] = "in_progress", body.rep, time.time()
        save(QUEUE_FILE, QUEUE)
        return x


@app.post("/api/queue/{item_id}/release")
def release(item_id: str):
    with LOCK:  # cancel the callback; they keep their place (createdAt unchanged)
        x = find(item_id)
        x["status"], x["claimed_by"], x["claimedAt"] = "waiting", None, None
        save(QUEUE_FILE, QUEUE)
        return x


@app.post("/api/queue/{item_id}/reopen")
def reopen(item_id: str):
    with LOCK:
        x = find(item_id)
        x["status"], x["doneAt"], x["claimed_by"], x["claimedAt"] = "waiting", None, None, None
        save(QUEUE_FILE, QUEUE)
        return x


@app.get("/api/callers")
def callers():
    out = []
    for phone, c in CALLERS.items():
        items = [x for x in QUEUE if x["phone"] == phone]
        latest = max(items, key=lambda x: x["createdAt"]) if items else None
        out.append({"phone": phone, "name": c.get("name"), "calls": c.get("calls", []),
                    "saved": True, "tier": latest and latest["tier"], "status": latest and latest["status"]})
    known = set(CALLERS)
    for x in QUEUE:  # seed callers who never saved a profile
        if x["phone"] not in known:
            known.add(x["phone"])
            out.append({"phone": x["phone"], "name": x["name"], "saved": False, "tier": x["tier"], "status": x["status"],
                        "calls": [{"at": time.strftime("%Y-%m-%d %H:%M", time.localtime(x["createdAt"])),
                                   "summary": x["summary"], "duration_s": None}]})
    return {"callers": out}


@app.delete("/api/callers/{phone}")
def forget(phone: str):
    with LOCK:
        CALLERS.pop(phone, None)
        save(CALLERS_FILE, CALLERS)
    return {"ok": True}


class SettingsIn(BaseModel):
    company: Optional[str] = None
    repsOnShift: Optional[int] = None
    avgHandleMin: Optional[int] = None


@app.get("/api/settings")
def get_settings():
    return SETTINGS


@app.post("/api/settings")
def set_settings(body: SettingsIn):
    for k, v in body.dict().items():
        if v is not None:
            SETTINGS[k] = max(1, v) if isinstance(v, int) else v.strip() or SETTINGS[k]
    save(SETTINGS_FILE, SETTINGS)
    return SETTINGS


class AskIn(BaseModel):
    question: str
    history: list = []


ASSIST = (
    "You are Cue's dashboard assistant for a support rep. Answer from the QUEUE JSON only; never invent callers, "
    "amounts or facts. The score is urgency (a learned percentile from 60,000 real CFPB complaint outcomes, not an AI "
    "guess) + value (rule: +5 at $1k, +10 at $10k) + aging (rule: +1 per minute, cap 30). Callers are synthetic and "
    "recognized by phone number, never verified. Be brief: at most 4 short sentences or a short list. Plain text, no "
    "markdown headings."
)


@app.post("/api/assistant")
def assistant(body: AskIn):
    b = board()
    slim = [{"rank": x.get("position"), "name": x["name"], "status": x["status"], "tier": x["tier"], "score": x["score"],
             "headline": x["summary"], "amount": x["brief"].get("Amount"), "why": x.get("reasons"),
             "waited_min": x.get("minutes_waited"), "trust": x["trust"]}
            for x in b["queued"] + b["inProgress"] + b["done"][:10]]
    convo = "\n".join(f"{m.get('role')}: {m.get('text')}" for m in body.history[-6:])
    text = f"QUEUE:\n{json.dumps(slim)}\n\nCONVERSATION:\n{convo}\nuser: {body.question}"
    return {"answer": llm(ASSIST, text)}


# ===================== VAPI PHONE CALLS (paste at the very END of server.py) =====================
# Lets a real phone call to the Vapi number use this server mid-call:
#   lookup_caller -> returning caller? (caller ID)      triage_call -> classify + score + queue -> place in line
# Reuses the existing lookup_caller() and triage_call() functions above. Nothing else changes.
from fastapi import Request as _VapiRequest
from fastapi.concurrency import run_in_threadpool as _vapi_threadpool


VAPI_TRIAGED = set()  # Vapi call ids already queued through the triage_call tool


def _vapi_queue_hangup(msg, call):
    """Safety net: the caller hung up before triage_call ran. Queue them from the transcript."""
    if not call.get("id") or call.get("id") in VAPI_TRIAGED:
        return {"ok": True}
    msgs = (msg.get("artifact") or {}).get("messages") or msg.get("messages") or []
    turns = [{"speaker": "agent" if m.get("role") in ("bot", "assistant") else "caller", "text": m.get("message") or m.get("content") or ""}
             for m in msgs if m.get("role") in ("bot", "assistant", "user")]
    said = " ".join(t["text"] for t in turns if t["speaker"] == "caller").strip()
    if len(said.split()) < 4:  # nothing usable: a hang-up or a wrong number
        return {"ok": True}
    VAPI_TRIAGED.add(call["id"])
    phone = (call.get("customer") or {}).get("number") or "unknown"
    try:
        triage_call(TriageIn(phone=phone, answers={"caller said": said[:1500]}, transcript=turns))
    except Exception as e:
        print("vapi hang-up queue failed:", type(e).__name__, e)
    return {"ok": True}


VAPI_SECRET = os.environ.get("VAPI_SERVER_SECRET")
ASSISTANT_ID = os.environ.get("ASSISTANT_ID")
CALLS_PER_NUMBER_PER_DAY = int(os.environ.get("CALLS_PER_NUMBER_PER_DAY", "3"))
CALLS_PER_DAY = int(os.environ.get("CALLS_PER_DAY", "40"))


def _vapi_live(msg, call):
    cid = call.get("id")
    if not cid:
        return
    status = msg.get("status")
    if msg.get("type") == "status-update" and status in ("ringing", "queued", "in-progress"):
        phone = (call.get("customer") or {}).get("number") or "unknown"
        known = CALLERS.get(phone)
        LIVE.setdefault(cid, {"key": cid, "phone": phone, "name": (known or {}).get("name"), "known": bool(known),
                              "startedAt": time.time() * 1000, "stage": "listening"})
        STATE["dirty"] = True
    elif msg.get("type") == "end-of-call-report" or status == "ended":
        if LIVE.pop(cid, None) is not None:
            STATE["dirty"] = True
    for x in list(LIVE.values()):  # drop anything stuck for over 15 minutes
        if time.time() * 1000 - x.get("startedAt", 0) > 15 * 60 * 1000:
            LIVE.pop(x["key"], None)


@app.post("/vapi/tools")
async def vapi_tools(request: _VapiRequest):
    if VAPI_SECRET and request.headers.get("x-vapi-secret") != VAPI_SECRET:
        raise HTTPException(401, "bad secret")  # only Vapi may post call events
    body = await request.json()
    msg = body.get("message", {})
    call = msg.get("call") or {}
    kind = msg.get("type")
    if kind == "assistant-request":  # an inbound call is ringing: rate-limit before Vapi spends minutes
        phone = (call.get("customer") or {}).get("number") or "unknown"
        if not allow(f"calls:{phone}", CALLS_PER_NUMBER_PER_DAY, 86400):
            return {"error": "This number has reached today's demo call limit. Please try again tomorrow."}
        if not allow("calls:all", CALLS_PER_DAY, 86400):
            return {"error": "Cue's demo line has reached today's call limit. Please try again tomorrow."}
        return {"assistantId": ASSISTANT_ID}
    if kind in ("status-update", "end-of-call-report"):
        _vapi_live(msg, call)
    if kind == "end-of-call-report":
        return await _vapi_threadpool(_vapi_queue_hangup, msg, call)
    if kind != "tool-calls":
        return {"ok": True}
    phone = (call.get("customer") or {}).get("number") or "unknown"
    results = []
    for tc in msg.get("toolCallList") or msg.get("toolCalls") or []:
        fn = tc.get("function") or {}
        args = fn.get("arguments") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args or "{}")
            except Exception:
                args = {}
        try:
            if fn.get("name") == "lookup_caller":
                r = lookup_caller(LookupIn(phone=phone))
                if r.get("trust") == "recognized":
                    last = (r.get("last") or {}).get("summary", "")
                    out = {"trust": "recognized", "name": r.get("name"),
                           "say": f"Returning caller. Say: {r.get('greeting')} You can mention their last call was about: {last}."}
                else:
                    out = {"trust": "new", "say": "New caller. Greet them normally."}
            elif fn.get("name") == "triage_call":
                answers = {"account": args.get("account_type", ""),
                           "specific": args.get("what_happened", ""),
                           "wrong": args.get("what_went_wrong", "")}
                extra = {k: args.get(k) for k in ("amount", "when", "tried", "wants", "best_time") if args.get(k)}
                transcript = [{"speaker": "caller", "text": f"{k}: {v}"} for k, v in {**answers, **extra}.items() if v]
                VAPI_TRIAGED.add(call.get("id"))
                if call.get("id") in LIVE:
                    LIVE[call["id"]].update(stage="scoring", name=args.get("caller_name") or LIVE[call["id"]].get("name"))
                r = await _vapi_threadpool(triage_call, TriageIn(
                    phone=phone, caller_name=args.get("caller_name") or None,
                    answers=answers, transcript=transcript))
                pos, eta = r["position"], r["eta_minutes"]
                if call.get("id") in LIVE:
                    LIVE[call["id"]].update(stage="queued", queuedAt=time.time() * 1000, tier=r["item"]["tier"], name=r["item"]["name"])
                out = {"position": pos, "eta_minutes": eta, "tier": r["item"]["tier"],
                       "say": f"Tell the caller they are number {pos} in line and a specialist should call back in about {eta} minutes. Callbacks go by urgency, not by who called first."}
            else:
                out = {"error": "unknown tool"}
        except Exception as e:
            print("vapi tool failed:", type(e).__name__, e)
            out = {"say": "Tell the caller they're in the callback line and a specialist will call back soon."}
        results.append({"toolCallId": tc.get("id"), "result": json.dumps(out)})
    return {"results": results}
# ===================== END VAPI PHONE CALLS =====================



# ---------------- shared state + rate limits (for Vercel's many short-lived instances) ----------------
from fastapi import Request as _Req
from fastapi.responses import JSONResponse as _JSON
from fastapi.concurrency import run_in_threadpool as _pool

VAPI_TRIAGED_KEY = "cue:triaged"
_MEM_RL = {}


def allow(key, limit, window):
    """Fixed-window counter: shared through Redis when configured, per instance otherwise."""
    bucket = f"rl:{key}:{int(time.time() // window)}"
    if REDIS_URL:
        try:
            n = redis("INCR", bucket)
            if n == 1:
                redis("EXPIRE", bucket, window)
            return n <= limit
        except Exception as e:
            print("rate limit check failed, allowing:", e)
            return True
    _MEM_RL[bucket] = _MEM_RL.get(bucket, 0) + 1
    return _MEM_RL[bucket] <= limit


def _pull():
    raw = redis("GET", "cue:state")
    if not raw:
        STATE["dirty"] = True  # first run: store the seeded queue
        return
    st = json.loads(raw)
    QUEUE[:] = st.get("queue", [])
    CALLERS.clear(); CALLERS.update(st.get("callers", {}))
    SETTINGS.update(st.get("settings", {}))
    LIVE.clear(); LIVE.update(st.get("live", {}))
    VAPI_TRIAGED.update(st.get("triaged", []))


def _push():
    redis("SET", "cue:state", json.dumps({"queue": QUEUE, "callers": CALLERS, "settings": SETTINGS, "live": LIVE,
                                          "triaged": list(VAPI_TRIAGED)[-200:]}))


# per-visitor limits on the endpoints that spend AI credits or reset the demo
WEB_LIMITS = {"/api/triage_call": (5, 3600), "/api/assistant": (20, 3600), "/api/translate": (30, 3600),
              "/api/reset": (10, 3600), "/api/settings": (20, 3600)}


@app.middleware("http")
async def _sync_and_limit(request: _Req, call_next):
    path = request.url.path
    if request.method == "POST" and not path.startswith("/vapi"):
        ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0].strip()
        for prefix, (limit, window) in WEB_LIMITS.items():
            if path.startswith(prefix) and not await _pool(allow, f"web:{prefix}:{ip}", limit, window):
                return _JSON({"detail": "Too many requests. Please wait a bit and try again."}, status_code=429)
    shared = REDIS_URL and (path.startswith("/api") or path.startswith("/vapi"))
    if shared:
        try:
            await _pool(_pull)
        except Exception as e:
            print("state pull failed:", e)
    response = await call_next(request)
    if shared and STATE["dirty"]:
        STATE["dirty"] = False
        try:
            await _pool(_push)
        except Exception as e:
            print("state push failed:", e)
    return response
