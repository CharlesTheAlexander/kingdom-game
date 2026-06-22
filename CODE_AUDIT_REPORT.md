# CODE_AUDIT_REPORT.md — Agent 1 (Code Auditor)

Scope: all 66 `.ts` files under `src/`. Method: full type check, production build,
dependency/dead-code analysis, wiring trace of the new-game flow and the Bannerlord
scene architecture, targeted scans for stubs/empty-handlers/console-noise.

## Headline result
- **`tsc --noEmit` → 0 errors, 0 warnings.**
- **`npm run build` → success** (`dist/assets/index-BwqaIsQn.js`, the deployed hash).
- New-game flow is correctly wired end to end:
  `MainMenu.newKingdom → KingCreationScene → (first-play) IntroCutsceneScene → ContinentScene`,
  with `ContinentScene` as the PRIMARY loop. `continueGame()` restores world saves
  from slots 0/1/2 via `SaveManager.loadGame` → `generateWorld(seed)` → `GameWorld.restoreFrom`.
- No CRITICAL or HIGH code defects found. The architecture migration (host-adapter
  re-homing of Heroes/Diplomacy/FactionLeaders/Reputation to the world level) is intact.

## Findings

### LOW-1 — Dead file: `src/audio/AudioManager.ts` (DEAD CODE)
- 40 lines. Imported by **nothing**; appears only inside a *comment* in
  `IsometricScene.ts:20` ("audio roadmap placeholder"). The live audio system is
  `src/audio/SoundEngine.ts` (imported by 17 files).
- File is an explicit no-op placeholder with a `TODO`.
- **Severity LOW.** Fix: delete the file (zero risk — nothing references it).
- **Action:** removed as part of Agent 1 fixes.

### LOW-2 — Bundle size warning (PERFORMANCE / BUILD HYGIENE)
- `index-*.js` is 1.93 MB raw / 538 KB gzip → Vite emits a chunk-size warning
  (not an error). Single bundle because the game is one Phaser app with no route
  splitting.
- **Severity LOW.** Acceptable for a static itch-style game; gzip 538 KB loads fast.
- **Action:** documented for Agent 4. Code-splitting the scenes is possible but risky
  vs. reward; deferred unless playtest shows a slow first paint.

### INFO — Intentional "stubs" are NOT dead code
- `IsometricScene.ts:468+` defines deliberate **inert system stubs** for world-scale
  subsystems that are disabled inside the per-settlement view (goblin camps, neutral
  settlements, wandering factions, etc. now live on the continent). These are typed,
  callable no-ops by design (Phase 3) so per-settlement HUD/update code stays safe.
  Correct pattern — left as-is.
- The 13 `console.error/console.warn` occurrences are all inside `try/catch` guards
  (defensive logging), not hot-path noise. Runtime verified 0 console output on boot.

### INFO — Dual old/new system layers are intentional
- `WinConditions`↔`WinConsequences`, `Diplomacy`↔`WorldDiplomacy`, `Heroes`↔`HeroWorld`
  are deliberate two-layer designs from the rebuild (the base system is re-homed onto a
  world-level host adapter, the `*World`/`*Consequences` file is the world wrapper).
  Not duplication-by-accident; both layers are reached.

## Per-file spot checks requested in the brief
- **WorldGenerator.ts (755 lines):** 1500×1500 gen present; seeded PRNG + fractal noise;
  12-biome table; rivers; biome resources. Reachable from `generateWorld()` used by
  `startCampaign` and `loadGame`. OK.
- **ContinentScene.ts (2786):** primary loop; A* movement (`scene.launch('IsometricScene')`
  on settlement enter at :1952; `BattleScene` launch at :848/:2028; return to menu at :2745).
  Autosave wired in `onNewDay`. OK.
- **IsometricScene.ts (5854):** per-settlement view, inert world stubs, enter/leave. OK.
- **KingCreationScene / MainMenuScene:** flow verified above. OK.

## Severity ledger
| ID | Severity | Title | Status |
|----|----------|-------|--------|
| LOW-1 | LOW | Dead file AudioManager.ts | FIXED (deleted) |
| LOW-2 | LOW | Bundle size warning | Deferred (documented) |

No CRITICAL / HIGH / MEDIUM code defects. Real-world issues (visual, UX, interaction)
are expected to surface in the browser passes (Agents 2 & 3), not in static analysis —
the code type-checks and the wiring is sound.
