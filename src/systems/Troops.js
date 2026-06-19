import Phaser from 'phaser';

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

// Shared move-to-command handler for any unit (Phase 3 box-select). Returns true
// while a command is active so the unit's normal AI is skipped that frame.
function runCommand(u, dt, speed, runAnim, idleAnim) {
  if (!u.cmd) return false;
  const c = u.cmd;
  const d = Phaser.Math.Distance.Between(u.x, u.y, c.x, c.y);
  if (d > 6) {
    const ang = Math.atan2(c.y - u.y, c.x - u.x);
    u.x += Math.cos(ang) * speed * dt;
    u.y += Math.sin(ang) * speed * dt;
    u.spr.setFlipX(c.x < u.x);
    u.play(runAnim);
  } else if (c.attackAI && u.canAttackAI && u.scene.ai && u.scene.ai.castleAlive) {
    u.scene.ai.damageCastle(WARRIOR_DPS_TO_AI * dt); // chip the AI castle
    u.play(idleAnim);
  } else {
    u.cmd = null; // arrived
    u.play(idleAnim);
  }
  u.sync();
  return true;
}

class Warrior {
  constructor(scene, x, y, homeX, homeY) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.homeX = homeX;
    this.homeY = homeY;
    this.hp = MAX_HP;
    this.maxHp = MAX_HP;
    this.alive = true;
    this.target = null;
    this.cmd = null; // manual move/attack command (box-select, Phase 3)
    this.canAttackAI = true;
    // (Phase 4) small idle offset so warriors don't rest on exact coordinates.
    this.idleOX = Phaser.Math.Between(-4, 4);
    this.idleOY = Phaser.Math.Between(-4, 4);
    this.spr = scene.add.sprite(x, y, 'blue_warrior_idle', 0).setScale(SCALE).setDepth(7);
    this.curAnim = 'blue_warrior_idle';
    if (scene.anims.exists('blue_warrior_idle')) this.spr.play('blue_warrior_idle');
  }

  play(key) {
    if (this.curAnim === key) return;
    this.curAnim = key;
    if (this.scene.anims.exists(key)) this.spr.play(key);
  }

  update(dt, enemies) {
    if (!this.alive) return;
    if (runCommand(this, dt, WARRIOR_SPEED, 'blue_warrior_run', 'blue_warrior_idle')) return;

    // Acquire / re-acquire nearest living enemy.
    if (!this.target || !this.target.alive) {
      this.target = this.nearestEnemy(enemies);
    }

    if (this.target && this.target.alive) {
      const d = Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y);
      if (d > ATTACK_RANGE) {
        this.moveToward(this.target.x, this.target.y, dt);
        this.play('blue_warrior_run');
      } else {
        this.spr.setFlipX(this.target.x < this.x); // (Phase 5) face the enemy
        this.target.takeDamage(DPS_TO_ENEMY * dt);
        this.play('blue_warrior_idle');
      }
    } else {
      // No enemies: drift back toward the (slightly offset) home point and idle.
      const hx = this.homeX + this.idleOX;
      const hy = this.homeY + this.idleOY;
      if (Phaser.Math.Distance.Between(this.x, this.y, hx, hy) > 3) {
        this.moveToward(hx, hy, dt);
        this.play('blue_warrior_run');
      } else {
        this.play('blue_warrior_idle');
      }
    }
    this.sync();
  }

  moveToward(tx, ty, dt) {
    const ang = Math.atan2(ty - this.y, tx - this.x);
    this.x += Math.cos(ang) * WARRIOR_SPEED * dt;
    this.y += Math.sin(ang) * WARRIOR_SPEED * dt;
    this.spr.setFlipX(tx < this.x);
  }

  takeDamage(amount) {
    this.hp -= amount;
    if (this.hp <= 0) this.die();
  }

  die() {
    this.alive = false;
    if (this.scene.dustAt) this.scene.dustAt(this.x, this.y); // Phase 5 death FX
    this.spr.destroy();
  }

  nearestEnemy(enemies) {
    let best = null;
    let bestD = Infinity;
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

  play(key) {
    if (this.curAnim === key) return;
    this.curAnim = key;
    if (this.scene.anims.exists(key)) this.spr.play(key);
  }

  sync() {
    this.spr.x = this.x;
    this.spr.y = this.y;
  }

  update(dt, enemies) {
    if (!this.alive) return;
    if (runCommand(this, dt, 60, 'blue_archer_idle', 'blue_archer_idle')) return;
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
      }
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

  play(key) {
    if (this.curAnim === key) return;
    this.curAnim = key;
    if (this.scene.anims.exists(key)) this.spr.play(key);
  }

  sync() {
    this.spr.x = this.x;
    this.spr.y = this.y;
  }

  update(dt, enemies, troops) {
    if (!this.alive) return;
    if (runCommand(this, dt, 60, 'monk_idle', 'monk_idle')) return;
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
      } else if (w.hp < w.maxHp * 0.8) {
        w.hp = Math.min(w.maxHp, w.hp + 5 * dt);
        this.healTimer += dt;
        if (this.healTimer >= 1) {
          this.healTimer = 0;
          this.healEffect(w.x, w.y);
        }
      }
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

    // Any enemy within 1 tile damages the nearest warrior.
    for (const e of enemies) {
      if (!e.alive) continue;
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
