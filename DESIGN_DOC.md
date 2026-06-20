# KINGDOM GAME — MASTER DESIGN & PRODUCTION DOCUMENT
*Last updated: June 2026 — auto-updated after every session* (copy 2)

---

## SECTION 1: VISION

You are placed into a living world. You start with nothing — a ruined starter village, a handful of workers, and wilderness in every direction. You gather resources, grow your settlement from a small village to a mighty castle, build and manage an army, and eventually wage large-scale wars against AI kingdoms that are growing simultaneously across the continent.

This is not a wave defense game. It is a kingdom management and conquest game with real-time strategy combat.

**Core inspirations:**
- Kingdoms and Castles — building loop, worker systems, being attacked
- Mount and Blade: Bannerlord — world map, army management, large scale battles
- Stardew Valley — visual warmth, intimacy, feel

---

## SECTION 2: THE THREE PILLARS

### Pillar 1: Kingdom Management
Building, workers, resources, settlement progression. The slow satisfying brain.
- Allocate workers to buildings manually
- Manage resource chains (wood → buildings, food → army upkeep, stone → walls)
- Grow settlement through 9 stages
- Build walls, roads, markets, caravans

### Pillar 2: Exploration & Expeditions
Sending units into the wilderness. The risk/reward brain.
- Workers gather from resource nodes on the map
- Troops fight wildlife threats (goblins, wolves, boars)
- Expedition parties sent for special/rare resources only (NOT basic resources)
- Pioneer parties sent to found new settlements

### Pillar 3: Large Scale Warfare
Army composition, campaigns, kingdom vs kingdom battles. The strategic brain.
- Build and command armies on a world map
- Skirmishes for small fights (on main map, under 10 units)
- Full battle screen for large army clashes (10+ units)
- Conquer or found settlements across the continent

---

## SECTION 3: SETTLEMENT PROGRESSION

9 stages total. Each feels meaningfully different.

| Stage | Unlocks | Visual Change |
|---|---|---|
| Small Village | Basic buildings, worker system | Open ruined area, no walls |
| Medium Village | More building slots, first troops | Slightly cleaned up |
| Large Village | Expedition system, first walls | Wooden fence visible |
| Small Town | TUTORIAL COMPLETE — main game begins, formations unlock | Wooden walls, gate |
| Medium Town | Markets, caravans, trade routes | Stone foundations visible |
| Large Town | Multi-army support, administrators | Stone walls partial |
| Small Castle | Full siege mechanics, champions | Full stone walls, towers |
| Medium Castle | Multi-kingdom diplomacy | Larger walls, moat |
| Large Castle | End-game content TBD | Full fortification |

**Key design rule:** The player discovers each stage by exploring — the world is huge and not immediately visible. You move the camera to find it.

**Current implementation:** 3 tiers only (Village → Town → Castle). Full 9-stage system is planned.

---

## SECTION 4: WORLD MAP DESIGN

### Map Feel
- Huge isometric world, 40×40 tile grid currently (will expand)
- Isometric perspective — decided, already implemented
- Region-based resources — geography determines what's available:
  - Forest regions: abundant wood, scarce stone
  - River regions: fish (food), trade bonuses
  - Mountain regions: abundant stone and iron, scarce food
  - Desert regions: scarce wood, gold deposits
  - Plains: balanced, good for farming

### Two-View System ✅ DECIDED
The game has two zoom levels that the player toggles between:

**Continent View (Tab to toggle):**
- Visual style similar to Catan — stylized, colorful, readable at a glance
- Shows the whole continent at once with:
  - Territory colored by faction
  - Small settlement icons showing tier level
  - Small army dots showing where armies are moving
  - Resource region shading
  - Roads as visible lines between settlements
- Click any settlement or army dot to zoom back into that location
- NOT YET BUILT — Phase B target

**Local View (current game):**
- Isometric main game view
- Building, worker allocation, skirmishes happen here
- Camera pans and zooms within the local region
- ✅ BUILT

### Territory System (planned)
- Buildings expand controlled territory visually
- Expanding territory reveals more of the map
- Other kingdoms have visible territory
- Border conflicts at territory edges

### What Exists On The Map
- Your settlement (center of your territory)
- Resource nodes (trees, gold, stone, sheep — ✅ built)
- Wildlife threats (wolves, boars, goblin camps — planned)
- AI kingdoms (one currently, multiple planned)
- Neutral settlements (planned)
- Ruins (planned)
- Roads (planned)

---

## SECTION 5: RESOURCE SYSTEM

### Time System ✅ BUILT
- 1 game day = 5 real minutes
- Day/night cycle visible — sky darkens at night
- Day counter visible in UI
- Food consumed once per game day at dawn
- All building/training timers measured in days

### Basic Resources ✅ BUILT
| Resource | Source | Used For |
|---|---|---|
| Wood | Trees / Lumberyard | Buildings, walls, roads |
| Stone | Rocks / Mine | Walls, upgrades, towers |
| Wheat | Farms / Windmill | Feeding citizens and soldiers |
| Meat | Sheep / Hunting | Higher nutrition food |
| Gold | Gold nodes / Castle | Training, trading, tribute |

### Special Resources (Expeditions only — planned)
| Resource | Used For |
|---|---|
| Iron | Upgrading troops to armored versions |
| Scrolls/Knowledge | Unlocking new buildings and abilities |
| Artifacts | Permanent one-time buffs |
| Mercenaries | Rare units that join your army |
| Intel | Reveals AI army composition before battle |

### Food System ✅ BUILT
- Wheat = 1 nutrition, Meat = 3 nutrition, Fish = 2 nutrition
- Each soldier: 1 nutrition/day
- Each worker/citizen: 1 nutrition per 2 days
- Starvation escalates over 4 days: warning → slow workers → deserting soldiers → leaving workers
- Diet bonus: 2+ food types = +10% battle morale

### Worker Allocation ✅ BUILT
- Workers manually assigned to buildings via +/- UI
- Buildings produce nothing with 0 workers
- Production scales with workers assigned (1/2/3 tiers per building)
- Unallocated workers idle near Castle visually
- Red ! on unstaffed buildings, green ✓ on staffed

---

## SECTION 6: BUILDINGS

### Currently Built ✅
| Building | Size | Notes |
|---|---|---|
| Castle | 3×3 tiles | Generates gold, visual changes per tier |
| House | 1×1 | +2 worker cap, max 3 houses |
| Lumberyard | 1×1 | Wood production, 1-3 workers |
| Mine | 1×1 | Stone production, 1-3 workers |
| Farm/Windmill | 1×1 | Wheat production, 1-3 workers |
| Barracks | 2×2 | Trains troops, L1/L2/L3 unlocks unit types |
| Tower | 1×1 | Auto-attacks enemies, needs 1 worker |

### Planned Buildings
| Building | Purpose | Stage Unlocked |
|---|---|---|
| Market | Trade resources at ratios | Medium Village |
| Caravan Post | Send caravans to other settlements | Small Town |
| Blacksmith | Craft iron equipment for troops | Small Town |
| Archery Range | Dedicated archer training | Small Town |
| Monastery | Train Monks, healing bonuses | Medium Town |
| Walls + Gates | Defense perimeter | Large Village |
| Watchtower | Extends vision range on map | Small Village |
| Road | Connects settlements, speeds movement | Medium Village |
| Pioneer Camp | Sends settlers to found new settlements | Medium Town |
| Tavern | Recruits mercenaries, boosts morale | Medium Town |
| Siege Workshop | Builds catapults, battering rams | Small Castle |

---

## SECTION 7: UNITS

### Player Units
| Unit | Role | Status | Cost |
|---|---|---|---|
| Warrior | Front line melee | ✅ Built | 30 gold + 5 food |
| Archer | Ranged back line | ✅ Built (Barracks L2) | 40 gold + 8 food |
| Monk | Healer/support | ✅ Built (Barracks L3) | 50 gold + 10 food + 10 stone |
| Pawn/Worker | Gathers resources | ✅ Built | Free (worker cap) |
| Knight | Armored warrior | Planned | 80 gold + 20 iron |
| Champion | Hero unit | Planned | Rare resources |
| Siege Unit | Destroys walls | Planned | 100 gold + 40 iron |

### Enemy Units
| Unit | Status |
|---|---|
| Red Warriors | ✅ Built (AI kingdom) |
| Red Archers | ✅ Built (AI 3+ barracks) |
| Goblins | Planned |
| Wolves | Planned |
| Boars | Planned |
| Bandits | Planned |

### Unit Controls ✅ BUILT
- Box-select: left-drag draws selection rectangle
- Move order: right-click destination
- Attack order: right-click enemy unit or AI castle
- Formation: units spread out around target point
- Selected unit count badge shown bottom-left

---

## SECTION 8: COMBAT SYSTEM

### Skirmish Mode ✅ PARTIALLY BUILT
- Happens on main map, no transition
- Box-select troops, right-click target
- Warriors auto-fight, Archers shoot from range, Monks heal
- Under 10 units = stays on main map
- Needs: wildlife threats, proper spawn locations, polish

### Battle Screen Mode — PLANNED (Phase C)
Separate Phaser scene (BattleScene.js).

**Flow:**
1. Triggers when 10+ units on either side
2. Pre-battle 30sec — drag units into formation
3. Battle phase — real time, issue orders
4. Outcome feeds back to world map

**Formations:** Line, Wedge, Defensive, Flanking
**Commands:** Charge, Hold, Flank Left/Right, Fall Back, Focus Fire

**Morale System:**
- Drops: units die, outnumbered, commander killed
- Rises: kills, successful flanks
- At 0: units route (return at 30% strength)

**Outcomes:**
- Win attacking → take settlement
- Win defending → enemy weakened
- Lose defending → pay tribute or lose settlement
- Lose attacking → army weakened, morale debuff

---

## SECTION 9: AI KINGDOMS

### Currently Built ✅
- One AI kingdom (Red faction) on far side of map
- Builds Barracks, Tower, House over time
- Sends attack waves toward player castle
- Has 500 HP castle — player can destroy it
- Rebuild period of 60s after castle destroyed
- Uses Red Tiny Swords sprites

### Planned
- Multiple AI kingdoms spread across continent
- Each with own settlement progression
- Faction colors: Red, Purple, Yellow, Black (all in Tiny Swords pack)
- AI declares war based on territory conflict, resources, random events
- AI sends caravans (can be raided)
- AI founds new settlements
- AI forms alliances against player
- AI sends diplomats (tribute requests, peace offers)

---

## SECTION 10: ASSETS

### Currently Have
**Tiny Swords Free Pack** (top-down sprites, used as unit overlays on isometric terrain):
✅ Blue buildings: Castle, Barracks, Tower, House1-3, Archery, Monastery
✅ Red/Black/Purple/Yellow buildings (all AI factions covered)
✅ Blue units: Warrior, Archer, Monk, Lancer, Pawn (all animations)
✅ Red/Black/Purple/Yellow units (all AI factions covered)
✅ Terrain: Trees, stumps, rocks, bushes, gold stones, sheep
✅ Resources: Wood, Gold, Meat sprites
✅ UI: Buttons, papers, ribbons, banners, bars, icons
✅ Particle FX: Explosions, fire, dust, water splash

**Isometric Strategy - Medieval Pixel Art Tiles** (isometric terrain + buildings):
✅ Sprite sheets: village_sheet, wooden_fort_sheet, stone_fort_sheet, wind_mill_sheet, water_wheel_sheet
✅ Individual tiles: grass, water, forest, rocks, terrain variations (img_1 through img_195)
✅ Master reference: Isometric_strategy.png
- Tile size: 64×100px diamonds
- Used for: ground terrain, building sprites in isometric view

### Assets Still Needed
| Asset | Priority |
|---|---|
| Goblin sprites (isometric or top-down) | HIGH |
| Wolf sprites | MEDIUM |
| Boar sprites | LOW |
| Wall tiles (wood + stone, isometric) | HIGH |
| Gate sprites | HIGH |
| World map / continent background | MEDIUM |
| Fog of war overlay | MEDIUM |
| Caravan sprite | MEDIUM |
| Iron ore node | MEDIUM |
| Market building (isometric) | MEDIUM |
| Blacksmith building (isometric) | MEDIUM |
| Knight unit | MEDIUM |
| Road tiles (isometric) | MEDIUM |

---

## SECTION 11: TECHNICAL PRODUCTION ROADMAP

### Phase A — Foundation ✅ COMPLETE
- ✅ Resource system (Wood, Stone, Wheat, Meat, Gold)
- ✅ Building placement (7 building types)
- ✅ Settlement tiers (Village/Town/Castle, 3 tiers)
- ✅ Worker allocation system (manual +/- per building)
- ✅ Worker pawns (visual, walk to resource nodes)
- ✅ Troops (Warrior, Archer, Monk)
- ✅ Box-select and right-click move/attack
- ✅ Enemy waves from AI kingdom
- ✅ AI kingdom (one, Red faction)
- ✅ Resource nodes (trees, gold, rocks, sheep)
- ✅ Day/night cycle + day counter
- ✅ Food upkeep system
- ✅ Camera pan + zoom, minimap
- ✅ Tutorial onboarding panel + contextual hints
- ✅ Isometric rebuild (IsometricScene.js)
- ✅ UI zoom bug fixed (dedicated uiCamera)
- ✅ Building sprite anchor fixed (origin 0.5, 1.0)
- ✅ Enemy spawn fixed (from AI castle location)
- ✅ Expedition redesign (special resources only)

### Phase B — World Expansion ✅ COMPLETE
*Goal: Map feels like a real world, threats feel organic*
- ✅ Wildlife.js: wolves (north forest, attack pawns), goblins (west, raid nodes/buildings), boars (south, deplete sheep nodes)
- ✅ Warriors auto-defend with leash radius — won't chase across whole map
- ✅ Four distinct terrain regions: N forest / E highlands / S plains+river / W mixed with soft gradients
- ✅ Region-biased resource node placement
- ✅ Territory.js: expands with buildings/tiers, soft cyan border, fog of war lifts near units
- ✅ Per-faction territory colors (cyan=player, red/purple/yellow=AI)
- ✅ Raid-safe nodes inside territory, worker harvest range enforced
- ✅ Iron resource added to HUD
- ✅ Expeditions redesigned: Scout (intel, ×2 simultaneous), Raid (iron+mercenary, ×2), Campaign (iron+artifact+scroll, ×1)
- ✅ Expedition timers: Scout 0.5 days, Raid 1 day, Campaign 2 days
- ✅ 5 Artifact types with permanent buffs + artifacts panel UI
- ✅ Mercenary units (yellow sprite, food upkeep, permanent until killed)
- ✅ 3 AI kingdoms: Red (west), Purple (NE passive), Yellow (SE aggressive)
- ✅ Wave coordinator: one attacker at a time with cooldowns
- ✅ Kingdom status panel (collapsed button by default)
- ✅ Attack banners, threat warnings queued (one at a time, 3s each)
- ✅ Node depletion/respawn FX, combat hit-flash, death fade
- ✅ Settlement wall/castle visual evolution per tier
- ✅ Idle workers auto-gather nearest node (freelancing system)
- ✅ Assigning worker to building stops freelancing; removing resumes it
- ✅ Wolf spawn fixes: north zone only, ≥12 tiles from castle, every 4 days, max 4
- ✅ Building selection highlight aligned to actual sprite bounds
- ✅ UI decluttered: 2-row resource bar, collapsed expedition/kingdom panels, smaller minimap
- ⬜ Neutral settlements (deferred to Phase D)
- ⬜ Wheat/Meat as separate resources (currently merged as Food — needs own pass)

### Phase B2 — World Expansion + Continent View ✅ COMPLETE
*Goal: Map feels like a real continent worth exploring*
- ✅ Map expanded 40x40 → 200x200 tiles
- ✅ 6 named biomes: start plains, deep forest (N), iron mountains (E), river delta (S), western wildlands (W), transitional middle
- ✅ Continuous river running E-W across south region
- ✅ Performance: Blitter-batched terrain rendering (40k tiles without lag)
- ✅ 9 neutral settlements (named, garrisoned, conquerable, passive income)
- ✅ 9 goblin camps (guards, loot drops, 5-day respawn, raids from nearest camp)
- ✅ AI kingdoms relocated to far corners (80+ tiles from player start)
- ✅ AI day-gated attacks: Yellow day 8, Red day 12, Purple day 18
- ✅ Territory rescaled: radius 8 start, +2/building, +15/tier upgrade
- ✅ Fog of war: 15 tiles beyond territory, permanently revealed by unit movement
- ✅ ContinentScene.js: Tab toggles Catan-style continent overview
- ✅ Continent view: biome colors, territory blobs, faction castles, river, region labels
- ✅ Settlement/camp/castle icons with hover tooltips on continent view
- ✅ Click settlement on continent → zoom into local view
- ✅ Live stats on continent: day/season, % owned, settlements controlled, active threats
- ✅ 71 resource nodes distributed across biomes
- ✅ Wildlife scaled to big map: wolves max 8, total wildlife max 20
- ✅ Idle workers bounded to 10 tile radius
- ⬜ Iron nodes in mountains (currently iron from camps/expeditions only)
- ⬜ Decorative bandit roads between goblin camps
- ⬜ Zoom-morph transition (currently fade transition)

### Phase C — Army & Battle System
*Goal: Warfare feels strategic and satisfying*
- ⬜ BattleScene.js (separate battle screen, triggers at 10+ units)
- ⬜ Formation system (pre-battle positioning)
- ⬜ Morale system
- ⬜ Battle outcome → world map feedback
- ⬜ World map army movement
- ⬜ Siege mechanics

### Phase D — Continent View
*Goal: Strategic layer feels like Mount & Blade world map*
- ⬜ ContinentScene.js (Tab to toggle)
- ⬜ Catan-style continent visualization
- ⬜ Territory coloring by faction
- ⬜ Army dots, settlement icons
- ⬜ Click to zoom into location

### Phase E — Economy Depth
*Goal: Management feels meaningful*
- ⬜ Market building (resource trading at ratios)
- ⬜ Caravan system (trade between settlements)
- ⬜ Expedition redesign (special resources: iron, scrolls, artifacts)
- ⬜ Iron + equipment crafting (Knights unlock)
- ⬜ Administrator system (auto-manage captured settlement for gold)
- ⬜ Road building

### Phase F — Polish & Feel
*Goal: Looks and feels like a real game*
- ⬜ Sound design (AudioManager.js roadmap exists)
- ⬜ Proper unit animations
- ⬜ Settlement visual evolution (walls appear per tier)
- ⬜ Win/lose conditions
- ⬜ Full 9-stage settlement progression

### Phase G — Late Game
- ⬜ Diplomacy system
- ⬜ Multiplayer consideration
- ⬜ 3D transition planning

---

## SECTION 12: CURRENT FILE STRUCTURE

```
kingdom-game/
  src/
    main.js                    — starts IsometricScene
    scenes/
      IsometricScene.js        — ACTIVE: isometric renderer, extends GameScene
      GameScene.js             — kept as reference, not active
      BattleScene.js           — planned (Phase C)
    systems/
      Resources.js             ✅
      Buildings.js             ✅
      Pawns.js                 ✅
      Troops.js                ✅
      Expeditions.js           ✅ redesigned (special resources only)
      AIKingdom.js             ✅ 3 factions (Red/Purple/Yellow)
      ResourceNodes.js         ✅
      Wildlife.js              ✅ wolves/goblins/boars
      Territory.js             ✅ expansion + fog of war
    data/
      BuildingTypes.js         ✅
    audio/
      AudioManager.js          — sound roadmap placeholder
  public/
    assets/
      Tiny Swords (Free Pack)/          — units + UI sprites
      Isometric Strategy - Medieval Pixel Art Tiles/  — terrain + buildings
  DESIGN_DOC.md                — master design document (committed to git)
  index.html
  package.json
```

---

## SECTION 13: DESIGN DECISIONS LOG

| Decision | Choice | Date |
|---|---|---|
| Perspective | Isometric | June 2026 |
| World map type | Dual-view (Local + Continent/Tab) | June 2026 |
| Time system | 1 game day = 5 real minutes | June 2026 |
| Food system | Multiple types (Wheat/Meat/Fish), daily upkeep | June 2026 |
| Expeditions | Special resources only (not basic) | June 2026 |
| Battle trigger | Under 10 units = skirmish, 10+ = BattleScene | June 2026 |
| Multiplayer | Architecture aware, not built yet | June 2026 |
| Win condition | Not decided — revisit Phase F | TBD |
| After Castle tier | Not decided — low priority | TBD |

---

## SECTION 14: NEXT SESSION PROMPT NOTES

Always include this doc at the top of every major Claude Code prompt.

**Current status: Full game audit complete ✅ — clean bill of health**
- Zero critical/major bugs
- One minor banner overlap fixed
- All systems verified working end-to-end
- Commit: 7041a18

**Known design observations (not bugs):**
- Kingdom attack banners should jump the warning queue (currently FIFO)
- Central building placement doesn't visibly expand territory (correct but confusing)

**Next session target: Phase C — BattleScene.js**
Completely isolated file, zero risk to existing systems.
- Triggers when 10+ units on either side
- Pre-battle formation phase (30 sec)
- Real time combat with morale system
- Outcome feeds back to world map
- See Section 8 for full spec

**After Phase C:**
- Phase D — Economy depth (Market, Caravans, Blacksmith, Knights)
- Phase E — Polish & Feel (sound, animations, full 9-stage progression)
- Phase F — Late game (diplomacy, multiplayer consideration)

---

## SECTION 15: MAJOR UPDATE — BATTLES, BUILDINGS, PROGRESSION, DIPLOMACY ✅

This session implemented the strategic mid/late-game layer:

**BattleScene (`src/scenes/BattleScene.js`)** — separate scene; triggers when a
combat involves 10+ combined units. Terrain-themed field, armies spawn
left/right, terrain obstacles, 20s pre-battle with 4 formation buttons
(Line/Wedge/Defensive/Flank), then auto-combat with a 5-button command bar
(Charge/Hold/Flank L/R/Retreat), per-side morale bars (green/yellow/red),
floating damage numbers, archer projectiles, death fades. Outcome (Victory/
Defeat/Retreat) returns surviving army + loot to the world.

**New buildings** — Market (2×2, trade panel, 1/day), Blacksmith (2×2, crafts
Equipment/day, enables Knights), Watchtower (1×1, +8 fog reveal), Tavern (2×2,
+10 battle morale, recruit mercenaries), Wall (1×1, placeable anywhere, blocks
pathing, no-cap). New resource: **Equipment**.

**Knights** — Barracks L2 + operational Blacksmith; 80g+30 food+1 equipment;
HP 120 / 25 dmg, blue-steel armored sprite.

**9-stage settlement progression** — Small/Medium/Large Village → Small/Medium/
Large Town → Small/Medium/Large Castle, each with cost, building cap (8→40),
stage-gated buildings, castle sprite swaps (village→wooden→stone fort), walls
(fence→wood→stone), moat + corner towers at castle stages, milestone banners.

**Caravans (`src/systems/Caravans.js`)** — routes between owned settlements
(max 3), daily specialty delivery scaled by distance, raid chance.

**Administrators** — assign to a conquered settlement: +30% tribute, 50 gold/day.

**Diplomacy (`src/systems/Diplomacy.js`)** — per-kingdom relationship (-100..100),
reacts to attacks/tribute/time; thresholds gate attacks; Send Tribute / Declare
War / Non-aggression Pact / Trade Alliance from the kingdoms panel.

**World polish** — priority warning banners (kingdom attacks jump the queue),
territory pulse on every build, goblin-camp red banners + rubble, seasonal
terrain tints, decorative wandering villagers.

**Performance** — terrain is a single batched Blitter (no 40k-tile depth sort);
territory recompute is bounded to the area around changed tiles.

---

*Git repo: github.com/CharlesTheAlexander/kingdom-game*
*Local: ~/Desktop/kingdom-game*
*Dev server: localhost:5174*