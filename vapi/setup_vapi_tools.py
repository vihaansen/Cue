"""Connect the Vapi assistant + phone number to this server's /vapi/tools endpoint.

    python setup_vapi_tools.py https://YOUR-TUNNEL-URL

Needs these in the environment or a .env file next to this script (never printed):
    VAPI_API_KEY, ASSISTANT_ID, VAPI_PHONE_NUMBER_ID
Keeps the assistant's existing voice and transcriber. Rerun whenever the tunnel URL changes.
"""
import json, os, sys, urllib.request
from pathlib import Path

for envf in (Path(__file__).parent / ".env", Path(__file__).parent.parent / ".env"):
    if envf.exists():
        for line in envf.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))

if len(sys.argv) < 2 or not sys.argv[1].startswith("https://"):
    sys.exit("Usage: python setup_vapi_tools.py https://YOUR-TUNNEL-URL")
URL = sys.argv[1].rstrip("/") + "/vapi/tools"
KEY, AID, PID = os.environ["VAPI_API_KEY"], os.environ["ASSISTANT_ID"], os.environ.get("VAPI_PHONE_NUMBER_ID")
SECRET = os.environ.get("VAPI_SERVER_SECRET")  # sent as X-Vapi-Secret so only Vapi can post to the server
SERVER = {"url": URL, "timeoutSeconds": 20, **({"headers": {"x-vapi-secret": SECRET}} if SECRET else {})}
COMPANY = os.environ.get("COMPANY_NAME", "Bank of Bridgegood")

SYSTEM = f"""You are Cue, the AI assistant on {COMPANY}'s support line. Nobody waits on hold: you understand the problem once and place the caller in a callback line ranked by urgency. The whole call should take about one minute.

HOW TO RUN THE CALL
1. Call lookup_caller once, silently, as soon as the caller first speaks. If they are recognized, use their first name and do not ask for their name.
2. Let them explain. Then work out these three things from what they ALREADY said:
   - account_type: checking, savings, credit card, debit card, mortgage, auto loan, student loan, personal loan, money transfer, or other. "My card" with a disputed charge means credit card unless they say debit.
   - what_happened: the specific event in their words, with any amount and date (for example "a $4,000 charge I didn't make, 20 minutes ago").
   - what_went_wrong: the kind of problem (for example "unauthorized charge", "money not received", "can't access account", "fee I didn't expect").
   One clear sentence from the caller often answers all three. Never ask a question whose answer is already clear or obvious. Never ask what happened and what went wrong as two separate questions. Never ask what they tried, what they want, or when to call back.
3. Ask ONLY for what is truly missing, one short question at a time, at most two follow-up questions in total. If the account type is unclear, ask "Is that a checking account, a credit card, or something else?"
4. New callers only: ask once, "Can I get your first and last name?" If they would rather not, carry on.
5. As soon as you have the three things (and the name, if new), say "Thanks, one moment while I place you in line." and call triage_call. Include amount, when, wants or best_time only if the caller volunteered them.
6. Tell the caller what the tool result says: their number in line and the wait in minutes, word for word. Say goodbye once and end the call.

STYLE
- Short, calm sentences. One question per turn. Never read out lists of examples.
- Acknowledge in a few words at most ("Got it." / "I'm sorry, that's stressful."). Don't repeat the caller's words back to them.
- Do not read the facts back for confirmation unless something was unclear.
- If they are upset, one sentence of empathy, then keep going.
RULES
- Never ask for card numbers, account numbers, PINs, passwords or Social Security numbers. If they start reading one, say you don't need it.
- Never promise a refund or outcome. No legal or financial advice. Emergencies: tell them to call 911.
- If a tool fails, tell them they're in the callback line and a specialist will call back soon.
- Reply in the caller's language if they switch."""

S = lambda d: {"type": "string", "description": d}
TOOLS = [
    {"type": "function",
     "function": {"name": "lookup_caller",
                  "description": "Check whether the caller has called before (uses caller ID). Call once, silently, when the caller first speaks.",
                  "parameters": {"type": "object", "properties": {}}},
     "server": {**SERVER, "timeoutSeconds": 10},
     "messages": [{"type": "request-start", "content": ""}]},
    {"type": "function",
     "function": {"name": "triage_call",
                  "description": "Place the caller in the ranked callback queue as soon as account_type, what_happened and what_went_wrong are known (inferred from what the caller said). Returns their place in line and the estimated wait.",
                  "parameters": {"type": "object", "required": ["account_type", "what_happened", "what_went_wrong"], "properties": {
                      "caller_name": S("Caller's full name"),
                      "account_type": S("Answer to question 1: what type of account is this?"),
                      "what_happened": S("Answer to question 2: what specifically happened?"),
                      "what_went_wrong": S("Answer to question 3: what went wrong?"),
                      "amount": S("Dollar amount mentioned, copied exactly"),
                      "when": S("When it happened"), "tried": S("What they already tried"),
                      "wants": S("What they want done"), "best_time": S("Best time to call back")}}},
     "server": {**SERVER, "timeoutSeconds": 45},
     "messages": [{"type": "request-start", "content": ""}]},
    {"type": "endCall"},
]


def api(method, path, body=None):
    req = urllib.request.Request("https://api.vapi.ai" + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "User-Agent": "curl/8.7.1", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:600]


current = api("GET", f"/assistant/{AID}")[1]
model = current.get("model", {}) if isinstance(current, dict) else {}
model = {"provider": model.get("provider", "openai"), "model": model.get("model", "gpt-4o"),
         "messages": [{"role": "system", "content": SYSTEM}], "tools": TOOLS}
patch = {"model": model, "server": SERVER, "serverMessages": ["tool-calls", "end-of-call-report", "status-update"],
         "maxDurationSeconds": 180,  # free plan: cap every call at 3 minutes
         "firstMessage": f"Thanks for calling {COMPANY}. I'm Cue, an AI assistant, and this call may be recorded. What's going on today?",
         "firstMessageMode": "assistant-speaks-first"}
code, res = api("PATCH", f"/assistant/{AID}", patch)
if code >= 300:
    print(f"First try failed ({code}): {res}\nRetrying with fewer fields…")
    for t in TOOLS:
        t.pop("messages", None)
    patch.pop("serverMessages", None)
    code, res = api("PATCH", f"/assistant/{AID}", patch)
print("✓ Assistant updated (prompt, 3 questions, 2 tools)" if code < 300 else f"✗ Assistant update failed ({code}): {res}")
if PID:
    # no fixed assistant: Vapi asks the server first (assistant-request), so it can turn away calls over the daily limit
    code, res = api("PATCH", f"/phone-number/{PID}", {"assistantId": None, "server": SERVER})
    print("✓ Phone number asks the server before answering (rate-limited)" if code < 300 else f"✗ Phone number update failed ({code}): {res}")
    num = api("GET", f"/phone-number/{PID}")[1]
    if isinstance(num, dict) and num.get("number"):
        print(f"\n📞 Call {num['number']} to test.")
print(f"Tools point at: {URL}")
