import Phaser from 'phaser';
import { GAME_W, GAME_H } from './GameScene.js';
import * as AssetGenerator from '../systems/AssetGenerator.js';
import * as SaveManager from '../systems/SaveManager.js';
import { sfx } from '../audio/SoundEngine.js';
import { GameWorld } from '../systems/GameWorld.js';
import { generateWorld } from '../systems/WorldGenerator.js';

// MainMenuScene (Completion Phase 1) — the first screen the player sees.
// A slowly panning procedural-terrain backdrop, animated falling leaves, the
// game title, and the menu (New Kingdom / Continue / Load / Settings / Credits).
export class MainMenuScene extends Phaser.Scene {
  [key: string]: any;

  constructor() { super('MainMenuScene'); }

  create() {
    // (Polish Phase 10) Atmospheric dusk sky gradient — deep navy up top warming to
    // a faint amber haze near the horizon, so the drifting world reads against a sky.
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x0b0f17, 1).setOrigin(0, 0);
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const r = Math.round(12 + t * 44), g = Math.round(16 + t * 36), bl = Math.round(30 + t * 26);
      this.add.rectangle(0, i * (GAME_H / 14), GAME_W, GAME_H / 14 + 1, Phaser.Display.Color.GetColor(r, g, bl), 1).setOrigin(0, 0);
    }

    // --- Slowly panning isometric terrain backdrop ---------------------------
    AssetGenerator.generateTerrain(this); // creates iso_* keys for the backdrop
    const HW = 32, HH = 16;
    const band = this.add.container(0, GAME_H * 0.54).setAlpha(0.6);
    const keys = ['iso_grass', 'iso_grass2', 'iso_grass3', 'iso_forest1', 'iso_forest3', 'iso_water', 'iso_mtn'];
    for (let r = 0; r < 16; r++) for (let c = 0; c < 60; c++) {
      const x = (c - r) * HW, y = (c + r) * HH * 0.5;
      const k = Math.random() < 0.12 ? 'iso_water' : Math.random() < 0.2 ? 'iso_forest' + (1 + (((c + r) % 3))) : Math.random() < 0.12 ? 'iso_mtn' : keys[(c + r) % 3];
      band.add(this.add.image(x, y, this.textures.exists(k) ? k : 'iso_grass').setOrigin(0.5, 0.5));
    }
    band.x = -200;
    this.tweens.add({ targets: band, x: -1400, duration: 60000, repeat: -1, yoyo: true, ease: 'Sine.easeInOut' });
    // Dusk wash + a warm low-horizon glow + a vignette to frame the menu.
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x0b0f17, 0.42).setOrigin(0, 0);
    this.add.rectangle(0, GAME_H * 0.62, GAME_W, GAME_H * 0.45, 0xff8a3a, 0.06).setOrigin(0, 0).setBlendMode(Phaser.BlendModes.ADD);
    this.makeVignette();

    // --- Ambient sky touches: drifting clouds + a couple of birds ------------
    this.makeAtmosphere();

    // --- Falling leaves (procedural particles) -------------------------------
    if (!this.textures.exists('menu_leaf')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false } as any);
      g.fillStyle(0xc97b3a, 1); g.fillEllipse(4, 4, 7, 4); g.generateTexture('menu_leaf', 8, 8); g.destroy();
    }
    this.add.particles(0, -10, 'menu_leaf', {
      x: { min: 0, max: GAME_W }, y: -10, lifespan: 9000, speedY: { min: 18, max: 44 }, speedX: { min: -20, max: 20 },
      scale: { min: 0.6, max: 1.4 }, rotate: { min: 0, max: 360 }, alpha: { start: 0.8, end: 0.2 }, frequency: 380, quantity: 1,
    }).setDepth(5);
    // Faint warm embers rising near the horizon for hearth-at-dusk warmth.
    this.add.particles(0, GAME_H * 0.72, 'menu_leaf', {
      x: { min: 0, max: GAME_W }, y: { min: -10, max: 20 }, lifespan: 6000, speedY: { min: -30, max: -12 }, speedX: { min: -8, max: 8 },
      scale: { min: 0.2, max: 0.5 }, alpha: { start: 0.5, end: 0 }, tint: 0xffb060, frequency: 700, quantity: 1, blendMode: 'ADD',
    }).setDepth(5);

    // --- Title: carved stone/gold with a soft pulsing glow -------------------
    const tx = GAME_W / 2, ty = GAME_H * 0.17;
    // Glow layer (a blurred-feeling duplicate behind the crisp title), pulsing.
    const glow = this.add.text(tx, ty, 'KINGDOM', { fontFamily: 'serif', fontSize: '92px', color: '#ffdf8a', fontStyle: 'bold' }).setOrigin(0.5).setDepth(9).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.28).setScale(1.02);
    this.tweens.add({ targets: glow, alpha: { from: 0.18, to: 0.42 }, scale: { from: 1.01, to: 1.05 }, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    // Deep carved shadow then the gold face.
    this.add.text(tx + 3, ty + 4, 'KINGDOM', { fontFamily: 'serif', fontSize: '88px', color: '#120c04', fontStyle: 'bold' }).setOrigin(0.5).setDepth(9.5);
    const title = this.add.text(tx, ty, 'KINGDOM', { fontFamily: 'serif', fontSize: '88px', color: '#e8c66a', fontStyle: 'bold', stroke: '#1a1206', strokeThickness: 10 }).setOrigin(0.5).setDepth(10);
    title.setShadow(0, 2, '#6b4a16', 4, false, true);
    // Gold rule + subtitle.
    this.add.rectangle(tx, ty + 56, 360, 2, 0xc9a14a, 0.8).setDepth(10);
    this.add.text(tx, ty + 70, 'A REALM TO FORGE', { fontFamily: 'monospace', fontSize: '18px', color: '#cbb787', letterSpacing: 6 } as any).setOrigin(0.5).setDepth(10);

    // --- Menu ----------------------------------------------------------------
    this.panel = null;
    const hasSave = SaveManager.hasAnySave();
    // (Phase 2) Continue is available whenever a king record exists (the campaign
    // is rebuilt deterministically from its seed; full save/load is Phase 12).
    let hasKing = false;
    try { hasKing = !!localStorage.getItem('kg_king'); } catch (e) {}
    const items: any[] = [
      ['New Kingdom', () => this.newKingdom(), true],
      ['Continue', () => this.continueGame(), hasKing || hasSave],
      ['Load Game', () => this.openLoad(), hasSave],
      ['Watch Intro', () => this.watchIntro(), true],
      ['Settings', () => this.openSettings(), true],
      ['Credits', () => this.openCredits(), true],
    ];
    let y = GAME_H * 0.46;
    for (const [label, fn, enabled] of items) { this.menuButton(tx, y, 300, 50, label, fn, enabled); y += 64; }

    this.add.text(tx, GAME_H - 20, 'Phaser 3 + TypeScript · procedural art', { fontFamily: 'monospace', fontSize: '11px', color: '#5a6072' }).setOrigin(0.5, 1).setDepth(10);
    this.cameras.main.fadeIn(500, 0, 0, 0);
  }

  // (Polish Phase 10) Soft dark vignette frame drawn once into a texture.
  makeVignette() {
    if (!this.textures.exists('menu_vignette')) {
      const tex = this.textures.createCanvas('menu_vignette', GAME_W, GAME_H);
      const ctx = tex.getContext();
      const grad = ctx.createRadialGradient(GAME_W / 2, GAME_H / 2, GAME_H * 0.32, GAME_W / 2, GAME_H / 2, GAME_H * 0.78);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.62)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, GAME_W, GAME_H); tex.refresh();
    }
    this.add.image(0, 0, 'menu_vignette').setOrigin(0, 0).setDepth(6);
  }

  // (Polish Phase 10) Drifting clouds and a small flock of birds that loop across.
  makeAtmosphere() {
    if (!this.textures.exists('menu_cloud')) {
      const tex = this.textures.createCanvas('menu_cloud', 160, 70);
      const ctx = tex.getContext();
      ctx.fillStyle = 'rgba(180,190,210,0.5)';
      const blob = (x: number, y: number, r: number) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
      blob(50, 42, 26); blob(82, 36, 32); blob(112, 44, 24); blob(70, 50, 28);
      tex.refresh();
    }
    for (let i = 0; i < 4; i++) {
      const c = this.add.image(Phaser.Math.Between(-80, GAME_W), Phaser.Math.Between(40, GAME_H * 0.32), 'menu_cloud')
        .setDepth(4).setAlpha(Phaser.Math.FloatBetween(0.25, 0.5)).setScale(Phaser.Math.FloatBetween(0.7, 1.4));
      this.tweens.add({ targets: c, x: c.x + GAME_W + 200, duration: Phaser.Math.Between(60000, 110000), repeat: -1, onRepeat: () => { c.x = -200; c.y = Phaser.Math.Between(40, GAME_H * 0.32); } });
    }
    // A small "V" of birds: two flapping chevrons that cross the sky on a long loop.
    if (!this.textures.exists('menu_bird')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false } as any);
      g.lineStyle(2, 0x2a2f3a, 1); g.beginPath(); g.moveTo(0, 6); g.lineTo(6, 0); g.lineTo(12, 6); g.strokePath();
      g.generateTexture('menu_bird', 12, 8); g.destroy();
    }
    const flock = this.add.container(-60, GAME_H * 0.22).setDepth(5).setAlpha(0.7);
    for (let i = 0; i < 3; i++) flock.add(this.add.image(i * 16, (i % 2) * 7, 'menu_bird').setScale(Phaser.Math.FloatBetween(0.7, 1)));
    flock.list.forEach((b: any, i: number) => this.tweens.add({ targets: b, y: b.y - 3, duration: 360 + i * 40, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
    const flyFlock = () => {
      flock.setPosition(-60, Phaser.Math.Between(GAME_H * 0.12, GAME_H * 0.3));
      this.tweens.add({ targets: flock, x: GAME_W + 80, duration: Phaser.Math.Between(26000, 40000), onComplete: () => this.time.delayedCall(Phaser.Math.Between(8000, 16000), flyFlock) });
    };
    this.time.delayedCall(3000, flyFlock);
  }

  // (Polish Phase 10) Medieval "carved tablet" menu button: a layered stone slab
  // with a gold rim, hover glow, and a pressed (inset) state. Handlers/flow are
  // unchanged — `fn` is still called on pointerdown exactly as before.
  menuButton(cx: number, cy: number, w: number, h: number, label: string, fn: () => void, enabled: boolean) {
    const c = this.add.container(cx, cy).setDepth(11);
    // Drop shadow, dark stone base, lighter top bevel, inner inset, gold rim.
    const shadow = this.add.rectangle(0, 4, w, h, 0x000000, 0.45);
    const base = this.add.rectangle(0, 0, w, h, enabled ? 0x2a2114 : 0x1a1a20, 1).setStrokeStyle(2, enabled ? 0xc9a14a : 0x3a3f4a, enabled ? 0.95 : 0.5);
    const bevel = this.add.rectangle(0, -h / 2 + 5, w - 8, 6, enabled ? 0x4a3a1e : 0x26262e, 0.7);
    const inset = this.add.rectangle(0, 0, w - 12, h - 12, enabled ? 0x1f1810 : 0x161620, 0.9).setStrokeStyle(1, enabled ? 0x6b5224 : 0x2a2a32, 0.6);
    const t = this.add.text(0, 0, label, { fontFamily: 'serif', fontSize: '21px', color: enabled ? '#f0e6d0' : '#5a6072', fontStyle: 'bold' }).setOrigin(0.5);
    t.setShadow(0, 1, '#000000', 2, false, true);
    // Hover glow rim (additive, hidden until hover).
    const glow = this.add.rectangle(0, 0, w + 6, h + 6, 0xffd27a, 0.0).setStrokeStyle(3, 0xffd27a, 0.0).setBlendMode(Phaser.BlendModes.ADD);
    c.add([shadow, base, bevel, inset, glow, t]);
    if (!enabled) return c;
    base.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains, { useHandCursor: true } as any);
    base.on('pointerover', () => { this.tweens.add({ targets: c, scaleX: 1.04, scaleY: 1.04, duration: 120 }); glow.setStrokeStyle(3, 0xffd27a, 0.9); base.setFillStyle(0x3a2c18, 1); try { sfx.unlock(); sfx.play('building_select'); } catch (e) {} });
    base.on('pointerout', () => { this.tweens.add({ targets: c, scaleX: 1, scaleY: 1, duration: 120 }); glow.setStrokeStyle(3, 0xffd27a, 0.0); base.setFillStyle(0x2a2114, 1); c.y = cy; });
    base.on('pointerup', () => { c.y = cy; inset.setFillStyle(0x1f1810, 0.9); });
    base.on('pointerdown', () => {
      c.y = cy + 2; inset.setFillStyle(0x140f08, 1); // pressed: inset darkens, tablet sinks
      try { sfx.unlock(); sfx.play('ui_click'); } catch (e) {}
      fn();
    });
    return c;
  }

  // ---- transitions (Phase 2 Bannerlord rebuild) ---------------------------
  // The continent is now the primary game loop. Both New Kingdom and Continue
  // land on ContinentScene with a freshly generated world stored in the shared
  // GameWorld singleton (so ContinentScene / IsometricScene / BattleScene all
  // read the same campaign state). King creation + the first-play intro run as
  // standalone scenes BEFORE the continent.

  // Boot the continent for a campaign already initialised in GameWorld. This must
  // work even if the menu was slept during creation/intro, so we wake first and
  // start the continent immediately (no reliance on this scene's clock/camera,
  // which don't tick while asleep).
  enterContinent() {
    try { this.scene.wake(); } catch (e) {}
    try { sfx.unlock(); sfx.play('menu_confirm'); } catch (e) {}
    this.scene.start('ContinentScene');
  }

  // Generate a world + initialise the shared campaign state from a king record.
  startCampaign(king: { kingdom: string; ruler: string; trait: string | null }) {
    const world = generateWorld();
    GameWorld.startNewCampaign(world, king);
  }

  newKingdom() {
    // Fresh game → king creation, then (first-play) intro, then the continent.
    try { localStorage.removeItem('kg_king'); } catch (e) {}
    SaveManager.clearPending();
    const afterCreate = (info: { kingdom: string; ruler: string; trait: string }) => {
      this.startCampaign(info);
      // First-play illustrated intro (unchanged scene), then the continent.
      let seen = true;
      try { seen = !!localStorage.getItem('kingdom_intro_seen'); } catch (e) {}
      if (!seen) {
        this.scene.launch('IntroCutsceneScene', {
          kingdomName: info.kingdom,
          // The menu is slept while the intro plays, so DON'T gate on the menu
          // being active here — just transition to the continent when the intro
          // finishes (enterContinent wakes the menu first, then starts it).
          onComplete: () => { try { this.enterContinent(); } catch (e) { console.error('[MainMenu] enterContinent failed', e); } },
        });
        this.scene.sleep();
      } else {
        this.enterContinent();
      }
    };
    // Launch the standalone creation scene on top; sleep the menu until it ends.
    this.scene.launch('KingCreationScene', { onComplete: (info: any) => { try { this.scene.wake(); } catch (e) {} afterCreate(info); } });
    this.scene.sleep();
  }

  continueGame() {
    // Phase 2: a full save/load round-trip is Phase 12. For now "Continue" lands
    // on the continent with a campaign initialised from the saved king record
    // (or defaults), so the player always resumes on the primary loop.
    let king: any = null;
    try { king = JSON.parse(localStorage.getItem('kg_king') || 'null'); } catch (e) {}
    if (!king) { this.toast('No kingdom to continue.'); return; }
    this.startCampaign({ kingdom: king.kingdom, ruler: king.ruler, trait: king.trait || null });
    this.enterContinent();
  }

  // (Phase 11) Replay the intro cutscene standalone from the menu. Sleeps the
  // menu, launches the cutscene on top with a placeholder kingdom name, and
  // wakes the menu back up when the cutscene finishes or is skipped. This does
  // NOT depend on the 'kingdom_intro_seen' flag — it always plays.
  watchIntro() {
    try { sfx.unlock(); } catch (e) {}
    this.scene.sleep();
    this.scene.launch('IntroCutsceneScene', {
      kingdomName: 'Eldoria',
      onComplete: () => { try { this.scene.wake(); } catch (e) {} },
    });
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
        // (Phase 2) Loading a slot resumes the campaign on the continent. A full
        // slot-state restore is Phase 12; for now we rebuild from the king record.
        lb.on('pointerdown', () => { if (SaveManager.preparePending(i).ok) this.continueGame(); });
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
