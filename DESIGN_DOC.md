# KINGDOM GAME — MASTER DESIGN & PRODUCTION DOCUMENT
*Last updated: June 2026 — auto-updated after every session* (3)

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

### Phase C — Army & Battle System ✅ COMPLETE
- ✅ BattleScene.js — terrain-themed battlefield, armies spawn left/right
- ✅ Pre-battle phase (20s): Line/Wedge/Defensive/Flank formation buttons
- ✅ Real-time combat: 5-button command bar (Charge/Hold/Flank L/R/Retreat)
- ✅ Per-side morale bars (green→yellow→red), routing at 0
- ✅ Floating damage numbers, projectiles, death fades
- ✅ Victory/Defeat screen → survivors + loot returned to world
- ✅ Knight unit: HP 120, damage 25, needs Blacksmith + Barracks L2 + Equipment
- ⬜ Manual unit dragging in pre-battle (simplified to formation buttons)
- ⬜ Box-select within battle (commands apply to whole army)
- ⬜ Siege mechanics (planned later)

### Phase D — Continent View ✅ COMPLETE (Phase B2)
- ✅ ContinentScene.js — Tab to toggle
- ✅ Catan-style biome visualization
- ✅ Territory coloring by faction
- ✅ Settlement icons, hover tooltips, click to focus
- ✅ Live stats (day/season, % owned, active threats)
- ⬜ Caravan dots on continent view (deferred)

### Phase E — Economy Depth ✅ COMPLETE
- ✅ Market building (2x2, trade panel, once per day)
- ✅ Blacksmith (2x2, crafts Equipment resource, enables Knights)
- ✅ Watchtower (extends fog of war reveal)
- ✅ Tavern (morale bonus, mercenary recruitment)
- ✅ Wall segments (block enemy pathfinding, have HP)
- ✅ Equipment resource (crafted at Blacksmith, consumed training Knights)
- ✅ Caravan system (Caravans.js, routes between owned settlements)
- ✅ Administrator system (50g/day, auto-manages conquered settlements)
- ✅ Diplomacy system (Diplomacy.js, relationship meters -100 to +100)
- ✅ Non-aggression pacts, trade alliances, coordinated attacks
- ⬜ Road building (deferred)
- ⬜ Per-settlement stockpiles (caravans use pooled resources)
- ⬜ Caravan dots on continent view

### Phase F — Polish & Feel 🔄 IN PROGRESS
- ✅ 9-stage settlement progression (Small/Medium/Large Village→Town→Castle)
- ✅ Building caps: 8→12→16→20→24→28→32→36→40
- ✅ Stage-gated buildings, castle sprite swaps per tier
- ✅ Wall styles evolve (wooden→stone), moat + corner towers at Castle
- ✅ Milestone announcement banners
- ✅ Priority kingdom-attack banners (jump warning queue)
- ✅ Territory pulse animation on every building placement
- ✅ Goblin camp visuals (banners + rubble on destruction)
- ✅ Seasonal terrain tints (Spring/Summer/Autumn/Winter)
- ✅ Wandering villager NPCs in settlement
- ✅ Performance: Blitter-batched terrain, bounded territory recompute
- ✅ Resource bar: consistent icon+value+label chips, flash on change, critical pulse
- ✅ Tutorial: 5-stage interactive (localStorage, never repeats), accurate hints
- ✅ BattleScene visual overhaul: terrain backgrounds, 56px units, morale bars, dramatic overlays
- ✅ Diplomacy UI: center-tick relationship bars, color-coded status, preview action effects
- ✅ Bottom panel tabs: Build/Expeditions/Kingdoms/Caravans
- ✅ Building costs show icons not abbreviations
- ✅ Building tooltips on hover
- ✅ Auto-exit placement mode after placing
- ✅ Floating identity icons on reused-sprite buildings (bobbing coin/hammer/eye/mug)
- ✅ Starting area expanded (20 tile reveal, nodes near castle)
- ✅ Fog color: deep blue-gray (less oppressive)
- ✅ Territory border: warm gold with gentle pulse
- ✅ Continent view: local view rectangle, softened biome edges
- ✅ Transition fades on scene switches
- ✅ Sound design: SoundEngine.js, ~20 events, fully procedural Web Audio, mute toggle
- ✅ Unit animations: Animations.js, spritesheet-driven, idle/walk/attack/heal per unit type
- ✅ Pawn animations: tool-matched (axe=wood, pickaxe=stone), interact loops at nodes
- ✅ BattleScene animations: all unit states wired
- ✅ Day/night cycle: 4-phase interpolated (dawn/day/dusk/night), sun/moon, stars, torches
- ✅ Per-building flickering torches at night
- ✅ Snow particles (Winter, mountains + settlement, building snow caps)
- ✅ Rain particles (Spring/Autumn, diagonal)
- ✅ Seasonal ambient sound (wind/rain, 0.1 vol)
- ✅ Text overflow audit: resource values abbreviate (125k/48k), expedition card fixed
- ✅ Economy balance: Castle gold 2→1.5/sec (gold was 4-20x early costs)
- ✅ BALANCE_REPORT.md written with full data tables
- ⬜ Win/lose conditions
- ⬜ Idle freelance yields reduction (recommended but deferred — warrants own playtest)
- ⬜ More gold sinks in early game

**Branch:** ui-presentation-overhaul (commit e965a7d + polish commits)
Run: git checkout main && git merge ui-presentation-overhaul

**Key balance findings from simulation:**
- Stone: ~60/day from idle workers — NOT scarce as suspected
- Food: fine with one Farm, crisis only if army built before Farm
- Gold: was oversupplied (600/day vs 30-150 early costs) — trimmed to 450/day
- Iron: correct pacing lever for late game, intentional gate
- All tier upgrade costs affordable in proportion to income
- Freelance workers may be TOO generous — reduces need for building allocation

### Phase H — Save System + Population ✅ COMPLETE
- ✅ SaveManager.js: complete state snapshot (resources, buildings, troops HP, fog-of-war bitset, diplomacy, AI kingdoms, settlements, nodes, expeditions, caravans, artifacts, flags, audio)
- ✅ 3 localStorage slots (slot 0 = auto-save)
- ✅ Menu (≡ button): Continue/Save/Load/Settings/New Game with slot metadata
- ✅ Auto-save: every 5 days + before BattleScene/Continent + on tab close
- ✅ S quick-save hotkey, "Saving..." indicator, "Kingdom Loaded" banner
- ✅ Corrupted/quota error handling
- ✅ Population.js: 10 start, +4/House, +1 every 3 days when fed
- ✅ Happiness 0-100: daily recompute, affects worker production (+10%/-20%/strike)
- ✅ Happiness HUD: face icon + breakdown tooltip
- ✅ Both systems persist through save/load
- Commits: 04780c5 (save), b0c1b96 (population)
- Branch: ui-presentation-overhaul

### Phase I — Army On Map ✅ COMPLETE (commits 0f8e7a3, 426800c)
- ✅ ArmyManager.js: named armies, terrain-based marching, supply, morale
- ✅ Army icons on map (faction-colored diamonds, unit count badge, morale dot)
- ✅ Armies tab in bottom panel: form, manage, disband
- ✅ March to location, neutral settlement, AI castle, enemy army
- ✅ Supply system: food from stockpile, morale drops when exhausted
- ✅ Auto-return home when morale hits 20
- ✅ Garrison duty at conquered settlements
- ✅ AI armies march visibly on map (not teleporting spawns)
- ✅ Warning banner when enemy army within 30 tiles
- ✅ Army dots on continent view, moving in real time
- ✅ BattleScene receives real army HP, returns survivors
- ✅ Coalition warfare: 3-day warning then synchronized assault
- ✅ Army quick-select hotkeys 1/2/3

### Phase J — World Events + King Identity ✅ COMPLETE (commits 7c39328, 0ce9b47)
- ✅ WorldEvents.js: 15 events (5 world news, 10 player choice)
- ✅ Seasonal events (harvest/winter/summer/spring modifiers)
- ✅ Messenger icon near castle, queues messages
- ✅ Message panel with choice buttons
- ✅ King creation screen (name + trait, one-time)
- ✅ 6 traits: Warlord/Merchant/Builder/Diplomat/Explorer/Scholar
- ✅ Reputation: Conqueror/Merchant/Protector/Destroyer (0-100)
- ✅ Kingdom title under name based on highest reputation
- ✅ Reputation effects on AI behavior and trade

### Phase K — Research Tree ✅ COMPLETE (commit 9d4740f)
- ✅ Library building (2x2, unlocks research)
- ✅ 9-tech tree: Military/Economy/Exploration branches
- ✅ Visual tree with prerequisite connections
- ✅ Progress bar in Library info panel
- ✅ Completion banners, effects applied immediately

### Phase L — Diplomacy Expansion + QOL ✅ COMPLETE (commits 3fecf53, ab378df)
- ✅ Trade Agreement treaty (+30 relations required)
- ✅ Military Alliance treaty (+60 relations, ally sends troops)
- ✅ Vassalage (demand tribute from weaker factions)
- ✅ Notifications log (last 50 events, color coded)
- ✅ Pause button (Space key, freezes all timers)
- ✅ Hotkeys: B/E/K/A/R/M/Space/Escape
- ✅ DESIGN_DOC.md updated with Section 18

### Phase M — Full Audit + Fixes ✅ COMPLETE (commit 4fce9fd)
- ✅ FULL_AUDIT_REPORT.md written — zero errors across 10 sessions
- ✅ King creation now pauses simulation (gameSpeed=0)
- ✅ Win conditions: Conquest/Diplomacy/Legacy all working
- ✅ WinConditions.js: checked in onNewDay()
- ✅ Victory screen: stats, Continue/New Game
- ✅ Defeat screen: redesigned with stats + Try Again
- ✅ Early AI tuning: garrison 3 each, Yellow day 6, Red day 9
- ✅ BattleScene subtitle: "Attacking"/"Assaulting"/"Defending" correct
- ✅ Diplomacy reputation: collapsible section, no overlap
- ✅ Node labels: fade by zoom, visible on hover
- ✅ Night: darker overlay, 40 stars, bigger moon/torches
- ✅ Winter: 250 particles, thicker snow caps, louder wind
- ✅ buildings.place() enforces stage gating

### Phase N — World Depth Session 1 ✅ COMPLETE
- ✅ Ancient ruins: 6 ruins in biomes, fog-hidden, one-time exploration, 6 unique rewards
- ✅ WanderingFactions.js: 2 caravans (trade/raid), 2 tribes (envoy→friendly), pilgrims
- ✅ Caravan trade: better-than-market rates, raid option
- ✅ Tribe effects: Forest→scouts+timber, Plains→food gifts
- ✅ Pilgrims: cross map, stop at Monastery for gold
- ✅ World events expanded: 15→28 events, seasonal additions
- ✅ Location histories: settlement/biome/goblin/AI castle discovery cards
- ✅ Tax system: Low/Normal/High/Extortionate, revolt mechanic
- ✅ Kingdom statistics panel: 6 sections, persists through save/load
- ✅ All faction dots on continent view
- Commits: 574a9b0, bf980a9, c09c933, 0600da1, 03c6321, 69a0720, d267dea

### Phase O — Major Bug Fix + UI Redesign ✅ COMPLETE
- ✅ 13 critical bugs fixed (soldier cap, alliance, AI army limits, fog, flank, battle blocks)
- ✅ Fullscreen canvas (fills browser window, responsive resize)
- ✅ K&C-inspired UI redesign: slim 7-category bar, toggle panels, visual research tree
- ✅ Auto-walls replace manual wall placement (breach delay mechanic)
- ✅ Loose units defend-only, must form army to attack
- ✅ 3 small stone nodes near starting castle
- ✅ Continent view restyled (saturated biomes, icons, river, vignette)
- ✅ BattleScene: Start Battle Now button, animated formation preview
- ✅ 100+ unit battles use formation blocks (readable at scale)
- Commits: 168077a, d0eee52, 0aa9e07, 9a9ff8d, f3e798a, 83e469d

**Known deviations:**
- Building/unit selection still uses bottom panel (floating world-space panels deferred)
- Wall type kept in save-compat only

### Phase P — Tonight: Autonomous Loop Session
- ⬜ Play → fix → improve loop until context exhausted
- ⬜ TypeScript migration (separate dedicated session)
- ⬜ In-battle tactical unit selection
- ⬜ Battlefield terrain bonuses
- ⬜ Building upgrades to 5 levels
- ⬜ Manufacturing chains
- ⬜ Banking system
- ⬜ Great Council
- ⬜ Asset replacement
- ⬜ Main menu screen

### Phase O — Late Game
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

**Current status: Major bug fix pass complete ✅**

**Bugs fixed (commit 8dac94e, branch ui-presentation-overhaul):**
- ✅ Torch particles drift on zoom (fixed world projection)
- ✅ Cannot place buildings behind castle (clicks fall through in placement mode)
- ✅ Tab locks in continent view — CRITICAL (bulletproof: fallback timer, try/catch, Escape key, always-on return button)
- ✅ Warriors/mercs don't attack settlements (playerCommanded flag disables home leash)
- ✅ Soldier cap ignores expedition soldiers (deployedSoldiers() added to total)
- ✅ Walls place outside territory (click re-validates on placement)
- ✅ Kingdom panel text unreadable (white bold on dark backgrounds, proper sizing)
- ✅ Units run home after move command (playerCommanded flag holds at destination)
- ✅ Market 1-trade/day limit removed (unlimited trades)
- ✅ Move and Demolish buildings added (free to move, 50% refund on demolish, Castle exempt)

**Note:** stray IsometricScene 2.js exists in src/scenes/ — delete it manually

**Commits:**
- 61e7691: idle workers, wolf spawns, expedition slots, UI declutter
- e167ff8: world expansion + continent view
- 7041a18: full game audit fixes
- isometric tile placement fix
- 249e344: BattleScene + new buildings + 9-stage progression + diplomacy
- e965a7d: UI presentation overhaul
- polish commits (animations, sound, weather, balance)
- 8dac94e: bug fixes + move/demolish buildings

**Next session: UI Overhaul**
Based on GAME_CRITIC_REPORT.md (committed to project).

Top 3 critic priorities:
1. Resource bar — inconsistent icons, gold/iron unreadable
2. BattleScene — flat green void, tiny units, no spectacle
3. Tutorial — outdated, contradicts actual mechanics (auto-gather)

Other high priority:
- Expedition panel overlap/clipping bugs
- Diplomacy bars empty at neutral (looks broken)
- Spatial disconnect: top-right openers open bottom panels
- New buildings are tinted clones (Market = windmill)
- Placement mode doesn't auto-exit

---

*Git repo: github.com/CharlesTheAlexander/kingdom-game*
*Local: ~/Desktop/kingdom-game*
*Dev server: localhost:5174*