# KINGDOM GAME — CRITIC & UX REPORT

*Played headless from a cold start. No prior knowledge assumed. Brutally honest, as requested.*

The game is **technically impressive and feature-complete** — there is genuinely a lot here (workers, territory/fog, a huge biome map, expeditions, three AI kingdoms, a battle scene, 9 settlement stages, diplomacy, caravans, administrators). The problem is the opposite of most prototypes: it has too many systems and not enough *presentation, onboarding, or visual identity* to make any of them land. Right now it reads as **a powerful strategy engine wearing a programmer-art skin**, not a finished game — and definitely not the warm, intimate Stardew-inspired world the design doc promises.

---

## FIRST IMPRESSION

**What it looks like on load:** A dark, almost-black screen. ~90% of it is fog of war. In the dead center is a small lit diamond of grass with a tiny castle, ringed by a glowing cyan grid. On top sits a modal: *"Welcome to your Kingdom."* It looks like a **4X strategy prototype**, not a cozy village builder.

**Is the genre clear?** Yes — clearly a top-down/isometric kingdom-management/strategy game. That part lands.

**Does the tutorial teach what you need?** No. The welcome modal is a static wall of 4 bullet points, and it is **out of date and partly wrong**:
- It says *"Upgrade your settlement from Village → Town → Castle"* — but the game now has **9 stages** ("Medium Village," "Large Town," etc.). The first time the player sees "Medium Village" the tutorial has already lied to them.
- Bullet 1 says *"Build Houses to get workers, then assign workers to Lumberyards and Mines to gather resources."* But the game has **idle workers that auto-gather** from day one. So the tutorial tells you to do work the game already does for you.
- It mentions nothing about: the **continent view (Tab)**, expeditions, territory/fog, combat orders, or any of the late-game systems (battles, diplomacy, caravans).

**Worst part of the first 60 seconds:** Right after you dismiss the modal, a hint banner reads *"Assign workers to buildings to start producing resources"* — yet the resource numbers are **already ticking up on their own** (the idle workers). A new player is immediately told to do something pointless, while the actual opening mechanic (auto-gathering, exploring, fog) goes unexplained. There is no "do this first" guidance; you're dropped into a busy HUD and left to click around.

---

## VISUAL QUALITY

**Finished game or prototype?** Prototype. The underlying tech is solid (depth sorting, fog, a 200×200 map that performs), but almost every surface is placeholder.

**The ugliest parts, in order:**

1. **The BattleScene.** This is the headline late-game feature and it is the most disappointing screen in the game. It's a **giant flat single-color green rectangle** with two thin vertical columns of ~8 tiny (40px) units each, separated by a vast empty middle with two reused iso-tile "obstacles" floating on it. It feels like a *small skirmish on a billiard table*, not a Bannerlord-scale battle. The morale bars are bare rectangles. There is no battlefield, no depth, no spectacle. The 20-second pre-battle timer makes you stare at static dots with only 4 buttons to press.

2. **The resource bar.** Inconsistent and unreadable at a glance. Wood shows an icon + number (no label); **Stone shows a text label + number (no icon)**; Food shows a meat icon + number (no label); **Gold and Iron are tiny indistinguishable gray/yellow dots + a number.** Three different representation styles in one bar. A new player literally cannot tell which number is gold vs iron.

3. **New buildings are tinted clones.** Market, Blacksmith, Watchtower, Tavern are the **same existing sprites recolored** — the "Market" is visibly a windmill, the "Blacksmith" is the mine scaffold, the "Wall" is a boulder. They're distinguishable by tint but they **don't communicate their function at all.**

4. **Diplomacy relationship bars render empty at neutral.** At relationship 0 (the starting value for every kingdom) the bar is a **solid black empty rectangle** next to "Cautious (0)." It looks broken/unfinished. There's no center tick or baseline fill.

5. **Expedition panel overlap.** The "Artifacts (0)" button is drawn **underneath the "Back" button** — text collision. The third expedition card's reward text ("…50% lose 2-3") is **cut off** at the right edge.

**Is the isometric world readable?** Mostly, but it's dominated by two things that hurt the "warmth" goal: the **bright cyan territory grid** (reads as a build-mode overlay, not "your land") and the **heavy black fog** (reads as empty/unfinished). There's a lot of dead green space around a small settlement.

**Do buildings/units sit on terrain correctly?** Yes — placement was clearly fixed; buildings stand on their tiles and depth-sort correctly. Units sit fine. This is one of the things that *does* look correct.

**Is the continent view useful?** Useful, not beautiful. It's readable (biomes labeled, kingdom crowns in corners, a river line) but it's **flat colored rectangles with hard edges** — closer to a debug minimap than the "Catan-style" board the design wants. Early on there are **no POI icons** (settlements/camps are fogged), so it looks empty.

---

## GAMEPLAY FEEL

**Core loop satisfying?** Partially. The **worker-allocation panel is genuinely good** (clear −/+ buttons, "3 free," production rates per worker count, an IDLE warning). That's the best-designed piece of UI in the game. But the loop is undercut by the **auto-gather/manual-allocation conflict**: if idle workers already gather wood/stone/food for free, *why build a Lumberyard?* The game never explains that staffed buildings are faster — so the central management decision feels redundant at first.

**Early pacing:** Too quiet and too empty. The opening is peaceful (good — no instant assault), but there's nothing to *do* except place a couple of buildings and watch numbers rise. The world around you is black fog; the wildlife, neutral settlements, and enemy kingdoms are all 50+ tiles away and invisible. For the first several minutes the "living world" feels **dead and far away.**

**Resource management meaningful or tedious?** Neutral leaning tedious, mostly because the **bar is hard to read** and the numbers tick slowly. The decisions (which building, which worker) are fine; the presentation makes them feel like spreadsheet bookkeeping rather than the "slow satisfying brain" the design wants.

**Do troops feel powerful?** Hard to tell, because of a bigger problem: **the BattleScene yanks your army off the map.** The moment a fight hits 10+ combined units, your troops vanish from the world and you're teleported into the flat battle screen — you don't *command* the clash you built up to, you watch two columns autobattle. This **removes agency** at the exact moment combat should feel best.

**Does the BattleScene feel epic?** No. Flat. See "ugliest parts" #1.

---

## UI / UX ISSUES (specific list)

- **Resource bar:** three inconsistent representation styles; gold/iron are ambiguous dots. Cannot read at a glance.
- **Opening hint contradicts the mechanic** ("assign workers" while workers already auto-gather).
- **Tutorial is out of date** (3 tiers vs 9 stages) and omits half the game (Tab, expeditions, combat, fog).
- **Expedition panel:** "Artifacts" button overlaps "Back"; third card's reward text clipped; buttons are all grayed with 0 soldiers and no "train soldiers first" guidance.
- **Diplomacy:** relationship bar is an empty black box at neutral; no legend explaining Cautious/Hostile/Pact; army shown as cryptic "~2w"; Tribute/War give no preview of consequences.
- **Spatial disconnect:** the openers (Caravans / Kingdoms / Expeditions) are **top-right buttons** that open panels at the **bottom** of the screen. Click top-right → content appears bottom-left. That's disorienting.
- **Top-right is crowded:** three dropdown buttons + a wave panel + a speed button stacked together.
- **Placement mode never auto-exits:** after placing a building you stay in placement mode with no obvious "done"; you have to find Cancel or click empty UI.
- **Cost abbreviations** (W/S/G/Fe/Eq) are never explained.
- **Caravans/Administrators are buried** behind a conditional top-right button and a panel that mixes route-creation and admin toggles with no explanation of either.

---

## SYSTEMS AUDIT

- **Worker allocation:** ✅ Good. Intuitive +/- with free-worker count and rate table. Keep this; make everything else match its clarity.
- **Expeditions:** Mostly clear (name, soldier cost, days, reward, slot count) but the panel has the overlap bug, clipped text, and no guidance when you can't afford it.
- **Territory:** The placement pulse helps, but the cyan grid reads as a tech overlay, not "your land," and growth from a single central building is barely visible. The *concept* is invisible to a new player — nothing says "this glowing ring is your border and it grows."
- **Diplomacy:** Mechanically real (relationship moves with tribute/attacks/time; gates AI aggression) but the UI hides it — empty bars, no explanation of what any status or action does.
- **Settlement progression:** ✅ The upgrade button is good — it shows the next stage name and exactly which resource you're missing ("need wood"), and glows when affordable. Best-communicated system after worker allocation. Undermined only by the outdated tutorial.
- **Caravans:** Function exists but the *why* is opaque. Nothing tells the player what a caravan is for, and it's gated behind owning 2 settlements with no signpost.

---

## WHAT'S MISSING

- **A visual identity.** Custom (or at least purpose-distinct) building sprites, a real battlefield background, world/terrain texture, and a resource bar that looks designed. Right now everything is recolored placeholder.
- **Battle spectacle.** The marquee feature needs scale: more/larger units, a real field, formations that read, impact, camera framing.
- **Onboarding that matches the current game.** An interactive, staged tutorial (place this, assign that, press Tab, send an expedition) that reflects the systems that actually exist.
- **A sense of a living, reachable world early.** The map is huge but the player sees a black void. Early POIs (a nearby ruin, a visible resource cluster, a closer first threat) would give direction.
- **Consequence/feedback for the strategic systems** (diplomacy outcomes, caravan deliveries, administrator income) surfaced where the player is looking.

---

## PRIORITIZED FIX LIST

### CRITICAL (breaks/obscures core experience)
- **Tutorial is wrong and misleading:** rewrite to match the real opening (auto-gathering, fog/exploration, Tab continent, 9 stages) and remove the contradictory "assign workers" first hint.
- **BattleScene feels flat and steals agency:** at minimum give it a real background and bigger/denser units; ideally let the player *choose* to fight on the main map vs. enter the battle, instead of auto-yanking the army at 10 units.
- **Resource bar is unreadable:** make every resource icon + label consistent; replace the ambiguous gold/iron dots with distinct labeled icons.

### HIGH
- **Expedition panel overlap/clipping:** move "Artifacts" off the "Back" button; wrap/shorten the third card's reward text.
- **Diplomacy bars empty at neutral:** render a baseline (center tick or half-fill) and add a one-line legend; show what Tribute/War do before clicking.
- **Auto-gather vs. building purpose unexplained:** one line in the building tooltip/tutorial ("staffed buildings gather far faster than idle workers").
- **Spatial disconnect of top-right openers → bottom panels:** either move the openers near the panel they open, or animate/point to where the panel appears.

### MEDIUM
- **New buildings are tinted clones:** at least add a distinct icon/banner over each so a Market doesn't look like a windmill.
- **Placement mode doesn't auto-exit / no clear "done."**
- **Continent view is flat:** add settlement/camp icons that appear on discovery, soften biome edges, add light texture.
- **Cost abbreviations unexplained:** spell out or add a hover legend.
- **Empty early world:** reveal a slightly larger starting area or place one nearby point of interest for direction.

### LOW (polish)
- Cyan territory grid is too "techy" — soften it so it reads as land, not a build grid.
- "~2w" and other cryptic abbreviations in the diplomacy/kingdom panel.
- 20s pre-battle timer is long for the amount of interaction available.
- Milestone announcement banners overlap the playfield while active.

---

## UI OVERHAUL RECOMMENDATIONS (by impact)

1. **Resource bar (top).** *What's wrong:* mixed icon/label/dot styles; gold & iron are unlabeled dots. *Should be:* one consistent chip per resource — distinct icon + value, evenly spaced, every resource treated the same. This is the single most-seen UI element and currently the least readable.
2. **BattleScene.** *What's wrong:* flat green void, tiny sparse units, bare bars. *Should be:* a textured/illustrated battlefield, larger and denser unit blocks that read as formations, clearer morale UI, and framing that conveys scale. This is the feature that most needs to look "finished."
3. **Diplomacy / Kingdoms panel.** *What's wrong:* empty relationship bars, cryptic abbreviations, no explanation. *Should be:* a relationship bar with a neutral baseline and color zones, a status label with a tooltip legend, and action buttons that preview their effect (+20 relationship, etc.).
4. **Tutorial / onboarding.** *What's wrong:* static, outdated, contradictory. *Should be:* a short interactive sequence keyed to the real systems, with the option to skip.
5. **New-building art.** *What's wrong:* recolored clones that misrepresent function. *Should be:* distinct silhouettes or at least labeled banners/icons so each building reads as itself.
6. **Top-right opener cluster + bottom panels.** *What's wrong:* crowded, and openers are spatially disconnected from the panels they open. *Should be:* consolidate, and put each opener adjacent to (or visually linked to) the panel it controls.

---

### Bottom line
There is a remarkable amount of working systems here — more than most finished indie strategy games ship with. But a player's first impression is a dark, empty screen with a lying tutorial and an unreadable resource bar, and the marquee battle feature looks like a placeholder. **The next phase of work should be almost entirely presentation and onboarding, not new systems.** Make the resource bar legible, rewrite the tutorial to match reality, and give the BattleScene a real face — those three alone would move this from "impressive prototype" to "looks like a game."
