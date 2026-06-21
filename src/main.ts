/// <reference types="vite/client" />
import Phaser from 'phaser';
import './style.css';
import { GameScene, GAME_W, GAME_H } from './scenes/GameScene.js';
import { MainMenuScene } from './scenes/MainMenuScene.js';
import { IsometricScene } from './scenes/IsometricScene.js';
import { ContinentScene } from './scenes/ContinentScene.js';
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
  // MainMenuScene auto-starts (first in the array) and launches IsometricScene
  // on New Kingdom / Continue / Load. GameScene stays registered as reference;
  // ContinentScene is launched on demand (Tab) on top of the local view.
  scene: [MainMenuScene, IsometricScene, GameScene, ContinentScene, BattleScene, CouncilScene, IntroCutsceneScene],
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
}
