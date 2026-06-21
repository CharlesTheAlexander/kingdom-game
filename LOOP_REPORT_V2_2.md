# Loop Report V2 — Iteration 2

## STEP 1 — PLAY
Continued from iteration 1's clean playthrough (no outstanding bugs). Spot-checked
the new sound + battle-atmosphere code under a cavalry/rain/victory battle — clean.

## STEP 3 — IMPROVE

### #7 Minimap improvements
The bottom-right minimap now surfaces live threats and assets:
- **Goblin camps** are coloured by escalation tier — green (camp) → orange (large)
  → red (fortress) — so a growing menace is visible at a glance.
- **Buildings on fire** appear as orange dots.
- **Heroes** assigned to armies show as small gold stars at their army's position.

File: `IsometricScene.ts` (`updateMinimap`).

### #10 Statistics panel V2
Added a **LEGENDS / LEGACY** band to the Kingdom Statistics panel tracking the new
systems: heroes recruited, heroes lost, spies sent, spies caught, buildings burned,
dragons faced, royal marriages, advisors defected. Counters are incremented from
the source systems via `KingdomStats.note()` and persist through save/load.

Files: `KingdomStats.ts` (new counters), `Heroes.ts`, `Espionage.ts`,
`Maintenance.ts`, `Succession.ts`, `RoyalCourt.ts` (note calls),
`IsometricScene.ts` (panel section).

## STEP 4 — VERIFY
`tsc --noEmit` 0 errors · `npm run build` clean · headless verification confirmed
the counters increment, the minimap markers draw, and the stats panel renders
(95 elements) with **zero console errors**.
