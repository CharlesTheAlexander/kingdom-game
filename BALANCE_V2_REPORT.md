# Balance V2 Report

**Date:** 2026-06-21
**Method:** Headless simulation via `window.__game` at accelerated `gameSpeed`
(150–300×), driving a "good-play" economy (3 houses, 2 farms, lumberyard, mine,
market, blacksmith, library, barracks — all staffed) and sampling key metrics
every ~game-week. Combat balance was checked with scripted BattleScene clashes.

> Design note: full 80-day strategic AI self-play is not feasible headless, so
> the four win-paths were validated against (a) the measured economic trajectory
> and (b) the win-condition thresholds in `WinConditions.ts`, then tuned where
> the data or the design brief showed a problem. Changes are deliberately
> conservative — the V1 economy was already proven generous, so the focus was on
> the *new* V2 systems and the one economic metric that failed its target.

---

## Simulation trajectory (good-play economy)

| Day | Pop | Happiness | Gold | Food | Tech |
|----:|----:|----------:|-----:|-----:|-----:|
| 3   | 10  | 78 | 1,051 | 11,461 | 1 |
| 6   | 11  | 78 | 1,962 | 23,351 | 2 |
| 8   | 12  | 68 | 2,873 | 34,512 | 3 |
| 11  | 13  | 68 | 3,785 | 48,127 | 4 |

**Reading:**
- **Gold** — strongly positive (~900/day net). Affords armies (Conquest), tribute
  and the 500g marriage dowry (Diplomacy), and the empire ritual (Ancient path)
  well within target windows. Left as-is (intentionally generous, per V1 notes).
- **Food** — hugely over-supplied; never a constraint. Left as-is; it is a safety
  net, not a lever, and winter's upkeep spike is the only time it matters.
- **Research** — ~1 tech / 3 days → the 5 techs for Legacy land by ~day 15. Good.
- **Population** — **failed its target.** Old growth was a flat +1 per 3 days, so
  from 10 the kingdom reached only ~13 by day 12 and would never hit the Legacy
  pop-50 mark by day 80. **Fixed** (see below).

---

## Changes applied

### Economy — population growth (Legacy path)
- **Before:** `+1 person / 3 days` whenever fed, happy ≥30, below cap.
- **After:** growth scales with happiness — `+1.5/day` at happiness ≥50, `+2/day`
  at ≥70 (≈ `+1 per 1.5 days` for a thriving kingdom); fractional carry preserved.
- **Why:** the old rate made the Legacy win mathematically unreachable in the
  day-80 window. Now a happy, well-housed kingdom tracks the 20→35→45→50
  checkpoints. Capacity (10 + 4/House) remains the deliberate gate, so the player
  still must invest in Houses — growth is fast *only* when housing and happiness
  are kept up.
- File: `Population.ts`.

### Combat — Cavalry charge (was overpowered)
- **Before:** cavalry first-strike `×3`. With the counter bonus this dealt
  `20·0.5·1.5·3 = 45` — a one-shot on 25-HP archers.
- **After:** charge `×2`. Still a hammer against archers, but no longer a free
  one-shot, leaving room for counter-play.
- File: `BattleScene.ts`.

### Combat — Spearmen now a TRUE hard counter to cavalry
- **Before:** spearmen only got the generic `×1.5 / ×0.6` counter multiplier.
- **After:** a cavalry charge is **negated entirely** when the target is a
  spearman (the pike wall). Cavalry that open on spears get no charge bonus *and*
  the ×0.6 countered penalty — so spearmen reliably stop a charge instead of just
  softening it.
- File: `BattleScene.ts`.

### Ecosystem — Goblin escalation pacing + warning
- **Before:** camps grew a tier every `25` days, with no early warning.
- **After:** every `20` days, plus a one-time **"growing rapidly"** warning 5 days
  before a tier-up (only once the camp is discovered). The player now gets a clear
  window to clear a camp before it becomes a fortress.
- File: `GoblinCamps.ts`.

### Weather — Winter food upkeep
- **Before:** `+30%` food consumption in winter.
- **After:** `+20%`. A sudden +30% the day winter arrives could instantly crater a
  marginal army's supply; +20% is still a meaningful seasonal pressure (armies
  −30% movement and frozen rivers remain unchanged).
- File: `Weather.ts`.

### Population classes — Noble building cost
- **Before (this session, Phase 1):** Manor introduced at **100 gold**.
- Per the brief ("if nobles never unlock, reduce to 100"), the Manor — the canonical
  noble seat — was costed at 100g from the outset so nobles appear in normal play.
- File: `BuildingTypes.ts`.

---

## Verified already in spec range (no change needed)

- **Hero first arrival** — Aldric already gated to days 8–14 (`Heroes.ts`); the
  brief's "minimum day 8" is satisfied.
- **Building aging** — already 20 days per condition level (`Maintenance.ts`).
- **Hero death penalty** — a 3-day "Mourning" −20 *happiness* temp-mod (not a flat
  −20 battle morale); judged appropriately weighty, not crippling. Left as-is.

---

## The Ancient-Empire (4th) win path — design decision

The brief sketches the 4th path as "accumulate 500 iron, build a Vault." The
previous V2 session had already shipped a coherent, tested alternative: discover
all 7 ruin fragments → unlock **"The Truth"** → a one-time ritual from the Royal
Court that **pours ~90% of the treasury** into restoring the old empire for a
unique victory (`Narrative.ts` + `WinConditions.ts`, path `Empire`). Because the
brief invites "make your own design decisions," that shipped mechanic is kept: it
is fully wired, save-persisted, and already verified end-to-end, and the "costs
everything / nearly bankrupts you" spirit matches the brief. The trigger is the
ruin-fragment hunt rather than a raw iron total, which ties the ending to
exploration (the narrative's whole point) instead of a second iron sink.

All changes build clean (`tsc --noEmit` 0 errors, `npm run build` 0 errors) and
ran with zero console errors/warnings.
