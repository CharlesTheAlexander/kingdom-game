import Phaser from 'phaser';
import { Enemy } from './Waves.js';

// AI enemy faction (Phase 3). Builds a red kingdom on the far left, grows over
// time, and sends attack waves at the player. Its castle (500 HP) can be killed
// by clicking it, which halts the assault while the AI rebuilds.

const BUILD_EVERY = 45; // seconds between AI buildings
const WAVE_GAP = 30; // seconds the AI "regroups" between waves
const FIRST_WAVE = 18; // seconds before the first wave
const CASTLE_HP = 500;
const CLICK_DMG = 40; // damage per click on the AI castle
const REBUILD_TIME = 60; // seconds to rebuild after the castle falls

// Ranged enemy archer. Conforms to the enemy interface used by WaveManager,
// towers and warriors (x, y, alive, update, takeDamage, destroy).
export class AIArcher {
  constructor(scene, x, y) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.maxHp = 24;
    this.hp = this.maxHp;
    this.alive = true;
    this.range = 3 * scene.TILE;
    this.shootTimer = 0;
    this.spr = scene.add.sprite(x, y, 'red_archer_idle', 0).setScale(40 / 192).setDepth(8).setFlipX(true);
    if (scene.anims.exists('red_archer_idle')) this.spr.play('red_archer_idle');
    this._barW = 24;
    this.hpBarBg = scene.add.rectangle(x, y - 18, this._barW + 2, 5, 0x000000, 0.75).setDepth(9);
    this.hpBarFill = scene.add.rectangle(x - this._barW / 2, y - 18, this._barW, 3, 0x2ecc71).setOrigin(0, 0.5).setDepth(10);
  }

  nearestTarget() {
    let best = null;
    let bd = Infinity;
    const consider = (obj) => {
      if (!obj || !obj.alive) return;
      const d = Phaser.Math.Distance.Between(this.x, this.y, obj.x, obj.y);
      if (d < bd) {
        bd = d;
        best = obj;
      }
    };
    for (const b of this.scene.buildings.buildings) consider(b);
    for (const w of this.scene.troops.warriors) consider(w);
    return { target: best, dist: bd };
  }

  update(dt) {
    if (!this.alive) return;
    const { target, dist } = this.nearestTarget();
    if (!target) {
      this.sync();
      return;
    }
    if (dist > this.range) {
      // Advance toward the target.
      const ang = Math.atan2(target.y - this.y, target.x - this.x);
      this.x += Math.cos(ang) * 45 * dt;
      this.y += Math.sin(ang) * 45 * dt;
    } else {
      // In range: shoot for 8 dmg/sec.
      target.takeDamage(8 * dt);
      this.shootTimer += dt;
      if (this.shootTimer >= 0.7) {
        this.shootTimer = 0;
        this.scene.spawnArrow(this.x, this.y, target.x, target.y);
      }
    }
    this.sync();
  }

  takeDamage(amount) {
    this.hp -= amount;
    const pct = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    this.hpBarFill.width = this._barW * pct;
    this.hpBarFill.fillColor = pct > 0.5 ? 0x2ecc71 : pct > 0.25 ? 0xf1c40f : 0xe74c3c;
    if (this.hp <= 0) this.destroy();
  }

  sync() {
    this.spr.x = this.x;
    this.spr.y = this.y;
    this.hpBarBg.x = this.x;
    this.hpBarBg.y = this.y - 18;
    this.hpBarFill.x = this.x - this._barW / 2;
    this.hpBarFill.y = this.y - 18;
  }

  destroy() {
    this.alive = false;
    this.spr.destroy();
    this.hpBarBg.destroy();
    this.hpBarFill.destroy();
  }
}

export class AIKingdom {
  constructor(scene) {
    this.scene = scene;
    this.buildings = []; // { sprite, type }
    this.usedTiles = new Set();
    this.buildTimer = 0;
    this.waveTimer = FIRST_WAVE;
    this.waveNumber = 0;
    this.regrouping = true;
    this.rebuildTimer = 0;
    this.castleAlive = true;

    this.placeCastle();
  }

  get barracksCount() {
    return this.buildings.filter((b) => b.type === 'barracks').length;
  }

  placeCastle() {
    this.castleRow = Math.floor(this.scene.ROWS / 2);
    const { x, y } = this.scene.tileCenter(1, this.castleRow); // far left, vertically centered
    this.castleX = x;
    this.castleY = y;
    this.castleHp = CASTLE_HP;
    this.castleAlive = true;

    this.castleSpr = this.scene.add.image(x, y, 'enemy_castle').setDepth(5).setInteractive({ useHandCursor: true });
    const src = this.castleSpr.texture.getSourceImage();
    this.castleSpr.setScale(52 / Math.max(src.width, src.height));
    this.castleSpr.on('pointerdown', (p, lx, ly, ev) => {
      if (!p.leftButtonDown()) return; // right-click = send selected units to attack
      ev.stopPropagation();
      this.damageCastle(CLICK_DMG);
    });

    this.barW = 64;
    this.castleBarBg = this.scene.add.rectangle(x, y - 40, this.barW + 4, 10, 0x000000, 0.75).setDepth(11);
    this.castleBarFill = this.scene.add.rectangle(x - this.barW / 2, y - 40, this.barW, 7, 0xc0392b).setOrigin(0, 0.5).setDepth(12);
    this.castleLabel = this.scene.add.text(x, y - 52, 'ENEMY', { fontFamily: 'monospace', fontSize: '10px', color: '#ff8a80', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(12);
  }

  damageCastle(amount) {
    if (!this.castleAlive) return;
    this.castleHp = Math.max(0, this.castleHp - amount);
    const pct = this.castleHp / CASTLE_HP;
    this.castleBarFill.width = this.barW * pct;
    this.scene.tweens.add({ targets: this.castleSpr, scale: this.castleSpr.scale * 1.08, yoyo: true, duration: 80 });
    if (this.castleHp <= 0) this.fallCastle();
  }

  fallCastle() {
    this.castleAlive = false;
    this.regrouping = true;
    this.rebuildTimer = REBUILD_TIME;
    // The current assault stops: remove living AI enemies.
    for (const e of this.scene.waves.enemies) e.destroy();
    this.scene.waves.enemies.length = 0;
    this.castleSpr.setVisible(false);
    this.castleBarBg.setVisible(false);
    this.castleBarFill.setVisible(false);
    this.castleLabel.setText('REBUILDING');
    this.scene.floatText(this.castleX, this.castleY - 30, 'AI CASTLE DESTROYED!', '#ffd23f');
  }

  reviveCastle() {
    this.castleAlive = true;
    this.castleHp = CASTLE_HP;
    this.castleBarFill.width = this.barW;
    this.castleSpr.setVisible(true);
    this.castleBarBg.setVisible(true);
    this.castleBarFill.setVisible(true);
    this.castleLabel.setText('ENEMY');
    this.waveTimer = FIRST_WAVE;
  }

  addBuilding() {
    // Pick a free wilderness tile on the far left (cols 0-3).
    for (let a = 0; a < 40; a++) {
      const col = Phaser.Math.Between(0, 5);
      const row = Phaser.Math.Between(1, this.scene.ROWS - 2);
      const key = `${col},${row}`;
      if (this.usedTiles.has(key)) continue;
      if (col === 1 && row === this.castleRow) continue; // castle tile
      this.usedTiles.add(key);
      const type = Phaser.Utils.Array.GetRandom(['barracks', 'tower', 'house']);
      const texKey = { barracks: 'ai_barracks', tower: 'ai_tower', house: 'ai_house' }[type];
      const { x, y } = this.scene.tileCenter(col, row);
      const spr = this.scene.add.image(x, y, texKey).setDepth(5);
      const src = spr.texture.getSourceImage();
      spr.setScale(44 / Math.max(src.width, src.height));
      this.scene.tweens.add({ targets: spr, scale: spr.scale * 1.2, yoyo: true, duration: 140 });
      this.buildings.push({ sprite: spr, type });
      return;
    }
  }

  launchWave() {
    this.waveNumber += 1;
    this.regrouping = false;
    const count = Math.max(2, 2 * this.barracksCount);
    const hp = 30 + this.waveNumber * 8;
    for (let i = 0; i < count; i++) {
      const x = this.castleX + Phaser.Math.Between(-10, 30);
      const y = this.castleY + Phaser.Math.Between(-40, 40);
      this.scene.waves.enemies.push(new Enemy(this.scene, x, y, hp, 1));
    }
    // Mixed troops once the AI has 3+ barracks.
    if (this.barracksCount >= 3) {
      const archers = Math.max(1, Math.floor(this.barracksCount / 3));
      for (let i = 0; i < archers; i++) {
        const x = this.castleX + Phaser.Math.Between(-10, 30);
        const y = this.castleY + Phaser.Math.Between(-40, 40);
        this.scene.waves.enemies.push(new AIArcher(this.scene, x, y));
      }
    }
    this.scene.onWaveStart(this.waveNumber);
  }

  // Status string shown top-left.
  status() {
    if (!this.castleAlive) return `Enemy kingdom rebuilding... (${Math.ceil(this.rebuildTimer)}s)`;
    if (this.regrouping) return `Enemy kingdom is regrouping... (${Math.ceil(this.waveTimer)}s)`;
    return `Enemy assault! Wave ${this.waveNumber} incoming`;
  }

  update(dt) {
    // Rebuild after the castle falls.
    if (!this.castleAlive) {
      this.rebuildTimer -= dt;
      if (this.rebuildTimer <= 0) this.reviveCastle();
      return; // no building or waves while down
    }

    // Grow the kingdom.
    this.buildTimer += dt;
    if (this.buildTimer >= BUILD_EVERY) {
      this.buildTimer = 0;
      this.addBuilding();
    }

    // Send waves; "regroup" once the current wave is cleared.
    const aiEnemiesAlive = this.scene.waves.enemies.length > 0;
    if (this.regrouping) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this.launchWave();
    } else if (!aiEnemiesAlive) {
      this.regrouping = true;
      this.waveTimer = WAVE_GAP;
    }
  }
}
