# Loop 1 Report

## STEP 1 — PLAY (headless, day-stepped + 12s real-time burst at 3x)
Exercised economy, army, research, diplomacy (tribute/war/ceasefire), world events,
wandering factions (caravan trade + tribe envoy), ruins (discover/explore/reward),
win conditions, and a save→load round-trip.

**Console: CLEAN. Build: passes. FPS: ~38 at 3x.**

Findings:
- All major systems function correctly. No CRITICAL or HIGH issues found.
- Caravan-trade "−100 gold" in the raw probe was a test-script artifact (the script
  overwrote gold before measuring); the trade itself adds gold correctly.
- Genuine gap: no on-screen feedback for victory progress.

## STEP 2 — FIX
- (Pre-loop) Added a **Conquest progress indicator** to the Diplomacy panel:
  "Conquest: X/total (need N to win)", green once the 75% threshold is met.
- No other fixes required — the build is healthy.

## STEP 3 — IMPROVE — Feature #1: In-battle unit box-select ✅
- Drag a rectangle on the battlefield to select specific player units; a cyan ring
  marks each selected unit and follows it.
- Command-bar orders (Charge/Hold/Flank L/R/Retreat) now apply ONLY to the
  selection; an empty selection still commands the whole army.
- Click empty ground to deselect. Rings clean up on unit death and battle end.
- Verified: selecting 5 of 7 units and issuing FLANK L flanked exactly those 5;
  the 2 unselected archers were untouched. Console clean.

Crossed off list item #1. Next loop: #2 (battlefield terrain bonuses).
