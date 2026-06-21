# Bannerlord-Style Rebuild — Progress Tracker

Branch: `bannerlord-rebuild` (main stays on the deployed visual-overhaul build until this is merged).
World size: **1500×1500** (chunk math adjusted; target 30+ FPS via aggressive chunk load/unload).
Rule: every phase must `npm run build` clean + boot with ZERO console errors before the next starts.

- [x] P1 — World generation (1500×1500 Perlin, biomes, rivers, resources, factions, chunked rendering)
      Files: src/data/Biomes.ts, src/systems/WorldGenerator.ts, src/systems/ChunkManager.ts (+ DEV hook in main.ts).
      Decisions: TOP-DOWN (orthographic) continent render, NOT iso, at 1500×1500; 50×50-tile chunks => 900 chunks;
      4px/tile chunk textures (200x200px), <=36 resident (LRU + window cull), ~5.8 MB texture budget. Seeded mulberry32
      + seeded value-noise (3 uncorrelated perms). Radial falloff => single continent. Audit (seed 1337): all 12 biomes
      present, 535 river tiles / 4 rivers, 28 settlements (1 player castle, 3 AI, 9 neutral, 9 goblin, 6 ruin),
      player >=424 tiles from every AI, 12,242 resource nodes, FPS 49, zero console errors, deterministic.
- [x] P2 — ContinentScene as PRIMARY game loop (party movement, A*, time, supply)
      Files: src/scenes/ContinentScene.ts (full rewrite), src/systems/GameWorld.ts (shared state singleton),
      src/systems/ContinentPathfinder.ts (A*), src/scenes/KingCreationScene.ts (standalone creation),
      src/main.ts (scene array + DEV __gw hook), src/scenes/MainMenuScene.ts (new-game flow),
      src/systems/ChunkManager.ts (MAX_RESIDENT 36→320 + window-protected LRU so a 0.4× viewport's
      ~220-chunk window never self-evicts mid-render).
      Flow: MainMenu → KingCreationScene → (first-play) IntroCutsceneScene → ContinentScene. Continue/Load
      also land on ContinentScene. World stored in GameWorld (WorldState + player party/supply/gold/day +
      currentSettlementId + pendingBattle), structured for Phase-12 serialize (seed + mutable layer only;
      typed arrays rebuilt from seed).
      Continent: chunked top-down render via ChunkManager (pooled Images bound to visible texture keys),
      camera follow + right-drag pan + wheel zoom (0.2–1.5, default 0.4); player crown crest w/ army badge +
      supply dot (green/yellow/red); left-click A* move using per-biome movementCost, dotted route + ETA
      ("Arrives in ~X days"), right-click cancels; continuous time (1 day = 5 min / DAY_MS, never pauses)
      with onNewDay hook; supply drains in the field, resupplies at the player castle; 1–3 AI parties per
      AI faction moving to personality objectives (aggressive→player, merchant/expansionist→settlements)
      w/ hover tooltip, fog-gated; fog of war (coarse explored bitmap, lifts around player + home);
      settlement interaction (≤2 tiles → Enter? confirm → SAFE per-settlement overlay stand-in w/ Leave —
      real IsometricScene transition deferred to Phase 3 to stay boot-clean; id passed via GameWorld);
      battle trigger (≤3 tiles → "Enemy army approaching!" banner; collision → real BattleScene via existing
      launch contract, survivors/loot restored, drop back on continent at battle site); slim HUD top bar +
      whole-world minimap w/ player/settlement/AI dots + viewport rect.
      Audit (headless, full new-game flow): ContinentScene becomes active; party moved (A* path len 40-56);
      day 1→2; supply 10→9.2 while traveling; 6/6 AI parties moved; enter/leave round-trip OK; battle
      launch+return OK; right-click cancel OK; Continue→continent OK; FPS while panning 53-59 @0.4× (min 56
      sustained), resident chunks ~126 bounded; ZERO console errors. tsc clean, build clean.
      STUBBED for later: per-settlement view is a safe overlay (Phase 3 = real local IsometricScene);
      supply→desertion is a morale-erosion flag only; Continue/Load rebuild from king record, not a full
      slot restore (Phase 12 SaveManager); passive +5 gold/day is a placeholder economy.
- [ ] P3 — IsometricScene as PER-SETTLEMENT view (per-settlement state, enter/leave)
- [ ] P4 — Pioneer system (found settlements anywhere)
- [ ] P5 — Living expedition system (parties on the continent)
- [ ] P6 — Hero world integration (dialogue, quests, stationing)
- [ ] P7 — Diplomatic narrative continuity (leader memory, honor)
- [ ] P8 — Late game content (stages 8–9, tournament, imperial)
- [ ] P9 — Battle fog of war + river system
- [ ] P10 — Win consequence system (reputation endings)
- [ ] P11 — Economy mid-game reinvestment (equipment, prestige, monuments)
- [ ] P12 — Full integration + save system update
