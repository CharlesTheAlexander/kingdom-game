# AUDIT_COMPLETE_REPORT.md

A 4-pass audit (code → visual → playtest → fix) of the deployed Bannerlord-style
game, performed against both the live site and a local DEV build (for instrumented
verification). Every fix below is committed, pushed, and confirmed in the deployed
`gh-pages` bundle.

## Master issue list (deduplicated, by severity)

| # | Sev | Issue | Status |
|---|-----|-------|--------|
| 1 | CRITICAL | **Continent felt frozen/unplayable** — 5 real-min/day + 9 tiles/day ⇒ party moved ~0.05 px/sec; "Day" never visibly changed; couldn't reach own settlement; ~14 h to cross the map | **FIXED** |
| 2 | CRITICAL | **Main-menu buttons unclickable** — interactive objects stuck in Phaser's input pending-insertion queue; hit-tests hit nothing; "click twice / nothing happens" on New Kingdom & all menu/panel controls | **FIXED** |
| 3 | HIGH | **Asymmetric canvas letterbox** — `#app` flex-centering stacked on Phaser `autoCenter`, shoving the canvas right (266px vs 89px bars) | **FIXED** |
| 4 | HIGH | **King-creation inputs misaligned** — HTML inputs window-centered while canvas was off-center; inputs overlapped their labels | **FIXED** (same root cause as #3) |
| 5 | LOW | Dead file `AudioManager.ts` (unimported) | **FIXED** (removed) |
| 6 | MEDIUM | Initial continent fog too dark/empty on first arrival | Open (loop) |
| 7 | LOW | Fresh-load menu renders dark ~1–2s before brightening (heavy backdrop warmup) | Open (loop) |
| 8 | LOW | Small HUD text at native res | Open |
| 9 | LOW | 1.9 MB / 538 KB-gzip single bundle (chunk-size warning) | Deferred |

No CRITICAL/HIGH issues remain open.

## Fixes applied (with verification)

1. **Continent pacing** (`ContinentScene.ts`): `DAY_MS 300000→10000`,
   `BASE_TILES_PER_DAY 9→100`, `DEFAULT_ZOOM 0.4→0.5`. Verified in-browser via the
   DEV `__gw` hook: party advanced ~46 tiles in 4 s (~22 screen-px/sec) and the day
   clock ticked at 10 s/day; fog reveals along the march.
2. **Menu input** (`MainMenuScene.ts`): replaced all per-object `setInteractive`
   with a deterministic scene-level click registry (`wireMenuInput`/`registerClick`/
   `hitClick`) driven by the scene-level pointer events that fire reliably. Covers the
   6 buttons, panel modal/close, Load slots, Settings toggles; volume slider →
   click-to-set. Root-caused by instrumentation (scene-level pointerdown fired but no
   `gameobjectdown`; force-flushing the pending queue made hit-tests resolve).
   Verified: one click on New Kingdom opens King Creation on DEV **and** live PROD.
3. **Canvas centering** (`style.css`): removed `#app` flex-centering so Phaser's
   `autoCenter` owns it. Verified symmetric (183/183) and the king-creation inputs now
   align with their labels.
4. **Dead code** (`AudioManager.ts` removed; IsometricScene comment updated).

## Why these weren't caught before
The 12-phase rebuild was verified almost entirely through DEV scene-hooks
(`scene.start('ContinentScene')`, headless `__gw` driving), which **bypass the main
menu and bypass real continuous-time play** — so a dead menu and an unplayably slow
clock both slipped through. Real browser play surfaced them immediately.

## Verification method notes
Instrumented verification used the local DEV build (exposes `__game`/`__gw`). Two
automation artifacts complicated UI testing and are NOT game bugs: (a) the screenshot
pixel space was scaled ~1.09× from CSS space after window resizes, so coordinate-based
clicks had to be taken from the rendered screenshot; (b) repeated DEV `scene.start/stop`
calls polluted scene state. Both were controlled for before drawing conclusions.

## State of the game after this session
The game is now **actually playable end-to-end**: the menu responds, you create a
ruler, and you travel a living, fog-shrouded 1500×1500 continent in continuous time,
entering atmospheric settlements to build. tsc + build clean; 0 console errors on boot.
Remaining open items (6–9) are polish, not blockers.
