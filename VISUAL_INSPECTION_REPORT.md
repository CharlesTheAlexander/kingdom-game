# VISUAL_INSPECTION_REPORT.md — Agent 2 (Visual Inspector)

Method: real browser (Claude in Chrome), live PROD site + local DEV build for
instrumented verification. Window 1470×690. Screenshots + canvas/DOM measurement
+ console capture.

## Screen-by-screen

### Screen 1 — Main Menu — **GOOD → EXCELLENT (after fix)**
- Gold serif "KINGDOM / A REALM TO FORGE" title with glow; drifting dust + clouds +
  a faint iso terrain band; six wood/gold tablet buttons (New Kingdom, Continue,
  Load Game, Watch Intro, Settings, Credits). Readable, atmospheric, professional.
- **ISSUE (FIXED) — asymmetric letterbox.** Canvas (1440×900, 16:10) FIT-scaled but
  **double-centered**: `#app{display:flex;justify-content:center}` *and* Phaser
  `autoCenter:CENTER_BOTH` both ran, shoving the canvas right (left bar 266px / right
  bar 89px). Fixed by removing the CSS flex-centering → now symmetric (183/183).
  Remaining bars are inherent FIT letterbox in an ultra-wide window and are dark-navy
  (`#0f0f1a`, blends). On a 16:9 display they shrink.

### Screen 2 — King Creation — **GOOD (one fixed alignment bug)**
- "FOUND YOUR KINGDOM", two HTML name inputs, 6 readable trait cards (Warlord,
  Merchant, Builder, Diplomat, Explorer, Scholar) each with clear effects, Begin
  button. Selecting a trait gold-outlines the card; a valid form turns **Begin green**
  (good affordance).
- **ISSUE (FIXED) — HTML inputs misaligned with canvas labels.** The DOM `<input>`s are
  window-centered while the canvas form was canvas-centered (the off-center canvas), so
  inputs sat ~85px left of their "Kingdom Name"/"Ruler" labels and overlapped them. The
  Screen-1 centering fix resolves this too (canvas center now == window center).

### Screen 3 — Intro Cutscene — **N/A this run**
- Skipped (the browser already had `kingdom_intro_seen`). Replayable via Watch Intro
  (verified present). Not re-inspected this pass.

### Screen 4 — Continent Map (PRIMARY) — **BROKEN → GOOD (after the headline fix)**
- **CRITICAL (FIXED) — the world felt frozen/unplayable.** Pacing constants made the
  continent uninteractable: `DAY_MS=300000` (5 real min per in-game day) and
  `BASE_TILES_PER_DAY=9` at `PX_PER_TILE=4`, zoom `0.4` ⇒ the party moved **~0.05
  screen-px/sec**. A move order advanced the party ~0.4px in 8s and "Day 1" never
  changed — it looked broken, and you literally could not walk to your own capital
  (the party and settlement are not co-located). Crossing the 1500-tile world would
  have taken ~14 real hours.
  - **Fix:** `DAY_MS=10000` (10s/day), `BASE_TILES_PER_DAY=100`, `DEFAULT_ZOOM=0.5`.
    Verified on the DEV build via `__gw`: party covers ~46 tiles in 4s (~22 screen-px/
    sec, a visible glide); the day clock ticks (1.0→4 in the test); fog lifts along the
    march revealing grass/river/biomes. **This single change makes the game playable.**
- What works well: minimap (top-right inset) shows a richly varied world (water/forest/
  plains/mountains) with a live camera-viewport box; A* move orders draw a gold route +
  an "Arrive in ~N days" ETA; right-click cancels; HUD reads
  `Valoria · 1 settlement | Day N | Season | Biome | Supply · Army · Gold`; right-side
  action stack (Menu/Expeditions/Heroes/Diplomacy/Realm).
- **MEDIUM (open) — initial fog is very dark/empty.** Before you move, only a small
  radius is revealed, so first load reads as a murky void. Candidate: a larger starting
  reveal or slightly lighter fog. Deferred to the loop.
- **LOW (open) — HUD text is small** at native res; legible but could scale up.

### Screen 5/6/7 (settlement view, building panels, research tree) — **NOT REACHED**
- Blocked this pass by the Screen-4 pacing bug (couldn't walk to the settlement).
  Now unblocked by the fix; to be inspected in the playtest/loop passes.

### Screens 8–11 (continent parchment tab, battle, council, night/weather) — **deferred**
- Not reached this pass; queued for the loop now that traversal works.

## Console
- Clean on boot (0 errors / 0 warnings), consistent with the prior live-boot check.

## Top issues ranked by impact
1. **CRITICAL — continent frozen-slow pacing** → FIXED (the headline fix).
2. **HIGH — asymmetric letterbox (double-centering)** → FIXED.
3. **HIGH — King-Creation input/label misalignment** → FIXED (same root cause).
4. **MEDIUM — initial fog too dark/empty** → open (loop).
5. **LOW — small HUD text** → open.
6. **WATCH — menu button click flaky under automation.** Under synthetic/CDP clicking,
   the menu buttons' object-level hit-test intermittently misses (Phaser `hitTestPointer`
   returned empty despite correct geometry/registration); `newKingdom()` direct works and
   the deployed site reached every screen, so this is most likely an automation/DEV-instance
   artifact, not a real-user bug. To be re-confirmed on a fresh PROD load.

## What's genuinely impressive
The procedural world (varied biomes + rivers on the minimap), the cohesive parchment/wood
art language across menu→creation→HUD, the route+ETA travel affordance, and — once paced
correctly — a party that visibly marches across a living, fog-shrouded continent.
