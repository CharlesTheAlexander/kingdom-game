/// <reference types="vite/client" />
import Phaser from 'phaser';
import './style.css';
import { GameScene, GAME_W, GAME_H } from './scenes/GameScene.js';
import { MainMenuScene } from './scenes/MainMenuScene.js';
import { IsometricScene } from './scenes/IsometricScene.js';
import { ContinentScene } from './scenes/ContinentScene.js';
import { KingCreationScene } from './scenes/KingCreationScene.js';
import { BattleScene } from './scenes/BattleScene.js';
import { CouncilScene } from './scenes/CouncilScene.js';
import { IntroCutsceneScene } from './scenes/IntroCutsceneScene.js';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#0f0f1a',
  scale: {
    mode: Phaser.Scale.FIT,          // (Phase 2) scale the 16:10 canvas to fill the window
    autoCenter: Phaser.Scale.CENTER_BOTH,
    expandParent: true,
  },
  // (Phase 2 Bannerlord rebuild) MainMenuScene auto-starts (first in the array).
  // New flow: MainMenu → KingCreationScene → (first-play) IntroCutsceneScene →
  // ContinentScene (the PRIMARY game loop). ContinentScene renders the chunked
  // 1500×1500 world and owns party movement/time/supply/AI. IsometricScene is
  // retained as the per-settlement view stand-in (Phase 3 makes it real);
  // BattleScene is launched on a continent battle trigger.
  scene: [MainMenuScene, ContinentScene, KingCreationScene, IsometricScene, GameScene, BattleScene, CouncilScene, IntroCutsceneScene],
};

const game = new Phaser.Game(config);

// (Phase 2) Keep the canvas matched to the window on resize.
window.addEventListener('resize', () => { game.scale.refresh(); });

// Dev-only handle for debugging in the browser console (stripped from prod builds).
if (import.meta.env.DEV) (window as any).__game = game;

// Phase 1 (Bannerlord rebuild) DEV-ONLY debug hook. Exposes the world generator
// + chunk renderer so the headless audit can generate a world and inspect it
// WITHOUT wiring anything into the scenes (that's Phase 2). This is the ONLY
// main.ts change allowed this phase — no scene changes.
if (import.meta.env.DEV) {
  import('./systems/WorldGenerator.js').then((wg) => {
    import('./systems/ChunkManager.js').then((cm) => {
      (window as any).__worldgen = {
        generateWorld: wg.generateWorld,
        biomeHistogram: wg.biomeHistogram,
        riverTileCount: wg.riverTileCount,
        getLastWorld: wg.getLastWorld,
        ChunkManager: cm.ChunkManager,
      };
    });
  });
  // (Phase 2) Expose the shared campaign state so the headless audit can read
  // the player party / day / supply / AI parties directly.
  import('./systems/GameWorld.js').then((gw) => {
    (window as any).__gw = gw.GameWorld;
  });
  // (Phase 4) Expose the Pioneer system so the headless audit can drive
  // sendPioneer / tryFound / tickAmbush programmatically per the spec.
  import('./systems/PioneerSystem.js').then((ps) => {
    (window as any).__PioneerSystem = ps.PioneerSystem;
  });
  // (Phase 5) Expose the Expedition system so the headless audit can drive
  // exploreRuin / raidCamp / sendWorkers / hireMercenaries / raidCaravan.
  import('./systems/ExpeditionSystem.js').then((es) => {
    (window as any).__ExpeditionSystem = es.ExpeditionSystem;
  });
  // (Phase 6) Expose the HeroWorld system so the headless audit can drive hero
  // arrivals, dialogue triggers, interactions, stationing, and the six quests.
  import('./systems/HeroWorld.js').then((hw) => {
    (window as any).__HeroWorld = hw.HeroWorld;
  });
}
