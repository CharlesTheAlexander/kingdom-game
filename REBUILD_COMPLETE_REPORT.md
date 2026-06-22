# Bannerlord-Style Rebuild — Complete Report

Branch: `bannerlord-rebuild` (12 phases, each committed; built on top of the deployed
visual-overhaul game). Every phase boots clean with **zero console errors** and `npm run
build` / `tsc --noEmit` are clean throughout.

## New architecture
- **ContinentScene** is now the PRIMARY game loop. The player exists as a moveable party
  on a procedurally generated **1500×1500** continent (top-down, chunked rendering). Time
  passes continuously; you move via A* over per-biome movement costs, manage supply, meet
  AI parties, raid camps, explore ruins, found colonies, and fight battles — all on the map.
- **IsometricScene** is now a PER-SETTLEMENT view. Entering a settlement loads its own
  `SettlementState` + a local map themed from its world biome; you build/manage there and
  "Leave" to return to the continent. The world clock keeps advancing while you're inside.
- **BattleScene** is unchanged in concept; battles are triggered by party collisions / camp
  raids and return outcomes to the continent.
- **GameWorld** (`src/systems/GameWorld.ts`) is the single shared campaign-state singleton
  read/written by every scene and serialized by the save system.

## Phase deliverables
1. **World generation** — seeded mulberry32 + fractal value-noise; height/temperature/moisture
   → 12-biome table; 4 rivers + bridges; biome-appropriate resources; faction/settlement/camp/
   ruin placement (player ≥424 tiles from every AI); chunked top-down renderer (50×50 chunks,
   bounded resident set). `WorldGenerator.ts`, `Biomes.ts`, `ChunkManager.ts`.
2. **Continent primary loop** — chunked render, player party + A* movement + path/ETA, continuous
   time + supply, AI parties with objectives, settlement enter, battle trigger, fog, HUD, minimap.
   New `KingCreationScene` + `GameWorld` shared state; new-game flow → continent.
3. **Per-settlement view** — `SettlementState`, biome-themed local maps, enter/leave, world-scale
   systems neutered inside the local view (re-homed to the world in later phases).
4. **Pioneer system** — send a pioneer party, guide it, found a new colony anywhere (added to the
   world + its own SettlementState), biome specialty (+25%), goblin ambush vulnerability.
5. **Living expeditions** — ruins exploration, goblin-camp raids (BattleScene), worker mining
   parties, mercenary camps, caravan raids, a simplified expedition panel, visible party icons.
6. **Hero world integration** — heroes re-homed to the world, travel with the party (portrait
   overlays), stationing at settlements, ~20–32 contextual dialogue lines/hero, hero-hero
   interactions, and all 6 personal quests (+ a 7th hero "The Ancient" via prestige).
7. **Diplomatic narrative** — world-level Diplomacy/FactionLeaders, per-leader memory, history-based
   dialogue ladders, memory events (gifts), betrayal consequences, and an honor system.
8. **Late game (stages 8–9)** — Grand Tournament, Legendary Forge, extra army slot, emissaries,
   Imperial Proclamation, Chronicle of the Kingdom, raised caps, transition events.
9. **Battle fog of war + rivers** — intel-gated pre-battle reveal (none/basic/full/Mira) with a
   fog-lift sweep; river crossing costs, destructible bridges, ferry docks, river battles.
10. **Win consequences** — world-level reputation + win checks; 8 reputation-shaped ending variants
    + the unique Empire ending; win screen with a reputation profile + key deeds from the chronicle;
    ongoing world reactions by dominant reputation.
11. **Economy reinvestment** — army equipment tiers (Iron/Steel/Legendary, army-wide + visual),
    settlement investment, a prestige score (+ effects, the 7th hero, monuments), and the Imperial
    research branch.
12. **Integration + save system** — this phase (below).

## Save system (Phase 12)
- A save is `{ v:2, meta, gameWorld: GameWorld.serializable() }` in localStorage slots (0 = auto,
  1–3 manual). `serializable()` persists the **seed + the full mutable campaign layer** only — the
  11 MB typed-array world is rebuilt deterministically from the seed.
- `SaveManager.loadGame(slot)` → `generateWorld(seed)` → `GameWorld.restoreFrom(world, data)`
  reapplies everything: player party/position/supply, gold, day, every `SettlementState`, all
  continent parties, the full settlement list (so **founded colonies + mercenary camps survive**),
  heroes (roster/XP/stations/quests/flags), diplomacy + leader memory + honor, reputation,
  prestige/monuments/equipment, bridges/ferries/intel, late-game flags, and the chronicle —
  rebuilding the host-backed system instances (Heroes/Diplomacy/Leaders/Reputation) on fresh hosts.
- Auto-save to slot 0 every 3 days and on entering/leaving a settlement; `S` quick-saves to slot 1;
  the menu **Continue/Load** restore via `loadGame`. All localStorage access is try/catch-guarded.

## Integration verification (headless, live server)
- Real new-game flow: MainMenu → KingCreation → (intro) → **ContinentScene active**, kingdom set.
- Party moves via A*; the day counter advances continuously; supply drains while travelling.
- Pioneer founds a colony ("Newhaven") which is enterable and **persists across save/load**.
- Ruins explore, goblin raids (battle), mercenary hire, intel-gated battle fog, leader memory,
  stages 8–9 actions, equipment/invest/prestige/monuments — all exercised in earlier phase audits.
- **Save → wipe → load** restores every value exactly (gold, prestige, equipment, honor, heroes,
  seed, settlements incl. the founded colony); **menu Continue** resumes from the save (gold 7777).
- `tsc --noEmit` clean · `npm run build` clean · **0 console errors / 0 warnings** · **FPS 45–60**.

The rebuilt game is the real game now: a living continent you travel, with settlements you visit,
a story that remembers you, and a save that captures all of it.
