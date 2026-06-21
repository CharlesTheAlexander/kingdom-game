# VISUAL SYSTEMS — REFERENCE

How every visual/audio system in Kingdom Game is built and where it lives in the
code. **Everything is procedural**: Phaser 3 Graphics/Canvas for art and the Web
Audio API for sound. There are no image files, sprite sheets, or audio assets —
all textures are generated at runtime into the Phaser texture cache, and all
sounds are synthesised from oscillators and filtered noise.

The 10-phase overhaul is summarised in `DESIGN_DOC.md` → "THE VISUAL OVERHAUL".
This document is the per-system map.

---

## 1. Terrain (Phase 1)
- **Code:** `src/systems/AssetGenerator.ts` → `generateTerrain(scene)` (~line 340),
  driven from `generateAll()` (~line 2034).
- **What it does:** generates the iso tile textures (`iso_grass`, `iso_grass2/3`,
  `iso_forest1..3`, `iso_water`, `iso_mtn`, …) with organic edge blending and
  multiple variants. `IsometricScene` lays them out with per-tile jitter/tilt so
  the grid never looks mechanical.
- **Used by:** `IsometricScene` (world ground) and `MainMenuScene` (the drifting
  backdrop band).

## 2. Buildings (Phase 2)
- **Art:** `src/systems/AssetGenerator.ts` → `generateBuildings(scene)` (~line 943).
- **Runtime object:** `src/systems/Buildings.ts` → `class Building` (shadow at
  depth 4, sprite at depth 5, HP/level/worker indicators) and `BuildingManager`.
- **Placement glue + decoration:** `IsometricScene.decorateBuilding()`,
  `placeBuilding`/`buildings.place`. Tier visuals: `IsometricScene.upgradeTier()`
  / `restoreTier()`.

## 3. Units (Phase 3)
- **Art:** `src/systems/AssetGenerator.ts` → `generateUnits(scene)` (~line 1266)
  (warriors, archers, monks, knights, cavalry, spearmen, mercenaries, plus enemy
  goblins/wolves/dragon).
- **Runtime:** `src/systems/Troops.ts`, `src/systems/Pawns.ts`,
  `src/systems/ArmyManager.ts`; battlefield rendering in `BattleScene`.

## 4. World objects & environment (Phase 4)
- **Code:** `src/systems/AssetGenerator.ts` (trees, rocks, decoration textures),
  `src/systems/ResourceNodes.ts`, `src/systems/Wildlife.ts`. Scatter/placement is
  done by `IsometricScene` during world build.

## 5. Sky / day-night / weather (Phase 5)
- **Code:** all in `src/scenes/IsometricScene.ts`:
  - `createDayNightOverlay()` (~line 4310) — sky gradient band, day/night tint
    overlay (`dnOverlay`), season overlay, stars/nebula/clouds, sky-bodies graphics.
  - `atmosphereAt(phase)` / `skyPaletteAt(phase)` — colour keyframes.
  - `updateDayCycle(gdelta)` (~line 4520) — advances the clock, computes
    `_nightness`, draws the sky each frame.
  - `drawSkyGradient` / `drawSkyBodies` / `updateAtmosphereFx` — per-frame sky.
  - `createWeather()` (~line 4392) + `updateWeather()` — snow/rain/fog emitters,
    lightning (`_strikeLightning`), and ambient particles
    (`createAmbientParticles`/`updateAmbientParticles`).
  - `updateSeason()` (~line 4367) — seasonal colour grading + the season-change
    wash, which also fires the `season_change` sound cue.
- **Audio:** looping wind/rain beds via `SoundEngine.startAmbient/stopAmbient`.

## 6. UI panel painters (Phase 6)
- **Code:** `src/scenes/IsometricScene.ts`:
  - `parchmentPanel(x,y,w,h,opts)` (~line 2792) — aged parchment sheet.
  - `stonePanel(x,y,w,h,opts)` (~line 2891) — carved stone slab.
  - `spriteButton(...)`, `panelText(...)`, carved tab strip, top-bar painter
    (`stonePanel` at the top), unfurling-scroll banner (~line 2747).
  - Sound control HUD: `drawSoundControl()`; settings menu volume/mute.
- **Other UI scenes:** `src/scenes/CouncilScene.ts` (council hall),
  `src/scenes/GameScene.ts` (constants `GAME_W`/`GAME_H`).

## 7. Particles / VFX (Phase 7)
- **Code:** `src/scenes/IsometricScene.ts`:
  - `explosionAt(x,y)` (~line 2475), `tierUpFx(x,y)` (~line 2602, gold burst +
    confetti + flash), building-placed bursts, fire effects, `floatText(...)`
    feedback, camera shake on tier-up.
  - `src/systems/Animations.ts` for shared tween helpers.
- **Combat VFX:** in `BattleScene` (hit sparks, arrow trails, death fades,
  cavalry dust, victory flourish).

## 8. Continent map (Phase 8)
- **Code:** `src/scenes/ContinentScene.ts`. Illustrated cartographic parchment
  (palette constants `PARCH*` at top), static sheet drawn once (`create()`),
  inked borders, faction territories, routes, compass, legend, parchment stats
  header. Launched (paused world) from `IsometricScene.openContinent()`.

## 9. Battle visuals (Phase 9)
- **Code:** `src/scenes/BattleScene.ts`. `drawTerrainGround(terrain)` (~line 508),
  formation markers/labels (~line 620), formation BLOCK rendering for large
  armies (~line 707), in-battle weather, cavalry dust, victory weapon-raise.
  Launched (paused world) from the three `IsometricScene` battle entry points.

## 10. Menu, transitions & loading (Phase 10)
- **Main menu:** `src/scenes/MainMenuScene.ts`:
  - `create()` — dusk sky gradient, drifting iso-world band, warm-horizon glow.
  - `makeVignette()` — radial vignette frame (cached texture).
  - `makeAtmosphere()` — drifting clouds + a looping bird flock.
  - carved stone/gold **KINGDOM** title with a pulsing additive glow.
  - `menuButton(...)` — carved-tablet button (gold rim, hover glow, sunk pressed
    state). All menu handlers/flow unchanged.
- **Transitions / loading card:** `src/scenes/TransitionOverlay.ts` →
  `showTransition(scene, opts)`. A self-cleaning, skippable loading tablet
  (banner, circular loader, rotating medieval quote). Cleans up on the host
  scene's SHUTDOWN/DESTROY and tracks all tweens/timers (leak-safe across
  `scene.restart`).
  - Invoked via `IsometricScene._launchWithTransition(title, sub, tint, doLaunch)`
    (a thin wrapper that runs the **original** launch+pause at the card midpoint),
    used at the Battle / Continent / Council launch sites, and from
    `src/systems/GreatCouncil.ts` `call()`.
- **Night warmth:** `IsometricScene.createNightGlow()` / `updateNightGlow(night)`
  — additive amber glow pooled around buildings, scaled by `_nightness`; off in
  daylight, rebuilt only on building-count change.

## Audio engine (cross-cutting)
- **Code:** `src/audio/SoundEngine.ts` — single shared `sfx` instance. Synthesis
  primitives `tone()`, `noise()`, `arp()`; event dispatcher `play(event)` /
  `playThrottled(event, ms)`; looping ambient beds `startAmbient`/`stopAmbient`.
- **Phase-10 cues added:** `season_change`, `settlement_upgrade`, `transition`,
  `menu_confirm`. Higher-level `AudioManager` lives in `src/audio/AudioManager.ts`.
- All cues are called from **existing** event hooks only; no game logic changed.
