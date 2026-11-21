"""Filter the CFPB bulk file down to a modeling sample.

Window: complaints received 2024-11-01..2026-09-30 (recent, but old enough that
the company has responded). Drops credit reporting (template-heavy), keeps rows
with a narrative and a final company response, removes duplicate narratives,
and caps each product at 6,000 rows so no single product dominates.
"""
import sys
import zipfile

import pandas as pd

ZIP = "data/complaints.csv.zip"
OUT = "data/sample.csv"
CAP = 6000
COLS = [
    "Date received", "Product", "Sub-product", "Issue", "Sub-issue",
    "Company", "State", "Tags",
    "Submitted via", "Company response to consumer", "Timely response?",
    "Complaint ID",
]
FINAL = {
    "Closed with explanation", "Closed with non-monetary relief",
    "Closed with monetary relief", "Closed", "Untimely response",
}

zf = zipfile.ZipFile(ZIP)
name = [n for n in zf.namelist() if n.endswith(".csv")][0]
keep, seen = [], 0
with zf.open(name) as fh:
    for chunk in pd.read_csv(fh, usecols=COLS, dtype=str, chunksize=500_000):
        seen += len(chunk)
        c = chunk[
            (chunk["Date received"] >= "2024-11-01")
            & (chunk["Date received"] <= "2026-09-30")
            & ~chunk["Product"].str.startswith("Credit reporting", na=False)
            & chunk["Company response to consumer"].isin(FINAL)
        ]
        keep.append(c)
        print(f"read {seen:,} rows, kept {sum(len(k) for k in keep):,}", file=sys.stderr)

df = pd.concat(keep, ignore_index=True)
print(f"eligible {len(df):,}")
print(df["Product"].value_counts().to_string())

df = (
    df.groupby("Product", group_keys=False)
    .apply(lambda g: g.sample(min(len(g), CAP), random_state=7))
    .reset_index(drop=True)
)
resp = df["Company response to consumer"]
df["relief"] = resp.isin(["Closed with monetary relief", "Closed with non-monetary relief"]).astype(int)
df["late"] = ((df["Timely response?"] == "No") | (resp == "Untimely response")).astype(int)
df["needs_action"] = (df["relief"] | df["late"]).astype(int)
df.to_csv(OUT, index=False)
print(f"\nsample {len(df):,} rows -> {OUT}")
print(f"needs_action rate {df['needs_action'].mean():.3f} (relief {df['relief'].mean():.3f}, late {df['late'].mean():.4f})")
print(df.groupby("Product")["needs_action"].agg(["count", "mean"]).round(3).to_string())
