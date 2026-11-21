"""Brief accuracy check: 50 real CFPB narratives -> Adaption deepseek-v4-flash briefs.

Narratives come from an older public CFPB snapshot (Hugging Face
BEE-spoke-data/consumer-finance-complaints) because the 2026 CFPB release no
longer includes narrative text.

Checks per brief:
  format_ok        6 labelled lines present
  amount_kept      the largest $ amount in the complaint appears in the brief
  amount_invented  brief contains a $ amount not in the complaint
  wants_faithful   LLM judge: 'Wants' line matches what the consumer asked for
  nothing_invented LLM judge: no facts beyond the complaint
Key: env ADAPTION_API_KEY, or clipboard if it starts with pt_ (then cleared).
"""
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
from adaption import Adaption

MODEL, N, WORKERS = "deepseek-v4-flash", 50, 10

key = os.environ.get("ADAPTION_API_KEY", "").strip()
if not key:
    clip = subprocess.run(["pbpaste"], capture_output=True, text=True).stdout.strip()
    if clip.startswith("pt_") and " " not in clip and len(clip) < 200:
        key = clip
        subprocess.run(["pbcopy"], input="", text=True)
        print("(Key read from clipboard; clipboard cleared.)")
    else:
        sys.exit("No Adaption key found. Copy it (starts with pt_) and run again.")
client = Adaption(api_key=key)

BRIEF = (
    "You write callback briefs for a support rep. Use only facts stated by the caller; "
    "never invent details. If something is not stated, write 'not stated'. Output exactly six lines:\n"
    "Headline: <one line>\nAmount: <the main dollar amount at stake, copied exactly, or 'not stated'>\n"
    "When: <when it happened>\nTried: <what they already tried>\n"
    "Wants: <what they want>\nBest time: <best time to call back, or 'not stated'>"
)
JUDGE = (
    "You are checking a support brief against the original complaint. Answer with JSON only: "
    '{"wants_faithful": true|false, "nothing_invented": true|false, "note": "<10 words>"}. '
    "wants_faithful = the Wants line matches what the consumer actually asks for (or 'not stated' "
    "when they ask for nothing specific). nothing_invented = every fact in the brief is supported "
    "by the complaint."
)
AMT = re.compile(r"\$\s?\{?\$?\s?([\d,]+(?:\.\d{1,2})?)")


def amounts(t):
    out = set()
    for m in AMT.findall(t or ""):
        try:
            out.add(round(float(m.replace(",", "")), 2))
        except ValueError:
            pass
    return out


def run(row):
    narr = row["Consumer complaint narrative"]
    try:
        brief = client.responses.create(model=MODEL, instructions=BRIEF, input=narr).output_text.strip()
        jtxt = client.responses.create(
            model=MODEL, instructions=JUDGE,
            input=f"COMPLAINT:\n{narr}\n\nBRIEF:\n{brief}").output_text
        j = json.loads(re.search(r"\{.*\}", jtxt, re.S).group(0))
    except Exception as e:  # keep going; count as failure
        return {"id": row["Complaint ID"], "error": str(e)[:120]}
    na, ba = amounts(narr), amounts(brief)
    labels = ["Headline:", "Amount:", "When:", "Tried:", "Wants:", "Best time:"]
    return {
        "id": row["Complaint ID"], "product": row["Product"],
        "format_ok": all(l in brief for l in labels),
        "has_amount": bool(na),
        "amount_kept": (max(na) in ba) if na else None,
        "amount_invented": bool(ba - na),
        "wants_faithful": bool(j.get("wants_faithful")),
        "nothing_invented": bool(j.get("nothing_invented")),
        "judge_note": j.get("note", ""), "brief": brief, "narrative": narr,
    }


rows = json.load(open("data/narratives_raw.json"))[:N]
with ThreadPoolExecutor(WORKERS) as ex:
    res = list(ex.map(run, rows))
df = pd.DataFrame(res)
df.to_csv("brief_check_results.csv", index=False)
ok = df[df.get("error").isna()] if "error" in df else df
amt = ok[ok["has_amount"] == True]
summary = {
    "briefs": int(len(ok)), "errors": int(len(df) - len(ok)),
    "format_ok": float(ok["format_ok"].mean()),
    "key_amount_kept": float(amt["amount_kept"].mean()) if len(amt) else None,
    "n_with_amount": int(len(amt)),
    "invented_amount_rate": float(ok["amount_invented"].mean()),
    "wants_faithful": float(ok["wants_faithful"].mean()),
    "nothing_invented": float(ok["nothing_invented"].mean()),
    "all_checks_pass": float((ok["format_ok"] & ~ok["amount_invented"] & ok["wants_faithful"]
                              & ok["nothing_invented"] & ok["amount_kept"].fillna(True).astype(bool)).mean()),
}
json.dump(summary, open("brief_check_summary.json", "w"), indent=1)
print(json.dumps(summary, indent=1))
