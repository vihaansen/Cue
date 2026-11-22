# Cue × CFPB: findings (slide-ready)

## Data
- **Source:** CFPB Consumer Complaint Database, bulk file released Nov 21 2026 (public domain, CC0).
- **Sample:** 60,000 complaints received Nov 2024 – Sep 2026, 6,000 from each of 10 products. Excluded: credit reporting (10.3M of 11.5M complaints, mostly template filings) and cases still in progress.
- **Label `needs_action`:** the company closed the complaint with monetary or non-monetary relief, or responded late. Rate: **19.9%** (13.8% relief, 6.2% late). This is a **stand-in for urgency**, not urgency itself.
- **Surprise:** the 2026 release has **no complaint narratives** (the column is gone from both the bulk file and the API). So the model uses only the structured intake fields, which are what a phone agent can actually ask. Brief accuracy was tested on narratives from an older public CFPB snapshot.
- **Split:** 80/20 stratified. Questions were chosen with 3-fold cross-validation on the training set; every number below is from the held-out 12,000.

## Headline: the 3 questions that matter
Forward selection over 6 askable questions picked, in order:
1. **What type of account exactly?** (sub-product)
2. **What specifically happened?** (sub-issue)
3. **What went wrong?** (issue)

- 3 questions: **AUC 0.711**. All 6 fields plus interactions: **AUC 0.712**. **3 questions capture 99.5% of the full model's lift over a coin flip.**
- Adding product, age 62+/servicemember, or state adds **nothing** to AUC.

## Ranking vs first-come-first-served (chart 2)
| Order | Cases needing action reached in the first 20% of callbacks |
|---|---|
| Cue, 3 questions | **40%** |
| Random | 21% |
| First-come, first-served | 15% |

- **That is 2.7× first-come.** At the top 20%: precision 0.39 (vs a 0.20 base rate), recall 0.39.
- First-come does worse than random here (AUC 0.47) because older complaints in this window were slightly less likely to need action.

## Validation and limits (say these before a judge asks)
- **The label measures company behavior.** Which company it is predicts relief best (AUC 0.82 on its own), because some companies hand out relief far more often than others. Cue answers one company's line, so we left that question out. For a multi-company hotline (a legal-aid line, a consumer advocate), it would be question #1.
- **Within one company the lift is modest:** median AUC **0.60** across the 17 largest companies with at least 10 cases each way, ranging from 0.41 to 0.74. The big gains come from sorting *types* of problems. Fine-grained ranking inside one company would need that company's own callback outcomes, and every handled call creates exactly that label.
- **No narratives**, so tone, dollar amounts and deadlines aren't used. For a live Cue call they could be pulled from the transcript.

## Fairness audit (chart 3)
- **States:** the average score is within ±2 points of the actual rate for all 10 largest states.
- **Older Americans are under-ranked by the 3-question model:** average score 0.194 vs an actual rate of 0.222 (n=595). The 6-field model, which includes the 62+/servicemember flag, matches reality (0.221). **Recommendation:** keep the 62+ / servicemember flag as a fairness guard even though it doesn't raise AUC.
- **Phone filers** needed action more often (27%) than their scores suggest (21%), though n=399 is small. That's worth watching for a phone product.

## Brief accuracy (Adaption, deepseek-v4-flash)
50 real CFPB narratives (older public snapshot), checked automatically plus an LLM judge.

| Check | v1 (5-line brief) | v2 (+ Amount line) |
|---|---|---|
| Briefs scored | 50 | 49 (1 API error) |
| Correct format | 100% | 100% |
| Invented a dollar amount | **0%** | **0%** |
| Kept the key dollar amount (complaints that mention one) | 52% (of 23) | **77%** (of 22) |
| No invented facts (judge) | 96% | 98% |
| "Wants" line faithful (judge) | 94% | 88% |
| Passed every check | 72% | 76% |

Story: v1 dropped the dollar amount half the time because the format had no slot for it. Adding one raised that to 77%, with still zero invented amounts. The remaining weak spot is the "Wants" line: when a caller never says what they want, the model sometimes guesses. Next fix: force "not stated" there. These are small samples (about 50), and the LLM judge is itself a model, so treat ±5 points as noise.

## One-liners for slides
- "3 questions get 99.5% of what all our data can tell us."
- "In the first 20% of callbacks, Cue reaches 40% of the people who needed action. First-come reaches 15%."
- "Our audit found the 3 questions under-rank older callers, so Cue keeps one extra flag."
- "Limit: our label is whether the company granted relief, a stand-in for urgency. Inside one company the lift is modest (AUC 0.60), and that's why Cue learns from every call it handles."

## Q&A prep
- **"Isn't relief a weak stand-in for urgency?"** Yes, and here's how much it's driven by the company (0.82 from company alone). That's why we excluded company and report within-company AUC.
- **"Why 3 questions?"** Chart 1: the curve is flat after 3.
- **"Why not plain accuracy?"** 80% of complaints don't need action, so "never urgent" would score 80% accuracy. We report AUC, precision and recall.

## Files
- `charts/chart1_auc_vs_questions.png`, `charts/chart2_ranking_vs_fcfs.png`, `charts/chart3_fairness_older.png`
- `results.json` (all numbers), `scoring_3q_v1.json` (3-question weights for Cue's scorer)
- `fairness_by_group.csv`, `fairness_by_state.csv`, `fairness_by_channel.csv`, `within_company_auc.csv`
- `prep.py`, `model.py`, `brief_check.py`
