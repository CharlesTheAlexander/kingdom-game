import Phaser from 'phaser';
import { GAME_W, GAME_H } from './GameScene.js';
import { registerUnitAnimations, playLoop, playOnce } from '../systems/Animations.js';
import { sfx } from '../audio/SoundEngine.js';

// (Polish Phase 1) idle texture -> { walk, attack } animation keys for battle units.
const ANIM_SET: Record<string, any> = {
  blue_warrior_idle: { run: 'blue_warrior_run', atk: 'blue_warrior_attack' },
  warrior_idle: { run: 'red_warrior_run', atk: 'red_warrior_attack' },
  yellow_warrior_idle: { run: 'yellow_warrior_run', atk: 'yellow_warrior_attack' },
  purple_warrior_idle: { run: 'purple_warrior_run', atk: 'purple_warrior_attack' },
  goblin_idle: { run: 'goblin_run', atk: 'goblin_attack' },
  blue_archer_idle: { run: 'blue_archer_run', atk: 'blue_archer_shoot' },
  red_archer_idle: { run: 'red_archer_idle', atk: 'red_archer_shoot' },
  monk_idle: { run: 'monk_run', atk: null },
  // (Assets V2) new unit sprites
  spearman_idle: { run: 'spearman_run', atk: 'spearman_attack' },
  cavalry_idle: { run: 'cavalry_run', atk: 'cavalry_attack' },
  goblin_shaman: { run: 'goblin_shaman_run', atk: null },
  goblin_warlord: { run: 'goblin_warlord_run', atk: 'goblin_attack' },
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
const STATS: Record<string, any> = {
  warrior: { hp: 50, dmg: 15, speed: 52, range: 0, tex: 'blue_warrior_idle', heal: 0 },
  mercenary: { hp: 50, dmg: 18, speed: 52, range: 0, tex: 'yellow_warrior_idle', heal: 0 },
  archer: { hp: 25, dmg: 12, speed: 30, range: 168, tex: 'blue_archer_idle', heal: 0 },
  monk: { hp: 30, dmg: 0, speed: 50, range: 0, tex: 'monk_idle', heal: 8 },
  knight: { hp: 120, dmg: 25, speed: 34, range: 0, tex: 'blue_lancer', heal: 0, area: true, tank: true },
  goblin: { hp: 15, dmg: 8, speed: 74, range: 0, tex: 'goblin_idle', heal: 0 },
  garrison: { hp: 50, dmg: 15, speed: 0, range: 0, tex: 'blue_warrior_idle', heal: 0, hold: true },
  siege: { hp: 80, dmg: 8, speed: 18, range: 0, tex: 'siege_unit', heal: 0, siege: true }, // smashes walls (50/s), weak vs units
  spearmen: { hp: 45, dmg: 12, speed: 34, range: 0, tex: 'spearman_idle', heal: 0, spear: true }, // (V2 P4) anti-cavalry, slow
  cavalry: { hp: 40, dmg: 20, speed: 100, range: 0, tex: 'cavalry_idle', heal: 0, charge: true }, // (V2 P4) fast, charges, anti-archer
  commander: { hp: 340, dmg: 38, speed: 46, range: 0, tex: 'blue_lancer', heal: 0, area: true, tank: true }, // (V2 P5) the King/Queen in person
};
// (V2 Phase 4) Rock-paper-scissors: key beats value.
const COUNTER: Record<string, string> = { warrior: 'spearmen', spearmen: 'cavalry', cavalry: 'archer', archer: 'warrior' };
const FACTION_WARRIOR: Record<string, string> = { red: 'warrior_idle', purple: 'purple_warrior_idle', yellow: 'yellow_warrior_idle', neutral: 'blue_warrior_idle', goblin: 'goblin_idle' };
const FACTION_LABEL: Record<string, string> = { red: 'Red Kingdom', purple: 'Purple Kingdom', yellow: 'Yellow Kingdom', neutral: 'Free Company', goblin: 'Goblin Horde' };
const FACTION_COLOR: Record<string, number> = { red: 0xd64a4a, purple: 0xa45ad6, yellow: 0xd6c04a, neutral: 0x6aa0d6, goblin: 0x6ab04a };

// Terrain palettes: sky (top of gradient), horizon (band), ground (bottom),
// the scatter sprite, and how many to scatter. name shown in the pre-battle.
const TERRAIN: Record<string, any> = {
  forest: { sky: 0x334a3a, horizon: 0x223626, ground: 0x14241a, deco: 'iso_forest1', bg: 16, obs: 7, name: 'Forest Clearing' },
  mountains: { sky: 0x46484f, horizon: 0x33343c, ground: 0x202128, deco: 'iso_mtn', bg: 12, obs: 6, name: 'Mountain Pass' },
  plains: { sky: 0x4a5838, horizon: 0x33401f, ground: 0x202d16, deco: 'iso_rock', bg: 6, obs: 3, name: 'Open Plains' },
  wildlands: { sky: 0x4a4530, horizon: 0x33311c, ground: 0x242113, deco: 'iso_rock', bg: 9, obs: 5, name: 'The Wildlands' },
};

class BUnit {
  scene: any;
  side: string;
  type: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  spr: any;
  block: boolean;
  count: number;
  [key: string]: any;

  constructor(scene: any, side: string, type: string, x: number, y: number, texOverride?: any, opts: any = {}) {
    this.scene = scene;
    this.side = side; // 'player' | 'enemy'
    this.type = type;
    const s = STATS[type] || STATS.warrior;
    // (BUG 12) Block mode: one entity stands for `count` units (large battles).
    this.block = !!opts.block; this.count = opts.count || 1; this.unitHp = s.hp;
    // (V2 Phase 4) Veterancy: 0 green, 1-2 trained(+10%), 3-5 veteran(+25%), 6+ elite(+50%, never routes).
    const vet = opts.vet || 0;
    this.vetLevel = vet >= 6 ? 3 : vet >= 3 ? 2 : vet >= 1 ? 1 : 0;
    this.vetMul = [1, 1.1, 1.25, 1.5][this.vetLevel];
    this.maxHp = s.hp * this.count * this.vetMul; this.hp = this.maxHp; this.dmg = s.dmg; this.speed = s.speed;
    this.range = s.range; this.heal = s.heal; this.area = !!s.area; this.tank = !!s.tank; this.hold = !!s.hold;
    this.x = x; this.y = y; this.alive = true; this.cmd = null; this.atkCd = 0;
    const tex = texOverride || s.tex;
    const px = type === 'knight' ? 64 : 56;
    this.shadow = scene.add.ellipse(x, y + 22, px * 0.5, px * 0.2, 0x000000, 0.28).setDepth(8);
    if (this.block) {
      // Formation block: sized by count (max 80px wide), unit sprite centered, count label.
      const bw = Phaser.Math.Clamp(34 + this.count * 2.2, 40, 80);
      this.blockW = bw;
      this.blockRect = scene.add.rectangle(x, y, bw, 46, side === 'player' ? 0x1d3b6b : 0x6b1d1d, 0.55).setStrokeStyle(2, side === 'player' ? 0x4a7bd5 : 0xd64a4a, 0.9).setDepth(9);
      this.spr = scene.add.sprite(x, y - 2, scene.textures.exists(tex) ? tex : 'blue_warrior_idle', 0).setScale(40 / 192).setDepth(10);
      this.label = scene.add.text(x, y + 16, `x${this.count}`, { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(12);
    } else {
      this.spr = scene.add.sprite(x, y, scene.textures.exists(tex) ? tex : 'blue_warrior_idle', 0).setScale(px / 192).setDepth(10);
    }
    this.anims = { idle: this.spr.texture.key, run: ANIM_SET[this.spr.texture.key] ? ANIM_SET[this.spr.texture.key].run : null, atk: ANIM_SET[this.spr.texture.key] ? ANIM_SET[this.spr.texture.key].atk : null };
    if (this.spr.texture.frameTotal > 1 && scene.anims.exists(this.spr.texture.key)) this.spr.play(this.spr.texture.key);
    this.spr.setFlipX(side === 'player'); // players (right) face left; enemies (left) face right
    this.hpW = this.block ? (this.blockW - 6) : 30;
    this.hpBg = scene.add.rectangle(x, y - 30, this.hpW + 2, 5, 0x000000, 0.6).setDepth(11);
    this.hpFill = scene.add.rectangle(x - this.hpW / 2, y - 30, this.hpW, 3, side === 'player' ? 0x4ad66b : 0xd64a4a).setOrigin(0, 0.5).setDepth(12);
    // (V2 Phase 4) Veterancy badge: white/silver/gold star; elite gets a gold tint.
    if (this.vetLevel > 0) {
      const sc = ['#ffffff', '#ffffff', '#cfd2da', '#ffd24a'][this.vetLevel];
      this.vetStar = scene.add.text(x + (this.block ? this.hpW / 2 : 9), y - 36, '★', { fontFamily: 'monospace', fontSize: '11px', color: sc, stroke: '#000', strokeThickness: 2 }).setOrigin(0.5).setDepth(13);
      if (this.vetLevel >= 3) this.spr.setTint(0xffe9a8);
    }
  }
  takeDamage(a) {
    if (!this.alive) return;
    this.hp -= a;
    this.hpFill.width = this.hpW * Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    if (this.block) { // (BUG 12) shrink the displayed count as the block takes losses
      const c = Math.max(0, Math.ceil(this.hp / this.unitHp));
      if (c !== this.count) { this.count = c; if (this.label) this.label.setText(`x${this.count}`); }
    }
    this.spr.setTintFill(0xff5555);
    this.scene.time.delayedCall(60, () => { if (this.alive) this.spr.clearTint(); });
    this.scene.dmgNumber(this.x, this.y - 24, Math.round(a), this.side === 'player' ? '#ff6b6b' : '#ffffff');
    this.scene.impactAt(this.x, this.y - 12); // (Feel pass) blood/impact specks
    if (a >= 22) this.scene.cameras.main.shake(90, 0.004 + Math.min(0.006, a / 4000)); // (Feel pass) big-hit shake
    if (this.hp <= 0) this.die();
  }
  die() {
    if (!this.alive) return;
    this.alive = false;
    sfx.playThrottled(this.side === 'player' ? 'soldier_dies' : 'enemy_dies', 110); // (Polish Phase 2)
    this.scene.onUnitDeath(this);
    this.hpBg.destroy(); this.hpFill.destroy();
    if (this.blockRect) this.blockRect.destroy();
    if (this.label) this.label.destroy();
    if (this.vetStar) this.vetStar.destroy();
    if (this.crown) this.crown.destroy(); // (V2 P5)
    if (this._selRing) { this._selRing.destroy(); this._selRing = null; } // (Loop 1)
    this.scene.tweens.add({ targets: this.shadow, alpha: 0, duration: 500, onComplete: () => this.shadow.destroy() });
    this.spr.setTintFill(0xff3333);
    this.scene.tweens.add({ targets: this.spr, alpha: 0, angle: this.side === 'player' ? 30 : -30, y: this.y + 6, duration: 600, onComplete: () => this.spr.destroy() });
  }
  sync() {
    this.spr.x = this.x; this.spr.y = this.block ? this.y - 2 : this.y;
    this.shadow.x = this.x; this.shadow.y = this.y + 22;
    if (this.blockRect) { this.blockRect.x = this.x; this.blockRect.y = this.y; }
    if (this.label) { this.label.x = this.x; this.label.y = this.y + 16; }
    if (this._selRing) { this._selRing.x = this.x; this._selRing.y = this.y; } // (Loop 1) follow selection
    if (this.vetStar) { this.vetStar.x = this.x + (this.block ? this.hpW / 2 : 9); this.vetStar.y = this.y - 36; } // (V2 P4)
    if (this.crown) { this.crown.x = this.x; this.crown.y = this.y - 46; } // (V2 P5) commander crown
    this.hpBg.x = this.x; this.hpBg.y = this.y - 30;
    this.hpFill.x = this.x - this.hpW / 2; this.hpFill.y = this.y - 30;
  }
}

export class BattleScene extends Phaser.Scene {
  [key: string]: any;

  constructor() { super('BattleScene'); }

  preload() {
    // Knight uses the Lancer sprite (not loaded by the world scene).
    const UNITS = 'assets/Tiny Swords (Free Pack)/Units';
    if (!this.textures.exists('blue_lancer')) this.load.spritesheet('blue_lancer', `${UNITS}/Blue Units/Lancer/Lancer_Idle.png`, { frameWidth: 192, frameHeight: 192 });
  }

  init(data) { this.cfg = data || {}; }

  // (Audit FIX 4) Subtitle reflects who initiated: defending vs attacking, and
  // names a neutral settlement when assaulting one.
  battleSubtitle() {
    const label = FACTION_LABEL[this.faction] || this.faction;
    if (this.cfg.playerDefending) return `Defending against the ${label}`;
    const ctx = this.cfg.context || {};
    if (ctx.kind === 'settlement' && ctx.ref && ctx.ref.name) return `Assaulting ${ctx.ref.name}`;
    return `Attacking the ${label}`;
  }

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
    this.spawnCommander(); // (V2 P5) the King/Queen leads the host
    this.applyFormation('player', 'LINE');
    this.applyFormation('enemy', 'LINE');

    // (Completion Phase 7) Defender walls — attackers must breach them. Siege
    // units smash fast (50/s); without siege the attacker is debuffed.
    if (this.cfg.defenderWalls) {
      this.makeWall();
      const hasSiege = this.sideUnits('player').some((u) => u.type === 'siege');
      if (!hasSiege) { this.morale.player = Math.max(0, this.morale.player - 15); this._noSiegeUntil = 30; }
    }

    this.buildHud();
    this.createStartButton(); // (Phase 5) skip the pre-battle timer
    this.createAbilityButton(); // (V2 P5) commander special ability
    this.setupBattleInput();  // (Loop 1) in-battle box-select
    this.cameras.main.fadeIn(400, 0, 0, 0);
  }

  // (V2 Phase 5) Spawn the player's King/Queen as a powerful Commander unit.
  // High HP and damage, a crown marker, and a presence that buffs the host —
  // but if the Commander falls the army's morale collapses.
  spawnCommander() {
    const c = this.cfg.commander;
    if (!c) return;
    const u = new BUnit(this, 'player', 'commander', GAME_W * 0.84, GAME_H * 0.54, 'blue_lancer', {});
    u.isCommander = true;
    u.spr.setScale((u.spr.scaleX) * 1.25).setTint(0xffd24a); // larger, royal gold
    u.crown = this.add.text(u.x, u.y - 46, '♔', { fontFamily: 'monospace', fontSize: '20px', color: '#ffd24a', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5).setDepth(14);
    this.commander = u;
    this.units.push(u);
  }

  // (V2 Phase 5) One-shot commander ability, flavored by the King's trait.
  createAbilityButton() {
    if (!this.cfg.commander) return;
    const trait = this.cfg.commander.trait;
    const lbl = trait === 'warlord' ? '⚔ BATTLE CRY' : trait === 'diplomat' ? '🗡 HONORABLE DUEL' : '♔ RALLY';
    const x = GAME_W - 150, y = 64, w = 270, h = 40;
    const g = this.add.rectangle(x, y, w, h, 0x3a2e5a, 0.92).setStrokeStyle(2, 0xffd24a, 0.9).setDepth(48).setInteractive({ useHandCursor: true });
    const t = this.add.text(x, y, lbl, { fontFamily: 'monospace', fontSize: '15px', color: '#ffd24a', fontStyle: 'bold' }).setOrigin(0.5).setDepth(49);
    this.abilityBtn = g; this.abilityTxt = t;
    g.on('pointerover', () => { if (!this._abilityUsed) g.setFillStyle(0x4a3e6a, 0.95); });
    g.on('pointerout', () => { if (!this._abilityUsed) g.setFillStyle(0x3a2e5a, 0.92); });
    g.on('pointerdown', (p, lx, ly, ev) => { ev && ev.stopPropagation && ev.stopPropagation(); this.useCommanderAbility(); });
  }

  useCommanderAbility() {
    if (this._abilityUsed) return;
    if (this.phase !== 'battle') { this.banner.setText('The Commander acts once battle is joined'); return; }
    if (this.commander && !this.commander.alive) { this.banner.setText('Your Commander has fallen'); return; }
    const trait = this.cfg.commander.trait;
    if (trait === 'warlord') {
      this._cryUntil = this.battleTime + 20; this.morale.player = Math.min(100, this.morale.player + 10);
      this.battleToast('BATTLE CRY!  +30% attack for 20s', 0xffd24a);
    } else if (trait === 'diplomat') {
      this._hexUntil = this.battleTime + 20; this.morale.enemy = Math.max(0, this.morale.enemy - 22);
      this.battleToast('HONORABLE DUEL!  enemy weakened', 0x66ddff);
    } else {
      this._cryUntil = this.battleTime + 15; this.morale.player = Math.min(100, this.morale.player + 20);
      this.battleToast('RALLY!  the host takes heart', 0x4ad66b);
    }
    this._abilityUsed = true;
    if (this.abilityBtn) { this.abilityBtn.setFillStyle(0x2a2a2a, 0.7).setStrokeStyle(2, 0x666666, 0.6); this.abilityBtn.disableInteractive(); }
    if (this.abilityTxt) this.abilityTxt.setColor('#888888');
  }

  battleToast(text, color) {
    const t = this.add.text(GAME_W / 2, GAME_H * 0.34, text, { fontFamily: 'monospace', fontSize: '28px', color: '#' + color.toString(16).padStart(6, '0'), fontStyle: 'bold', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5).setDepth(75).setScale(0.6);
    this.tweens.add({ targets: t, scale: 1.1, duration: 260, ease: 'Back.out', yoyo: false });
    this.tweens.add({ targets: t, alpha: 0, y: t.y - 40, delay: 1100, duration: 700, onComplete: () => t.destroy() });
  }

  // (V2 Phase 5) Player attack multiplier from the Commander's presence:
  // +10% while alive, ×1.3 during Battle Cry, but a 30% collapse once fallen.
  playerCmdMul() {
    let m = this._cmdDead ? 0.7 : (this.commander && this.commander.alive ? 1.1 : 1);
    if (this._cryUntil && this.battleTime < this._cryUntil) m *= 1.3;
    return m;
  }
  enemyCmdMul() { return (this._hexUntil && this.battleTime < this._hexUntil) ? 0.75 : 1; }

  // (Loop 1, Feature #1) Drag a rectangle to select specific player units;
  // command-bar orders then apply ONLY to the selection (empty selection =
  // whole army). Click empty ground to clear the selection.
  setupBattleInput() {
    this.selectBox = this.add.graphics().setDepth(45);
    this._drag = null;
    this.input.on('pointerdown', (p) => {
      if (this.phase === 'done') return;
      if (p.y > GAME_H - 120 || p.y < 60) return; // ignore the button bar + top HUD
      this._drag = { x0: p.x, y0: p.y, moved: false };
    });
    this.input.on('pointermove', (p) => {
      if (!this._drag) return;
      if (Math.abs(p.x - this._drag.x0) + Math.abs(p.y - this._drag.y0) > 4) this._drag.moved = true;
      this.selectBox.clear();
      if (this._drag.moved) {
        const x = Math.min(p.x, this._drag.x0), y = Math.min(p.y, this._drag.y0), w = Math.abs(p.x - this._drag.x0), h = Math.abs(p.y - this._drag.y0);
        this.selectBox.fillStyle(0x66ddff, 0.12).fillRect(x, y, w, h);
        this.selectBox.lineStyle(1.5, 0x66ddff, 0.9).strokeRect(x, y, w, h);
      }
    });
    this.input.on('pointerup', (p) => {
      if (!this._drag) return;
      const d = this._drag; this._drag = null; this.selectBox.clear();
      if (!d.moved) { this.clearBattleSelection(); this.banner.setText(this.phase === 'pre' ? 'Choose a formation — battle begins automatically' : 'Orders apply to the whole army'); return; }
      const x = Math.min(p.x, d.x0), y = Math.min(p.y, d.y0), w = Math.abs(p.x - d.x0), h = Math.abs(p.y - d.y0);
      const sel = this.sideUnits('player').filter((u) => u.x >= x && u.x <= x + w && u.y >= y && u.y <= y + h);
      this.setBattleSelection(sel);
    });
  }

  setBattleSelection(units) {
    this.clearBattleSelection();
    this.selected = units;
    for (const u of units) this.addSelRing(u);
    if (units.length) this.banner.setText(`${units.length} unit${units.length > 1 ? 's' : ''} selected — orders apply to them`);
  }
  clearBattleSelection() {
    for (const u of this.selected || []) { if (u._selRing) { u._selRing.destroy(); u._selRing = null; } }
    this.selected = [];
  }
  addSelRing(u) {
    if (u._selRing) return;
    const r = u.block ? (u.blockW / 2 + 4) : 18;
    u._selRing = this.add.circle(u.x, u.y, r, 0x66ddff, 0).setStrokeStyle(2, 0x66ddff, 0.95).setDepth(13);
  }

  // (Phase 5) A "Start Battle Now" button that appears after 3s and skips the
  // remaining pre-battle countdown.
  createStartButton() {
    const y = GAME_H - 104;
    this.startBtn = this.add.rectangle(GAME_W / 2, y, 230, 42, 0xc9a84c).setStrokeStyle(2, 0xffffff, 0.9).setDepth(50).setInteractive({ useHandCursor: true }).setVisible(false);
    this.startBtnTxt = this.add.text(GAME_W / 2, y, '⚔ Start Battle Now', { fontFamily: 'monospace', fontSize: '16px', color: '#1a140c', fontStyle: 'bold' }).setOrigin(0.5).setDepth(51).setVisible(false);
    this.startBtn.on('pointerover', () => this.startBtn.setFillStyle(0xe6c86a));
    this.startBtn.on('pointerout', () => this.startBtn.setFillStyle(0xc9a84c));
    this.startBtn.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); if (this.phase === 'pre') this.startBattle(); });
    this.time.delayedCall(3000, () => { if (this.phase === 'pre' && this.startBtn) { this.startBtn.setVisible(true); this.startBtnTxt.setVisible(true); } });
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

    // (Loop 2, Feature #2) Terrain bonus zones — drawn so the player can read them.
    // High ground: a brighter elevated band across the top of the field.
    this._hiY = HORIZON + (GAME_H - HORIZON) * 0.22;     // above this = high ground
    this._riverY = GAME_H - 70;                            // below this = river crossing
    this.add.rectangle(0, HORIZON, GAME_W, this._hiY - HORIZON, 0xffffff, 0.06).setOrigin(0, 0).setDepth(-17);
    this.add.text(GAME_W / 2, HORIZON + 6, 'High Ground  ·  +20% damage', { fontFamily: 'monospace', fontSize: '11px', color: '#e8e0cc' }).setOrigin(0.5, 0).setAlpha(0.45).setDepth(-16);
    // River crossing: a blue band along the bottom edge.
    this.add.rectangle(0, this._riverY, GAME_W, GAME_H - this._riverY, 0x2a5a8a, 0.32).setOrigin(0, 0).setDepth(-17);
    this.add.text(GAME_W / 2, this._riverY + 4, 'River Crossing  ·  −20% damage', { fontFamily: 'monospace', fontSize: '11px', color: '#cfe0ff' }).setOrigin(0.5, 0).setAlpha(0.55).setDepth(-16);
  }

  // (Feature #2) Attacker damage multiplier by terrain position.
  terrainAtkMul(u) {
    if (this._hiY && u.y < this._hiY) return 1.2;       // high ground
    if (this._riverY && u.y > this._riverY) return 0.8; // crossing the river
    return 1;
  }
  // (Feature #2) Defender takes less when standing in forest (an obstacle cluster).
  terrainDefMul(u) {
    for (const o of this.obstacles) if (Phaser.Math.Distance.Between(u.x, u.y, o.x, o.y) < o.r + 6) return 0.7;
    return 1;
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
  spawnArmy(side: string, armyData: any, _color?: any) {
    const x = side === 'player' ? GAME_W * 0.80 : GAME_W * 0.20;
    const total = (armyData || []).reduce((s, g) => s + (g.count || 0), 0);
    // (BUG 12) Over 10 units a side renders as formation BLOCKS (one per type),
    // so 100+ unit battles stay readable instead of overflowing the screen.
    const blockMode = total > 10;
    for (const grp of armyData) {
      if (!grp.count) continue;
      let tex;
      if (side === 'enemy') tex = grp.type === 'archer' ? 'red_archer_idle' : (FACTION_WARRIOR[this.faction] || 'warrior_idle');
      const vet = grp.battles || 0; // (V2 P4) veterancy from the group's battle history
      if (blockMode) {
        const u = new BUnit(this, side, grp.type, x, GAME_H * 0.54, tex, { block: true, count: grp.count, vet });
        this.units.push(u);
      } else {
        for (let i = 0; i < grp.count; i++) this.units.push(new BUnit(this, side, grp.type, x, GAME_H * 0.54, tex, { vet }));
      }
    }
  }

  sideUnits(side) { return this.units.filter((u) => u.alive && u.side === side); }

  // Arrange a side's living units into a dense, ranked formation. Player holds
  // the right ~35%, the enemy the left ~35%, leaving the centre contested.
  applyFormation(side, name) {
    const us = this.sideUnits(side);
    if (!us.length) return;
    // (Phase 5) Remember start positions so we can ANIMATE into the new formation.
    const prev = us.map((u) => ({ u, x: u.x, y: u.y }));
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
    // (Phase 5) Animate units from their previous spots into the new formation
    // so the player can see the arrangement form during pre-battle.
    if (this.phase === 'pre') {
      for (const { u, x, y } of prev) {
        const nx = u.x, ny = u.y; u.x = x; u.y = y; u.sync();
        this.tweens.add({ targets: u, x: nx, y: ny, duration: 320, ease: 'Cubic.out', onUpdate: () => u.sync() });
      }
    } else {
      us.forEach((u) => u.sync());
    }
  }

  buildHud() {
    // --- Morale bars: enemy top-left, player top-right (Phase 3) -------------
    this.enemyBar = this.makeMoraleBar(20, 18, false, FACTION_COLOR[this.faction] || 0xd64a4a, `Enemy · ${FACTION_LABEL[this.faction] || this.faction}`, 'skull');
    // (V2 Phase 1) Enemy leader portrait beside their morale bar.
    const pk = 'portrait_' + this.faction;
    if (this.textures.exists(pk)) this.add.image(248, 14, pk).setOrigin(0, 0).setDisplaySize(40, 40).setDepth(42);
    this.playerBar = this.makeMoraleBar(GAME_W - 20, 18, true, 0x4ad66b, 'Your Army', 'shield');

    // --- Pre-battle headline -------------------------------------------------
    this.title = this.add.text(GAME_W / 2, 14, this.pal.name, { fontFamily: 'monospace', fontSize: '26px', color: '#ffe9a8', fontStyle: 'bold', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5, 0).setDepth(41);
    this.subtitle = this.add.text(GAME_W / 2, 46, this.battleSubtitle(), { fontFamily: 'monospace', fontSize: '14px', color: '#e7d6b0', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(41);
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

  // Player command. (BUG 11) Flank L/R sends non-archer units to the left/right
  // 30% of the battlefield, then they advance — with a brief arrow cue.
  command(name) {
    const all = this.sideUnits('player');
    const sel = (this.selected && this.selected.length) ? this.selected.filter((u) => u.alive) : null;
    const us = sel || all;
    if (name === 'CHARGE') us.forEach((u) => { u.cmd = 'charge'; });
    else if (name === 'HOLD') us.forEach((u) => { u.cmd = 'hold'; });
    else if (name === 'FLANK L') { (sel || all.filter((u) => u.type !== 'archer')).forEach((u) => { u.cmd = 'flankL'; }); this.flankArrow('L'); }
    else if (name === 'FLANK R') { (sel || all.filter((u) => u.type !== 'archer')).forEach((u) => { u.cmd = 'flankR'; }); this.flankArrow('R'); }
    else if (name === 'RETREAT') { all.forEach((u) => { u.cmd = 'retreat'; }); this._retreating = true; }
    this.activeCmd = name;
    this.cmdBtns.forEach((b) => b.setActive(b.label === name));
    this.banner.setText(`Order: ${name}`);
  }

  // (BUG 11) Brief arrow animation showing the flank direction.
  flankArrow(dir) {
    const y = GAME_H * 0.5, x0 = GAME_W / 2;
    const g = this.add.graphics().setDepth(60);
    const col = 0xffd24a;
    const draw = (cx) => { g.clear(); g.lineStyle(8, col, 0.9); const d = dir === 'L' ? -1 : 1; g.beginPath(); g.moveTo(cx - d * 40, y); g.lineTo(cx + d * 40, y); g.strokePath(); g.beginPath(); g.moveTo(cx + d * 10, y - 24); g.lineTo(cx + d * 44, y); g.lineTo(cx + d * 10, y + 24); g.strokePath(); };
    draw(x0);
    this.tweens.addCounter({ from: 0, to: 1, duration: 700, onUpdate: (tw) => { const t = tw.getValue(); draw(x0 + (dir === 'L' ? -1 : 1) * t * 120); g.setAlpha(1 - t); }, onComplete: () => g.destroy() });
  }

  // (Feel pass) A small burst of red impact specks at a hit location.
  impactAt(x, y) {
    for (let i = 0; i < 4; i++) {
      const d = this.add.circle(x, y, Phaser.Math.Between(1, 3), 0xb02a2a).setDepth(29);
      this.tweens.add({ targets: d, x: x + Phaser.Math.Between(-14, 14), y: y + Phaser.Math.Between(-10, 6), alpha: 0, duration: 360, onComplete: () => d.destroy() });
    }
  }

  // (V2 Phase 4) 1.5x when attacker counters defender, 0.6x when countered, else 1.
  counterMul(atk: string, def: string) {
    if (COUNTER[atk] === def) return 1.5;
    if (COUNTER[def] === atk) return 0.6;
    return 1;
  }
  // Brief green ▲ (advantage) / red ▼ (disadvantage) so the player learns counters.
  counterArrow(u: any, cm: number) {
    if (cm === 1) return;
    u._arrowCd = (u._arrowCd || 0) - 1;
    if (u._arrowCd > 0) return; u._arrowCd = 12;
    const t = this.add.text(u.x, u.y - 34, cm > 1 ? '▲' : '▼', { fontFamily: 'monospace', fontSize: '14px', color: cm > 1 ? '#4ad66b' : '#ff6b6b', fontStyle: 'bold', stroke: '#000', strokeThickness: 2 }).setOrigin(0.5).setDepth(30);
    this.tweens.add({ targets: t, y: u.y - 48, alpha: 0, duration: 700, onComplete: () => t.destroy() });
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
    // (V2 Phase 5) The Commander's death collapses the army's will to fight.
    if (u.isCommander) {
      this._cmdDead = true;
      this.morale.player = Math.max(0, this.morale.player - 35);
      this.battleToast('THE COMMANDER HAS FALLEN', 0xe74c3c);
      this.cameras.main.shake(260, 0.012);
    }
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

    if (this._noSiegeUntil > 0) this._noSiegeUntil -= dt; // (Phase 7) no-siege debuff timer
    this.updateWall(dt); // (Phase 7) wall breach state
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
    if (this.startBtn) this.startBtn.setVisible(false); // (Phase 5) hide skip button
    if (this.startBtnTxt) this.startBtnTxt.setVisible(false);
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

  // (Completion Phase 7) Defender wall across the centre of the field.
  makeWall() {
    const x = GAME_W * 0.5, top = HORIZON + 80, h = GAME_H - 120 - top;
    this.wall = { x, hp: 600, maxHp: 600 };
    this.wallG = this.add.graphics().setDepth(7);
    this.wallBarBg = this.add.rectangle(x, top - 16, 120, 8, 0x000000, 0.7).setDepth(42);
    this.wallBar = this.add.rectangle(x - 60, top - 16, 120, 6, 0x9aa0a6).setOrigin(0, 0.5).setDepth(43);
    this.wallLabel = this.add.text(x, top - 28, 'WALL', { fontFamily: 'monospace', fontSize: '11px', color: '#cbd2da', fontStyle: 'bold' }).setOrigin(0.5).setDepth(43);
    this.drawWallG(top, h);
  }
  drawWallG(top, h) {
    const g = this.wallG; if (!g) return; const x = this.wall.x; g.clear();
    g.fillStyle(0x6f6f68, 1); g.fillRect(x - 9, top, 18, h);
    g.fillStyle(0x82828a, 1); g.fillRect(x - 9, top, 6, h);
    g.fillStyle(0x55554f, 1); for (let yy = top; yy < top + h; yy += 16) g.fillRect(x - 9, yy, 18, 2); // courses
    for (let cx = x - 9; cx < x + 9; cx += 8) g.fillRect(cx, top - 6, 5, 6); // merlons
  }
  updateWall(dt) {
    if (!this.wall) return;
    this.wallBar.width = 120 * Phaser.Math.Clamp(this.wall.hp / this.wall.maxHp, 0, 1);
    if (this.wall.hp <= 0) {
      this.dmgNumber(this.wall.x, HORIZON + 90, 0, '#fff');
      if (this.wallG) this.wallG.destroy(); if (this.wallBar) this.wallBar.destroy(); if (this.wallBarBg) this.wallBarBg.destroy(); if (this.wallLabel) this.wallLabel.destroy();
      this.wall = null; this.banner.setText('The wall is breached!');
      this.cameras.main.shake(300, 0.01);
    }
  }

  updateUnit(u, dt) {
    const moraleMul = (this.morale[u.side] <= 30 ? 0.8 : 1) * (u.cmd === 'charge' ? 1.2 : 1);
    // (Completion Phase 7) While a wall stands, player units assault it instead of
    // crossing. Siege hits for 50/s; others chip at 5/s (×0.7 with no-siege debuff).
    if (this.wall && this.wall.hp > 0 && u.side === 'player' && u.cmd !== 'retreat') {
      const wx = this.wall.x;
      if (u.x > wx + 22) { this.moveTo(u, wx + 12, u.y, u.speed * moraleMul, dt); playLoop(u.spr, u.anims.run || u.anims.idle); u.sync(); return; }
      u.atkCd = Math.max(0, u.atkCd - dt);
      if (u.atkCd <= 0) {
        u.atkCd = 0.5;
        let dmg = (u.type === 'siege' ? 25 : 2.5) * (u.count || 1);
        if (this._noSiegeUntil > 0 && u.type !== 'siege') dmg *= 0.7;
        this.wall.hp -= dmg; this.dmgNumber(wx, u.y - 20, Math.round(dmg), '#cbd2da');
        playOnce(u.spr, u.anims.atk, u.anims.idle); sfx.playThrottled('sword_hit', 130);
      } else playLoop(u.spr, u.anims.idle);
      u.sync(); return;
    }
    // Defenders hold behind their wall until it falls.
    if (this.wall && this.wall.hp > 0 && u.side === 'enemy') { playLoop(u.spr, u.anims.idle); u.sync(); return; }
    // Commands that override targeting.
    if (u.cmd === 'retreat') { this.moveTo(u, u.side === 'player' ? GAME_W + 40 : -40, u.y, u.speed * 1.1 * moraleMul, dt); u.sync(); return; }
    // (BUG 11) Move to the left/right 30% band, then advance toward the enemy.
    if (u.cmd === 'flankL') { if (u.x > GAME_W * 0.30) { this.moveTo(u, GAME_W * 0.14, u.y, u.speed * moraleMul, dt); playLoop(u.spr, u.anims.run || u.anims.idle); u.sync(); return; } u.cmd = 'charge'; }
    if (u.cmd === 'flankR') { if (u.x < GAME_W * 0.70) { this.moveTo(u, GAME_W * 0.86, u.y, u.speed * moraleMul, dt); playLoop(u.spr, u.anims.run || u.anims.idle); u.sync(); return; } u.cmd = 'charge'; }

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
          // (BUG 12) block dmg scales w/ count; (Feature #2) terrain; (V2 P4) veterancy + counters + charge.
          const cm = this.counterMul(u.type, foe.type);
          let power = u.dmg * 0.5 * (u.count || 1) * this.terrainAtkMul(u) * (u.vetMul || 1) * cm;
          power *= u.side === 'player' ? this.playerCmdMul() : this.enemyCmdMul(); // (V2 P5) commander buffs/collapse
          // (V2 P3 balance) Cavalry charge: 2x first strike (was 3x — 3x one-shot
          // archers). Spearmen are a HARD counter: their pike wall negates the
          // charge entirely, so cavalry must not open on them.
          if (u.type === 'cavalry' && !u._charged) { if (foe.type !== 'spearmen') power *= 2; u._charged = true; }
          this.counterArrow(u, cm); // teach the matchup
          if (u.area) { for (const o of this.units) { if (o.alive && o.side !== u.side && Phaser.Math.Distance.Between(u.x, u.y, o.x, o.y) <= MELEE) o.takeDamage(power * this.terrainDefMul(o)); } }
          else foe.takeDamage(power * this.terrainDefMul(foe));
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
    const survivors: Record<string, number> = {};
    let keepFrac = victory ? 1 : retreated ? 0.6 : 0.4;
    for (const u of this.sideUnits('player')) { if (u.isCommander) continue; survivors[u.type] = (survivors[u.type] || 0) + (u.count || 1); } // (BUG 12) blocks carry a count; (V2 P5) commander isn't a troop type
    const army = Object.entries(survivors).map(([type, count]) => ({ type, count: Math.max(0, Math.round(count * keepFrac)) }));
    // Loot from defeated enemies (victory only).
    const enemyDead = (this.cfg.enemyArmy || []).reduce((s, g) => s + g.count, 0);
    const loot = victory ? { gold: enemyDead * 8, iron: this.faction === 'goblin' ? enemyDead * 2 : 0 } : null;

    // (Feel pass) Victory confetti rains down; defeat washes the screen gray.
    if (victory) {
      if (!this.textures.exists('confetti_px')) { const cg = this.make.graphics({ x: 0, y: 0, add: false } as any); cg.fillStyle(0xffffff, 1); cg.fillRect(0, 0, 4, 4); cg.generateTexture('confetti_px', 4, 4); cg.destroy(); }
      this.add.particles(0, -10, 'confetti_px', { x: { min: 0, max: GAME_W }, y: -10, lifespan: 2600, speedY: { min: 120, max: 260 }, speedX: { min: -40, max: 40 }, scale: { min: 0.8, max: 2 }, rotate: { min: 0, max: 360 }, tint: [0xffd24a, 0x4ad66b, 0x66ddff, 0xff6b6b, 0xffffff], quantity: 4, frequency: 30, duration: 1500 }).setDepth(72);
    } else if (!retreated) {
      const gray = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x202028, 0).setOrigin(0, 0).setDepth(69);
      this.tweens.add({ targets: gray, fillAlpha: 0.4, duration: 700 });
    }

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
        if (cb) cb({ victory, retreated, army, loot, context: this.cfg.context, commanderDied: !!this._cmdDead });
      });
    });
  }
}
