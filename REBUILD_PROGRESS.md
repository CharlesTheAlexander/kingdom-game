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
- [ ] P2 — ContinentScene as PRIMARY game loop (party movement, A*, time, supply)
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
