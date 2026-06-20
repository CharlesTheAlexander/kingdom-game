import Phaser from 'phaser';
import { GAME_W, GAME_H } from './GameScene.js';

// BattleScene (Phase 1) — a separate strategic battle scene. IsometricScene
// launches it (paused underneath) when a combat involves 10+ units, passing the
// two armies; the player sets a formation in a 20s pre-battle phase, then units
// fight automatically with morale, commands and damage numbers, and the outcome
// (surviving army, loot, conquest) is handed back via the onComplete callback.

const PRE_BATTLE = 20;     // seconds
const MAX_BATTLE = 300;    // 5 minutes
const MELEE = 42;          // px melee range (~1 tile)

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
const TERRAIN_BG = { forest: 0x1f3322, mountains: 0x33343a, plains: 0x2a3d22, wildlands: 0x33331f };

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
    this.spr = scene.add.sprite(x, y, scene.textures.exists(tex) ? tex : 'blue_warrior_idle', 0).setScale(type === 'knight' ? 44 / 192 : 40 / 192).setDepth(10);
    if (this.spr.texture.frameTotal > 1 && scene.anims.exists(this.spr.texture.key)) this.spr.play(this.spr.texture.key);
    this.spr.setFlipX(side === 'enemy'); // enemies (left) face right; players (right) face left
    if (side === 'player') this.spr.setFlipX(true);
    this.hpBg = scene.add.rectangle(x, y - 22, 26, 4, 0x000000, 0.6).setDepth(11);
    this.hpFill = scene.add.rectangle(x - 13, y - 22, 26, 2.5, side === 'player' ? 0x4ad66b : 0xd64a4a).setOrigin(0, 0.5).setDepth(12);
  }
  takeDamage(a) {
    if (!this.alive) return;
    this.hp -= a;
    this.hpFill.width = 26 * Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    this.spr.setTintFill(0xff5555);
    this.scene.time.delayedCall(60, () => { if (this.alive) this.spr.clearTint(); });
    this.scene.dmgNumber(this.x, this.y - 18, Math.round(a), this.side === 'player' ? '#ff6b6b' : '#ffffff');
    if (this.hp <= 0) this.die();
  }
  die() {
    if (!this.alive) return;
    this.alive = false;
    this.scene.onUnitDeath(this);
    this.hpBg.destroy(); this.hpFill.destroy();
    this.spr.setTintFill(0xff3333);
    this.scene.tweens.add({ targets: this.spr, alpha: 0, duration: 500, onComplete: () => this.spr.destroy() });
  }
  sync() { this.spr.x = this.x; this.spr.y = this.y; this.hpBg.x = this.x; this.hpBg.y = this.y - 22; this.hpFill.x = this.x - 13; this.hpFill.y = this.y - 22; }
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
    this.faction = this.cfg.enemyFaction || 'red';
    this.add.rectangle(0, 0, GAME_W, GAME_H, TERRAIN_BG[terrain] || TERRAIN_BG.plains, 1).setOrigin(0, 0);
    // vignette
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.18).setOrigin(0, 0).setDepth(1);

    this.units = [];
    this.obstacles = [];
    this.phase = 'pre';
    this.timer = PRE_BATTLE;
    this.battleTime = 0;
    this.morale = { player: 70, enemy: 70 };
    if (this.cfg.taverMoraleBonus) this.morale.player += 10;
    this.selected = [];

    this.scatterObstacles(terrain);
    this.spawnArmy('player', this.cfg.playerArmy || [], GAME_W - 180, 0xffffff);
    this.spawnArmy('enemy', this.cfg.enemyArmy || [], 180, null);
    this.applyFormation('player', 'LINE');
    this.applyFormation('enemy', 'LINE');

    this.buildHud();
    this.cameras.main.fadeIn(400, 0, 0, 0);
  }

  scatterObstacles(terrain) {
    const n = terrain === 'plains' ? 2 : terrain === 'forest' ? 8 : 6;
    const key = terrain === 'mountains' ? 'iso_mtn' : terrain === 'forest' ? 'iso_forest1' : 'iso_rock';
    for (let i = 0; i < n; i++) {
      const x = Phaser.Math.Between(330, GAME_W - 330);
      const y = Phaser.Math.Between(140, GAME_H - 200);
      const o = this.add.image(x, y, this.textures.exists(key) ? key : 'iso_rock').setScale(1.4).setDepth(5).setAlpha(0.85);
      this.obstacles.push({ x, y, r: 40 });
    }
  }

  // armyData: [{type, count}]
  spawnArmy(side, armyData, baseX, tint) {
    for (const grp of armyData) {
      for (let i = 0; i < grp.count; i++) {
        let tex;
        if (side === 'enemy') tex = grp.type === 'archer' ? 'red_archer_idle' : (FACTION_WARRIOR[this.faction] || 'warrior_idle');
        const u = new BUnit(this, side, grp.type, baseX, GAME_H / 2, tex);
        this.units.push(u);
      }
    }
  }

  sideUnits(side) { return this.units.filter((u) => u.alive && u.side === side); }

  // Arrange a side's living units into a formation.
  applyFormation(side, name) {
    const us = this.sideUnits(side);
    if (!us.length) return;
    const baseX = side === 'player' ? GAME_W - 180 : 180;
    const dir = side === 'player' ? -1 : 1; // facing direction (toward centre)
    const cy = GAME_H / 2;
    const byType = (t) => us.filter((u) => u.type === t || (t === 'warrior' && (u.type === 'mercenary' || u.type === 'knight' || u.type === 'garrison')));
    const place = (arr, x, spread) => arr.forEach((u, i) => { u.x = x; u.y = cy + (i - (arr.length - 1) / 2) * spread; });
    if (name === 'LINE') {
      place(byType('warrior'), baseX, 34);
      place(us.filter((u) => u.type === 'archer'), baseX + dir * 55, 34);
      place(us.filter((u) => u.type === 'monk'), baseX + dir * 100, 40);
    } else if (name === 'WEDGE') {
      const w = byType('warrior');
      w.forEach((u, i) => { const k = i - (w.length - 1) / 2; u.x = baseX + dir * Math.abs(k) * -22; u.y = cy + k * 30; });
      place(us.filter((u) => u.type === 'archer'), baseX + dir * 70, 30);
      place(us.filter((u) => u.type === 'monk'), baseX + dir * 110, 36);
    } else if (name === 'DEFENSIVE') {
      const ring = byType('warrior'); const R = 70 + ring.length * 2;
      ring.forEach((u, i) => { const a = (i / ring.length) * Math.PI * 2; u.x = baseX + dir * 40 + Math.cos(a) * R; u.y = cy + Math.sin(a) * R; });
      us.filter((u) => u.type === 'monk' || u.type === 'archer').forEach((u, i) => { u.x = baseX + dir * 40 + (i % 3 - 1) * 18; u.y = cy + Math.floor(i / 3) * 18 - 18; });
    } else if (name === 'FLANK') {
      us.forEach((u, i) => { u.x = baseX + (i % 2) * dir * -30; u.y = (i % 2 === 0 ? cy - 150 : cy + 150) + Math.floor(i / 2) * 26 - us.length * 4; });
    }
    us.forEach((u) => u.sync());
  }

  buildHud() {
    // Morale bars: enemy top-left, player top-right.
    this.mEnemyBg = this.add.rectangle(20, 20, 220, 16, 0x000000, 0.6).setOrigin(0, 0).setDepth(40);
    this.mEnemy = this.add.rectangle(22, 22, 216, 12, 0x4ad66b).setOrigin(0, 0).setDepth(41);
    this.add.text(20, 38, `Enemy (${this.faction})`, { fontFamily: 'monospace', fontSize: '12px', color: '#ddd' }).setDepth(41);
    this.mPlayerBg = this.add.rectangle(GAME_W - 20, 20, 220, 16, 0x000000, 0.6).setOrigin(1, 0).setDepth(40);
    this.mPlayer = this.add.rectangle(GAME_W - 22, 22, 216, 12, 0x4ad66b).setOrigin(1, 0).setDepth(41);
    this.add.text(GAME_W - 20, 38, 'Your Army', { fontFamily: 'monospace', fontSize: '12px', color: '#ddd' }).setOrigin(1, 0).setDepth(41);

    this.countdown = this.add.text(GAME_W / 2, 28, '', { fontFamily: 'monospace', fontSize: '20px', color: '#ffe9a8', fontStyle: 'bold', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5, 0).setDepth(41);
    this.banner = this.add.text(GAME_W / 2, 70, 'Set your formation, then battle begins', { fontFamily: 'monospace', fontSize: '14px', color: '#fff', backgroundColor: '#000000aa', padding: { x: 8, y: 4 } }).setOrigin(0.5, 0).setDepth(41);

    // Formation buttons (pre-battle).
    this.formBtns = [];
    const forms = ['LINE', 'WEDGE', 'DEFENSIVE', 'FLANK'];
    forms.forEach((f, i) => {
      const b = this.mkButton(150 + i * 165, GAME_H - 40, 150, 36, f, 0x3a5a8a, () => { this.applyFormation('player', f); this.banner.setText(`Formation: ${f}`); });
      this.formBtns.push(b);
    });

    // Command bar (battle phase) — hidden until battle starts.
    this.cmdBtns = [];
    const cmds = [['CHARGE', 0x8a3a3a], ['HOLD', 0x3a6a8a], ['FLANK L', 0x6a5a3a], ['FLANK R', 0x6a5a3a], ['RETREAT', 0x5a3a6a]];
    cmds.forEach((c, i) => {
      const b = this.mkButton(110 + i * 150, GAME_H - 40, 138, 36, c[0], c[1], () => this.command(c[0]));
      b.bg.setVisible(false); b.txt.setVisible(false);
      this.cmdBtns.push(b);
    });
  }

  mkButton(x, y, w, h, label, color, onClick) {
    const bg = this.add.rectangle(x, y, w, h, color).setStrokeStyle(2, 0xf0e6c8, 0.7).setDepth(40).setInteractive({ useHandCursor: true });
    const txt = this.add.text(x, y, label, { fontFamily: 'monospace', fontSize: '13px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(41);
    bg.on('pointerover', () => bg.setFillStyle(color + 0x101010));
    bg.on('pointerout', () => bg.setFillStyle(color));
    bg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); onClick(); });
    return { bg, txt };
  }

  // Player command (applies to all player units — selection simplified).
  command(name) {
    const us = this.sideUnits('player');
    if (name === 'CHARGE') us.forEach((u) => { u.cmd = 'charge'; });
    else if (name === 'HOLD') us.forEach((u) => { u.cmd = 'hold'; });
    else if (name === 'FLANK L') us.forEach((u) => { u.cmd = 'flankL'; });
    else if (name === 'FLANK R') us.forEach((u) => { u.cmd = 'flankR'; });
    else if (name === 'RETREAT') { us.forEach((u) => { u.cmd = 'retreat'; }); this._retreating = true; }
    this.banner.setText(`Order: ${name}`);
  }

  dmgNumber(x, y, n, color) {
    const t = this.add.text(x, y, `${n}`, { fontFamily: 'monospace', fontSize: '13px', color, fontStyle: 'bold', stroke: '#000', strokeThickness: 2 }).setOrigin(0.5).setDepth(30);
    this.tweens.add({ targets: t, y: y - 26, alpha: 0, duration: 900, onComplete: () => t.destroy() });
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
      this.countdown.setText(`Battle begins in: ${Math.ceil(this.timer)}s`);
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
    this.countdown.setText('');
    this.banner.setText('BATTLE!');
    this.formBtns.forEach((b) => { b.bg.setVisible(false); b.txt.setVisible(false); });
    this.cmdBtns.forEach((b) => { b.bg.setVisible(true); b.txt.setVisible(true); });
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
      if (w) { if (Phaser.Math.Distance.Between(u.x, u.y, w.x, w.y) > 30) this.moveTo(u, w.x, w.y, u.speed * moraleMul, dt); else { w.hp = Math.min(w.maxHp, w.hp + u.heal * dt); w.hpFill.width = 26 * (w.hp / w.maxHp); } }
      u.sync(); return;
    }

    const atkRange = u.range > 0 ? u.range : MELEE;
    if (dist <= atkRange) {
      if (u.cmd === 'hold' || u.range > 0 || u.hold || true) {
        if (u.atkCd <= 0) {
          u.atkCd = 0.5;
          if (u.area) { for (const o of this.units) { if (o.alive && o.side !== u.side && Phaser.Math.Distance.Between(u.x, u.y, o.x, o.y) <= MELEE) o.takeDamage(u.dmg * 0.5); } }
          else foe.takeDamage(u.dmg * 0.5);
          if (u.range > 0) this.projectile(u.x, u.y, foe.x, foe.y);
        }
      }
    } else if (u.cmd !== 'hold' && !u.hold) {
      // Knights/tanks draw aggro is implicit (they advance and intercept by being front).
      this.moveTo(u, foe.x, foe.y, u.speed * moraleMul, dt);
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
    u.x = Phaser.Math.Clamp(nx, 30, GAME_W - 30); u.y = Phaser.Math.Clamp(ny, 100, GAME_H - 120);
  }

  projectile(x1, y1, x2, y2) {
    const dot = this.add.circle(x1, y1, 2.5, 0xffffff).setDepth(20);
    this.tweens.add({ targets: dot, x: x2, y: y2, duration: 180, onComplete: () => dot.destroy() });
  }

  updateMoraleBars() {
    const col = (m) => (m >= 70 ? 0x4ad66b : m >= 40 ? 0xe6c84a : 0xd64a4a);
    this.mPlayer.width = 216 * (this.morale.player / 100); this.mPlayer.fillColor = col(this.morale.player);
    this.mEnemy.width = 216 * (this.morale.enemy / 100); this.mEnemy.fillColor = col(this.morale.enemy);
  }

  endBattle(kind) {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.cmdBtns.forEach((b) => { b.bg.setVisible(false); b.txt.setVisible(false); });
    const victory = kind === 'victory' || kind === 'rout_enemy';
    const retreated = kind === 'retreat';
    // Survivors by type.
    const survivors = {};
    let keepFrac = victory ? 1 : retreated ? 0.6 : 0.4;
    for (const u of this.sideUnits('player')) survivors[u.type] = (survivors[u.type] || 0) + 1;
    const army = Object.entries(survivors).map(([type, count]) => ({ type, count: Math.max(0, Math.round(count * keepFrac)) }));
    // Loot from defeated enemies (victory only).
    const enemyDead = (this.cfg.enemyArmy || []).reduce((s, g) => s + g.count, 0);
    const loot = victory ? { gold: enemyDead * 8, iron: this.faction === 'goblin' ? enemyDead * 2 : 0 } : null;

    const big = this.add.text(GAME_W / 2, GAME_H / 2 - 30, victory ? 'VICTORY' : retreated ? 'RETREAT' : 'DEFEAT', { fontFamily: 'monospace', fontSize: '56px', color: victory ? '#7CFC7C' : '#e74c3c', fontStyle: 'bold', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5).setDepth(60);
    const sub = victory && loot ? `Loot: +${loot.gold} gold${loot.iron ? ' +' + loot.iron + ' iron' : ''}` : `You keep ${Math.round(keepFrac * 100)}% of survivors`;
    this.add.text(GAME_W / 2, GAME_H / 2 + 30, sub, { fontFamily: 'monospace', fontSize: '18px', color: '#fff', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(60);

    this.time.delayedCall(2600, () => {
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.time.delayedCall(420, () => {
        const cb = this.cfg.onComplete;
        this.scene.stop();
        if (cb) cb({ victory, retreated, army, loot, context: this.cfg.context });
      });
    });
  }
}
