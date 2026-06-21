# Bannerlord-Style Rebuild — Progress Tracker

Branch: `bannerlord-rebuild` (main stays on the deployed visual-overhaul build until this is merged).
World size: **1500×1500** (chunk math adjusted; target 30+ FPS via aggressive chunk load/unload).
Rule: every phase must `npm run build` clean + boot with ZERO console errors before the next starts.

- [ ] P1 — World generation (1500×1500 Perlin, biomes, rivers, resources, factions, chunked rendering)
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
