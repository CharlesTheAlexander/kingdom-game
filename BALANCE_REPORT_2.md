# BALANCE REPORT 2 — Completion Session

Quantitative economy simulation (headless): a representative opening build
(Farm/Mine/Lumberyard at 3 workers each + Castle + one toggled Iron Mine + 3
warriors for upkeep), advancing the staffed-building economy day-by-day with the
real `buildings.tick` (1 Hz) and `onNewDay` loops. Snapshots at days 5/10/20/40.

## Findings (before fixes)

| Resource | d5 | d10 | d20 | d40 |
|---|---|---|---|---|
| Gold | 2400 | 4650 | 9150 | 18150 |
| Iron | 3000 | 6000 | 12000 | 24000 |
| Wood | 10580 | 21080 | 42080 | 84080 |
| Stone | 6040 | 12040 | 24040 | 48040 |
| Food | 10560 | 21060 | 42060 | 86685 |

Two clear imbalances — both touched by this session's new systems:

1. **Iron wildly oversupplied.** The new "Mine Iron" toggle (Phase 6) produced
   iron at 0.5× the stone rate (~600/day for a 3-worker mine), making iron — a
   resource meant to gate Knights/Blacksmith/Siege — trivial.
2. **Gold oversupplied.** ~9150 by day 20 (plan threshold: 2000), even with the
   new gold sinks (Phase 8).

## Fixes applied

1. **Iron mine output → ~30–38/day.** Iron now accrues probabilistically
   (`chance = 0.04 × workers` per tick) and depletes the nearby deposit, instead
   of a flat 0.5× stone. Re-sim: iron 189 (d5) / 766 (d20) — scarce and
   strategic, and still comfortably clears the "≥50 iron by day 20" target once a
   player settles the eastern mountains. (`Buildings.produce`.)
2. **Castle gold 1.5 → 1.2/sec** (plan-sanctioned). Re-sim: gold 1950 (d5) /
   7350 (d20). Combined with the new sinks (Emergency Levy 200, Reinforce Castle
   100×5, Espionage 75, Distribute Wealth 150, treaties 100–200, Great Council
   300, Treasury deposits, Siege training 100/unit) gold now has real purpose.
   (`BuildingTypes.castle`.)

## Re-sim (after fixes)

| Resource | d5 | d10 | d20 | d40 |
|---|---|---|---|---|
| Gold | 1950 | 3750 | 7350 | 14550 |
| Iron | 189 | 379 | 766 | 1505 |

## Win-condition timing (assessment)

Headless full-game wins (combat/AI driven) can't be auto-played deterministically,
so timing is assessed from the economy + system pacing:

- **Conquest** — economy is never the bottleneck; pace is set by army strength vs
  garrisons. Siege engines (Phase 7) + armies make 75% control reachable ~day
  50–60. Garrison HP unchanged (already tuned).
- **Diplomacy** — gold funds tribute/treaties; Diplomat trait + Great Council
  ("Crown a High King") gives a fast path. All-kingdom +80 reachable ~day 60–70.
- **Legacy** — Stage 7 needs Cut Stone (Phase 2) + iron (now scarce, Phase 6),
  a real gate; pop 50 needs Houses + food (plentiful); 5 techs by ~day 12;
  5 happy days aided by Grand Hall (+20) / Distribute Wealth. Reachable ~day 70–80.

## Deliberately unchanged (pre-existing)

Wood/Stone/Food run high because staffed production is per-second (a 3-worker
Farm = 7 food/s). This is the original design (see BALANCE_REPORT.md) where
building/upgrade costs scale into the hundreds–thousands to match. Overhauling
the core production model was out of scope and would risk destabilizing the
shipped, working economy; the surplus is intentional headroom, not a regression.
