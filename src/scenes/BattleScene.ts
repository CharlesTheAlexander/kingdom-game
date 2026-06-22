import Phaser from 'phaser';
import { GAME_W, GAME_H } from './GameScene.js';
import { registerUnitAnimations, playLoop, playOnce } from '../systems/Animations.js';
import { sfx } from '../audio/SoundEngine.js';
import { GameWorld } from '../systems/GameWorld.js'; // (Phase 11) army equipment tier + monument morale

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
    // (Phase 11) Restore the equipment sheen (if any) after the hit-flash, else
    // just clear the tint as before.
    this.scene.time.delayedCall(60, () => { if (this.alive) { if (this._equipTint) this.spr.setTint(this._equipTint); else this.spr.clearTint(); } });
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
    if (this._equipAura) { this._equipAura.destroy(); this._equipAura = null; } // (Phase 11)
    if (this._selRing) { this._selRing.destroy(); this._selRing = null; } // (Loop 1)
    this.scene.tweens.add({ targets: this.shadow, alpha: 0, duration: 500, onComplete: () => this.shadow.destroy() });
    this.spr.setTintFill(0xff3333);
    this.scene.deathWispFx(this.x, this.y, this.side === 'player'); // (Visual P7) rising soul wisp
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
    if (this._equipAura) { this._equipAura.x = this.x; this._equipAura.y = this.y + 6; } // (Phase 11) legendary aura follows
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

  // =========================================================================
  // (Phase 9) BATTLE FOG OF WAR — a PRE-BATTLE information gate driven by the
  // intel level computed at the launch site. This is an OVERLAY + a gated info
  // display only; it never touches combat resolution, the result, or onComplete.
  //   none  — enemy half covered by a dark blue-gray fog; only a count estimate
  //           ("Enemy force: ~12 units"), no types/formation; enemy bar hidden.
  //   basic — enemy unit types visible, but the formation arrangement is hidden
  //           (no enemy formation label/markers, ranks scrambled into a huddle).
  //   full  — complete enemy formation + commander note + enemy morale (revealed
  //           only when the fight starts, like normal); enemy bar shown on lift.
  //   mira  — full, PLUS the enemy morale bar + active ability are visible NOW
  //           (Mira scouts ahead) and fog never appears.
  // =========================================================================
  applyPreBattleIntel() {
    const intel = this.intel || 'none';
    this._fogLifted = false;
    // The enemy morale bar is hidden pre-battle unless Mira has scouted the foe.
    this.setMoraleBarVisible(this.enemyBar, intel === 'mira');

    const enemy = this.units.filter((u: any) => u.side === 'enemy');

    if (intel === 'mira' || intel === 'full') {
      // Full picture — nothing hidden. Mira additionally reveals the foe's active
      // ability + morale; a short scouting note tells the player why.
      if (intel === 'mira') {
        this.intelNote = this.add.text(GAME_W * 0.20, 92, "Mira scouts ahead — enemy fully revealed", { fontFamily: 'monospace', fontSize: '12px', color: '#bdf0c8', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(45);
        const ability = this.faction === 'goblin' ? 'Frenzy' : 'War Banner';
        this.add.text(GAME_W * 0.20, 110, `Enemy ability: ${ability}`, { fontFamily: 'monospace', fontSize: '11px', color: '#ffe0a0', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(45);
      } else {
        this.intelNote = this.add.text(GAME_W * 0.20, 92, 'Scout report — enemy formation revealed', { fontFamily: 'monospace', fontSize: '12px', color: '#cfe0ff', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(45);
      }
      return;
    }

    if (intel === 'basic') {
      // Unit TYPES are visible but NOT the arrangement: scramble the enemy into a
      // loose huddle (no readable ranks) and suppress the enemy formation label.
      this._hideEnemyFormation = true;
      this.scrambleEnemyHuddle();
      this.intelNote = this.add.text(GAME_W * 0.20, 92, 'Limited intel — enemy types known, formation unclear', { fontFamily: 'monospace', fontSize: '12px', color: '#e7d6b0', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(45);
      return;
    }

    // intel === 'none' — FOG. Cover the enemy (left) half of the field with a dark
    // blue-gray overlay, hide every enemy visual under it, and show only a fuzzy
    // count estimate. The player sees neither types nor formation.
    this._hideEnemyFormation = true;
    for (const u of enemy) this.setUnitObjVisible(u, false);
    const fogX = 0, fogW = GAME_W * 0.5;
    this.fogRect = this.add.rectangle(fogX, 0, fogW, GAME_H, 0x1c2733, 0.92).setOrigin(0, 0).setDepth(46);
    // A few drifting fog wisps for texture (cheap; cleaned up on lift).
    this.fogWisps = this.add.graphics().setDepth(46.5);
    for (let i = 0; i < 14; i++) { this.fogWisps.fillStyle(0x2a3a48, 0.5); this.fogWisps.fillEllipse(Phaser.Math.Between(20, fogW - 20), Phaser.Math.Between(HORIZON, GAME_H - 40), Phaser.Math.Between(60, 160), Phaser.Math.Between(28, 70)); }
    // Fuzzy count estimate (rounded to the nearest ~5 so it reads as an estimate).
    const total = (this.cfg.enemyArmy || []).reduce((s: number, g: any) => s + (g.count || 0), 0);
    const est = Math.max(1, Math.round(total / 5) * 5);
    this.fogLabel = this.add.text(fogW / 2, GAME_H * 0.5, `?\nEnemy force: ~${est} units\n(no scouts — formation unknown)`, { fontFamily: 'monospace', fontSize: '20px', color: '#cfdae6', align: 'center', fontStyle: 'bold', stroke: '#000', strokeThickness: 4, lineSpacing: 8 }).setOrigin(0.5).setDepth(47);
  }

  // (Phase 9) Toggle all of a BUnit's display objects (used to hide enemies under
  // the fog and bring them back on the dramatic reveal).
  setUnitObjVisible(u: any, vis: boolean) {
    for (const o of [u.spr, u.shadow, u.hpBg, u.hpFill, u.blockRect, u.label, u.vetStar, u.crown]) { if (o && o.setVisible) o.setVisible(vis); }
  }

  // (Phase 9) Basic-intel "formation unclear": pull the enemy into a loose blob in
  // their back third so types read but no ranks/arrangement are legible. Purely a
  // display arrangement — startBattle() re-applies a real formation on the reveal.
  scrambleEnemyHuddle() {
    const us = this.sideUnits('enemy');
    const cx = GAME_W * 0.16, cy = GAME_H * 0.54;
    for (const u of us) {
      if (u.isCommander) continue;
      this.tweens.killTweensOf(u); // stop the in-flight formation tween from applyFormation
      u.x = cx + Phaser.Math.Between(-46, 46);
      u.y = cy + Phaser.Math.Between(-70, 70);
      u.sync();
    }
  }

  // (Phase 9) THE REVEAL — when the battle is joined the fog LIFTS with a dramatic
  // sweep: the overlay slides off the enemy half and fades, enemy units fade back
  // in, and the enemy morale bar appears. After this everything is normal.
  liftBattleFog() {
    if (this._fogLifted) return;
    this._fogLifted = true;
    // Reveal the enemy morale bar now (for all intel levels except where already shown).
    this.setMoraleBarVisible(this.enemyBar, true);
    if (this.intelNote) { this.tweens.add({ targets: this.intelNote, alpha: 0, duration: 500, onComplete: () => this.intelNote && this.intelNote.destroy() }); }
    // Bring hidden enemy units back (they were hidden under fog).
    for (const u of this.units) { if (u.side === 'enemy' && u.alive) { this.setUnitObjVisible(u, true); if (u.spr) u.spr.setAlpha(0); } }
    if (this.fogLabel) this.tweens.add({ targets: this.fogLabel, alpha: 0, scale: 1.4, duration: 400, onComplete: () => this.fogLabel && this.fogLabel.destroy() });
    if (this.fogWisps) this.tweens.add({ targets: this.fogWisps, alpha: 0, duration: 500, onComplete: () => this.fogWisps && this.fogWisps.destroy() });
    if (this.fogRect) {
      // A bright sweep wipe across the fog as it slides off + fades.
      const sweep = this.add.rectangle(0, 0, 8, GAME_H, 0xbfe0ff, 0).setOrigin(0, 0).setDepth(48).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: sweep, x: GAME_W * 0.5, fillAlpha: 0.4, duration: 420, ease: 'Cubic.out', yoyo: true, onComplete: () => sweep.destroy() });
      this.tweens.add({ targets: this.fogRect, alpha: 0, x: -GAME_W * 0.5, duration: 520, ease: 'Cubic.in', onComplete: () => { this.fogRect && this.fogRect.destroy(); this.fogRect = null; } });
      // Fade the enemy units in as the fog peels away.
      this.time.delayedCall(120, () => { for (const u of this.units) { if (u.side === 'enemy' && u.alive && u.spr) this.tweens.add({ targets: u.spr, alpha: 1, duration: 400 }); } });
    } else {
      for (const u of this.units) { if (u.side === 'enemy' && u.alive && u.spr) u.spr.setAlpha(1); }
    }
    this.cameras.main.flash(180, 180, 210, 240);
  }

  create() {
    const terrain = this.cfg.terrainType || 'plains';
    this.pal = TERRAIN[terrain] || TERRAIN.plains;
    this.faction = this.cfg.enemyFaction || 'red';
    // (Phase 9) Fog-of-war intel level for the PRE-BATTLE display. Computed at the
    // launch site (ContinentScene/expeditions): 'mira' (ranger scouts ahead) >
    // 'full' (fresh spy report) > 'basic' (unit types only) > 'none' (fog + count).
    this.intel = this.cfg.intel || 'none';
    // (Phase 9) Is this battle fought on a river crossing? Draw a river across the
    // field + apply the existing river crossing-zone penalty (−20%).
    this.riverBattle = !!this.cfg.riverBattle;

    registerUnitAnimations(this); // (Polish Phase 1) ensure walk/attack/shoot anims exist
    this.ensureFxTextures(); // (Visual P7) generate-once particle pixels
    this.drawBattlefield();

    this.units = [];
    this.obstacles = [];
    this.phase = 'pre';
    this.timer = PRE_BATTLE;
    this.battleTime = 0;
    // (Phase 11) ARMY EQUIPMENT TIER — the army-wide damage bonus + visual tier.
    // Prefer an explicit cfg override (lets the headless audit/tests pin a value),
    // else read the live GameWorld. Folded into playerCmdMul + the unit tint.
    this._equipTier = (this.cfg.equipmentTier != null) ? this.cfg.equipmentTier : (GameWorld.equipmentTier || 0);
    this._equipDmgMult = (this.cfg.equipmentDmgMult != null) ? this.cfg.equipmentDmgMult : GameWorld.equipmentDamageMult();
    this.morale = { player: 70, enemy: 70 };
    if (this.cfg.taverMoraleBonus) this.morale.player += 10;
    // (Phase 11) Standing battle-morale bonus from monuments (the Great Statue's +15).
    const monMorale = (this.cfg.monumentMorale != null) ? this.cfg.monumentMorale : GameWorld.monumentMoraleBonus();
    if (monMorale) this.morale.player = Math.min(100, this.morale.player + monMorale);
    this.selected = [];
    this.activeCmd = null;

    this.scatterObstacles(terrain);
    this.spawnArmy('player', this.cfg.playerArmy || [], 0xffffff);
    this.spawnArmy('enemy', this.cfg.enemyArmy || [], null);
    this.applyEquipmentTint(); // (Phase 11) progressive armour sheen by tier
    this.spawnCommander(); // (V2 P5) the King/Queen leads the host
    this.spawnArmyBanners(); // (Visual P9) planted waving banner at each host
    this.spawnLeaves();      // (Visual P9) drifting forest leaves
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
    this.applyPreBattleIntel(); // (Phase 9) fog / gated enemy info by intel level
    this.createStartButton(); // (Phase 5) skip the pre-battle timer
    this.createAbilityButton(); // (V2 P5) commander special ability
    this.setupBattleInput();  // (Loop 1) in-battle box-select
    this.createBattleWeather(); // (V2 P4 #4) rain/snow carried from the world
    this.cameras.main.fadeIn(400, 0, 0, 0);
  }

  // (V2 P4, improvement #4) If it was raining/snowing in the world, the battle is
  // fought under the same sky.
  createBattleWeather() {
    const w = this.cfg.weather;
    if (w !== 'rain' && w !== 'snow') return;
    if (!this.textures.exists('battle_wx')) { const wg = this.make.graphics({ x: 0, y: 0, add: false } as any); wg.fillStyle(0xffffff, 1); wg.fillRect(0, 0, w === 'rain' ? 2 : 3, w === 'rain' ? 10 : 3); wg.generateTexture('battle_wx', 3, 10); wg.destroy(); }
    if (w === 'rain') this.add.particles(0, -10, 'battle_wx', { x: { min: 0, max: GAME_W }, y: -10, lifespan: 900, speedY: { min: 600, max: 800 }, speedX: { min: -60, max: -40 }, scaleY: { min: 0.8, max: 1.4 }, alpha: { start: 0.5, end: 0.2 }, quantity: 6, frequency: 24, tint: 0x9fc4d2 }).setDepth(68);
    else this.add.particles(0, -10, 'battle_wx', { x: { min: 0, max: GAME_W }, y: -10, lifespan: 4200, speedY: { min: 50, max: 110 }, speedX: { min: -30, max: 30 }, scale: { min: 0.6, max: 1.2 }, alpha: { start: 0.8, end: 0.3 }, quantity: 3, frequency: 50, tint: 0xffffff }).setDepth(68);
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
      this.battleToast('BATTLE CRY!  +30% attack for 20s', 0xffd24a); sfx.play('battle_cry'); // (V2 P4 #8)
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
    // (Phase 11) Army-wide EQUIPMENT TIER damage bonus (+15%/+30%/+50%). Folded
    // into the player command multiplier so every player strike benefits. Read
    // from the cfg snapshot taken at battle launch (falls back to GameWorld).
    m *= (this._equipDmgMult || 1);
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

  // (Visual P9) Painterly battlefield with cinematic depth — a dramatic clouded
  // sky, an atmospheric haze horizon, light shafts, and per-terrain foreground:
  // plains (perspective grass strokes), forest (tree masses on both flanks +
  // drifting leaves), mountains (boulders, misty valley, distant peaks). The
  // terrain bonus ZONES (high ground / river / forest) and their labels are kept.
  drawBattlefield() {
    const p = this.pal;
    const terrain = this.cfg.terrainType || 'plains';
    this._terrain = terrain;
    const lerp = (a, b, t) => {
      const ca = Phaser.Display.Color.IntegerToColor(a), cb = Phaser.Display.Color.IntegerToColor(b);
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(ca, cb, 100, Math.round(Phaser.Math.Clamp(t, 0, 1) * 100));
      return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
    };
    this._lerp = lerp;

    // ---- 1. SKY: a deep painterly gradient drawn as a graphics fill ----------
    const sky = this.add.graphics().setDepth(-30);
    const SKY_N = 24, skyStep = HORIZON / SKY_N;
    for (let i = 0; i < SKY_N; i++) {
      sky.fillStyle(lerp(p.sky, p.horizon, i / (SKY_N - 1)), 1);
      sky.fillRect(0, i * skyStep, GAME_W, skyStep + 1);
    }
    // Warm cinematic light pooling near the horizon centre (the sun's glow).
    const sunX = GAME_W * 0.5, glow = this.add.graphics().setDepth(-29).setBlendMode(Phaser.BlendModes.ADD);
    const sunWarm = terrain === 'mountains' ? 0xbfc8d8 : 0xffe0a0;
    for (let r = 360; r > 0; r -= 24) { glow.fillStyle(sunWarm, 0.018); glow.fillCircle(sunX, HORIZON + 8, r); }

    // ---- 2. CLOUDS: soft layered painterly cloud masses -----------------------
    this.drawClouds(terrain);

    // ---- 3. LIGHT SHAFTS: cheap god-rays fanning down from the sun ------------
    const shafts = this.add.graphics().setDepth(-28).setBlendMode(Phaser.BlendModes.ADD);
    const shaftTint = terrain === 'mountains' ? 0xaab4c8 : 0xfff0c0;
    for (let i = 0; i < 7; i++) {
      const a = Phaser.Math.FloatBetween(-0.5, 0.5);
      const x0 = sunX + a * 120, len = GAME_H * 0.7, spread = 26 + Math.abs(a) * 60;
      shafts.fillStyle(shaftTint, 0.05);
      shafts.beginPath();
      shafts.moveTo(x0 - 10, HORIZON - 30);
      shafts.lineTo(x0 + 10, HORIZON - 30);
      shafts.lineTo(x0 + Math.sin(a) * len + spread, HORIZON - 30 + len);
      shafts.lineTo(x0 + Math.sin(a) * len - spread, HORIZON - 30 + len);
      shafts.closePath(); shafts.fillPath();
    }
    this._shafts = shafts;

    // ---- 4. DISTANT TERRAIN SILHOUETTE on the horizon (atmospheric haze) ------
    this.drawHorizonMasses(terrain);
    // Atmospheric haze band blending sky into land.
    const haze = this.add.graphics().setDepth(-21);
    for (let i = 0; i < 10; i++) { haze.fillStyle(lerp(p.horizon, p.ground, i / 9), 0.5 - i * 0.03); haze.fillRect(0, HORIZON - 16 + i * 4, GAME_W, 6); }
    this.add.rectangle(0, HORIZON, GAME_W, 2, 0xffffff, 0.10).setOrigin(0, 0).setDepth(-20);

    // ---- 5. GROUND: painterly gradient + terrain-specific strokes -------------
    const ground = this.add.graphics().setDepth(-19);
    const GR_N = 22, grStep = (GAME_H - HORIZON) / GR_N;
    for (let i = 0; i < GR_N; i++) {
      ground.fillStyle(lerp(p.horizon, p.ground, i / (GR_N - 1)), 1);
      ground.fillRect(0, HORIZON + i * grStep, GAME_W, grStep + 1);
    }
    // A pool of warm light on the contested centre ground.
    const groundGlow = this.add.graphics().setDepth(-18).setBlendMode(Phaser.BlendModes.ADD);
    for (let r = 380; r > 0; r -= 30) { groundGlow.fillStyle(sunWarm, 0.012); groundGlow.fillEllipse(GAME_W * 0.5, GAME_H * 0.62, r * 1.6, r * 0.7); }

    this.drawTerrainGround(terrain);

    // ---- 6. Background scenery clustered near the horizon (decoration) --------
    const key = this.textures.exists(p.deco) ? p.deco : 'iso_rock';
    for (let i = 0; i < p.bg; i++) {
      const x = Phaser.Math.Between(20, GAME_W - 20);
      const y = Phaser.Math.Between(HORIZON - 4, HORIZON + 60);
      const t = (y - (HORIZON - 4)) / 64;            // 0 far .. 1 near
      this.add.image(x, y, key).setScale(0.6 + t * 0.7).setAlpha(0.32 + t * 0.38).setDepth(-17 + Math.round(t * 3)).setTint(lerp(0x7a8696, p.ground, t));
    }
    // Painterly vignette — darkened EDGES that frame the lit centre like a
    // canvas. Drawn as graded dark bands on each edge (no blend mode → never
    // bleeds the world scene; the opaque sky/ground above fully covers it).
    const vig = this.add.graphics().setDepth(-10);
    const EB = 26;
    for (let i = 0; i < EB; i++) {
      vig.fillStyle(0x05060a, 0.32 * Math.pow(1 - i / EB, 1.6));
      vig.fillRect(0, i * 4, GAME_W, 4);                       // top
      vig.fillRect(0, GAME_H - 4 - i * 4, GAME_W, 4);          // bottom
      vig.fillRect(i * 5, 0, 5, GAME_H);                       // left
      vig.fillRect(GAME_W - 5 - i * 5, 0, 5, GAME_H);          // right
    }

    // ---- 7. TERRAIN BONUS ZONES (kept — gameplay reads off _hiY / _riverY) ----
    this._hiY = HORIZON + (GAME_H - HORIZON) * 0.22;     // above this = high ground
    this._riverY = GAME_H - 70;                            // below this = river crossing
    // High ground: a sunlit elevated rise across the top of the field.
    const hi = this.add.graphics().setDepth(-16).setBlendMode(Phaser.BlendModes.ADD);
    hi.fillStyle(sunWarm, 0.05); hi.fillRect(0, HORIZON, GAME_W, this._hiY - HORIZON);
    hi.fillStyle(0xffffff, 0.08); hi.fillRect(0, this._hiY - 3, GAME_W, 3); // ridge highlight
    this.add.text(GAME_W / 2, HORIZON + 6, 'High Ground  ·  +20% damage', { fontFamily: 'monospace', fontSize: '11px', color: '#fff0cc', stroke: '#3a2c10', strokeThickness: 2 }).setOrigin(0.5, 0).setAlpha(0.5).setDepth(-15);
    // River crossing: a reflective blue band along the bottom edge.
    this.drawRiver(this._riverY);
    this.add.text(GAME_W / 2, this._riverY + 4, 'River Crossing  ·  −20% damage', { fontFamily: 'monospace', fontSize: '11px', color: '#dcefff', stroke: '#0a2030', strokeThickness: 2 }).setOrigin(0.5, 0).setAlpha(0.6).setDepth(-14);

    // (Phase 9) If this battle is fought ON a river tile, a river runs ACROSS the
    // contested centre that both hosts must ford — units inside the band take the
    // same −20% crossing penalty (reusing terrainAtkMul). A vertical strip down the
    // middle so player (right) and enemy (left) must wade through it to engage.
    if (this.riverBattle) {
      const bandW = Math.round(GAME_W * 0.14);
      this._riverBandX0 = GAME_W * 0.5 - bandW / 2;
      this._riverBandX1 = GAME_W * 0.5 + bandW / 2;
      this.drawCrossingRiver(this._riverBandX0, this._riverBandX1);
      this.add.text(GAME_W / 2, HORIZON + 70, 'River Crossing  ·  −20% damage', { fontFamily: 'monospace', fontSize: '11px', color: '#dcefff', stroke: '#0a2030', strokeThickness: 2 }).setOrigin(0.5, 0).setAlpha(0.7).setDepth(-13);
    }
  }

  // (Phase 9) A reflective river running vertically across the battlefield centre
  // (for battles fought on a river tile). Drawn over the ground, under units.
  drawCrossingRiver(x0: number, x1: number) {
    const g = this.add.graphics().setDepth(5);
    const w = x1 - x0;
    for (let i = 0; i < w; i += 3) { g.fillStyle(this._lerp(0x2a5a8a, 0x14406a, i / w), 0.55); g.fillRect(x0 + i, HORIZON + 40, 3, GAME_H - HORIZON - 40); }
    // Shimmer streaks + foaming banks.
    const sh = this.add.graphics().setDepth(5.2).setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 0; i < 26; i++) { sh.fillStyle(0xbfe0ff, Phaser.Math.FloatBetween(0.04, 0.12)); const sy = HORIZON + 50 + Phaser.Math.Between(0, GAME_H - HORIZON - 90); sh.fillRect(x0 + Phaser.Math.Between(4, w - 40), sy, Phaser.Math.Between(20, w - 8), 1.5); }
    g.fillStyle(0xbfe0ff, 0.12); g.fillRect(x0, HORIZON + 40, 2, GAME_H - HORIZON - 40); g.fillRect(x1 - 2, HORIZON + 40, 2, GAME_H - HORIZON - 40);
  }

  // (Visual P9) Soft layered painterly cloud masses drifting across the sky.
  drawClouds(terrain: string) {
    const dark = terrain === 'mountains' || terrain === 'forest';
    const layers = [
      { y: HORIZON * 0.28, n: 5, sc: 1.3, alpha: dark ? 0.20 : 0.16, tint: dark ? 0x2a2e38 : 0xf6ead0, sp: 5 },
      { y: HORIZON * 0.55, n: 6, sc: 1.0, alpha: dark ? 0.26 : 0.22, tint: dark ? 0x3a3f4c : 0xfff4dc, sp: 9 },
    ];
    this._clouds = [];
    for (const L of layers) {
      for (let i = 0; i < L.n; i++) {
        const cx = (i / L.n) * GAME_W + Phaser.Math.Between(-40, 40);
        const g = this.add.graphics().setDepth(-27).setBlendMode(dark ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD);
        // A cloud = a cluster of overlapping soft ellipses.
        const w = Phaser.Math.Between(120, 220) * L.sc;
        for (let k = 0; k < 5; k++) {
          g.fillStyle(L.tint, L.alpha * Phaser.Math.FloatBetween(0.5, 1));
          g.fillEllipse(Phaser.Math.Between(-w / 2, w / 2), Phaser.Math.Between(-10, 10), Phaser.Math.Between(50, 100) * L.sc, Phaser.Math.Between(22, 40) * L.sc);
        }
        g.x = cx; g.y = L.y;
        this._clouds.push({ g, sp: L.sp * Phaser.Math.FloatBetween(0.7, 1.3) });
      }
    }
  }

  // (Visual P9) Distant horizon masses — peaks / treeline / hills behind the haze.
  drawHorizonMasses(terrain: string) {
    const g = this.add.graphics().setDepth(-23);
    const base = HORIZON + 4;
    if (terrain === 'mountains') {
      // Two ranges of distant peaks for depth.
      g.fillStyle(this._lerp(this.pal.horizon, 0x6a6e7a, 0.5), 0.7);
      let x = -40; while (x < GAME_W + 40) { const w = Phaser.Math.Between(120, 220), h = Phaser.Math.Between(70, 150); g.fillTriangle(x, base, x + w / 2, base - h, x + w, base); x += w * 0.7; }
      g.fillStyle(this._lerp(this.pal.horizon, 0x8088a0, 0.7), 0.9);
      x = -60; while (x < GAME_W + 40) { const w = Phaser.Math.Between(90, 160), h = Phaser.Math.Between(40, 90); g.fillTriangle(x, base, x + w / 2, base - h, x + w, base); g.fillStyle(0xffffff, 0.12); g.fillTriangle(x + w / 2 - 8, base - h + 14, x + w / 2, base - h, x + w / 2 + 8, base - h + 14); g.fillStyle(this._lerp(this.pal.horizon, 0x8088a0, 0.7), 0.9); x += w * 0.8; } // snowcaps
    } else if (terrain === 'forest') {
      // A jagged distant treeline silhouette.
      g.fillStyle(this._lerp(this.pal.horizon, 0x101c12, 0.6), 0.85);
      let x = -10; while (x < GAME_W + 10) { const w = Phaser.Math.Between(18, 40), h = Phaser.Math.Between(28, 64); g.fillTriangle(x, base, x + w / 2, base - h, x + w, base); x += w * 0.6; }
    } else {
      // Plains / wildlands: gentle rolling distant hills.
      g.fillStyle(this._lerp(this.pal.horizon, this.pal.ground, 0.4), 0.6);
      for (let i = 0; i < 3; i++) { const cy = base + i * 6; g.fillEllipse(GAME_W * (0.2 + i * 0.3), cy + 30, GAME_W * 0.6, 80); }
    }
  }

  // (Visual P9) Terrain-specific foreground ground painting.
  drawTerrainGround(terrain: string) {
    const g = this.add.graphics().setDepth(-17);
    const top = HORIZON + 30;
    if (terrain === 'plains' || terrain === 'wildlands') {
      // Perspective grass: short tufts near the horizon, long sweeping strokes
      // in the foreground (drawn denser/larger toward the bottom).
      const blade = terrain === 'wildlands' ? 0x6a5f2e : 0x3c5226;
      const blade2 = terrain === 'wildlands' ? 0x877a3c : 0x52703a;
      for (let i = 0; i < 900; i++) {
        const t = Math.pow(Math.random(), 0.6);          // bias toward foreground
        const y = top + t * (GAME_H - top);
        const x = Phaser.Math.Between(0, GAME_W);
        const len = 3 + t * 16, lean = Phaser.Math.FloatBetween(-2, 2) * (1 + t);
        g.lineStyle(1 + t * 1.2, Math.random() < 0.5 ? blade : blade2, 0.3 + t * 0.4);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + lean, y - len); g.strokePath();
      }
    } else if (terrain === 'forest') {
      // Dappled clearing: scattered soft light pools + scattered undergrowth.
      const dap = this.add.graphics().setDepth(-16).setBlendMode(Phaser.BlendModes.ADD);
      for (let i = 0; i < 26; i++) { const t = Math.random(); dap.fillStyle(0xcfe0a0, 0.04 + t * 0.05); dap.fillEllipse(Phaser.Math.Between(GAME_W * 0.2, GAME_W * 0.8), Phaser.Math.Between(top + 30, GAME_H - 80), Phaser.Math.Between(40, 120), Phaser.Math.Between(16, 40)); }
      for (let i = 0; i < 220; i++) { const t = Math.pow(Math.random(), 0.7); const y = top + t * (GAME_H - top); g.lineStyle(1 + t, 0x223a1c, 0.3 + t * 0.3); const x = Phaser.Math.Between(0, GAME_W), len = 4 + t * 10; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Phaser.Math.FloatBetween(-3, 3), y - len); g.strokePath(); }
    } else { // mountains
      // Rocky ground: scattered stones and cracks, cool slate tones.
      for (let i = 0; i < 70; i++) {
        const t = Math.pow(Math.random(), 0.6); const y = top + 20 + t * (GAME_H - top - 20);
        const x = Phaser.Math.Between(0, GAME_W), r = 3 + t * 14;
        const c = this._lerp(0x3a3c44, 0x222329, Math.random());
        g.fillStyle(c, 0.6); g.fillEllipse(x, y, r * 1.6, r * 0.8);
        g.fillStyle(0x55585f, 0.4); g.fillEllipse(x - r * 0.2, y - r * 0.2, r * 0.9, r * 0.4); // top light
      }
      // A misty valley pooling in the contested centre.
      const mist = this.add.graphics().setDepth(-15).setBlendMode(Phaser.BlendModes.ADD);
      for (let i = 0; i < 8; i++) { mist.fillStyle(0xaab4c8, 0.04); mist.fillEllipse(GAME_W * 0.5 + Phaser.Math.Between(-200, 200), GAME_H * 0.5 + i * 18, Phaser.Math.Between(300, 520), Phaser.Math.Between(40, 80)); }
    }
    // FOREST FLANKS: dark tree masses pressing in from both sides (drawn over
    // ground, under units). Done for forest only.
    if (terrain === 'forest') this.drawForestFlanks();
  }

  // (Visual P9) Dense dark tree masses crowding both flanks of a forest battle.
  drawForestFlanks() {
    const g = this.add.graphics().setDepth(7.5); // over ground, under most units
    const drawSide = (left: boolean) => {
      const edge = left ? 0 : GAME_W;
      const dir = left ? 1 : -1;
      for (let i = 0; i < 18; i++) {
        const depth = Math.random();                 // 0 near edge .. 1 reaching in
        const x = edge + dir * depth * 240 + dir * Phaser.Math.Between(0, 40);
        const y = Phaser.Math.Between(HORIZON + 40, GAME_H - 40);
        const h = Phaser.Math.Between(80, 180) * (1 - depth * 0.4);
        const w = h * 0.6;
        // trunk
        g.fillStyle(0x1a130c, 0.9); g.fillRect(x - 4, y - h * 0.25, 8, h * 0.25);
        // canopy = stacked dark triangles
        const dark = this._lerp(0x0e1a0e, 0x1c2e16, depth);
        for (let k = 0; k < 3; k++) { const ch = h * (0.7 - k * 0.18); g.fillStyle(dark, 0.95); g.fillTriangle(x - w / 2, y - h * 0.2 - k * h * 0.22, x, y - h * 0.2 - k * h * 0.22 - ch, x + w / 2, y - h * 0.2 - k * h * 0.22); }
        // rim light from clearing
        g.fillStyle(0x4a6a2c, 0.18 * (1 - depth)); g.fillTriangle(x - w / 2 + 2, y - h * 0.3, x, y - h * 0.9, x - w / 2 + 8, y - h * 0.3);
      }
    };
    drawSide(true); drawSide(false);
  }

  // (Visual P9) A reflective river band along the bottom of the field.
  drawRiver(y: number) {
    const g = this.add.graphics().setDepth(-15);
    const h = GAME_H - y;
    for (let i = 0; i < h; i += 3) { g.fillStyle(this._lerp(0x2a5a8a, 0x14406a, i / h), 0.5); g.fillRect(0, y + i, GAME_W, 3); }
    // Shimmer streaks.
    const sh = this.add.graphics().setDepth(-14).setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 0; i < 30; i++) { sh.fillStyle(0xbfe0ff, Phaser.Math.FloatBetween(0.04, 0.12)); const sy = y + Phaser.Math.Between(4, h - 4); sh.fillRect(Phaser.Math.Between(0, GAME_W - 120), sy, Phaser.Math.Between(40, 120), 1.5); }
    // Bank highlight.
    g.fillStyle(0xbfe0ff, 0.10); g.fillRect(0, y, GAME_W, 2);
  }

  // (Visual P9) Per-frame battle atmosphere: drifting clouds, waving army
  // banners, and (forest) drifting leaves. All cheap, no per-frame allocations.
  updateAtmosphere(dt: number, time: number) {
    // Drift clouds; wrap around the screen.
    if (this._clouds) for (const c of this._clouds) { c.g.x += c.sp * dt; if (c.g.x > GAME_W + 240) c.g.x = -240; }
    // Wave the planted army banners (a gentle flag flutter via skew/scale).
    if (this._banners) for (const b of this._banners) { const w = Math.sin(time * 0.004 + b.phase); b.flag.scaleX = b.dir * (0.9 + w * 0.18); b.flag.y = b.baseY + Math.sin(time * 0.003 + b.phase) * 1.5; }
    // Drifting leaves (forest only) — recycle a small pool.
    if (this._leaves) for (const l of this._leaves) {
      l.x += l.vx * dt; l.y += l.vy * dt; l.rotation += l.vr * dt;
      if (l.y > GAME_H + 20 || l.x < -20 || l.x > GAME_W + 20) { l.x = Phaser.Math.Between(0, GAME_W); l.y = HORIZON; l.vx = Phaser.Math.FloatBetween(-18, 6); }
    }
  }

  // (Visual P9) Plant a waving banner pole at each army's back line.
  spawnArmyBanners() {
    this._banners = [];
    const plant = (side: string) => {
      const x = side === 'player' ? GAME_W * 0.93 : GAME_W * 0.07;
      const y = GAME_H * 0.40;
      const col = side === 'player' ? 0x4a7bd5 : (FACTION_COLOR[this.faction] || 0xd64a4a);
      const dark = this._lerp(col, 0x000000, 0.45);
      // Pole.
      this.add.rectangle(x, y, 4, 150, 0x3a2c18).setOrigin(0.5, 0).setDepth(8);
      this.add.circle(x, y - 4, 5, 0xffd24a).setDepth(9); // finial
      // Flag = a triangular pennant graphic anchored at the pole.
      const dir = side === 'player' ? -1 : 1;
      const flag = this.add.graphics().setDepth(9);
      flag.fillStyle(col, 0.95); flag.beginPath(); flag.moveTo(0, 0); flag.lineTo(dir * 60, 14); flag.lineTo(0, 30); flag.closePath(); flag.fillPath();
      flag.fillStyle(dark, 0.95); flag.beginPath(); flag.moveTo(0, 30); flag.lineTo(dir * 38, 28); flag.lineTo(0, 16); flag.closePath(); flag.fillPath();
      flag.fillStyle(0xffffff, 0.5); flag.fillCircle(dir * 16, 15, 4); // emblem
      flag.x = x + dir * 2; flag.y = y + 4;
      this._banners.push({ flag, baseY: flag.y, dir, phase: side === 'player' ? 0 : 1.6 });
    };
    plant('player'); plant('enemy');
  }

  // (Visual P9) Subtle ground markers + a floating formation label so the army
  // reads as deliberately arrayed. Purely decorative; never touches unit math.
  drawFormationMarkers() {
    if (this._fmG) this._fmG.clear(); else this._fmG = this.add.graphics().setDepth(1);
    if (this._fmLabels) { for (const t of this._fmLabels) t.destroy(); }
    this._fmLabels = [];
    const g = this._fmG;
    const markSide = (side: string) => {
      // (Phase 9) Don't draw the ENEMY formation footprint/ranks/label while it is
      // hidden by fog (intel none) or unclear (intel basic) during pre-battle.
      if (side === 'enemy' && this._hideEnemyFormation && this.phase === 'pre') return;
      const us = this.sideUnits(side).filter((u) => !u.isCommander);
      if (!us.length) return;
      const col = side === 'player' ? 0x4a7bd5 : (FACTION_COLOR[this.faction] || 0xd64a4a);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const u of us) { minX = Math.min(minX, u.x); maxX = Math.max(maxX, u.x); minY = Math.min(minY, u.y); maxY = Math.max(maxY, u.y); }
      const cx = (minX + maxX) / 2;
      // A soft footprint plate beneath the formation.
      g.fillStyle(col, 0.06); g.fillEllipse(cx, (minY + maxY) / 2 + 20, (maxX - minX) + 90, (maxY - minY) + 70);
      // Rank lines — short dashes the units stand along.
      g.lineStyle(1.5, col, 0.22);
      const cols = new Set<number>();
      for (const u of us) cols.add(Math.round(u.x / 28) * 28);
      for (const colX of cols) { g.beginPath(); g.moveTo(colX, minY - 12); g.lineTo(colX, maxY + 24); g.strokePath(); }
      // Floating formation label.
      const name = side === 'player' ? (this._playerForm || 'LINE') : (this._enemyForm || 'LINE');
      const lab = this.add.text(cx, minY - 30, `${side === 'player' ? 'Your Host' : (FACTION_LABEL[this.faction] || 'Enemy')} · ${name}`, { fontFamily: 'monospace', fontSize: '12px', color: side === 'player' ? '#bcd9ff' : '#ffd0d0', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(2).setAlpha(0.7);
      this._fmLabels.push(lab);
    };
    markSide('player'); markSide('enemy');
  }

  // (Visual P9) Forest leaves drifting down across the field.
  spawnLeaves() {
    if (this._terrain !== 'forest') return;
    this._leaves = [];
    for (let i = 0; i < 22; i++) {
      const c = [0x6a8c3a, 0xa8983c, 0x8a5a2a][i % 3];
      const l = this.add.rectangle(Phaser.Math.Between(0, GAME_W), Phaser.Math.Between(HORIZON, GAME_H), 6, 3, c, 0.7).setDepth(34).setRotation(Math.random() * Math.PI);
      (l as any).vx = Phaser.Math.FloatBetween(-18, 6); (l as any).vy = Phaser.Math.FloatBetween(10, 26); (l as any).vr = Phaser.Math.FloatBetween(-2, 2);
      this._leaves.push(l as any);
    }
  }

  // (Visual P9) A cinematic flourish when the battle is joined: clashing flash,
  // a sweeping light bloom and a rolling dust wave from each advancing line.
  battleStartFlourish() {
    // Bright additive flash sweeping from the centre.
    const flash = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0xffe9b0, 0).setDepth(64).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: flash, fillAlpha: 0.28, duration: 120, yoyo: true, hold: 60, onComplete: () => flash.destroy() });
    // Dust kicked up along each army's front as they surge forward.
    if (this.textures.exists('fx_soft')) {
      for (const side of ['player', 'enemy']) {
        const dir = side === 'player' ? -1 : 1;
        const x = side === 'player' ? GAME_W * 0.74 : GAME_W * 0.26;
        const d = this.add.particles(x, GAME_H * 0.54, 'fx_soft', { lifespan: 700, speedX: { min: dir * 30, max: dir * 110 }, speedY: { min: -40, max: 20 }, x: { min: -10, max: 10 }, y: { min: -120, max: 120 }, scale: { start: 0.6, end: 2 }, alpha: { start: 0.35, end: 0 }, tint: [0xc8b48c, 0xa8946c], quantity: 16, emitting: false }).setDepth(9);
        d.explode(16);
        this.time.delayedCall(760, () => d.destroy());
      }
    }
    this.cameras.main.shake(160, 0.004);
  }

  // (Feature #2) Attacker damage multiplier by terrain position.
  terrainAtkMul(u) {
    if (this._hiY && u.y < this._hiY) return 1.2;       // high ground
    if (this._riverY && u.y > this._riverY) return 0.8; // crossing the bottom-edge river
    // (Phase 9) Crossing the central river band on a river-tile battlefield.
    if (this.riverBattle && this._riverBandX0 !== undefined && u.x >= this._riverBandX0 && u.x <= this._riverBandX1) return 0.8;
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

  // (Phase 11) Apply a progressive armour SHEEN to the player's units by the
  // army's equipment tier: Iron = a cold steel-grey, Steel = a bright silver,
  // Legendary = a unique radiant gold glow (with an additive aura ring). Stored
  // as `_equipTint` on each unit so it survives the hit-flash clearTint (BUnit
  // .takeDamage reapplies it). Tier 0 (Basic) leaves the base sprite untouched.
  applyEquipmentTint() {
    const tier = this._equipTier || 0;
    if (tier <= 0) return;
    const TINT = [0, 0xbfc8d6, 0xe8eef7, 0xffe9a8]; // [-, Iron, Steel, Legendary]
    const tint = TINT[Math.max(0, Math.min(3, tier))];
    this._equipTintColor = tint;
    for (const u of this.units) {
      if (u.side !== 'player' || u.isCommander || !u.spr) continue;
      u._equipTint = tint;
      u.spr.setTint(tint);
      if (tier >= 3) {
        // Legendary — a unique radiant glow: an additive aura ring beneath the unit.
        const aura = this.add.ellipse(u.x, u.y + 6, (u.blockW || 30) * 1.3, 22, 0xffd24a, 0.30).setDepth(9).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: aura, alpha: { from: 0.30, to: 0.12 }, scaleX: 1.15, scaleY: 1.15, yoyo: true, repeat: -1, duration: 900 });
        u._equipAura = aura;
      }
    }
  }

  sideUnits(side) { return this.units.filter((u) => u.alive && u.side === side); }

  // Arrange a side's living units into a dense, ranked formation. Player holds
  // the right ~35%, the enemy the left ~35%, leaving the centre contested.
  applyFormation(side, name) {
    if (side === 'player') this._playerForm = name; else this._enemyForm = name; // (Visual P9) label tracking
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
      // (Visual P9) Redraw ordered ground markers/labels once units settle.
      this.time.delayedCall(340, () => { if (this.phase === 'pre') this.drawFormationMarkers(); });
    } else {
      us.forEach((u) => u.sync());
    }
  }

  buildHud() {
    // --- Morale bars: enemy top-left, player top-right (Phase 3) -------------
    this.enemyBar = this.makeMoraleBar(20, 18, false, FACTION_COLOR[this.faction] || 0xd64a4a, `Enemy · ${FACTION_LABEL[this.faction] || this.faction}`, 'skull');
    // (V2 Phase 1) Enemy leader portrait beside their morale bar.
    const pk = 'portrait_' + this.faction;
    if (this.textures.exists(pk)) this.enemyBar._portrait = this.add.image(248, 14, pk).setOrigin(0, 0).setDisplaySize(40, 40).setDepth(42);
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

    this.updateMoraleBars(); // (Visual P9) initial pip/banner render
  }

  // (Visual P9) A dramatic, weighty morale gauge: a faction banner above that
  // visually WILTS as morale drops, a segmented row of shield/sword pips that
  // empty out, green→yellow→red colour, and a shake at low morale. Driven from
  // the existing morale values via updateMoraleBars (math unchanged).
  makeMoraleBar(x, y, anchorRight, accent, label, icon) {
    const W = 236, H = 30, PIPS = 10;
    const ox = anchorRight ? x - W : x;
    const cont = this.add.container(0, 0).setDepth(40);

    // --- Faction banner that hangs above and wilts with morale ---------------
    const bnX = anchorRight ? ox + W - 26 : ox + 26;
    const banner = this.add.graphics().setDepth(40);
    const drawBanner = (col: number, droop: number) => {
      banner.clear();
      banner.fillStyle(0x2a1d10, 1); banner.fillRect(bnX - 1.5, y - 30, 3, 28); // pole
      banner.fillStyle(0xffd24a, 1); banner.fillCircle(bnX, y - 31, 3);          // finial
      const w = 26, sag = droop * 8;
      banner.fillStyle(col, 0.96);
      banner.beginPath(); banner.moveTo(bnX + 2, y - 28);
      banner.lineTo(bnX + 2 + w, y - 28 + sag * 0.4);
      banner.lineTo(bnX + 2 + w, y - 10 + sag);
      banner.lineTo(bnX + 2 + w / 2, y - 14 + sag * 1.3);
      banner.lineTo(bnX + 2, y - 10 + sag * 0.6);
      banner.closePath(); banner.fillPath();
      banner.fillStyle(0xffffff, 0.45); banner.fillCircle(bnX + 2 + w / 2, y - 19 + sag * 0.7, 3);
    };
    drawBanner(accent, 0);

    // --- Bar frame -----------------------------------------------------------
    const frameOuter = this.add.rectangle(ox, y, W, H, 0x1a140c, 0.92).setOrigin(0, 0).setStrokeStyle(2, 0xc9a84c, 0.85).setDepth(40);
    const frameInner = this.add.rectangle(ox + 2, y + 2, W - 4, H - 4, 0x0a0d14, 0.9).setOrigin(0, 0).setDepth(40);

    // --- Segmented pips (shield = player, sword = enemy) ---------------------
    const padL = 8, padR = 8;
    const slotW = (W - padL - padR) / PIPS;
    const pips: any[] = [];
    const pg = this.add.graphics().setDepth(41);
    for (let i = 0; i < PIPS; i++) {
      const px = ox + padL + i * slotW + slotW / 2;
      pips.push({ x: px, y: y + H / 2 });
    }

    // --- Numeric value + label ----------------------------------------------
    const val = this.add.text(ox + W / 2, y + H + 2, '70', { fontFamily: 'monospace', fontSize: '13px', color: '#fff', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(43);
    const labelTxt = this.add.text(anchorRight ? ox + W - 4 : ox + 4, y + H + 2, label, { fontFamily: 'monospace', fontSize: '11px', color: '#dcd2bf', stroke: '#000', strokeThickness: 2 }).setOrigin(anchorRight ? 1 : 0, 0).setDepth(41);

    return { val, W, H, ox, y, pips, pg, icon, accent, banner, drawBanner, frameOuter, frameInner, labelTxt, _shakeX: ox, _low: false };
  }

  // (Phase 9) Show/hide an entire morale gauge (used to gate the ENEMY bar: it is
  // hidden pre-battle unless Mira scouts it, and revealed when the fog lifts).
  setMoraleBarVisible(bar: any, vis: boolean) {
    if (!bar) return;
    for (const o of [bar.val, bar.banner, bar.pg, bar.frameOuter, bar.frameInner, bar.labelTxt]) { if (o && o.setVisible) o.setVisible(vis); }
    if (bar._portrait && bar._portrait.setVisible) bar._portrait.setVisible(vis);
  }

  // (Visual P9) Render the pip row for a morale bar at fraction f (0..1).
  drawMoralePips(bar: any, f: number, col: number) {
    const g = bar.pg; g.clear();
    const filled = f * bar.pips.length;
    for (let i = 0; i < bar.pips.length; i++) {
      const p = bar.pips[i];
      const amt = Phaser.Math.Clamp(filled - i, 0, 1);
      // empty socket
      g.fillStyle(0x000000, 0.5); this.drawMoralePip(g, p.x, p.y, 1, 0x222831, 0.0);
      if (amt <= 0) continue;
      this.drawMoralePip(g, p.x, p.y, amt, col, 1);
    }
  }
  drawMoralePip(g: any, x: number, y: number, scale: number, col: number, alpha: number) {
    const s = 5 * scale;
    if (alpha <= 0) { g.fillStyle(col, 0.55); g.fillCircle(x, y, 5.5); g.lineStyle(1, 0x000000, 0.4); g.strokeCircle(x, y, 5.5); return; }
    g.fillStyle(col, 1);
    // a tiny shield glyph
    g.beginPath(); g.moveTo(x - s, y - s); g.lineTo(x + s, y - s); g.lineTo(x + s, y); g.lineTo(x, y + s * 1.3); g.lineTo(x - s, y); g.closePath(); g.fillPath();
    g.fillStyle(0xffffff, 0.4 * alpha); g.fillRect(x - 0.8, y - s + 1, 1.6, s * 1.6);
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

  // ---- (Visual P7) Combat particle VFX -------------------------------------
  // Tiny generate-once pixels so every combat burst can use a real particle
  // emitter (batched, cheap) instead of dozens of tweened circles.
  ensureFxTextures() {
    if (!this.textures.exists('fx_px')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false } as any);
      g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 3, 3); g.generateTexture('fx_px', 3, 3); g.destroy();
    }
    if (!this.textures.exists('fx_soft')) {
      // Soft round glow for sparks / heal motes (radial falloff).
      const tex = this.textures.createCanvas('fx_soft', 12, 12) as any;
      if (tex) {
        const ctx = tex.getContext();
        const grad = ctx.createRadialGradient(6, 6, 0, 6, 6, 6);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.4, 'rgba(255,255,255,0.7)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad; ctx.fillRect(0, 0, 12, 12); tex.refresh();
      }
    }
  }

  // Northgard-style sword hit: a bright warm spark burst + a quick expanding ring.
  swordHitFx(x: number, y: number) {
    const burst = this.add.particles(x, y, 'fx_soft', {
      lifespan: 320, speed: { min: 60, max: 170 }, angle: { min: 0, max: 360 },
      scale: { start: 0.7, end: 0 }, alpha: { start: 1, end: 0 },
      tint: [0xfff3c0, 0xffd24a, 0xffae42], quantity: 7, blendMode: 'ADD',
      gravityY: 120, emitting: false,
    }).setDepth(29);
    burst.explode(7, x, y);
    this.time.delayedCall(360, () => burst.destroy());
    // Bright spark -> warm fade expanding ring.
    const ring = this.add.circle(x, y, 4, 0xffe9a8, 0).setStrokeStyle(2.5, 0xffd24a, 0.95).setDepth(28);
    this.tweens.add({ targets: ring, scale: 3.4, alpha: 0, duration: 280, ease: 'Cubic.out', onComplete: () => ring.destroy() });
  }

  // Arrow hit: a tiny pale impact + a couple of drifting feather flecks.
  arrowHitFx(x: number, y: number) {
    const burst = this.add.particles(x, y, 'fx_px', {
      lifespan: 260, speed: { min: 30, max: 90 }, angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 }, alpha: { start: 0.9, end: 0 },
      tint: [0xe8e8e8, 0xcfd2da], quantity: 4, emitting: false,
    }).setDepth(29);
    burst.explode(4, x, y);
    this.time.delayedCall(300, () => burst.destroy());
    // A couple of feather flecks that flutter down.
    for (let i = 0; i < 2; i++) {
      const f = this.add.rectangle(x, y, 5, 2, 0xf2ede0, 0.95).setDepth(28).setRotation(Phaser.Math.FloatBetween(-1, 1));
      this.tweens.add({
        targets: f, x: x + Phaser.Math.Between(-12, 12), y: y + Phaser.Math.Between(8, 22),
        angle: Phaser.Math.Between(-120, 120), alpha: 0, duration: 520, ease: 'Sine.in',
        onComplete: () => f.destroy(),
      });
    }
  }

  // Monk heal: a golden mote beam from healer to target + a soft settling burst.
  healBeamFx(hx: number, hy: number, tx: number, ty: number) {
    const beam = this.add.particles(0, 0, 'fx_soft', {
      lifespan: 420, scale: { start: 0.55, end: 0 }, alpha: { start: 0.9, end: 0 },
      tint: [0xfff0b0, 0xffe066, 0x9fe6a0], quantity: 1, frequency: 24,
      blendMode: 'ADD', emitting: false,
    }).setDepth(27);
    // Emit a short ribbon of motes travelling along the heal line.
    let t = 0; const steps = 6;
    const timer = this.time.addEvent({ delay: 28, repeat: steps - 1, callback: () => {
      t += 1; const f = t / steps;
      beam.emitParticleAt(Phaser.Math.Linear(hx, tx, f), Phaser.Math.Linear(hy, ty, f) - 8, 1);
    } });
    // Soft golden settle burst on the target.
    const settle = this.add.particles(tx, ty - 6, 'fx_soft', {
      lifespan: 480, speed: { min: 12, max: 36 }, angle: { min: 200, max: 340 },
      scale: { start: 0.6, end: 0 }, alpha: { start: 0.95, end: 0 },
      tint: [0x9fe6a0, 0xffe066], quantity: 5, blendMode: 'ADD', emitting: false,
    }).setDepth(27);
    settle.explode(5, tx, ty - 6);
    this.time.delayedCall(560, () => { timer.remove(); beam.destroy(); settle.destroy(); });
  }

  // Cavalry charge: a trailing dust cloud kicked up behind the rider.
  chargeDustFx(x: number, y: number, dir: number) {
    const dust = this.add.particles(x - dir * 10, y + 16, 'fx_soft', {
      lifespan: 520, speedX: { min: -dir * 70, max: -dir * 20 }, speedY: { min: -30, max: 6 },
      scale: { start: 0.5, end: 1.6 }, alpha: { start: 0.5, end: 0 },
      tint: [0xc8b48c, 0xa8946c, 0xd8c8a4], quantity: 6, emitting: false,
    }).setDepth(9);
    dust.explode(6);
    this.time.delayedCall(560, () => dust.destroy());
  }

  // Unit death: a brief flash already exists (die tints red); add a faint soul
  // wisp that rises and fades.
  deathWispFx(x: number, y: number, friendly: boolean) {
    const wisp = this.add.particles(x, y - 6, 'fx_soft', {
      lifespan: 760, speedX: { min: -14, max: 14 }, speedY: { min: -52, max: -28 },
      scale: { start: 0.7, end: 0 }, alpha: { start: 0.55, end: 0 },
      tint: friendly ? [0xbfe0ff, 0xeaf3ff] : [0xe6c0c0, 0xf0dada],
      quantity: 4, blendMode: 'ADD', emitting: false,
    }).setDepth(13);
    wisp.explode(4);
    this.time.delayedCall(820, () => wisp.destroy());
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
    this.updateAtmosphere(dt, time); // (Visual P9) drifting clouds / waving banners / leaves
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
    this.liftBattleFog(); // (Phase 9) the reveal moment — fog sweeps away as lines advance
    if (this.startBtn) this.startBtn.setVisible(false); // (Phase 5) hide skip button
    if (this.startBtnTxt) this.startBtnTxt.setVisible(false);
    // (Visual P9) Clear the pre-battle ordered ground markers + labels.
    if (this._fmG) { this._fmG.clear(); }
    if (this._fmLabels) { for (const t of this._fmLabels) t.destroy(); this._fmLabels = []; }
    this.battleStartFlourish(); // (Visual P9) cinematic clash flourish
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
        else { w.hp = Math.min(w.maxHp, w.hp + u.heal * dt); w.hpFill.width = w.hpW * (w.hp / w.maxHp); if (u.atkCd <= 0) { u.atkCd = 1; playOnce(u.spr, 'monk_heal', u.anims.idle); this.healBeamFx(u.x, u.y - 8, w.x, w.y - 8); this.dmgNumber(w.x, w.y - 30, `+${Math.round(u.heal)}`, '#9fe6a0'); /* (Visual P7) golden heal beam + HP float */ } else playLoop(u.spr, u.anims.idle); }
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
          if (u.type === 'cavalry' && !u._charged) { if (foe.type !== 'spearmen') power *= 2; u._charged = true; sfx.playThrottled('cavalry_charge', 400); /* (V2 P4 #8) hooves */ this.chargeDustFx(u.x, u.y, foe.x > u.x ? 1 : -1); /* (Visual P7) charge dust */ }
          this.counterArrow(u, cm); // teach the matchup
          if (u.area) { for (const o of this.units) { if (o.alive && o.side !== u.side && Phaser.Math.Distance.Between(u.x, u.y, o.x, o.y) <= MELEE) o.takeDamage(power * this.terrainDefMul(o)); } }
          else foe.takeDamage(power * this.terrainDefMul(foe));
          if (u.range > 0) { this.projectile(u.x, u.y, foe.x, foe.y); sfx.playThrottled('arrow_shoot', 120); this.arrowHitFx(foe.x, foe.y - 12); /* (Visual P7) */ }
          else { sfx.playThrottled('sword_hit', 130); this.swordHitFx(foe.x, foe.y - 12); /* (Visual P7) warm spark + ring */ }
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
    // (V2 P4 #4) Galloping cavalry kick up a dust trail.
    if (u.type === 'cavalry') { u._dustCd = (u._dustCd || 0) - dt; if (u._dustCd <= 0) { u._dustCd = 0.1; this.dustPuff(u.x + (u.side === 'player' ? 14 : -14), u.y + 18); } }
  }

  // (V2 P4 #4) A small fading dust cloud (cavalry trail).
  dustPuff(x, y) {
    const d = this.add.ellipse(x, y, 12, 6, 0xb6a886, 0.45).setDepth(9);
    this.tweens.add({ targets: d, scale: 1.8, alpha: 0, y: y - 4, duration: 480, onComplete: () => d.destroy() });
  }

  projectile(x1, y1, x2, y2) {
    const dot = this.add.circle(x1, y1, 2.5, 0xffe9a8).setDepth(20);
    this.tweens.add({ targets: dot, x: x2, y: y2, duration: 180, onComplete: () => dot.destroy() });
  }

  // (Visual P9) Drive the dramatic morale gauges from the (unchanged) morale
  // values: pips empty out, colour shifts green→yellow→red, the faction banner
  // wilts as morale falls, and the bar shakes/pulses when morale is low.
  updateMoraleBars() {
    const col = (m) => (m >= 70 ? 0x4ad66b : m >= 40 ? 0xe6c84a : 0xd64a4a);
    const set = (bar, m) => {
      if (!bar || !bar.pips) return;
      const f = Phaser.Math.Clamp(m / 100, 0, 1);
      const c = col(m);
      this.drawMoralePips(bar, f, c);
      bar.val.setText(`${Math.round(m)}`);
      bar.val.setColor(m >= 70 ? '#bdf0c8' : m >= 40 ? '#f2e29a' : '#ffb0a8');
      // Banner wilts: droop grows as morale drops; colour desaturates toward red.
      const droop = 1 - f;
      bar.drawBanner(this._lerp(bar.accent, 0x6a3030, droop * 0.7), droop);
      // Low-morale alarm: shake the frame + pulse stroke colour.
      const low = m <= 30;
      if (low) {
        const sh = Math.sin(this.time.now * 0.04) * 2.2;
        bar.frameOuter.x = bar.ox + sh; bar.frameInner.x = bar.ox + 2 + sh; bar.pg.x = sh;
        bar.frameOuter.setStrokeStyle(2, 0xff5a4a, 0.95);
      } else if (bar._low) {
        bar.frameOuter.x = bar.ox; bar.frameInner.x = bar.ox + 2; bar.pg.x = 0;
        bar.frameOuter.setStrokeStyle(2, 0xc9a84c, 0.85);
      }
      bar._low = low;
    };
    set(this.playerBar, this.morale.player);
    set(this.enemyBar, this.morale.enemy);
  }

  // (Visual P9) A grand heraldic banner for the end overlay. Victory: it
  // unfurls from above with a proud flutter. Defeat: it tears free and falls.
  endBanner(victory: boolean, retreated: boolean, D: number) {
    const col = victory ? 0x4a7bd5 : (retreated ? 0x6a5a3a : 0x5a3540);
    const dark = this._lerp(col, 0x000000, 0.5);
    const cx = GAME_W / 2, w = 150, h = 230;
    const g = this.add.graphics().setDepth(D + 1);
    g.fillStyle(0x2a1d10, 1); g.fillRect(-3, -16, 6, 14);                 // pole stub
    g.fillStyle(0xffd24a, 1); g.fillCircle(0, -18, 6);                    // finial
    g.fillStyle(col, 0.97); g.fillRect(-w / 2, 0, w, h);                 // cloth
    g.fillStyle(dark, 0.97); g.beginPath(); g.moveTo(-w / 2, h); g.lineTo(0, h - 34); g.lineTo(w / 2, h); g.lineTo(w / 2, h - 4); g.lineTo(0, h - 30); g.lineTo(-w / 2, h - 4); g.closePath(); g.fillPath(); // swallowtail
    g.lineStyle(3, 0xffd24a, 0.85); g.strokeRect(-w / 2, 0, w, h);        // gold trim
    // Heraldic emblem.
    g.fillStyle(0xffd24a, 0.95);
    if (victory) { // crown
      g.beginPath(); g.moveTo(-34, h * 0.42); g.lineTo(-34, h * 0.30); g.lineTo(-17, h * 0.40); g.lineTo(0, h * 0.26); g.lineTo(17, h * 0.40); g.lineTo(34, h * 0.30); g.lineTo(34, h * 0.42); g.closePath(); g.fillPath();
      g.fillRect(-34, h * 0.42, 68, 8);
    } else { // sword (point-down, fallen)
      g.fillRect(-3, h * 0.22, 6, h * 0.34); g.fillRect(-16, h * 0.30, 32, 7); g.fillCircle(0, h * 0.20, 6);
    }
    g.x = cx;
    if (victory) {
      g.y = -h - 30; g.setAlpha(0);
      this.tweens.add({ targets: g, y: GAME_H * 0.16, alpha: 1, duration: 800, ease: 'Bounce.out' });
      this.tweens.add({ targets: g, scaleX: 1.03, duration: 1500, yoyo: true, repeat: -1, delay: 850 }); // proud flutter
    } else {
      g.y = GAME_H * 0.16;
      this.tweens.add({ targets: g, y: GAME_H + 120, angle: retreated ? 12 : 38, alpha: retreated ? 0.6 : 0.25, duration: 1700, delay: 500, ease: 'Cubic.in' }); // banner falls
    }
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

    // (V2 P4 #4) Surviving troops raise their weapons in celebration on victory.
    if (victory) { for (const u of this.sideUnits('player')) this.tweens.add({ targets: u.spr, y: u.spr.y - 10, angle: u.side === 'player' ? -8 : 8, yoyo: true, repeat: 2, duration: 220, delay: Phaser.Math.Between(0, 300) }); }

    const D = 70;
    if (victory) {
      // (Visual P9) THE SUN BREAKS THROUGH — a warm bloom swells from the horizon.
      const sun = this.add.graphics().setDepth(D - 2).setBlendMode(Phaser.BlendModes.ADD);
      sun.fillStyle(0xffe8b0, 1); sun.fillCircle(GAME_W / 2, HORIZON, 40);
      for (let r = 520; r > 0; r -= 22) { sun.fillStyle(0xffd88a, 0.02); sun.fillCircle(GAME_W / 2, HORIZON, r); }
      sun.setScale(0.3).setAlpha(0);
      this.tweens.add({ targets: sun, alpha: 1, scaleX: 1, scaleY: 1, duration: 900, ease: 'Cubic.out' });
      // Rays sweep out.
      const rays = this.add.graphics().setDepth(D - 2).setBlendMode(Phaser.BlendModes.ADD);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; rays.fillStyle(0xfff0c0, 0.05); rays.beginPath(); rays.moveTo(GAME_W / 2 + Math.cos(a) * 30, HORIZON + Math.sin(a) * 30); rays.lineTo(GAME_W / 2 + Math.cos(a + 0.06) * 900, HORIZON + Math.sin(a + 0.06) * 900); rays.lineTo(GAME_W / 2 + Math.cos(a - 0.06) * 900, HORIZON + Math.sin(a - 0.06) * 900); rays.closePath(); rays.fillPath(); }
      rays.setAlpha(0); this.tweens.add({ targets: rays, alpha: 1, duration: 1200 });
      this.tweens.add({ targets: rays, angle: 12, duration: 6000, repeat: -1, yoyo: true });
      // Gold confetti / cinders rising.
      if (!this.textures.exists('confetti_px')) { const cg = this.make.graphics({ x: 0, y: 0, add: false } as any); cg.fillStyle(0xffffff, 1); cg.fillRect(0, 0, 4, 4); cg.generateTexture('confetti_px', 4, 4); cg.destroy(); }
      this.add.particles(0, -10, 'confetti_px', { x: { min: 0, max: GAME_W }, y: -10, lifespan: 2600, speedY: { min: 120, max: 260 }, speedX: { min: -40, max: 40 }, scale: { min: 0.8, max: 2 }, rotate: { min: 0, max: 360 }, tint: [0xffd24a, 0x4ad66b, 0x66ddff, 0xff6b6b, 0xffffff], quantity: 4, frequency: 30, duration: 1500 }).setDepth(D + 4);
    } else if (!retreated) {
      // (Visual P9) DEFEAT — the sky darkens and cold rain falls.
      const dark = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x10121a, 0).setOrigin(0, 0).setDepth(D - 2);
      this.tweens.add({ targets: dark, fillAlpha: 0.5, duration: 900 });
      if (!this.textures.exists('battle_wx')) { const wg = this.make.graphics({ x: 0, y: 0, add: false } as any); wg.fillStyle(0xffffff, 1); wg.fillRect(0, 0, 2, 12); wg.generateTexture('battle_wx', 2, 12); wg.destroy(); }
      this.add.particles(0, -10, 'battle_wx', { x: { min: 0, max: GAME_W }, y: -10, lifespan: 900, speedY: { min: 700, max: 950 }, speedX: { min: -80, max: -50 }, scaleY: { min: 1, max: 1.8 }, alpha: { start: 0.4, end: 0.1 }, quantity: 8, frequency: 18, tint: 0x8aa0b0 }).setDepth(D - 1);
    }

    // Phase 3 / Visual P9: full-screen outcome overlay (kept flow + onComplete).
    const survCount = Object.values(survivors).reduce((s, n) => s + n, 0);
    const finalSurv = army.reduce((s, g) => s + g.count, 0);
    this.add.rectangle(0, 0, GAME_W, GAME_H, victory ? 0x0c1a0c : 0x1a0c0c, victory ? 0.55 : 0.7).setOrigin(0, 0).setDepth(D);

    // (Visual P9) A grand player banner: unfurls on victory, falls on defeat.
    this.endBanner(victory, retreated, D);

    const big = this.add.text(GAME_W / 2, GAME_H / 2 - 60, victory ? 'VICTORY' : retreated ? 'RETREAT' : 'DEFEAT', { fontFamily: 'monospace', fontSize: '64px', color: victory ? '#ffd24a' : '#e74c3c', fontStyle: 'bold', stroke: '#000', strokeThickness: 7 }).setOrigin(0.5).setDepth(D + 3);
    this.tweens.add({ targets: big, scale: { from: 1.4, to: 1 }, duration: 450, ease: 'Back.out' });
    if (victory) this.tweens.add({ targets: big, scale: 1.04, duration: 1400, yoyo: true, repeat: -1, delay: 500 });
    const lines = [];
    lines.push(`Survivors: ${finalSurv} of ${survCount}`);
    if (victory && loot) lines.push(`Loot: +${loot.gold} gold${loot.iron ? `  +${loot.iron} iron` : ''}`);
    else if (!victory) lines.push(`You keep ${Math.round(keepFrac * 100)}% of survivors`);
    this.add.text(GAME_W / 2, GAME_H / 2 + 8, lines.join('\n'), { fontFamily: 'monospace', fontSize: '20px', color: '#fff', align: 'center', stroke: '#000', strokeThickness: 3, lineSpacing: 8 }).setOrigin(0.5, 0).setDepth(D + 3);

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
