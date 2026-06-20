import Phaser from 'phaser';
import { playLoop, playOnce } from './Animations.js';
import { sfx } from '../audio/SoundEngine.js';

// Blue warrior troops (Phase 4). Trained at the Barracks; they idle in a loose
// cluster near their barracks and automatically engage incoming enemies. The
// number of living warriors IS the Soldiers resource shown in the UI.

const SCALE = 36 / 192; // warrior sheets are 192px frames; show at ~36px
const WARRIOR_SPEED = 70; // px/sec
const ATTACK_RANGE = 0.8 * 48; // within ~1 tile
const DPS_TO_ENEMY = 15;
const ENEMY_DPS_TO_WARRIOR = 5;
const WARRIOR_DPS_TO_AI = 10; // when commanded to attack the AI castle
const MAX_HP = 50;
// (Phase 2) Auto-acquire leash: warriors only auto-engage threats within ~7
// tiles and won't chase past ~12 tiles from home, so they defend the base
// instead of wandering after wildlife. Right-click commands ignore the leash.
const AUTO_ACQUIRE = 7 * 48;
const LEASH = 12 * 48;

// Shared move-to-command handler for any unit (Phase 3 box-select). Returns true
// while a command is active so the unit's normal AI is skipped that frame.
function speedMul(u) {
  return u.scene.buffs ? u.scene.buffs.troopSpeed : 1; // War Drum artifact (Phase 5)
}

function runCommand(u, dt, speed, runAnim, idleAnim) {
  if (!u.cmd) return false;
  const c = u.cmd;
  const d = Phaser.Math.Distance.Between(u.x, u.y, c.x, c.y);
  if (d > 6) {
    const ang = Math.atan2(c.y - u.y, c.x - u.x);
    const sp = speed * speedMul(u);
    u.x += Math.cos(ang) * sp * dt;
    u.y += Math.sin(ang) * sp * dt;
    u.spr.setFlipX(c.x < u.x);
    u.play(runAnim);
  } else if (c.attackAI && u.canAttackAI) {
    // Chip the commanded enemy castle (Phase 6 — any faction), else the legacy AI.
    const castle = c.castle || (u.scene.ai && u.scene.ai.castleAlive ? u.scene.ai : null);
    if (castle && castle.castleAlive) castle.damageCastle(WARRIOR_DPS_TO_AI * dt);
    else u.cmd = null;
    u.play(idleAnim);
  } else {
    u.cmd = null; // arrived
    u.play(idleAnim);
  }
  u.sync();
  return true;
}

class Warrior {
  constructor(scene, x, y, homeX, homeY, opts = {}) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.homeX = homeX;
    this.homeY = homeY;
    this.maxHp = opts.hp || MAX_HP; // (Phase 3) Knights override hp/dps
    this.hp = this.maxHp;
    this.dps = opts.dps || DPS_TO_ENEMY;
    this.alive = true;
    this.target = null;
    this.cmd = null; // manual move/attack command (box-select, Phase 3)
    this.canAttackAI = true;
    // (Phase 5) Mercenaries are yellow-sprited warriors with a higher food
    // upkeep and a floating label; regular warriors are blue. (Phase 3) Knights.
    this.mercenary = !!opts.mercenary;
    this.knight = !!opts.knight;
    this.idleAnim = opts.idle || 'blue_warrior_idle';
    this.runAnim = opts.run || 'blue_warrior_run';
    this.atkAnim = opts.attack || 'blue_warrior_attack'; // (Polish Phase 1) melee swing
    // (Phase 4) small idle offset so warriors don't rest on exact coordinates.
    this.idleOX = Phaser.Math.Between(-4, 4);
    this.idleOY = Phaser.Math.Between(-4, 4);
    this.spr = scene.add.sprite(x, y, this.idleAnim, 0).setScale(opts.scale || SCALE).setDepth(7);
    if (opts.tint) this.spr.setTint(opts.tint);
    this.curAnim = this.idleAnim;
    if (scene.anims.exists(this.idleAnim)) this.spr.play(this.idleAnim);
    if (opts.label) {
      this.label = scene.add.text(x, y - 24, opts.label, { fontFamily: 'monospace', fontSize: '9px', color: '#ffe066', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5, 1).setDepth(8);
    }
  }

  play(key) { playLoop(this.spr, key); }

  update(dt, enemies) {
    if (!this.alive) return;
    if (runCommand(this, dt, WARRIOR_SPEED, this.runAnim, this.idleAnim)) return;

    // Acquire / re-acquire the nearest living threat within auto-acquire range.
    if (!this.target || !this.target.alive) {
      this.target = this.nearestEnemy(enemies, AUTO_ACQUIRE);
    }
    // (Bug 4/8) The home leash only applies to AUTO-defending units. A unit the
    // player explicitly sent somewhere ignores the leash, so it will engage an
    // enemy garrison / building far from home instead of running back.
    if (!this.playerCommanded && this.target && Phaser.Math.Distance.Between(this.homeX, this.homeY, this.x, this.y) > LEASH) {
      this.target = null;
    }

    if (this.target && this.target.alive) {
      const d = Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y);
      if (d > ATTACK_RANGE) {
        this.moveToward(this.target.x, this.target.y, dt);
        this.play(this.runAnim);
      } else {
        this.spr.setFlipX(this.target.x < this.x); // (Phase 5) face the enemy
        const dmgMul = this.scene.buffs ? this.scene.buffs.warriorDamage : 1; // Whetstone artifact
        this.target.takeDamage(this.dps * dt * dmgMul);
        // (Polish Phase 1) swing the sword on a cadence, idle between swings.
        this._atkCd = (this._atkCd || 0) - dt;
        if (this._atkCd <= 0) { this._atkCd = 0.7; playOnce(this.spr, this.atkAnim, this.idleAnim); sfx.playThrottled('sword_hit', 130); }
        else this.play(this.idleAnim);
      }
    } else if (this.playerCommanded) {
      // (Bug 8) Hold the position the player ordered — do NOT run back home.
      this.play(this.idleAnim);
    } else {
      // No enemies: drift back toward the (slightly offset) home point and idle.
      const hx = this.homeX + this.idleOX;
      const hy = this.homeY + this.idleOY;
      if (Phaser.Math.Distance.Between(this.x, this.y, hx, hy) > 3) {
        this.moveToward(hx, hy, dt);
        this.play(this.runAnim);
      } else {
        this.play(this.idleAnim);
      }
    }
    this.sync();
  }

  moveToward(tx, ty, dt) {
    const ang = Math.atan2(ty - this.y, tx - this.x);
    const sp = WARRIOR_SPEED * speedMul(this);
    this.x += Math.cos(ang) * sp * dt;
    this.y += Math.sin(ang) * sp * dt;
    this.spr.setFlipX(tx < this.x);
  }

  takeDamage(amount) {
    this.hp -= amount;
    this.spr.setTintFill(0xff5555); // (Phase 7) hit flash
    this.scene.time.delayedCall(70, () => { if (this.alive) { if (this.knight) this.spr.setTint(0x9fb8d8); else this.spr.clearTint(); } });
    if (this.hp <= 0) this.die();
  }

  die() {
    this.alive = false;
    sfx.playThrottled('soldier_dies', 120); // (Polish Phase 2)
    if (this.scene.dustAt) this.scene.dustAt(this.x, this.y); // Phase 5 death FX
    this.spr.destroy();
    if (this.label) this.label.destroy();
  }

  nearestEnemy(enemies, maxRange = Infinity) {
    let best = null;
    let bestD = maxRange;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  sync() {
    this.spr.x = this.x;
    this.spr.y = this.y;
    if (this.label) { this.label.x = this.x; this.label.y = this.y - 24; }
  }
}

// Stationary blue archer (Phase 4): stays near the barracks, shoots the nearest
// enemy within 4 tiles for 12 dmg/sec.
class Archer {
  constructor(scene, x, y) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.hp = 40;
    this.maxHp = 40;
    this.alive = true;
    this.range = 4 * scene.TILE;
    this.shootTimer = 0;
    this.cmd = null;
    this.canAttackAI = false;
    this.curAnim = 'blue_archer_idle';
    this.spr = scene.add.sprite(x, y, 'blue_archer_idle', 0).setScale(36 / 192).setDepth(7);
    if (scene.anims.exists('blue_archer_idle')) this.spr.play('blue_archer_idle');
  }

  play(key) { playLoop(this.spr, key); }

  sync() {
    this.spr.x = this.x;
    this.spr.y = this.y;
  }

  update(dt, enemies) {
    if (!this.alive) return;
    if (runCommand(this, dt, 60, 'blue_archer_run', 'blue_archer_idle')) return;
    let best = null;
    let bd = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (best && bd <= this.range) {
      best.takeDamage(12 * dt);
      this.spr.setFlipX(best.x < this.x);
      this.shootTimer += dt;
      if (this.shootTimer >= 0.6) {
        this.shootTimer = 0;
        this.scene.spawnArrow(this.x, this.y, best.x, best.y);
        playOnce(this.spr, 'blue_archer_shoot', 'blue_archer_idle'); // (Polish Phase 1)
      } else {
        this.play('blue_archer_idle');
      }
    } else {
      this.play('blue_archer_idle');
    }
  }

  takeDamage(a) {
    this.hp -= a;
    if (this.hp <= 0) this.die();
  }

  die() {
    this.alive = false;
    this.spr.destroy();
  }
}

// Blue monk (Phase 4): no combat. Follows the nearest warrior and heals them
// 5 HP/sec while their HP is below 80%.
class Monk {
  constructor(scene, x, y) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.hp = 30;
    this.maxHp = 30;
    this.alive = true;
    this.healTimer = 0;
    this.cmd = null;
    this.canAttackAI = false;
    this.curAnim = 'monk_idle';
    this.spr = scene.add.sprite(x, y, 'monk_idle', 0).setScale(36 / 192).setDepth(7);
    if (scene.anims.exists('monk_idle')) this.spr.play('monk_idle');
  }

  play(key) { playLoop(this.spr, key); }

  sync() {
    this.spr.x = this.x;
    this.spr.y = this.y;
  }

  update(dt, enemies, troops) {
    if (!this.alive) return;
    if (runCommand(this, dt, 60, 'monk_run', 'monk_idle')) return;
    let w = null;
    let bd = Infinity;
    for (const ww of troops.warriors) {
      if (!ww.alive) continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, ww.x, ww.y);
      if (d < bd) {
        bd = d;
        w = ww;
      }
    }
    if (w) {
      if (bd > 28) {
        const ang = Math.atan2(w.y - this.y, w.x - this.x);
        this.x += Math.cos(ang) * 62 * dt;
        this.y += Math.sin(ang) * 62 * dt;
        this.spr.setFlipX(w.x < this.x);
        this.play('monk_run'); // (Polish Phase 1)
      } else if (w.hp < w.maxHp * 0.8) {
        const healMul = this.scene.buffs ? this.scene.buffs.monkHeal : 1; // Healer's Tome artifact
        w.hp = Math.min(w.maxHp, w.hp + 5 * dt * healMul);
        this.healTimer += dt;
        if (this.healTimer >= 1) {
          this.healTimer = 0;
          this.healEffect(w.x, w.y);
          playOnce(this.spr, 'monk_heal', 'monk_idle'); // (Polish Phase 1) cast pose
        } else {
          this.play('monk_idle');
        }
      } else {
        this.play('monk_idle');
      }
    } else {
      this.play('monk_idle');
    }
    this.spr.x = this.x;
    this.spr.y = this.y;
  }

  healEffect(x, y) {
    const fx = this.scene.add.sprite(x, y - 10, 'heal_effect', 0).setScale(40 / 192).setDepth(8);
    if (this.scene.anims.exists('heal_effect')) {
      fx.play('heal_effect');
      fx.once('animationcomplete', () => fx.destroy());
    } else {
      this.scene.time.delayedCall(400, () => fx.destroy());
    }
  }

  takeDamage(a) {
    this.hp -= a;
    if (this.hp <= 0) this.die();
  }

  die() {
    this.alive = false;
    this.spr.destroy();
  }
}

export class TroopManager {
  constructor(scene) {
    this.scene = scene;
    this.warriors = [];
    this.archers = [];
    this.monks = [];
  }

  // All trained units count toward the Soldiers number.
  get count() {
    return this.warriors.length + this.archers.length + this.monks.length;
  }

  // All living units (for box-select, Phase 3).
  allUnits() {
    return [...this.warriors, ...this.archers, ...this.monks].filter((u) => u.alive);
  }

  // Remove one random living unit (Phase 3 food desertion). Returns true if any.
  removeRandom() {
    const all = this.allUnits();
    if (all.length === 0) return false;
    const u = all[Math.floor(Math.random() * all.length)];
    u.die();
    return true;
  }

  // (Phase 1 BattleScene) Snapshot the army by type, then remove every unit from
  // the world (they "march off" to the BattleScene). Survivors are respawned.
  snapshot() {
    const c = { warrior: 0, mercenary: 0, knight: 0, archer: this.archers.length, monk: this.monks.length };
    for (const w of this.warriors) { if (w.knight) c.knight++; else if (w.mercenary) c.mercenary++; else c.warrior++; }
    return Object.entries(c).filter(([, v]) => v > 0).map(([type, count]) => ({ type, count }));
  }

  removeAll() {
    for (const u of [...this.warriors, ...this.archers, ...this.monks]) { u.alive = false; if (u.spr) u.spr.destroy(); if (u.label) u.label.destroy(); if (u.selRing) u.selRing.destroy(); }
    this.warriors = []; this.archers = []; this.monks = [];
  }

  // (Save system) Capture every living unit's type/position/hp.
  serialize() {
    const out = [];
    for (const w of this.warriors) if (w.alive) out.push({ t: w.knight ? 'knight' : w.mercenary ? 'mercenary' : 'warrior', x: Math.round(w.x), y: Math.round(w.y), hp: Math.round(w.hp), maxHp: w.maxHp, cmd: !!w.playerCommanded });
    for (const a of this.archers) if (a.alive) out.push({ t: 'archer', x: Math.round(a.x), y: Math.round(a.y), hp: Math.round(a.hp), maxHp: a.maxHp, cmd: !!a.playerCommanded });
    for (const m of this.monks) if (m.alive) out.push({ t: 'monk', x: Math.round(m.x), y: Math.round(m.y), hp: Math.round(m.hp), maxHp: m.maxHp, cmd: !!m.playerCommanded });
    return out;
  }

  // (Save system) Rebuild units from serialized data onto a clean roster.
  restore(list) {
    this.removeAll();
    for (const d of list || []) {
      const x = d.x, y = d.y;
      let u;
      if (d.t === 'archer') { u = new Archer(this.scene, x, y); this.archers.push(u); }
      else if (d.t === 'monk') { u = new Monk(this.scene, x, y); this.monks.push(u); }
      else if (d.t === 'knight') { u = new Warrior(this.scene, x, y, x, y, { knight: true, hp: 120, dps: 25, scale: 44 / 192, tint: 0x9fb8d8, label: 'Knight' }); this.warriors.push(u); }
      else if (d.t === 'mercenary') { u = new Warrior(this.scene, x, y, x, y, { mercenary: true, label: 'Mercenary', idle: 'yellow_warrior_idle', run: 'yellow_warrior_run', attack: 'yellow_warrior_attack' }); this.warriors.push(u); }
      else { u = new Warrior(this.scene, x, y, x, y); this.warriors.push(u); }
      if (d.maxHp) u.maxHp = d.maxHp;
      if (d.hp != null) u.hp = d.hp;
      u.playerCommanded = !!d.cmd;
      if (u.sync) u.sync();
    }
  }

  spawnArcher(barracks) {
    this.archers.push(new Archer(this.scene, barracks.x + Phaser.Math.Between(-26, -14), barracks.y + Phaser.Math.Between(-14, 14)));
  }

  spawnMonk(barracks) {
    this.monks.push(new Monk(this.scene, barracks.x + Phaser.Math.Between(14, 26), barracks.y + Phaser.Math.Between(-14, 14)));
  }

  // Called when a Barracks finishes training a soldier.
  spawn(barracks) {
    const n = this.warriors.length;
    // Loose cluster offset so warriors don't stack on a single point.
    const ox = ((n % 4) - 1.5) * 16;
    const oy = (Math.floor(n / 4) % 3) * 16 + 22;
    const hx = barracks.x + ox;
    const hy = barracks.y + oy;
    this.warriors.push(new Warrior(this.scene, hx, hy, hx, hy));
  }

  // Spawn a warrior at an explicit point (used when expeditions return).
  spawnAt(x, y) {
    this.warriors.push(new Warrior(this.scene, x, y, x, y));
  }

  // (Phase 3) Knight: HP 120, 25 dmg, slow, armored (blue-steel tint, larger).
  spawnKnight(home) {
    const hx = home.x + Phaser.Math.Between(-22, 22);
    const hy = home.y + Phaser.Math.Between(20, 40);
    const k = new Warrior(this.scene, hx, hy, hx, hy, { knight: true, hp: 120, dps: 25, scale: 44 / 192, tint: 0x9fb8d8, label: 'Knight' });
    this.warriors.push(k);
    const c = this.scene.buildings.castle;
    if (c && this.scene.floatText) this.scene.floatText(c.x, c.y - 44, 'A Knight joins your army!', '#9fb8d8');
    return k;
  }

  // (Phase 5) A Mercenary joins from an expedition: yellow sprite, "Mercenary"
  // label, fights like a warrior but eats 5 food/day (see dailyUpkeep).
  spawnMercenary() {
    const home = this.scene.buildings.barracks ? this.scene.buildings.barracks : (this.scene.buildings.buildings.find((b) => b.typeKey === 'barracks') || this.scene.buildings.castle);
    const hx = home.x + Phaser.Math.Between(-24, 24);
    const hy = home.y + Phaser.Math.Between(20, 36);
    const m = new Warrior(this.scene, hx, hy, hx, hy, { mercenary: true, label: 'Mercenary', idle: 'yellow_warrior_idle', run: 'yellow_warrior_run', attack: 'yellow_warrior_attack' });
    this.warriors.push(m);
    const c = this.scene.buildings.castle;
    if (c && this.scene.floatText) this.scene.floatText(c.x, c.y - 44, 'A Mercenary joined your army!', '#ffe066');
    return m;
  }

  // (Phase 5) Daily food upkeep: 2/soldier, 5/mercenary.
  dailyUpkeep() {
    let n = 0;
    for (const w of this.warriors) n += w.mercenary ? 5 : 2;
    n += this.archers.length * 2;
    n += this.monks.length * 2;
    return n;
  }

  // Remove up to n warriors quietly (they leave on an expedition).
  detach(n) {
    for (let i = 0; i < n && this.warriors.length > 0; i++) {
      const w = this.warriors.pop();
      w.alive = false;
      w.spr.destroy();
    }
  }

  update(dt, enemies) {
    for (const w of this.warriors) w.update(dt, enemies);

    // Any enemy within 1 tile damages the nearest warrior. Wildlife is flagged
    // noWarriorMelee (it harasses the economy, not the warriors directly).
    for (const e of enemies) {
      if (!e.alive || e.noWarriorMelee) continue;
      let nearest = null;
      let nd = Infinity;
      for (const w of this.warriors) {
        if (!w.alive) continue;
        const d = Phaser.Math.Distance.Between(e.x, e.y, w.x, w.y);
        if (d < nd) {
          nd = d;
          nearest = w;
        }
      }
      if (nearest && nd <= this.scene.TILE) nearest.takeDamage(ENEMY_DPS_TO_WARRIOR * dt);
    }

    for (const a of this.archers) a.update(dt, enemies);
    for (const m of this.monks) m.update(dt, enemies, this);

    this.warriors = this.warriors.filter((w) => w.alive);
    this.archers = this.archers.filter((a) => a.alive);
    this.monks = this.monks.filter((m) => m.alive);
  }
}
