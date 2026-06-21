// Enemies and the wave scheduler.
import Phaser from 'phaser';
import { sfx } from '../audio/SoundEngine.js';

const CASTLE_DPS = 10; // damage an enemy deals to the castle per second on contact
const ENEMY_SPEED = 55; // pixels per second

export class Enemy {
  scene: any;
  x: number;
  y: number;
  maxHp: number;
  hp: number;
  damage: number;
  alive: boolean;
  rect: any;
  path: any;
  pathIdx: number;
  hpBarBg: any;
  hpBarFill: any;
  [key: string]: any;

  constructor(scene: any, x: number, y: number, hp: number, damage: number, anims?: any) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.maxHp = hp;
    this.hp = hp;
    this.damage = damage;
    this.alive = true;
    this.path = null;
    this.pathIdx = 0;
    this.recalcTimer = Math.random(); // stagger path recalcs

    // (Phase 6) Faction warrior sprite (defaults to the red kingdom's).
    this.idleAnim = (anims && anims.idle) || 'warrior_idle';
    this.runAnim = (anims && anims.run) || 'red_warrior_run';
    this.rect = scene.add.sprite(x, y, this.idleAnim, 0).setScale(40 / 192).setDepth(8);
    this.curAnim = null;
    this.playAnim(this.idleAnim);

    // Clean drawn HP bar (sprite bars smeared when stretched — see GameScene note).
    this._barW = 24;
    this.hpBarBg = scene.add.rectangle(x, y - 18, this._barW + 2, 5, 0x000000, 0.75).setDepth(9);
    this.hpBarFill = scene.add
      .rectangle(x - this._barW / 2, y - 18, this._barW, 3, 0x2ecc71)
      .setOrigin(0, 0.5)
      .setDepth(10);
  }

  playAnim(key) {
    if (this.curAnim === key) return;
    this.curAnim = key;
    if (this.scene.anims.exists(key)) this.rect.play(key);
  }

  takeDamage(amount) {
    this.hp -= amount;
    const pct = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    this.hpBarFill.width = this._barW * pct;
    this.hpBarFill.fillColor = pct > 0.5 ? 0x2ecc71 : pct > 0.25 ? 0xf1c40f : 0xe74c3c;
    // (Phase 7) brief red hit flash.
    this.rect.setTintFill(0xff3333);
    this.scene.time.delayedCall(70, () => { if (this.alive) this.rect.clearTint(); });
    if (this.hp <= 0) this.destroy();
  }

  update(dt, scene) {
    if (!this.alive) return;
    const castle = scene.buildings.castle;
    if (!castle || !castle.alive) return;

    const distToCastle = Phaser.Math.Distance.Between(this.x, this.y, castle.x, castle.y);
    if (distToCastle <= scene.TILE) {
      // In contact with the castle: stop and attack.
      castle.takeDamage(CASTLE_DPS * dt);
      this.playAnim(this.idleAnim);
      this.syncVisual();
      return;
    }
    this.playAnim(this.runAnim);

    // Periodically recompute a route around buildings.
    this.recalcTimer += dt;
    if (!this.path || this.recalcTimer >= 1) {
      this.recalcTimer = 0;
      this.path = scene.computeEnemyPath(this);
      this.pathIdx = 0;
    }

    if (this.path && this.pathIdx < this.path.length) {
      const wp = this.path[this.pathIdx];
      const d = Phaser.Math.Distance.Between(this.x, this.y, wp.x, wp.y);
      if (d < 4) {
        this.pathIdx++;
      } else {
        const ang = Math.atan2(wp.y - this.y, wp.x - this.x);
        this.x += Math.cos(ang) * ENEMY_SPEED * dt;
        this.y += Math.sin(ang) * ENEMY_SPEED * dt;
      }
    } else {
      // Fallback: head straight for the castle.
      const ang = Math.atan2(castle.y - this.y, castle.x - this.x);
      this.x += Math.cos(ang) * ENEMY_SPEED * dt;
      this.y += Math.sin(ang) * ENEMY_SPEED * dt;
    }
    this.syncVisual();
  }

  syncVisual() {
    this.rect.x = this.x;
    this.rect.y = this.y;
    this.hpBarBg.x = this.x;
    this.hpBarBg.y = this.y - 18;
    this.hpBarFill.x = this.x - this._barW / 2;
    this.hpBarFill.y = this.y - 18;
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    sfx.playThrottled('enemy_dies', 110); // (Polish Phase 2)
    // (Phase 7) dust puff + 0.5s fade-out on death.
    if (this.scene.dustAt) this.scene.dustAt(this.x, this.y);
    this.hpBarBg.destroy();
    this.hpBarFill.destroy();
    this.rect.clearTint();
    this.scene.tweens.add({ targets: this.rect, alpha: 0, scale: this.rect.scale * 0.8, duration: 450, onComplete: () => this.rect.destroy() });
  }
}

export class WaveManager {
  // Phase 3: the AI kingdom drives wave spawning, so `auto` defaults to false —
  // this manager now only updates/culls the shared enemies array.
  scene: any;
  interval: number;
  enemies: any[];
  spawnQueue: any[];
  [key: string]: any;

  constructor(scene: any, interval = 60, auto = false) {
    this.scene = scene;
    this.interval = interval;
    this.timeToNext = interval;
    this.waveNumber = 0;
    this.enemies = [];
    this.spawnQueue = []; // { delay, hp, damage, edge }
    this.spawnTimer = 0;
    this.auto = auto;
  }

  update(dt) {
    if (this.auto) {
      this.timeToNext -= dt;
      if (this.timeToNext <= 0) {
        this.startWave();
        this.timeToNext = this.interval;
      }
      if (this.spawnQueue.length > 0) {
        this.spawnTimer += dt;
        while (this.spawnQueue.length > 0 && this.spawnTimer >= this.spawnQueue[0].delay) {
          const spec = this.spawnQueue.shift();
          this.spawnTimer = 0;
          this.spawnEnemy(spec);
        }
      }
    }

    // Update + cull enemies (both melee Enemies and AI archers).
    for (const e of this.enemies) e.update(dt, this.scene);
    this.enemies = this.enemies.filter((e) => e.alive);
  }

  startWave() {
    this.waveNumber += 1;
    const count = 3 + (this.waveNumber - 1) * 2;
    const hp = 30 + (this.waveNumber - 1) * 10;
    const damage = 1 + (this.waveNumber - 1);
    const edge = Phaser.Math.Between(0, 3); // whole wave enters from one edge

    this.spawnTimer = 0;
    for (let i = 0; i < count; i++) {
      this.spawnQueue.push({ delay: i === 0 ? 0 : 0.45, hp, damage, edge });
    }
    this.scene.onWaveStart(this.waveNumber);
  }

  spawnEnemy(spec) {
    const { x, y } = this.scene.edgeSpawnPoint(spec.edge);
    const e = new Enemy(this.scene, x, y, spec.hp, spec.damage);
    this.enemies.push(e);
  }
}
