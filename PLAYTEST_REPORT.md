# PLAYTEST_REPORT.md — hands-on play pass

Played the real game in Chrome (live PROD + local DEV for instrumentation),
menu → king creation → continent → settlement → building panel. This doubled as
the "blind playtester" pass; findings below are what actually happened, in order.

## Narrative

**Boot → menu.** Title screen reads well (gold "KINGDOM", dusk backdrop). First
friction: clicked **New Kingdom and nothing happened.** Clicked again — still
nothing. This is the worst possible first impression: the primary button felt
dead. (Root-caused and fixed — see issue #1.)

**King creation.** Once past the menu: clean screen, 6 legible trait cards, name
fields, Begin turns green when valid — good affordance. One visual wart: the name
input boxes sat left of their labels and overlapped them (fixed — same root cause
as the canvas-centering issue).

**Continent (the main game).** Landed on the continent and… it looked **broken/
frozen.** Clicked to move my party and nothing visibly moved; the "Day 1" counter
never changed. It felt like the game had hung. I could not even reach my own
starting settlement. (This was the single most damaging problem — see issue #2.)
After the fix, the same screen is night-and-day: the party visibly marches along
its route, fog peels back to reveal grass/rivers/biomes, and the day counter
ticks — it finally feels like a living world you travel.

**Settlement.** Entering a settlement (after the pacing fix made it reachable)
is a highlight: a polished isometric castle with resource nodes, sheep, a river,
**live rain/cloud/sun weather**, a clear HUD and category bar, a "Leave
Settlement" button. Clicking the **Castle** category opened a working panel
(Keep HP, Reinforce, Invest, Upgrade→Medium Village). This part feels good.

## Bugs found (severity)

1. **MAJOR — main-menu buttons unclickable / needed repeated clicks.** New
   Kingdom (and the rest) silently swallowed clicks. Root cause: Phaser left the
   menu's interactive objects in its input pending-insertion queue, so hit-tests
   ran against an empty list. **FIXED** (scene-level click dispatch). Verified: one
   click now opens King Creation on both DEV and live PROD.
2. **MAJOR — continent felt frozen; party wouldn't move, day wouldn't advance.**
   Pacing constants (5 real-min/day, 9 tiles/day) made motion ~0.05 px/sec.
   **FIXED** (10s/day, 100 tiles/day, zoom 0.5). Verified: party moves ~22 px/sec.
3. **MINOR — king-creation name inputs misaligned/overlapping labels.** **FIXED**
   via the canvas-centering fix.
4. **MINOR — asymmetric black bars** around the canvas. **FIXED** (centering).

## UX issues (severity)

- **FRUSTRATING — initial continent fog is very dark/empty.** On first arrival the
  revealed area is tiny, so the world reads as an empty void until you travel.
  Open (loop candidate): larger starting reveal / slightly lighter fog.
- **MINOR — fresh-load menu renders dark for ~1–2s** before brightening (heavy
  backdrop: ~960 iso tiles + particles warming up). Open.
- **MINOR — HUD text is small** at native resolution. Open.

## Verdict
After the two MAJOR fixes the game crosses the line from "looks broken" to
"genuinely playable and atmospheric." Best moment: watching the party march across
the fog-shrouded continent and entering the rainswept castle. Worst moment (pre-fix):
the dead New Kingdom button + the frozen continent — both now resolved.
Would I keep playing? After the fixes — yes.
