import Phaser from 'phaser';
import { GAME_W, GAME_H } from './GameScene.js';
import * as AssetGenerator from '../systems/AssetGenerator.js';
import * as SaveManager from '../systems/SaveManager.js';
import { sfx } from '../audio/SoundEngine.js';

// MainMenuScene (Completion Phase 1) — the first screen the player sees.
// A slowly panning procedural-terrain backdrop, animated falling leaves, the
// game title, and the menu (New Kingdom / Continue / Load / Settings / Credits).
export class MainMenuScene extends Phaser.Scene {
  [key: string]: any;

  constructor() { super('MainMenuScene'); }

  create() {
    // Dark base + sky gradient.
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x0b0f17, 1).setOrigin(0, 0);
    for (let i = 0; i < 8; i++) this.add.rectangle(0, i * (GAME_H / 8), GAME_W, GAME_H / 8 + 1, Phaser.Display.Color.GetColor(14 + i * 2, 18 + i * 3, 28 + i * 5), 1).setOrigin(0, 0);

    // --- Slowly panning isometric terrain backdrop ---------------------------
    AssetGenerator.generateTerrain(this); // creates iso_* keys for the backdrop
    const HW = 32, HH = 16;
    const band = this.add.container(0, GAME_H * 0.52).setAlpha(0.55);
    const keys = ['iso_grass', 'iso_grass2', 'iso_grass3', 'iso_forest1', 'iso_forest3', 'iso_water', 'iso_mtn'];
    for (let r = 0; r < 16; r++) for (let c = 0; c < 60; c++) {
      const x = (c - r) * HW, y = (c + r) * HH * 0.5;
      const k = Math.random() < 0.12 ? 'iso_water' : Math.random() < 0.2 ? 'iso_forest' + (1 + (((c + r) % 3))) : Math.random() < 0.12 ? 'iso_mtn' : keys[(c + r) % 3];
      band.add(this.add.image(x, y, this.textures.exists(k) ? k : 'iso_grass').setOrigin(0.5, 0.5));
    }
    band.x = -200;
    this.tweens.add({ targets: band, x: -1400, duration: 60000, repeat: -1, yoyo: true, ease: 'Sine.easeInOut' });
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x0b0f17, 0.45).setOrigin(0, 0); // darken for contrast

    // --- Falling leaves (procedural particles) -------------------------------
    if (!this.textures.exists('menu_leaf')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false } as any);
      g.fillStyle(0xc97b3a, 1); g.fillEllipse(4, 4, 7, 4); g.generateTexture('menu_leaf', 8, 8); g.destroy();
    }
    this.add.particles(0, -10, 'menu_leaf', {
      x: { min: 0, max: GAME_W }, y: -10, lifespan: 9000, speedY: { min: 18, max: 44 }, speedX: { min: -20, max: 20 },
      scale: { min: 0.6, max: 1.4 }, rotate: { min: 0, max: 360 }, alpha: { start: 0.8, end: 0.2 }, frequency: 380, quantity: 1,
    }).setDepth(5);

    // --- Title ---------------------------------------------------------------
    const tx = GAME_W / 2;
    this.add.text(tx, GAME_H * 0.16, 'KINGDOM', { fontFamily: 'serif', fontSize: '88px', color: '#e8c66a', fontStyle: 'bold', stroke: '#1a1206', strokeThickness: 10 }).setOrigin(0.5).setDepth(10);
    this.add.text(tx, GAME_H * 0.16 + 64, 'A REALM TO FORGE', { fontFamily: 'monospace', fontSize: '18px', color: '#cbb787', letterSpacing: 6 } as any).setOrigin(0.5).setDepth(10);

    // --- Menu ----------------------------------------------------------------
    this.panel = null;
    const hasSave = SaveManager.hasAnySave();
    const items: any[] = [
      ['New Kingdom', () => this.newKingdom(), true],
      ['Continue', () => this.continueGame(), hasSave],
      ['Load Game', () => this.openLoad(), hasSave],
      ['Settings', () => this.openSettings(), true],
      ['Credits', () => this.openCredits(), true],
    ];
    let y = GAME_H * 0.46;
    for (const [label, fn, enabled] of items) { this.menuButton(tx, y, 300, 50, label, fn, enabled); y += 64; }

    this.add.text(tx, GAME_H - 20, 'Phaser 3 + TypeScript · procedural art', { fontFamily: 'monospace', fontSize: '11px', color: '#5a6072' }).setOrigin(0.5, 1).setDepth(10);
    this.cameras.main.fadeIn(500, 0, 0, 0);
  }

  menuButton(cx: number, cy: number, w: number, h: number, label: string, fn: () => void, enabled: boolean) {
    const fill = enabled ? 0x1c2740 : 0x191c24;
    const b = this.add.rectangle(cx, cy, w, h, fill, 0.96).setDepth(11).setStrokeStyle(2, enabled ? 0xc9a14a : 0x3a3f4a, enabled ? 0.9 : 0.5);
    const t = this.add.text(cx, cy, label, { fontFamily: 'monospace', fontSize: '20px', color: enabled ? '#f0e6d0' : '#5a6072', fontStyle: 'bold' }).setOrigin(0.5).setDepth(12);
    if (!enabled) return;
    b.setInteractive({ useHandCursor: true });
    b.on('pointerover', () => { b.setFillStyle(0x2a3a5c, 1); b.setScale(1.04); t.setScale(1.04); });
    b.on('pointerout', () => { b.setFillStyle(fill, 0.96); b.setScale(1); t.setScale(1); });
    b.on('pointerdown', () => { try { sfx.unlock(); sfx.play('ui_click'); } catch (e) {} fn(); });
    return b;
  }

  // ---- transitions --------------------------------------------------------
  startGame() { this.cameras.main.fadeOut(350, 0, 0, 0); this.time.delayedCall(380, () => this.scene.start('IsometricScene')); }

  newKingdom() {
    // Fresh game → force king creation (clear the one-time king flag + any pending save).
    try { localStorage.removeItem('kg_king'); } catch (e) {}
    SaveManager.clearPending();
    this.startGame();
  }
  continueGame() {
    const r = SaveManager.preparePending(0);
    if (!r.ok) { this.toast(r.error || 'No save to continue.'); return; }
    this.startGame();
  }

  // ---- load / settings / credits sub-panels -------------------------------
  closePanel() { if (this.panel) { this.panel.forEach((o: any) => o.destroy()); this.panel = null; } }
  panelBase(title: string) {
    this.closePanel();
    const W = 480, H = 320, x = (GAME_W - W) / 2, yy = (GAME_H - H) / 2, els: any[] = [];
    els.push(this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05070b, 0.6).setOrigin(0, 0).setDepth(20).setInteractive());
    els.push(this.add.rectangle(x, yy, W, H, 0x161b26, 0.99).setOrigin(0, 0).setDepth(21).setStrokeStyle(3, 0xc9a14a, 0.9));
    els.push(this.add.text(GAME_W / 2, yy + 18, title, { fontFamily: 'monospace', fontSize: '22px', color: '#ffe9b0', fontStyle: 'bold' }).setOrigin(0.5, 0).setDepth(22));
    const close = this.add.text(x + W - 16, yy + 14, '✕', { fontFamily: 'monospace', fontSize: '18px', color: '#cbb787' }).setOrigin(1, 0).setDepth(22).setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => this.closePanel());
    els.push(close);
    this.panel = els;
    return { x, y: yy, W, H, els };
  }

  openLoad() {
    const { x, y, W, els } = this.panelBase('LOAD GAME');
    const slots = SaveManager.listSlots();
    slots.forEach((s: any, i: number) => {
      const sy = y + 60 + i * 74;
      const has = !s.empty && !s.corrupted;
      els.push(this.add.rectangle(x + 24, sy, W - 48, 64, has ? 0x1c2740 : 0x191c24, 0.96).setOrigin(0, 0).setDepth(22).setStrokeStyle(2, 0x39455a, 0.8));
      const label = s.corrupted ? 'Corrupted' : s.empty ? 'Empty' : `Day ${s.day} · ${s.tier} · ${s.playMin || 0} min`;
      els.push(this.add.text(x + 40, sy + 12, `Slot ${i}${i === 0 ? ' (auto)' : ''}`, { fontFamily: 'monospace', fontSize: '14px', color: '#f0e6d0', fontStyle: 'bold' }).setDepth(23));
      els.push(this.add.text(x + 40, sy + 36, label, { fontFamily: 'monospace', fontSize: '12px', color: '#b9c6d6' }).setDepth(23));
      if (has) {
        const lb = this.add.rectangle(x + W - 110, sy + 32, 76, 30, 0x2d6cb0).setDepth(23).setStrokeStyle(1, 0xf0e6c8, 0.8).setInteractive({ useHandCursor: true });
        els.push(lb); els.push(this.add.text(x + W - 110, sy + 32, 'Load', { fontFamily: 'monospace', fontSize: '13px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(24));
        lb.on('pointerdown', () => { if (SaveManager.preparePending(i).ok) this.startGame(); });
      }
    });
  }

  openSettings() {
    const { x, y, W, els } = this.panelBase('SETTINGS');
    const cfg = this.loadSettings();
    // Master volume slider.
    els.push(this.add.text(x + 30, y + 70, 'Master Volume', { fontFamily: 'monospace', fontSize: '14px', color: '#dfe6ee' }).setDepth(22));
    const trackX = x + 30, trackY = y + 100, trackW = W - 60;
    const track = this.add.rectangle(trackX, trackY, trackW, 8, 0x2a3242).setOrigin(0, 0.5).setDepth(22);
    els.push(track);
    const fill = this.add.rectangle(trackX, trackY, trackW * cfg.volume, 8, 0xc9a14a).setOrigin(0, 0.5).setDepth(23); els.push(fill);
    const knob = this.add.circle(trackX + trackW * cfg.volume, trackY, 9, 0xf0e6d0).setDepth(24).setInteractive({ useHandCursor: true, draggable: true }); els.push(knob);
    this.input.setDraggable(knob);
    knob.on('drag', (_p: any, dx: number) => {
      const v = Phaser.Math.Clamp((dx - trackX) / trackW, 0, 1); knob.x = trackX + trackW * v; fill.width = trackW * v;
      cfg.volume = v; this.saveSettings(cfg); try { sfx.setVolume(v); } catch (e) {}
    });
    // Toggles.
    const toggle = (ty: number, label: string, key: string) => {
      els.push(this.add.text(x + 30, ty, label, { fontFamily: 'monospace', fontSize: '14px', color: '#dfe6ee' }).setDepth(22));
      const box = this.add.rectangle(x + W - 60, ty + 6, 40, 22, cfg[key] ? 0x2e8b57 : 0x39393f).setDepth(22).setStrokeStyle(1, 0xf0e6c8, 0.7).setInteractive({ useHandCursor: true });
      const lbl = this.add.text(x + W - 60, ty + 6, cfg[key] ? 'ON' : 'OFF', { fontFamily: 'monospace', fontSize: '11px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(23);
      els.push(box, lbl);
      box.on('pointerdown', () => { cfg[key] = !cfg[key]; this.saveSettings(cfg); box.setFillStyle(cfg[key] ? 0x2e8b57 : 0x39393f); lbl.setText(cfg[key] ? 'ON' : 'OFF'); });
    };
    toggle(y + 140, 'Show Tooltips', 'tooltips');
    toggle(y + 180, 'Frequent Auto-save', 'autosaveFast');
  }

  openCredits() {
    const { x, y, W, els } = this.panelBase('CREDITS');
    const lines = ['Built with Phaser 3 + TypeScript', 'Art generated programmatically', 'Inspired by Kingdoms and Castles', 'and Mount & Blade', '', 'A kingdom-building & conquest game'];
    els.push(this.add.text(GAME_W / 2, y + 90, lines.join('\n'), { fontFamily: 'monospace', fontSize: '15px', color: '#e7d6b0', align: 'center', lineSpacing: 10 }).setOrigin(0.5, 0).setDepth(22));
  }

  // ---- settings persistence (read by the game where relevant) -------------
  loadSettings() { let c: any = {}; try { c = JSON.parse(localStorage.getItem('kg_settings') || '{}'); } catch (e) {} return { volume: c.volume != null ? c.volume : 0.6, tooltips: c.tooltips !== false, autosaveFast: !!c.autosaveFast }; }
  saveSettings(c: any) { try { localStorage.setItem('kg_settings', JSON.stringify(c)); } catch (e) {} }

  toast(msg: string) {
    const t = this.add.text(GAME_W / 2, GAME_H - 70, msg, { fontFamily: 'monospace', fontSize: '14px', color: '#fff', backgroundColor: '#000000cc', padding: { x: 10, y: 6 } }).setOrigin(0.5).setDepth(40);
    this.tweens.add({ targets: t, alpha: 0, delay: 1600, duration: 600, onComplete: () => t.destroy() });
  }
}
