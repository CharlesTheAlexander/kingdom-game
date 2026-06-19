import Phaser from 'phaser';
import './style.css';
import { GameScene, GAME_W, GAME_H } from './scenes/GameScene.js';

const config = {
  type: Phaser.AUTO,
  parent: 'app',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#0f0f1a',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [GameScene],
};

const game = new Phaser.Game(config);

// Dev-only handle for debugging in the browser console (stripped from prod builds).
if (import.meta.env.DEV) window.__game = game;
