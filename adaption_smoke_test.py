"""Adaption smoke test for Cue briefs.

Setup (key stays in your shell, never in code or chat):
    pip install adaption
    export ADAPTION_API_KEY="..."   # from adaptionlabs.ai Settings -> API keys
    python adaption_smoke_test.py

Cost: deepseek-v4-flash is 0.045 credits per 1M input tokens and 0.14 per 1M
output tokens, so this whole test costs a tiny fraction of one credit.
"""

from adaption import Adaption

MODEL = "deepseek-v4-flash"

NARRATIVE = (
    "I disputed a $1,240 charge on my credit card in August after the merchant "
    "never shipped my order. The bank closed the dispute without explaining why "
    "and added late fees. I called twice and was told someone would call back. "
    "Nobody did. I need the charge and the fees reversed before my statement "
    "closes on the 28th. Mornings are best for me."
)

INSTRUCTIONS = (
    "You write callback briefs for a support rep. Use only facts stated by the "
    "caller; never invent details. Output exactly five lines:\n"
    "Headline: <one line>\n"
    "When: <when it happened>\n"
    "Tried: <what they already tried>\n"
    "Wants: <what they want>\n"
    "Best time: <best time to call back, or 'not stated'>"
)

import os
import subprocess
import sys

key = os.environ.get("ADAPTION_API_KEY", "").strip()
from_clipboard = False
if not key:
    # Fall back to the clipboard, but only if it looks like an Adaption key,
    # so unrelated clipboard contents are never sent anywhere.
    clip = subprocess.run(["pbpaste"], capture_output=True, text=True).stdout.strip()
    if clip.startswith("pt_") and " " not in clip and len(clip) < 200:
        key, from_clipboard = clip, True
    else:
        sys.exit(
            "No Adaption key found. Copy it from adaptionlabs.ai Settings -> "
            "API keys (it starts with pt_), then run this again."
        )

client = Adaption(api_key=key)
if from_clipboard:
    subprocess.run(["pbcopy"], input="", text=True)  # clear the key from the clipboard
    print("(Key read from clipboard; clipboard cleared.)")

brief = client.responses.create(
    model=MODEL, instructions=INSTRUCTIONS, input=NARRATIVE
).output_text
print("=== English brief ===\n" + brief)

for lang in ["Spanish", "Simplified Chinese", "Vietnamese"]:
    out = client.responses.create(
        model=MODEL,
        instructions=(
            f"Translate this brief fully into {lang}, including the five line "
            "labels and month names. Keep the five-line format. Copy every "
            "digit and dollar amount exactly (e.g. $1,240 stays $1,240)."
        ),
        input=brief,
    ).output_text
    print(f"\n=== {lang} ===\n{out}")

# Quick key-fact check, the same idea as the 50-narrative accuracy test.
facts = ["1,240", "August", "28"]
missing = [f for f in facts if f not in brief]
print("\nKey facts kept:", "all" if not missing else f"missing {missing}")
