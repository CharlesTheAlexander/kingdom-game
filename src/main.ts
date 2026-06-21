/// <reference types="vite/client" />
import Phaser from 'phaser';
import './style.css';
import { GameScene, GAME_W, GAME_H } from './scenes/GameScene.js';
import { IsometricScene } from './scenes/IsometricScene.js';
import { ContinentScene } from './scenes/ContinentScene.js';
import { BattleScene } from './scenes/BattleScene.js';

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
  // IsometricScene is the active scene (first in the array auto-starts);
  // GameScene stays registered as reference but is not started. ContinentScene
  // is launched on demand (Tab) on top of the local view.
  scene: [IsometricScene, GameScene, ContinentScene, BattleScene],
};

const game = new Phaser.Game(config);

// (Phase 2) Keep the canvas matched to the window on resize.
window.addEventListener('resize', () => { game.scale.refresh(); });

// Dev-only handle for debugging in the browser console (stripped from prod builds).
if (import.meta.env.DEV) (window as any).__game = game;
