# Loop 3 Report

## STEP 1 — PLAY
Build healthy, console CLEAN after Loops 1–2.

## STEP 2 — FIX
None required.

## STEP 3 — IMPROVE — Feature #3: Building upgrades to 5 levels ✅
- `MAX_LEVEL` 3 → **5** for every building, with a gentler output curve
  ([1, 1.5, 2.25, 3, 4]) instead of the old runaway 2^level; upgrade cost rises
  ~1.8× per level to gate the high tiers. Selected-building panel and upgrade
  button already key off `MAX_LEVEL`, so they read "Lv X/5" automatically.
- **Level 4–5 perks (completable, no new resource types):**
  - Mine L4+: ~10% chance per tick to find +1 iron (no expedition needed).
  - Lumberyard L5: +25% surplus output.
  - Farm L5: auto-feeds the army → daily food upkeep halved.
  - Barracks L4: warriors trained arrive as **Elites** (+50% HP & damage).
  - Barracks L5: unlocks the **Champion** (200 HP / 40 dmg, 1 max), trainable
    from the Military panel and the barracks panel.
- Verified: output scales (4→16 at L5), mine finds iron, farm halves upkeep,
  champion queues once then refuses a second, elite warrior spawns at 75 HP.

**Scoping decision (documented in code):** Planks (Lumberyard L4) and a separate
Meat resource (Farm L4) are intentionally deferred to Feature #4 (manufacturing
chains), which introduces the new resource types they depend on. Elite/Champion
keep their boosted stats in world skirmishes; large BattleScene clashes still
collapse units to base types (a pre-existing limitation shared by mercenaries).

Crossed off list item #3. Next: #4 (manufacturing chains — Sawmill/Stonecutter).
