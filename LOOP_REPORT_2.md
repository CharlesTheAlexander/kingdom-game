# Loop 2 Report

## STEP 1 — PLAY
Re-verified after Loop 1: battles still resolve normally (box-select falls back to
whole-army when nothing is selected). Build passes, console CLEAN.

## STEP 2 — FIX
None required.

## STEP 3 — IMPROVE — Feature #2: Battlefield terrain bonuses ✅
- **High ground** (top ~22% of the field): attackers there deal **+20% damage**.
- **River crossing** (bottom edge band): attackers there deal **−20% damage**.
- **Forest** (the scattered obstacle clusters): defenders standing in them take
  **30% less damage** (+30% effective defense).
- Zones are drawn as background bands with labels ("High Ground · +20% damage",
  "River Crossing · −20% damage"); forest = the existing scenery obstacles.
- Applied to both melee and ranged (and area) attacks; verified multipliers
  (1.2 / 0.8 / 1.0 attack, 0.7 forest defense) and a clean battle return.

Crossed off list item #2. Next: #3 (building upgrades to 5 levels).
