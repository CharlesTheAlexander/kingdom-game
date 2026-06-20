# KINGDOM GAME — FULL QA & DESIGN AUDIT

*Observation-only audit. No code was changed. Driven via headless Chrome + DevTools
Protocol against `window.__game`, with full console capture across 10 sessions
(first-contact, core-loop, late-game, and visual passes). Screenshots saved to
`/tmp/audit_shots/`.*

*Auditor stance: hired senior QA + game designer, brutally honest, never seen the
game before.*

---

## EXECUTIVE SUMMARY

This is a genuinely impressive, unusually *stable* build. Across ten scripted
sessions — first load, building/economy, expeditions, armies, full BattleScene,
diplomacy/treaties/coalition, research, world events, save/load, continent view,
late-game at 3×, and visual passes — I recorded **zero console errors and zero
exceptions**. Every headline system from the design and expansion docs is present
and actually functions end-to-end. It already feels like a game, not a tech demo.

Is it fun? The *systems* are fun and interlocking; the strategic army-on-map layer
plus diplomacy/coalition is the standout. Does it feel finished? Mechanically yes,
but **it has no goal** — there is no victory or endgame condition of any kind, only
a game-over when your castle falls. That is the single biggest issue: a player can
do everything right for an hour and the game never acknowledges winning. The second
real issue is a UX one: the king-creation screen does not pause the simulation, so
the new-player onboarding clock is literally ticking (resources accrue, days pass,
enemies can move) while they read trait descriptions.

Everything below is detail. There are no game-breaking bugs.

---

## CONSOLE ERRORS

**None.** Every session captured `Runtime.consoleAPICalled` (error/warning/assert)
and `Runtime.exceptionThrown`. All ten runs reported `CLEAN`:

| Session | Coverage | Console |
|---|---|---|
| A / A2 | first load, king creation, trait apply | CLEAN |
| B1 | 12 building types, workers, production, population, happiness, tiers | CLEAN |
| B2 / B2b | expeditions, market, demolish, tier upgrade, army supply, BattleScene launch | CLEAN |
| B3 | battle completion, diplomacy, research | CLEAN |
| B4 | battle return handoff, world events, continent, save/load | CLEAN |
| C | AI attacks ×3, coalition, multi-army, caravans, 3 techs, pop growth, 3× burst | CLEAN |
| D | night/winter render, choice event, sound, QOL hotkeys | CLEAN |
| messenger / clipshots | messenger panel, panel clip captures | CLEAN |

There were **no** errors of any severity to list. This is the strongest single
finding in the audit and should be protected by future work.

---

## BROKEN FEATURES (do not work at all)

**None found.** Every feature on the test checklist that exists in the code
responded correctly when exercised. Items that initially looked broken turned out
to be test artifacts of headless probing (documented below under "investigation
notes"), not product defects.

*Investigation notes (false alarms, for transparency):*
- *Army supply "not draining"* — only because the test called `onNewDay()` without
  the real-time `update()` loop, so the army never physically left the 4-tile
  "home" radius where supply is intentionally not consumed. With the army moved
  away, supply drained 3→0 over 7 days, morale 75→55→0, and the army auto-retreated.
  Working as designed.
- *Settlement "not conquered"* — a garrisoned settlement (3 guards) correctly routes
  to the BattleScene instead of instant-conquering; it only auto-conquers when the
  garrison is 0. Working as designed.
- *Battle "not returning"* — the victory→world handoff fires after a deliberate ~3.8s
  outcome overlay + fade; a 2.5s probe wait was simply too short. With a 5s wait the
  army returned with survivors + loot and the world scene resumed. Working as designed.

---

## DEGRADED FEATURES (work but incorrectly)

**1. BattleScene subtitle always says "Defending against …" even when you attack.**
`BattleScene.js:241` hardcodes `Defending against the {Faction}`. When you send
*your* army to attack an enemy castle or neutral settlement, the battle screen still
reads "Defending against the Red Kingdom." The engine actually knows the difference
(`cfg.playerDefending` is used for the timeout outcome at line 414) — only the label
ignores it. Severity: MINOR (narrative/UI correctness). Evidence: `B_battlescene.png`
was produced from an *attack* yet reads "Defending against the Red Kingdom."

**2. Starting-trait numbers deviate from the expansion doc.** The in-game cards are
internally honest (they describe what actually happens), but they don't match
`KINGDOM_GAME_EXPANSION_DOC`:
- Warlord: doc says "army cap +5"; implementation is **+3** (base 3 → cap 6).
  Verified live: `traitBonuses.armyCap = 6`, card text "Army cap +3."
- Builder: doc says "construction time halved"; buildings are instant anyway, so the
  card honestly substitutes "Instant placement." No timed construction exists.
- Merchant / Explorer are *more* generous than the doc (25% vs "better", 30% vs 25%).

This is doc-vs-code drift, not a player-facing lie. Severity: MINOR.

No other incorrect behavior was observed. Production rates, refunds, relationship
math, research effects, coalition timing, and save/load all matched expectations
exactly.

---

## UI AND VISUAL ISSUES

**1. Diplomacy panel: reputation labels overlap the top kingdom row.** In the
Kingdoms panel, the four reputation mini-bars (Conqueror / Protector / Merchant /
Destroyer) are packed into the header strip and collide with the first kingdom row —
"Destroyer" is partially occluded. Functional but untidy. Severity: MINOR.
Evidence: `C_kingdoms.png`.

**2. Resource-node quantity labels are always-on world text.** Each of the ~71 map
nodes renders a permanent "Wood x40 / Stone x30 / Food x20 / Gold x30" label. Up
close it's informative; zoomed out it's visual noise and a lot of live text objects.
Consider fading these by zoom or showing on hover. Severity: LOW. Evidence: the
world-text dump returned dozens of node labels before any HUD text.

**3. Night and Winter effects are subtle at default zoom.** Forcing night
(`dayTimer≈0.86`) and Winter (`gameDay=55`) produced only a faint change in the
captured frames; snow/blue-tint were not clearly perceptible at the tested zoom.
The systems exist and run without error (`updateWeather` ran clean; season correctly
reported "Winter"), but the *visual payoff* is weak. Severity: LOW. Evidence:
`D_night.png`, `D_winter.png` look close to the daytime frame.

**What looked great:** king creation (`A1_first_load.png`), the BattleScene
(`B_battlescene.png`), the continent view (`B4_continent.png`), the messenger choice
panel (`E_messenger_panel.png`), and the Armies / Build panels (`C_armies.png`,
`C_build.png`) are all crisp, well-labeled, and free of cut-off text or unlabeled
buttons. No button was found with a missing label or icon.

---

## GAMEPLAY ISSUES

**1. King creation does not pause the game.** The creation overlay only dims the
screen; `gameSpeed` stays 1. Observed live: gold rose from ~157 to ~270 while the
creation screen sat open during the load, and `gameSpeed` read `1` throughout. A new
player taking the intended "60 seconds" to choose a name and trait is losing time,
consuming food, and theoretically exposed to events. **Fix:** set `gameSpeed = 0`
(or a dedicated freeze flag) while the creation overlay is up. Severity: HIGH (it
undermines the very onboarding moment).

**2. No win condition / no endgame.** There is no victory trigger anywhere in the
code — no conquest %, no diplomacy "High King," no legacy score (all three are
specced in EXPANSION_DOC §8, and DESIGN_DOC §13 marks win condition "Not decided").
The only terminal state is game-over on castle loss. This caps how invested anyone
can get: there is nothing to *achieve*. **Fix:** even a single, simple win path
(e.g., control N settlements, or destroy all AI castles) with an end screen would
transform the sense of purpose. Severity: HIGH (design completeness).

**3. Population scales slowly and is housing-gated.** Over a simulated ~30 days with
full food, population grew only 10 → 18, because growth is +1 per 3 days *and* capped
by housing capacity (≈4/House). The expansion doc dangles "population 30+/500" as
late-game/legacy targets; at current rates and house caps those are very far away.
Not a bug, but the late-game population fantasy isn't reachable in practice. Severity:
MEDIUM.

**4. AI kingdoms are weak in fresh games.** AI strength comes from build timers that
tick in real time (`buildEvery` 30–45s). In a freshly seeded day-30 state each AI's
`estimatedArmy()` was only ~2; they *do* launch waves and coalitions correctly, but
the threat only becomes real after a lot of wall-clock time. A new player on a fresh
map will find the early "kingdoms" almost inert. Severity: MEDIUM.

**5. `place()` does not enforce stage-unlock gating.** The build *palette* correctly
hides tier-locked buildings (only 6 show at Small Village — `C_build.png`), but the
underlying `buildings.place()` will place any type at any tier (my probe seeded all
12 at Small Village). Players can't normally hit this, but it's a latent
inconsistency. Severity: LOW.

---

## WHAT WORKS WELL (do not change)

- **Stability.** Zero console errors across every system and a 10s 3× real-time
  burst at a steady ~43 FPS (headless). This is rare and valuable.
- **King creation screen.** Clean layout, readable labels, six meaningfully distinct
  traits with one-time effects; selecting a trait highlights it and enables Begin.
  Trait bonuses verified applied live (Warlord → `foodMult 0.8`, `armyCap 6`).
- **BattleScene.** Battlefield name, dual morale bars, terrain obstacles, dense
  ranked units, four working formations, dramatic countdown, and a full
  Victory/Defeat overlay that correctly returns survivors + loot to the world.
- **Army-on-map system.** Form named armies from the pool, march with terrain speed,
  daily supply drain, morale collapse → auto-retreat, disband returns units. The
  strategic layer the expansion doc called "the one thing" — and it delivers.
- **Diplomacy + treaties + coalition.** Tribute/trade/alliance/vassal thresholds all
  gate correctly; coalition fires a 3-day warning then launches simultaneous AI
  armies. Exactly as designed.
- **Save/Load.** Full round-trip preserved day, gold, king identity, armies, research,
  and treaties.
- **Research, world events + messenger, expeditions, market, demolish refund (exact
  50%), worker/production, happiness with strike + growth.** All verified working.
- **Continent view & QOL.** Catan-style overview with live stats; pause, tab hotkeys
  (B/E/K/A/R), notifications log with unread badge, and 1–3 army quick-select all
  confirmed via the real key bindings.

---

## FEATURE COMPLETENESS AUDIT

Legend: ✅ complete & working · ⚠️ partial · ❌ missing

### From DESIGN_DOC.md (current/built systems)
- ✅ Resource system (wood/stone/food/gold/iron/equipment) — verified live.
- ✅ Building placement, 12 types — all placeable; tier-gated in palette.
- ⚠️ Settlement progression — all **9 tiers defined** and `upgradeTier()` works, but
  the doc itself notes deeper per-stage building/visual variety is aspirational.
- ✅ Worker allocation + production scaling + idle freelancing.
- ✅ Day/night + seasons exist (⚠️ visual payoff subtle — see UI #3).
- ✅ Food upkeep, ✅ population + happiness + strike + growth.
- ✅ Troops (warrior/archer/monk/knight/mercenary), ✅ box-select/right-click.
- ✅ BattleScene (formations, morale, outcome handoff).
- ✅ 3 AI kingdoms with day-gated attacks (⚠️ weak early — Gameplay #4).
- ✅ Wildlife, territory + fog, expeditions (special rewards only), artifacts.
- ✅ Market, Blacksmith, Watchtower, Tavern, Wall, Library, Equipment, Knights.
- ✅ Caravans + administrators, ✅ Diplomacy base.
- ✅ Sound engine (functional; volume 0.6, mute flag; can't audibly verify headless).
- ✅ Save/Load + 3 slots + autosave infra.

### From KINGDOM_GAME_EXPANSION_DOC.md
- ✅ §1 King identity + 6 traits + reputation titles. ⚠️ Reputation→AI-reaction
  consequences are light (titles + market bonus + vassal gating exist; "caravans
  stop to trade," "factions flee," etc. not implemented).
- ⚠️ §2 Living world: ✅ named biomes, ✅ messenger + **15** world events (doc
  envisioned ~30), ✅ seasonal events. ❌ named neutral-location histories on
  discovery, ❌ wandering factions, ❌ ancient ruins, ❌ 500×500 map (still 200×200).
- ✅ §3 Population + happiness. ❌ **Tax system / slider** (only a "Tax Revolt"
  event references taxes; no actual tax mechanic). ❌ explicit revolt state (very-low
  happiness causes strike + people leaving, but no scripted "restore order" event).
  ✅ Research tree (9 techs / 3 branches). ❌ 5-level building upgrade depth (3 levels).
- ✅ §4 Army-on-map, ✅ AI armies on map, ✅ coalition warfare. ⚠️ AI "personalities"
  exist as tuning constants (aggressive/passive) but not the full
  personality/leader/own-research model. ❌ in-battle unit box-select, ❌ battlefield
  terrain bonuses (high ground/forest/river), ❌ reinforcements, ❌ retreat pursuit.
- ❌ §5 Exploration: ancient ruins, wandering factions, underworld — none built.
- ⚠️ §6 Economy: ✅ market + caravans; ❌ manufacturing chains, ❌ external AI trade
  routes, ❌ merchant guild contracts, ❌ banking.
- ✅ §7 Diplomacy: trade/alliance/vassal treaties + coalition. ❌ royal marriage,
  ❌ ambassador/rumor/military-access actions, ❌ Great Council.
- ❌ §8 Endgame: **all three win paths missing** (no win condition at all).
- ✅ §9 QOL: ✅ save, ✅ pause, ✅ notifications log, ✅ hotkeys, ✅ army quick-select.
  ⚠️ "fast-forward to next event" not present; ❌ kingdom statistics panel.

**Net:** the four "MUST DO FIRST" and the "HIGH IMPACT" expansion items (save,
army-on-map, population, world events, research, king identity, treaties, coalition,
QOL) are essentially **all done**. The gaps are the later-tier content (ruins,
wandering factions, manufacturing, banking, council) and — critically — the
**endgame/win conditions**.

---

## PACING ANALYSIS

- **Early game:** smooth and inviting; king creation → tutorial → first build reads
  well. Resources are *generous* (consistent with the existing BALANCE_REPORT), so
  there's little early scarcity tension. The unpaused creation screen is the one
  rough edge.
- **Mid game:** this is the strongest stretch. Forming armies, marching, supply,
  expeditions, research, and first diplomacy create real decisions. The army-on-map
  layer adds tension *and* agency rather than confusion — you decide when/where wars
  happen.
- **Army system — tension or confusion?** Tension. The UI (Armies panel, icons,
  Select/Supplies/Disband, quick-select) is legible, and supply/morale create
  meaningful upkeep pressure.
- **World events:** ~1 per 7 days + seasonal — a reasonable heartbeat, though 15
  events will repeat in a long session (doc wanted ~30). Choice events surfacing via
  the messenger icon is a nice "the world is talking to you" touch.
- **Research:** rewarding and well-paced (~3 days/tech with 2 librarians; effects are
  immediate and visible, e.g. warrior damage 1.0→1.2).
- **Late game:** under-served. AI stays weak unless a lot of real time passes,
  population can't realistically reach the dangled targets, and there's no climax
  to build toward. The mid-game loop currently has to be its own reward.

---

## PRIORITIZED FIX LIST

**CRITICAL (game-breaking):**
- *(none — no crashes, no console errors, no broken features)*

**HIGH (significantly hurts experience):**
1. Add at least one **win/endgame condition** with an end screen (EXPANSION_DOC §8).
   The game currently has no goal.
2. **Pause the simulation during king creation** (`gameSpeed = 0` while the overlay
   is up). Protects the onboarding moment.

**MEDIUM (noticeable):**
3. Tune **early AI build-up** so fresh-map kingdoms feel like a threat sooner (seed
   them with a small starting garrison or accelerate first `buildEvery`).
4. Rebalance **population growth/housing** so late-game population targets are
   reachable, or lower the targets the design implies.
5. Fix the **diplomacy panel reputation-label overlap** with the top kingdom row.
6. Fix the **BattleScene "Defending against" subtitle** to respect
   `cfg.playerDefending` (say "Attacking" / "Assaulting" when you initiate).

**LOW (polish):**
7. Fade or hover-gate the **resource-node quantity labels** to cut zoomed-out clutter.
8. Strengthen **night/winter visuals** (deeper night overlay, more visible snow/tint).
9. Enforce **stage-unlock in `buildings.place()`** (not just the palette) for
   consistency.
10. Reconcile **doc drift**: Market "1/day" (now unlimited), Warlord "+5" vs "+3",
    Builder "construction time halved" vs "instant," and EXPANSION targets vs reality.

---

## RECOMMENDED NEXT SESSION

Focus on **purpose and the first five minutes**, not new subsystems:

1. **Win conditions + end screen (Path 1: Conquest first).** Implement "control X of
   the continent's settlements (or destroy all AI castles) → Victory screen with a
   score/title, then optional continue." This is the highest-leverage missing piece
   and it reuses systems that already work (settlements, AI castles, reputation).
2. **Pause during king creation**, and consider a one-line "what to do first" call to
   action when the tutorial opens.
3. **Early-AI threat pass** so the world feels alive within the first 10 minutes
   (small starting AI garrisons + a slightly faster first wave on at least the
   aggressive faction).
4. **Cheap "living world" wins** that are nearly free given existing data: named
   histories on settlement/biome discovery, and a few more world events to push past
   the 15-event repeat point.

Deliberately deferred: ancient ruins, wandering factions, manufacturing chains,
banking, Great Council, in-battle unit micro, 500×500 map. They're worthwhile but
secondary to giving the existing, well-built loop a reason to end and a stronger
opening.

---

*Methodology footnote: late-game ("Session C") was exercised by advancing game-days
programmatically and triggering AI waves/coalitions directly, plus a real-time 3×
burst, rather than 45+ minutes of wall-clock play — literal 3× to day 30 is
impractical headless. All other sessions ran the real scene update loop. A recurring
headless-only gotcha worth noting for future automated testing: Chrome exhausts WebGL
contexts after ~12 page loads and silently fails to start the Phaser renderer
(`active scenes: []`); closing stale tabs between runs fixes it. This is a test-harness
limitation, not a game issue.*
