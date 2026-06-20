import Phaser from 'phaser';
import { GAME_W, GAME_H } from './GameScene.js';
import { registerUnitAnimations, playLoop, playOnce } from '../systems/Animations.js';
import { sfx } from '../audio/SoundEngine.js';

// (Polish Phase 1) idle texture -> { walk, attack } animation keys for battle units.
const ANIM_SET = {
  blue_warrior_idle: { run: 'blue_warrior_run', atk: 'blue_warrior_attack' },
  warrior_idle: { run: 'red_warrior_run', atk: 'red_warrior_attack' },
  yellow_warrior_idle: { run: 'yellow_warrior_run', atk: 'yellow_warrior_attack' },
  purple_warrior_idle: { run: 'purple_warrior_run', atk: 'purple_warrior_attack' },
  goblin_idle: { run: 'goblin_run', atk: 'goblin_attack' },
  blue_archer_idle: { run: 'blue_archer_run', atk: 'blue_archer_shoot' },
  red_archer_idle: { run: 'red_archer_idle', atk: 'red_archer_shoot' },
  monk_idle: { run: 'monk_run', atk: null },
};

// BattleScene (Phase 1 + UI overhaul Phase 3) — a separate strategic battle
// scene. IsometricScene launches it (paused underneath) when a combat involves
// 10+ units, passing the two armies; the player sets a formation in a 20s
// pre-battle phase, then units fight automatically with morale, commands and
// damage numbers, and the outcome (surviving army, loot, conquest) is handed
// back via the onComplete callback.

const PRE_BATTLE = 20;     // seconds
const MAX_BATTLE = 300;    // 5 minutes
const MELEE = 42;          // px melee range (~1 tile)
const HORIZON = Math.round(GAME_H * 0.30);

// Per-type stats. speed in px/sec, range in px (0 = melee).
const STATS = {
  warrior: { hp: 50, dmg: 15, speed: 52, range: 0, tex: 'blue_warrior_idle', heal: 0 },
  mercenary: { hp: 50, dmg: 18, speed: 52, range: 0, tex: 'yellow_warrior_idle', heal: 0 },
  archer: { hp: 25, dmg: 12, speed: 30, range: 168, tex: 'blue_archer_idle', heal: 0 },
  monk: { hp: 30, dmg: 0, speed: 50, range: 0, tex: 'monk_idle', heal: 8 },
  knight: { hp: 120, dmg: 25, speed: 34, range: 0, tex: 'blue_lancer', heal: 0, area: true, tank: true },
  goblin: { hp: 15, dmg: 8, speed: 74, range: 0, tex: 'goblin_idle', heal: 0 },
  garrison: { hp: 50, dmg: 15, speed: 0, range: 0, tex: 'blue_warrior_idle', heal: 0, hold: true },
};
const FACTION_WARRIOR = { red: 'warrior_idle', purple: 'purple_warrior_idle', yellow: 'yellow_warrior_idle', neutral: 'blue_warrior_idle', goblin: 'goblin_idle' };
const FACTION_LABEL = { red: 'Red Kingdom', purple: 'Purple Kingdom', yellow: 'Yellow Kingdom', neutral: 'Free Company', goblin: 'Goblin Horde' };
const FACTION_COLOR = { red: 0xd64a4a, purple: 0xa45ad6, yellow: 0xd6c04a, neutral: 0x6aa0d6, goblin: 0x6ab04a };

// Terrain palettes: sky (top of gradient), horizon (band), ground (bottom),
// the scatter sprite, and how many to scatter. name shown in the pre-battle.
const TERRAIN = {
  forest: { sky: 0x334a3a, horizon: 0x223626, ground: 0x14241a, deco: 'iso_forest1', bg: 16, obs: 7, name: 'Forest Clearing' },
  mountains: { sky: 0x46484f, horizon: 0x33343c, ground: 0x202128, deco: 'iso_mtn', bg: 12, obs: 6, name: 'Mountain Pass' },
  plains: { sky: 0x4a5838, horizon: 0x33401f, ground: 0x202d16, deco: 'iso_rock', bg: 6, obs: 3, name: 'Open Plains' },
  wildlands: { sky: 0x4a4530, horizon: 0x33311c, ground: 0x242113, deco: 'iso_rock', bg: 9, obs: 5, name: 'The Wildlands' },
};

class BUnit {
  constructor(scene, side, type, x, y, texOverride) {
    this.scene = scene;
    this.side = side; // 'player' | 'enemy'
    this.type = type;
    const s = STATS[type] || STATS.warrior;
    this.maxHp = s.hp; this.hp = s.hp; this.dmg = s.dmg; this.speed = s.speed;
    this.range = s.range; this.heal = s.heal; this.area = !!s.area; this.tank = !!s.tank; this.hold = !!s.hold;
    this.x = x; this.y = y; this.alive = true; this.cmd = null; this.atkCd = 0;
    const tex = texOverride || s.tex;
    // Phase 3: larger units (56px, knights 64px) and a soft ground shadow.
    const px = type === 'knight' ? 64 : 56;
    this.shadow = scene.add.ellipse(x, y + 22, px * 0.5, px * 0.2, 0x000000, 0.28).setDepth(8);
    this.spr = scene.add.sprite(x, y, scene.textures.exists(tex) ? tex : 'blue_warrior_idle', 0).setScale(px / 192).setDepth(10);
    // (Polish Phase 1) walk + attack animation states keyed off the idle texture.
    this.anims = { idle: this.spr.texture.key, run: ANIM_SET[this.spr.texture.key] ? ANIM_SET[this.spr.texture.key].run : null, atk: ANIM_SET[this.spr.texture.key] ? ANIM_SET[this.spr.texture.key].atk : null };
    if (this.spr.texture.frameTotal > 1 && scene.anims.exists(this.spr.texture.key)) this.spr.play(this.spr.texture.key);
    this.spr.setFlipX(side === 'player'); // players (right) face left; enemies (left) face right
    this.hpW = 30;
    this.hpBg = scene.add.rectangle(x, y - 30, this.hpW + 2, 5, 0x000000, 0.6).setDepth(11);
    this.hpFill = scene.add.rectangle(x - this.hpW / 2, y - 30, this.hpW, 3, side === 'player' ? 0x4ad66b : 0xd64a4a).setOrigin(0, 0.5).setDepth(12);
  }
  takeDamage(a) {
    if (!this.alive) return;
    this.hp -= a;
    this.hpFill.width = this.hpW * Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    this.spr.setTintFill(0xff5555);
    this.scene.time.delayedCall(60, () => { if (this.alive) this.spr.clearTint(); });
    this.scene.dmgNumber(this.x, this.y - 24, Math.round(a), this.side === 'player' ? '#ff6b6b' : '#ffffff');
    if (this.hp <= 0) this.die();
  }
  die() {
    if (!this.alive) return;
    this.alive = false;
    sfx.playThrottled(this.side === 'player' ? 'soldier_dies' : 'enemy_dies', 110); // (Polish Phase 2)
    this.scene.onUnitDeath(this);
    this.hpBg.destroy(); this.hpFill.destroy();
    this.scene.tweens.add({ targets: this.shadow, alpha: 0, duration: 500, onComplete: () => this.shadow.destroy() });
    this.spr.setTintFill(0xff3333);
    this.scene.tweens.add({ targets: this.spr, alpha: 0, angle: this.side === 'player' ? 30 : -30, y: this.y + 6, duration: 600, onComplete: () => this.spr.destroy() });
  }
  sync() {
    this.spr.x = this.x; this.spr.y = this.y;
    this.shadow.x = this.x; this.shadow.y = this.y + 22;
    this.hpBg.x = this.x; this.hpBg.y = this.y - 30;
    this.hpFill.x = this.x - this.hpW / 2; this.hpFill.y = this.y - 30;
  }
}

export class BattleScene extends Phaser.Scene {
  constructor() { super('BattleScene'); }

  preload() {
    // Knight uses the Lancer sprite (not loaded by the world scene).
    const UNITS = 'assets/Tiny Swords (Free Pack)/Units';
    if (!this.textures.exists('blue_lancer')) this.load.spritesheet('blue_lancer', `${UNITS}/Blue Units/Lancer/Lancer_Idle.png`, { frameWidth: 192, frameHeight: 192 });
  }

  init(data) { this.cfg = data || {}; }

  create() {
    const terrain = this.cfg.terrainType || 'plains';
    this.pal = TERRAIN[terrain] || TERRAIN.plains;
    this.faction = this.cfg.enemyFaction || 'red';

    registerUnitAnimations(this); // (Polish Phase 1) ensure walk/attack/shoot anims exist
    this.drawBattlefield();

    this.units = [];
    this.obstacles = [];
    this.phase = 'pre';
    this.timer = PRE_BATTLE;
    this.battleTime = 0;
    this.morale = { player: 70, enemy: 70 };
    if (this.cfg.taverMoraleBonus) this.morale.player += 10;
    this.selected = [];
    this.activeCmd = null;

    this.scatterObstacles(terrain);
    this.spawnArmy('player', this.cfg.playerArmy || [], 0xffffff);
    this.spawnArmy('enemy', this.cfg.enemyArmy || [], null);
    this.applyFormation('player', 'LINE');
    this.applyFormation('enemy', 'LINE');

    this.buildHud();
    this.cameras.main.fadeIn(400, 0, 0, 0);
  }

  // Phase 3: terrain-themed battlefield — a banded sky+ground gradient (opaque
  // rectangles so it fully covers the paused world scene), a horizon haze, and
  // scattered background scenery sized/dimmed by depth.
  drawBattlefield() {
    const p = this.pal;
    const lerp = (a, b, t) => {
      const ca = Phaser.Display.Color.IntegerToColor(a), cb = Phaser.Display.Color.IntegerToColor(b);
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(ca, cb, 100, Math.round(t * 100));
      return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
    };
    const band = (y, h, color) => this.add.rectangle(0, y, GAME_W, h + 1, color, 1).setOrigin(0, 0).setDepth(-20);
    const SKY_N = 8, skyH = HORIZON / SKY_N;
    for (let i = 0; i < SKY_N; i++) band(i * skyH, skyH, lerp(p.sky, p.horizon, i / (SKY_N - 1)));
    const GR_N = 10, grH = (GAME_H - HORIZON) / GR_N;
    for (let i = 0; i < GR_N; i++) band(HORIZON + i * grH, grH, lerp(p.horizon, p.ground, i / (GR_N - 1)));
    // Horizon haze line.
    this.add.rectangle(0, HORIZON, GAME_W, 3, 0xffffff, 0.06).setOrigin(0, 0).setDepth(-19);
    // Background scenery clustered near the horizon (non-blocking decoration).
    const key = this.textures.exists(p.deco) ? p.deco : 'iso_rock';
    for (let i = 0; i < p.bg; i++) {
      const x = Phaser.Math.Between(20, GAME_W - 20);
      const y = Phaser.Math.Between(HORIZON - 14, HORIZON + 70);
      const t = (y - (HORIZON - 14)) / 84;            // 0 far .. 1 near
      this.add.image(x, y, key).setScale(0.7 + t * 0.7).setAlpha(0.4 + t * 0.4).setDepth(-18 + Math.round(t * 3)).setTint(0x8090a0);
    }
    // Vignette.
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.16).setOrigin(0, 0).setDepth(-10);
  }

  scatterObstacles(terrain) {
    const p = this.pal;
    const key = this.textures.exists(p.deco) ? p.deco : 'iso_rock';
    for (let i = 0; i < p.obs; i++) {
      const x = Phaser.Math.Between(360, GAME_W - 360);
      const y = Phaser.Math.Between(HORIZON + 110, GAME_H - 200);
      this.add.image(x, y, key).setScale(1.0).setDepth(6).setAlpha(0.95);
      this.obstacles.push({ x, y, r: 30 });
    }
  }

  // armyData: [{type, count}]
  spawnArmy(side, armyData) {
    const x = side === 'player' ? GAME_W * 0.80 : GAME_W * 0.20;
    for (const grp of armyData) {
      for (let i = 0; i < grp.count; i++) {
        let tex;
        if (side === 'enemy') tex = grp.type === 'archer' ? 'red_archer_idle' : (FACTION_WARRIOR[this.faction] || 'warrior_idle');
        const u = new BUnit(this, side, grp.type, x, GAME_H * 0.54, tex);
        this.units.push(u);
      }
    }
  }

  sideUnits(side) { return this.units.filter((u) => u.alive && u.side === side); }

  // Arrange a side's living units into a dense, ranked formation. Player holds
  // the right ~35%, the enemy the left ~35%, leaving the centre contested.
  applyFormation(side, name) {
    const us = this.sideUnits(side);
    if (!us.length) return;
    const dir = side === 'player' ? -1 : 1;     // toward the centre
    const rear = -dir;                          // toward own back lines
    const frontX = side === 'player' ? GAME_W * 0.80 : GAME_W * 0.20;
    const cy = GAME_H * 0.54;
    const warriors = us.filter((u) => u.type === 'warrior' || u.type === 'mercenary' || u.type === 'knight' || u.type === 'garrison' || u.type === 'goblin');
    const archers = us.filter((u) => u.type === 'archer');
    const monks = us.filter((u) => u.type === 'monk');
    // Lay a group into vertical ranks, wrapping to deeper columns toward the rear.
    const ranks = (arr, x, vGap, perCol) => arr.forEach((u, i) => {
      const c = Math.floor(i / perCol), r = i % perCol;
      const n = Math.min(perCol, arr.length - c * perCol);
      u.x = x + rear * c * 30; u.y = cy + (r - (n - 1) / 2) * vGap;
    });
    if (name === 'WEDGE') {
      warriors.forEach((u, i) => { const k = i - (warriors.length - 1) / 2; u.x = frontX + rear * Math.abs(k) * 11; u.y = cy + k * 26; });
      ranks(archers, frontX + rear * 84, 28, 8);
      ranks(monks, frontX + rear * 134, 30, 6);
    } else if (name === 'DEFENSIVE') {
      const R = 56 + warriors.length * 2;
      warriors.forEach((u, i) => { const a = (i / warriors.length) * Math.PI * 2; u.x = frontX + rear * 34 + Math.cos(a) * R; u.y = cy + Math.sin(a) * R * 0.72; });
      [...monks, ...archers].forEach((u, i) => { u.x = frontX + rear * 34 + (i % 3 - 1) * 22; u.y = cy + Math.floor(i / 3) * 22 - 22; });
    } else if (name === 'FLANK') {
      warriors.forEach((u, i) => { const top = i % 2 === 0; u.x = frontX + rear * Math.floor(i / 2) * 30; u.y = (top ? cy - 170 : cy + 170) + Math.floor(i / 2) * 6; });
      ranks(archers, frontX + rear * 44, 28, 8);
      ranks(monks, frontX + rear * 92, 30, 6);
    } else { // LINE — dense shoulder-to-shoulder ranks
      ranks(warriors, frontX, 30, 9);
      ranks(archers, frontX + rear * 70, 28, 8);
      ranks(monks, frontX + rear * 120, 32, 6);
    }
    us.forEach((u) => u.sync());
  }

  buildHud() {
    // --- Morale bars: enemy top-left, player top-right (Phase 3) -------------
    this.enemyBar = this.makeMoraleBar(20, 18, false, FACTION_COLOR[this.faction] || 0xd64a4a, `Enemy · ${FACTION_LABEL[this.faction] || this.faction}`, 'skull');
    this.playerBar = this.makeMoraleBar(GAME_W - 20, 18, true, 0x4ad66b, 'Your Army', 'shield');

    // --- Pre-battle headline -------------------------------------------------
    this.title = this.add.text(GAME_W / 2, 14, this.pal.name, { fontFamily: 'monospace', fontSize: '26px', color: '#ffe9a8', fontStyle: 'bold', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5, 0).setDepth(41);
    this.subtitle = this.add.text(GAME_W / 2, 46, `Defending against the ${FACTION_LABEL[this.faction] || this.faction}`, { fontFamily: 'monospace', fontSize: '14px', color: '#e7d6b0', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(41);
    this.countdown = this.add.text(GAME_W / 2, 74, '', { fontFamily: 'monospace', fontSize: '22px', color: '#ffd24a', fontStyle: 'bold', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5, 0).setDepth(41);
    this.banner = this.add.text(GAME_W / 2, GAME_H - 96, 'Choose a formation — battle begins automatically', { fontFamily: 'monospace', fontSize: '14px', color: '#fff', backgroundColor: '#000000aa', padding: { x: 10, y: 5 } }).setOrigin(0.5, 1).setDepth(41);

    // --- Formation buttons (pre-battle) -------------------------------------
    this.formBtns = [];
    const forms = [['LINE', 'balanced'], ['WEDGE', 'aggressive'], ['DEFENSIVE', 'hold ground'], ['FLANK', 'pincer']];
    const fw = 200, gap = 16, total = forms.length * fw + (forms.length - 1) * gap;
    forms.forEach((f, i) => {
      const x = (GAME_W - total) / 2 + i * (fw + gap) + fw / 2;
      this.formBtns.push(this.makeFormButton(x, GAME_H - 44, fw, 50, f[0], f[1]));
    });

    // --- Command bar (battle phase) — hidden until battle starts -------------
    this.cmdBtns = [];
    const cmds = [['CHARGE', 0x8a3a3a], ['HOLD', 0x3a6a8a], ['FLANK L', 0x6a5a3a], ['FLANK R', 0x6a5a3a], ['RETREAT', 0x5a3a6a]];
    const cw = 170, cgap = 14, ctotal = cmds.length * cw + (cmds.length - 1) * cgap;
    cmds.forEach((c, i) => {
      const x = (GAME_W - ctotal) / 2 + i * (cw + cgap) + cw / 2;
      const b = this.makeCmdButton(x, GAME_H - 44, cw, 50, c[0], c[1]);
      b.hide();
      this.cmdBtns.push(b);
    });
  }

  // A morale bar with a faction icon, label, coloured fill, and numeric value.
  makeMoraleBar(x, y, anchorRight, accent, label, icon) {
    const W = 220, H = 28;
    const ox = anchorRight ? x - W : x;
    const bg = this.add.rectangle(ox, y, W, H, 0x0a0d14, 0.85).setOrigin(0, 0).setDepth(40).setStrokeStyle(2, accent, 0.7);
    const fill = this.add.rectangle(ox + 3, y + 3, W - 6, H - 6, 0x4ad66b).setOrigin(0, 0).setDepth(41);
    const ic = this.add.graphics().setDepth(43);
    if (icon === 'shield') this.drawShield(ic, ox + (anchorRight ? W - 16 : 16), y + H / 2, accent);
    else this.drawSkull(ic, ox + (anchorRight ? W - 16 : 16), y + H / 2);
    const val = this.add.text(ox + W / 2, y + H / 2, '70', { fontFamily: 'monospace', fontSize: '15px', color: '#fff', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(43);
    this.add.text(anchorRight ? ox + W - 30 : ox + 30, y + H + 3, label, { fontFamily: 'monospace', fontSize: '12px', color: '#dcd2bf' }).setOrigin(anchorRight ? 1 : 0, 0).setDepth(41);
    return { fill, val, W };
  }

  drawShield(g, x, y, color) {
    g.fillStyle(color, 1); g.lineStyle(1.5, 0x000000, 0.6);
    g.beginPath(); g.moveTo(x - 8, y - 9); g.lineTo(x + 8, y - 9); g.lineTo(x + 8, y + 1); g.lineTo(x, y + 10); g.lineTo(x - 8, y + 1); g.closePath();
    g.fillPath(); g.strokePath();
    g.fillStyle(0xffffff, 0.5); g.fillRect(x - 1, y - 6, 2, 12);
  }

  drawSkull(g, x, y) {
    g.fillStyle(0xe6e6e6, 1); g.fillCircle(x, y - 2, 7); g.fillRect(x - 5, y + 2, 10, 5);
    g.fillStyle(0x1a1a1a, 1); g.fillCircle(x - 3, y - 2, 2); g.fillCircle(x + 3, y - 2, 2);
    g.fillRect(x - 1, y + 2, 1.5, 4); g.fillRect(x + 1, y + 2, 1.5, 4);
  }

  // Draws a small dot-pattern glyph showing what a formation looks like.
  drawFormGlyph(g, x, y, name) {
    g.fillStyle(0xffe9a8, 1);
    const d = (dx, dy) => g.fillCircle(x + dx, y + dy, 1.8);
    if (name === 'LINE') { for (let i = -2; i <= 2; i++) d(0, i * 5); d(6, 0); }
    else if (name === 'WEDGE') { d(-6, 0); d(-2, -5); d(-2, 5); d(2, -9); d(2, 9); }
    else if (name === 'DEFENSIVE') { for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; d(Math.cos(a) * 7, Math.sin(a) * 7); } }
    else { d(-4, -9); d(0, -9); d(-2, -4); d(-4, 9); d(0, 9); d(-2, 4); } // FLANK
  }

  makeFormButton(x, y, w, h, name, desc) {
    const bg = this.add.rectangle(x, y, w, h, 0x26354f).setStrokeStyle(2, 0xf0e6c8, 0.7).setDepth(40).setInteractive({ useHandCursor: true });
    const g = this.add.graphics().setDepth(41);
    this.drawFormGlyph(g, x - w / 2 + 22, y, name);
    const t1 = this.add.text(x - w / 2 + 44, y - 11, name, { fontFamily: 'monospace', fontSize: '15px', color: '#fff', fontStyle: 'bold' }).setOrigin(0, 0).setDepth(41);
    const t2 = this.add.text(x - w / 2 + 44, y + 6, desc, { fontFamily: 'monospace', fontSize: '11px', color: '#bcd0ea' }).setOrigin(0, 0).setDepth(41);
    bg.on('pointerover', () => bg.setFillStyle(0x32466a));
    bg.on('pointerout', () => bg.setFillStyle(0x26354f));
    bg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.applyFormation('player', name); this.banner.setText(`Formation: ${name} — ${desc}`); this.formBtns.forEach((b) => b.setActive(b.name === name)); });
    const obj = { name, bg, g, t1, t2, setVisible: (v) => { bg.setVisible(v); g.setVisible(v); t1.setVisible(v); t2.setVisible(v); }, setActive: (on) => bg.setStrokeStyle(on ? 3 : 2, on ? 0xffe9a8 : 0xf0e6c8, on ? 1 : 0.7) };
    return obj;
  }

  makeCmdButton(x, y, w, h, label, color) {
    const bg = this.add.rectangle(x, y, w, h, color).setStrokeStyle(2, 0xf0e6c8, 0.6).setDepth(40).setInteractive({ useHandCursor: true });
    const g = this.add.graphics().setDepth(41);
    this.drawCmdIcon(g, x - w / 2 + 22, y, label);
    const txt = this.add.text(x - w / 2 + 40, y, label, { fontFamily: 'monospace', fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(41);
    bg.on('pointerover', () => { if (this.activeCmd !== label) bg.setFillStyle(color + 0x101010); });
    bg.on('pointerout', () => { if (this.activeCmd !== label) bg.setFillStyle(color); });
    bg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.command(label); });
    return {
      label, base: color, bg, g, txt,
      hide: () => { bg.setVisible(false); g.setVisible(false); txt.setVisible(false); },
      show: () => { bg.setVisible(true); g.setVisible(true); txt.setVisible(true); },
      setActive: (on) => { bg.setFillStyle(on ? color + 0x202020 : color); bg.setStrokeStyle(on ? 3 : 2, on ? 0xffe9a8 : 0xf0e6c8, on ? 1 : 0.6); },
    };
  }

  drawCmdIcon(g, x, y, label) {
    g.lineStyle(2, 0xffffff, 0.95); g.fillStyle(0xffffff, 0.95);
    if (label === 'CHARGE') { g.beginPath(); g.moveTo(x - 7, y); g.lineTo(x + 5, y); g.strokePath(); g.beginPath(); g.moveTo(x + 1, y - 5); g.lineTo(x + 7, y); g.lineTo(x + 1, y + 5); g.strokePath(); }
    else if (label === 'HOLD') { g.lineStyle(0); g.fillStyle(0xffffff, 0.95); g.beginPath(); g.moveTo(x - 6, y - 7); g.lineTo(x + 6, y - 7); g.lineTo(x + 6, y + 1); g.lineTo(x, y + 8); g.lineTo(x - 6, y + 1); g.closePath(); g.fillPath(); }
    else if (label === 'FLANK L') { g.beginPath(); g.moveTo(x + 6, y); g.lineTo(x - 6, y); g.strokePath(); g.beginPath(); g.moveTo(x - 2, y - 5); g.lineTo(x - 7, y); g.lineTo(x - 2, y + 5); g.strokePath(); }
    else if (label === 'FLANK R') { g.beginPath(); g.moveTo(x - 6, y); g.lineTo(x + 6, y); g.strokePath(); g.beginPath(); g.moveTo(x + 2, y - 5); g.lineTo(x + 7, y); g.lineTo(x + 2, y + 5); g.strokePath(); }
    else { g.beginPath(); g.moveTo(x + 6, y); g.lineTo(x - 6, y); g.strokePath(); g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x - 6, y); g.lineTo(x, y + 5); g.strokePath(); } // RETREAT
  }

  // Player command (applies to all player units — selection simplified).
  command(name) {
    const us = this.sideUnits('player');
    if (name === 'CHARGE') us.forEach((u) => { u.cmd = 'charge'; });
    else if (name === 'HOLD') us.forEach((u) => { u.cmd = 'hold'; });
    else if (name === 'FLANK L') us.forEach((u) => { u.cmd = 'flankL'; });
    else if (name === 'FLANK R') us.forEach((u) => { u.cmd = 'flankR'; });
    else if (name === 'RETREAT') { us.forEach((u) => { u.cmd = 'retreat'; }); this._retreating = true; }
    this.activeCmd = name;
    this.cmdBtns.forEach((b) => b.setActive(b.label === name));
    this.banner.setText(`Order: ${name}`);
  }

  dmgNumber(x, y, n, color) {
    const t = this.add.text(x, y, `${n}`, { fontFamily: 'monospace', fontSize: '14px', color, fontStyle: 'bold', stroke: '#000', strokeThickness: 2 }).setOrigin(0.5).setDepth(30);
    this.tweens.add({ targets: t, y: y - 28, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  onUnitDeath(u) {
    // Morale: -3 your side loses a unit, +2 the other side gains from the kill.
    const me = u.side, foe = u.side === 'player' ? 'enemy' : 'player';
    this.morale[me] = Math.max(0, this.morale[me] - 3);
    this.morale[foe] = Math.min(100, this.morale[foe] + 2);
  }

  nearestEnemyOf(u) {
    let best = null, bd = Infinity;
    for (const o of this.units) {
      if (!o.alive || o.side === u.side) continue;
      const d = Phaser.Math.Distance.Between(u.x, u.y, o.x, o.y);
      if (d < bd) { bd = d; best = o; }
    }
    return { foe: best, dist: bd };
  }

  update(time, delta) {
    const dt = delta / 1000;
    if (this.phase === 'done') return;

    if (this.phase === 'pre') {
      this.timer -= dt;
      const s = Math.ceil(this.timer);
      if (this.timer <= 5.99) {
        // Dramatic final countdown.
        this.countdown.setText(`${s}`);
        this.countdown.setColor(s <= 3 ? '#ff6b5a' : '#ffd24a');
        if (s !== this._lastTick) { this._lastTick = s; this.countdown.setScale(1.6); this.tweens.add({ targets: this.countdown, scale: 1, duration: 400, ease: 'Cubic.out' }); }
      } else {
        this.countdown.setText(`Battle begins in ${s}s`);
      }
      if (this.timer <= 0) this.startBattle();
      this.updateMoraleBars();
      return;
    }

    this.battleTime += dt;
    // Morale: outnumbered 2:1 penalty.
    const pc = this.sideUnits('player').length, ec = this.sideUnits('enemy').length;
    if (pc > 0 && ec >= pc * 2) this.morale.player = Math.max(0, this.morale.player - dt);
    if (ec > 0 && pc >= ec * 2) this.morale.enemy = Math.max(0, this.morale.enemy - dt);

    for (const u of this.units) { if (u.alive) this.updateUnit(u, dt); }
    this.units = this.units.filter((u) => u.alive || u.spr.active);
    this.updateMoraleBars();

    // End conditions.
    const playerAlive = this.sideUnits('player').length;
    const enemyAlive = this.sideUnits('enemy').length;
    if (this._retreating && this.sideUnits('player').every((u) => u.x > GAME_W - 60)) this.endBattle('retreat');
    else if (this.morale.player <= 0) this.endBattle('rout_player');
    else if (this.morale.enemy <= 0) this.endBattle('rout_enemy');
    else if (playerAlive === 0) this.endBattle('defeat');
    else if (enemyAlive === 0) this.endBattle('victory');
    else if (this.battleTime >= MAX_BATTLE) this.endBattle(this.cfg.playerDefending ? 'victory' : 'defeat');
  }

  startBattle() {
    this.phase = 'battle';
    sfx.play('battle_start'); // (Polish Phase 2)
    this.countdown.setScale(1);
    this.countdown.setText('');
    this.title.setText('BATTLE!');
    this.title.setColor('#ff6b5a');
    this.tweens.add({ targets: this.title, scale: { from: 1.3, to: 1 }, duration: 500 });
    this.subtitle.setVisible(false);
    this.banner.setText('Issue orders below');
    this.formBtns.forEach((b) => b.setVisible(false));
    this.cmdBtns.forEach((b) => b.show());
    // Enemy AI picks a formation based on composition.
    const eHasArchers = this.sideUnits('enemy').some((u) => u.type === 'archer');
    this.applyFormation('enemy', eHasArchers ? 'LINE' : this.faction === 'goblin' ? 'FLANK' : 'WEDGE');
  }

  updateUnit(u, dt) {
    const moraleMul = (this.morale[u.side] <= 30 ? 0.8 : 1) * (u.cmd === 'charge' ? 1.2 : 1);
    // Commands that override targeting.
    if (u.cmd === 'retreat') { this.moveTo(u, u.side === 'player' ? GAME_W + 40 : -40, u.y, u.speed * 1.1 * moraleMul, dt); u.sync(); return; }
    if (u.cmd === 'flankL') { if (u.y > 70) { this.moveTo(u, u.x, 60, u.speed * moraleMul, dt); u.sync(); return; } u.cmd = 'charge'; }
    if (u.cmd === 'flankR') { if (u.y < GAME_H - 130) { this.moveTo(u, u.x, GAME_H - 140, u.speed * moraleMul, dt); u.sync(); return; } u.cmd = 'charge'; }

    const { foe, dist } = this.nearestEnemyOf(u);
    if (!foe) { u.sync(); return; }
    u.spr.setFlipX(foe.x > u.x);
    u.atkCd = Math.max(0, u.atkCd - dt);

    // Monk: follow nearest injured friendly and heal.
    if (u.heal > 0) {
      const w = this.healTarget(u);
      if (w) {
        if (Phaser.Math.Distance.Between(u.x, u.y, w.x, w.y) > 30) { this.moveTo(u, w.x, w.y, u.speed * moraleMul, dt); playLoop(u.spr, u.anims.run || u.anims.idle); }
        else { w.hp = Math.min(w.maxHp, w.hp + u.heal * dt); w.hpFill.width = w.hpW * (w.hp / w.maxHp); if (u.atkCd <= 0) { u.atkCd = 1; playOnce(u.spr, 'monk_heal', u.anims.idle); } else playLoop(u.spr, u.anims.idle); }
      } else playLoop(u.spr, u.anims.idle);
      u.sync(); return;
    }

    const atkRange = u.range > 0 ? u.range : MELEE;
    if (dist <= atkRange) {
      if (u.cmd === 'hold' || u.range > 0 || u.hold || true) {
        if (u.atkCd <= 0) {
          u.atkCd = 0.5;
          if (u.area) { for (const o of this.units) { if (o.alive && o.side !== u.side && Phaser.Math.Distance.Between(u.x, u.y, o.x, o.y) <= MELEE) o.takeDamage(u.dmg * 0.5); } }
          else foe.takeDamage(u.dmg * 0.5);
          if (u.range > 0) { this.projectile(u.x, u.y, foe.x, foe.y); sfx.playThrottled('arrow_shoot', 120); }
          else sfx.playThrottled('sword_hit', 130);
          playOnce(u.spr, u.anims.atk, u.anims.idle); // (Polish Phase 1) swing / shoot
        } else {
          playLoop(u.spr, u.anims.idle);
        }
      }
    } else if (u.cmd !== 'hold' && !u.hold) {
      // Knights/tanks draw aggro is implicit (they advance and intercept by being front).
      this.moveTo(u, foe.x, foe.y, u.speed * moraleMul, dt);
      playLoop(u.spr, u.anims.run || u.anims.idle);
    } else {
      playLoop(u.spr, u.anims.idle);
    }
    u.sync();
  }

  healTarget(u) {
    let best = null, bd = Infinity;
    for (const o of this.units) {
      if (!o.alive || o.side !== u.side || o === u || o.hp >= o.maxHp * 0.8) continue;
      const d = Phaser.Math.Distance.Between(u.x, u.y, o.x, o.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  moveTo(u, tx, ty, speed, dt) {
    const ang = Math.atan2(ty - u.y, tx - u.x);
    let nx = u.x + Math.cos(ang) * speed * dt;
    let ny = u.y + Math.sin(ang) * speed * dt;
    // Simple obstacle avoidance.
    for (const o of this.obstacles) { if (Phaser.Math.Distance.Between(nx, ny, o.x, o.y) < o.r) { nx = u.x + Math.cos(ang + 1) * speed * dt; ny = u.y + Math.sin(ang + 1) * speed * dt; break; } }
    u.x = Phaser.Math.Clamp(nx, 30, GAME_W - 30); u.y = Phaser.Math.Clamp(ny, HORIZON + 60, GAME_H - 120);
  }

  projectile(x1, y1, x2, y2) {
    const dot = this.add.circle(x1, y1, 2.5, 0xffe9a8).setDepth(20);
    this.tweens.add({ targets: dot, x: x2, y: y2, duration: 180, onComplete: () => dot.destroy() });
  }

  updateMoraleBars() {
    const col = (m) => (m >= 70 ? 0x4ad66b : m >= 40 ? 0xe6c84a : 0xd64a4a);
    const set = (bar, m) => { bar.fill.width = (bar.W - 6) * (m / 100); bar.fill.fillColor = col(m); bar.val.setText(`${Math.round(m)}`); };
    set(this.playerBar, this.morale.player);
    set(this.enemyBar, this.morale.enemy);
  }

  endBattle(kind) {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.cmdBtns.forEach((b) => b.hide());
    const victory = kind === 'victory' || kind === 'rout_enemy';
    const retreated = kind === 'retreat';
    sfx.play(victory ? 'victory' : 'defeat'); // (Polish Phase 2)
    // Survivors by type.
    const survivors = {};
    let keepFrac = victory ? 1 : retreated ? 0.6 : 0.4;
    for (const u of this.sideUnits('player')) survivors[u.type] = (survivors[u.type] || 0) + 1;
    const army = Object.entries(survivors).map(([type, count]) => ({ type, count: Math.max(0, Math.round(count * keepFrac)) }));
    // Loot from defeated enemies (victory only).
    const enemyDead = (this.cfg.enemyArmy || []).reduce((s, g) => s + g.count, 0);
    const loot = victory ? { gold: enemyDead * 8, iron: this.faction === 'goblin' ? enemyDead * 2 : 0 } : null;

    // Phase 3: full-screen outcome overlay.
    const survCount = Object.values(survivors).reduce((s, n) => s + n, 0);
    const finalSurv = army.reduce((s, g) => s + g.count, 0);
    const D = 70;
    this.add.rectangle(0, 0, GAME_W, GAME_H, victory ? 0x0c1a0c : 0x1a0c0c, 0.72).setOrigin(0, 0).setDepth(D);
    const big = this.add.text(GAME_W / 2, GAME_H / 2 - 60, victory ? 'VICTORY' : retreated ? 'RETREAT' : 'DEFEAT', { fontFamily: 'monospace', fontSize: '64px', color: victory ? '#ffd24a' : '#e74c3c', fontStyle: 'bold', stroke: '#000', strokeThickness: 7 }).setOrigin(0.5).setDepth(D + 1);
    this.tweens.add({ targets: big, scale: { from: 1.4, to: 1 }, duration: 450, ease: 'Back.out' });
    const lines = [];
    lines.push(`Survivors: ${finalSurv} of ${survCount}`);
    if (victory && loot) lines.push(`Loot: +${loot.gold} gold${loot.iron ? `  +${loot.iron} iron` : ''}`);
    else if (!victory) lines.push(`You keep ${Math.round(keepFrac * 100)}% of survivors`);
    this.add.text(GAME_W / 2, GAME_H / 2 + 8, lines.join('\n'), { fontFamily: 'monospace', fontSize: '20px', color: '#fff', align: 'center', stroke: '#000', strokeThickness: 3, lineSpacing: 8 }).setOrigin(0.5, 0).setDepth(D + 1);

    this.time.delayedCall(3000, () => {
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.time.delayedCall(420, () => {
        const cb = this.cfg.onComplete;
        this.scene.stop();
        if (cb) cb({ victory, retreated, army, loot, context: this.cfg.context });
      });
    });
  }
}
