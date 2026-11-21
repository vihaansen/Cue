"""Rung x CFPB: which 3 intake questions matter, and does ranking beat first-come?

Target: needs_action = company closed with monetary/non-monetary relief, or
responded late. This is a STAND-IN for urgency, not urgency itself.

Outputs: charts/*.png, results.json, rung_scoring.json, fairness_*.csv
"""
import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.sparse import hstack
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder

SEED = 7
df = pd.read_csv("data/sample.csv", dtype=str)
y = df["needs_action"].astype(int).values

# ---- Candidate intake questions (structured fields; 2026 data has no narratives)
top_co = df["Company"].value_counts().index[:150]
Q = pd.DataFrame({
    "product": df["Product"].fillna("?"),
    "sub_product": df["Sub-product"].fillna("?"),
    "issue": df["Issue"].fillna("?"),
    "sub_issue": df["Sub-issue"].fillna("?"),
    "company": df["Company"].where(df["Company"].isin(top_co), "Other").fillna("Other"),
    "older_or_servicemember": df["Tags"].fillna("none"),
    "state": df["State"].fillna("?"),
})
LABEL = {
    "product": "What product is this about?",
    "sub_product": "What type of account exactly?",
    "issue": "What went wrong?",
    "sub_issue": "What specifically happened?",
    "company": "Which company is it?",
    "older_or_servicemember": "Are you 62+ or a servicemember?",
    "state": "What state are you in?",
}

# Rung serves ONE company's line, so "which company?" is constant there.
# Keep company only for the within-company evaluation, not as a question.
COMPANY = Q.pop("company")

idx = np.arange(len(df))
tr, te = train_test_split(idx, test_size=0.2, stratify=y, random_state=SEED)


def qmodel(cols):
    enc = ColumnTransformer([("oh", OneHotEncoder(handle_unknown="ignore", min_frequency=20), cols)])
    return make_pipeline(enc, LogisticRegression(max_iter=3000, C=0.5))


def cv_auc(cols):
    skf = StratifiedKFold(3, shuffle=True, random_state=SEED)
    X, yy = Q.iloc[tr], y[tr]
    s = []
    for a, b in skf.split(X, yy):
        m = qmodel(cols).fit(X.iloc[a], yy[a])
        s.append(roc_auc_score(yy[b], m.predict_proba(X.iloc[b])[:, 1]))
    return float(np.mean(s))


def test_auc(cols):
    m = qmodel(cols).fit(Q.iloc[tr], y[tr])
    p = m.predict_proba(Q.iloc[te])[:, 1]
    return roc_auc_score(y[te], p), m, p


# ---- Forward selection (chosen on train CV, reported on held-out test) ----
chosen, path, remaining = [], [], list(Q.columns)
while remaining:
    scores = {c: cv_auc(chosen + [c]) for c in remaining}
    best = max(scores, key=scores.get)
    chosen.append(best)
    remaining.remove(best)
    auc_t, _, _ = test_auc(chosen)
    path.append({"k": len(chosen), "added": best, "cv_auc": scores[best], "test_auc": auc_t})
    print(f"{len(chosen)}. +{best:24s} cv={scores[best]:.3f} test={auc_t:.3f}")

# ---- Full model: every intake field + company x issue/product crosses ----
F = Q.copy()
F["subproduct_x_issue"] = Q["sub_product"] + "|" + Q["issue"]
F["product_x_subissue"] = Q["product"] + "|" + Q["sub_issue"]
oh = OneHotEncoder(handle_unknown="ignore", min_frequency=20).fit(F.iloc[tr])
full = LogisticRegression(max_iter=4000, C=0.5).fit(oh.transform(F.iloc[tr]), y[tr])
p_full = full.predict_proba(oh.transform(F.iloc[te]))[:, 1]
auc_full = roc_auc_score(y[te], p_full)
print(f"full model (all fields + crosses) test AUC={auc_full:.3f}")

top3 = chosen[:3]
auc3, m3, p3 = test_auc(top3)
yt = y[te]
base = yt.mean()


def at_top(p, frac=0.2):
    k = int(round(frac * len(p)))
    flag = np.zeros(len(p), bool)
    flag[np.argsort(-p)[:k]] = True
    tp = (flag & (yt == 1)).sum()
    return {"precision": tp / k, "recall": tp / yt.sum(), "flagged_share": frac}


# ---- Queue simulation: learned vs first-come vs random --------------------
dates = pd.to_datetime(df["Date received"].iloc[te]).values
rng = np.random.default_rng(SEED)
orders = {
    "Rung (3 questions)": np.argsort(-p3, kind="stable"),
    "Rung (full model)": np.argsort(-p_full, kind="stable"),
    "First-come, first-served": np.argsort(dates, kind="stable"),
    "Random": rng.permutation(len(te)),
}
gains = {}
for name, o in orders.items():
    cum = np.cumsum(yt[o]) / yt.sum()
    gains[name] = cum
reach20 = {n: float(g[int(0.2 * len(g)) - 1]) for n, g in gains.items()}
auc_fcfs = roc_auc_score(yt, -dates.astype("int64"))  # earlier = higher priority

# ---- Charts ----------------------------------------------------------------
plt.rcParams.update({"font.size": 15, "axes.spines.top": False, "axes.spines.right": False})
import os

os.makedirs("charts", exist_ok=True)

ks = [r["k"] for r in path]
aucs = [r["test_auc"] for r in path]
fig, ax = plt.subplots(figsize=(11, 6.2))
ax.plot(ks, aucs, "o-", color="#2563eb", lw=3, ms=9, label="Intake questions only")
ax.axhline(auc_full, color="#16a34a", ls="--", lw=2, label=f"All 6 fields + interactions ({auc_full:.2f})")
ax.axhline(0.5, color="#9ca3af", ls=":", lw=2, label="Coin flip (0.50)")
ax.scatter([3], [auc3], s=380, facecolors="none", edgecolors="#dc2626", lw=3, zorder=5)
ax.annotate(f"3 questions: AUC {auc3:.2f}", (3, auc3), xytext=(3.6, auc3 - 0.045),
            color="#dc2626", fontsize=16, weight="bold")
ax.set_xticks(ks)
ax.set_xticklabels([f"{r['k']}\n+{r['added'].replace('_', ' ')}" for r in path], fontsize=10)
ax.set_ylabel("AUC on held-out complaints")
ax.set_title("Three questions get most of the signal", loc="left", weight="bold")
ax.legend(loc="lower right", fontsize=12, frameon=False)
ax.set_ylim(0.45, max(auc_full, max(aucs)) + 0.05)
fig.tight_layout()
fig.savefig("charts/chart1_auc_vs_questions.png", dpi=160)

fig, ax = plt.subplots(figsize=(11, 6.2))
x = np.arange(1, len(te) + 1) / len(te)
style = {"Rung (3 questions)": ("#dc2626", "-", 3.5), "Rung (full model)": ("#16a34a", "--", 2),
         "First-come, first-served": ("#6b7280", "-", 2.5), "Random": ("#9ca3af", ":", 2)}
for n, g in gains.items():
    c, ls, lw = style[n]
    ax.plot(x, g, color=c, ls=ls, lw=lw, label=f"{n}: {reach20[n]:.0%} reached")
ax.axvline(0.2, color="#111827", lw=1, alpha=0.4)
ax.text(0.205, 0.04, "first 20% of callbacks", fontsize=12, alpha=0.7)
ax.set_xlabel("Share of the queue called back")
ax.set_ylabel("Share of cases that needed action")
ax.set_title("Ranking reaches cases that need action sooner", loc="left", weight="bold")
ax.legend(loc="lower right", fontsize=12, frameon=False, title="In the first 20% of callbacks", title_fontsize=12)
ax.set_xlim(0, 1); ax.set_ylim(0, 1)
fig.tight_layout()
fig.savefig("charts/chart2_ranking_vs_fcfs.png", dpi=160)

# ---- Fairness audit --------------------------------------------------------
T = pd.DataFrame({"y": yt, "p3": p3, "pfull": p_full,
                  "state": df["State"].iloc[te].fillna("?").values,
                  "group": df["Tags"].iloc[te].fillna("No tag").values,
                  "via": df["Submitted via"].iloc[te].fillna("?").values})
cut3, cutf = np.quantile(p3, 0.8), np.quantile(p_full, 0.8)
T["flag3"], T["flagf"] = T["p3"] >= cut3, T["pfull"] >= cutf


def grp(g):
    pos = g[g["y"] == 1]
    return pd.Series({
        "n": len(g), "actual_rate": g["y"].mean(),
        "mean_score_3q": g["p3"].mean(), "mean_score_full": g["pfull"].mean(),
        "recall_top20_3q": pos["flag3"].mean() if len(pos) else np.nan,
        "recall_top20_full": pos["flagf"].mean() if len(pos) else np.nan,
    })


by_group = T.groupby("group").apply(grp).round(3).sort_values("n", ascending=False)
top_states = T["state"].value_counts().index[:10]
by_state = T[T["state"].isin(top_states)].groupby("state").apply(grp).round(3).sort_values("n", ascending=False)
by_via = T.groupby("via").apply(grp).round(3).sort_values("n", ascending=False)
by_group.to_csv("fairness_by_group.csv"); by_state.to_csv("fairness_by_state.csv"); by_via.to_csv("fairness_by_channel.csv")
print("\nFairness by group:\n", by_group.to_string())
print("\nFairness by state (top 10):\n", by_state.to_string())
print("\nFairness by channel:\n", by_via.to_string())

fig, ax = plt.subplots(figsize=(11, 6.2))
bg = by_group.reindex(["No tag", "Older American", "Servicemember", "Older American, Servicemember"]).dropna()
xi = np.arange(len(bg))
ax.bar(xi - 0.27, bg["actual_rate"], 0.27, color="#9ca3af", label="Actually needed action")
ax.bar(xi, bg["mean_score_3q"], 0.27, color="#dc2626", label="Score: 3 questions")
ax.bar(xi + 0.27, bg["mean_score_full"], 0.27, color="#2563eb", label="Score: all 6 fields (incl. 62+/servicemember)")
ax.set_xticks(xi); ax.set_xticklabels([f"{i}\n(n={int(n)})" for i, n in zip(bg.index, bg["n"])], fontsize=11)
ax.set_ylabel("Rate")
ax.set_title("3 questions under-rank older callers; asking age fixes it", loc="left", weight="bold")
ax.legend(frameon=False, fontsize=12, loc="upper right")
ax.set_ylim(0, 0.3)
fig.tight_layout()
fig.savefig("charts/chart3_fairness_older.png", dpi=160)

# ---- Export the 3-question scorer for Rung --------------------------------
enc = m3.named_steps["columntransformer"].named_transformers_["oh"]
lr = m3.named_steps["logisticregression"]
weights = {}
for name, w in zip(enc.get_feature_names_out(top3), lr.coef_[0]):
    q, a = "?", name
    for c in sorted(top3, key=len, reverse=True):
        if name.startswith(c + "_"):
            q, a = c, name[len(c) + 1:]
            break
    weights.setdefault(q, {})[a] = round(float(w), 4)
json.dump({
    "about": "Logistic score = sigmoid(intercept + sum of weights for each answer). "
             "Unknown answers add 0. 'infrequent_sklearn' = any rare answer.",
    "target": "needs_action (relief or late response), a stand-in for urgency",
    "questions": [{"key": c, "ask": LABEL[c]} for c in top3],
    "intercept": round(float(lr.intercept_[0]), 4),
    "weights": weights,
}, open("rung_scoring.json", "w"), indent=1)


# Within-company AUC: how well does the ranking sort ONE company's callers?
wc = pd.DataFrame({"co": COMPANY.iloc[te].values, "y": yt, "p": p3})
within = []
for co, g in wc.groupby("co"):
    if co != "Other" and len(g) >= 150 and 10 <= g["y"].sum() <= len(g) - 10:
        within.append({"company": co, "n": len(g), "rate": g["y"].mean(), "auc": roc_auc_score(g["y"], g["p"])})
within = pd.DataFrame(within).sort_values("n", ascending=False)
within.round(3).to_csv("within_company_auc.csv", index=False)
print("\nWithin-company AUC (3 questions):\n", within.head(12).round(3).to_string(index=False))
print("median within-company AUC:", round(within["auc"].median(), 3), "over", len(within), "companies")

res = {
    "rows": int(len(df)), "test_rows": int(len(te)), "base_rate": float(base),
    "selection_path": path, "top3": top3, "top3_questions": [LABEL[c] for c in top3],
    "auc_top3": float(auc3), "auc_full": float(auc_full), "auc_all_questions": float(aucs[-1]),
    "auc_fcfs": float(auc_fcfs), "share_of_full_auc_lift": float((auc3 - 0.5) / (auc_full - 0.5)),
    "top20_top3": at_top(p3), "top20_full": at_top(p_full),
    "reached_in_first_20pct": reach20,
    "within_company_auc_median": float(within["auc"].median()),
    "within_company_n": int(len(within)),
}
json.dump(res, open("results.json", "w"), indent=1, default=float)
print(json.dumps({k: res[k] for k in ["base_rate", "top3", "auc_top3", "auc_full", "auc_fcfs",
                                      "share_of_full_auc_lift", "top20_top3", "top20_full",
                                      "reached_in_first_20pct"]}, indent=1, default=float))
