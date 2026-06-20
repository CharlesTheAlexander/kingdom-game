import Phaser from 'phaser';
import { Enemy } from './Waves.js';

// AI enemy factions (Phase 3, extended to several kingdoms in Phase 6).
// Each kingdom builds independently on its own corner of the map, grows over
// time, and sends attack waves at the player. A shared wave coordinator
// (scene.waveCoord) ensures only ONE kingdom attacks at a time, with a cooldown
// between different kingdoms' waves. Castles (500 HP) can be clicked to destroy,
// forcing that kingdom to rebuild.

const CASTLE_HP = 500;
const CLICK_DMG = 40;     // damage per click on an enemy castle
const REBUILD_TIME = 60;  // seconds to rebuild after a castle falls
const GLOBAL_GAP = 12;    // seconds of calm between two different kingdoms' waves

// Per-faction configuration. tile = castle tile; build* = where it expands;
// zoneTint = the light territory wash colour.
// (Phase B) On the 200x200 map the kingdoms sit in the far corners, 80+ tiles
// from the player's centre start, and stay passive for the first several days.
export const FACTIONS = {
  red: {
    key: 'red', name: 'Red Kingdom', color: 0xc0392b, labelColor: '#ff8a80', zoneTint: 0xffc2c2,
    tile: { col: 12, row: 100 }, buildCols: [4, 24], buildRows: [88, 112],
    startDay: 12, buildEvery: 45, waveGap: 30, firstWave: 18,
    countMul: 1.0, hpMul: 1.0, buildMix: ['barracks', 'tower', 'house'],
    tex: { castle: 'enemy_castle', barracks: 'ai_barracks', tower: 'ai_tower', house: 'ai_house' },
    warrior: { idle: 'warrior_idle', run: 'red_warrior_run' },
  },
  purple: {
    key: 'purple', name: 'Purple Kingdom', color: 0x8e44ad, labelColor: '#d6a4ff', zoneTint: 0xe2c2ff,
    tile: { col: 185, row: 15 }, buildCols: [168, 194], buildRows: [5, 28],
    startDay: 18, buildEvery: 35, waveGap: 45, firstWave: 30, // passive: economy first, small frequent raids
    countMul: 0.7, hpMul: 1.1, buildMix: ['house', 'house', 'tower', 'barracks'],
    tex: { castle: 'purple_castle', barracks: 'purple_barracks', tower: 'purple_tower', house: 'purple_house' },
    warrior: { idle: 'purple_warrior_idle', run: 'purple_warrior_run' },
  },
  yellow: {
    key: 'yellow', name: 'Yellow Kingdom', color: 0xf1c40f, labelColor: '#ffe066', zoneTint: 0xfff0b0,
    tile: { col: 185, row: 185 }, buildCols: [168, 194], buildRows: [178, 195],
    startDay: 8, buildEvery: 30, waveGap: 22, firstWave: 24, // aggressive: army fast, big fragile waves
    countMul: 1.5, hpMul: 0.7, buildMix: ['barracks', 'barracks', 'tower'],
    tex: { castle: 'yellow_castle', barracks: 'yellow_barracks', tower: 'yellow_tower', house: 'yellow_house' },
    warrior: { idle: 'yellow_warrior_idle', run: 'yellow_warrior_run' },
  },
};

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
      const ang = Math.atan2(target.y - this.y, target.x - this.x);
      this.x += Math.cos(ang) * 45 * dt;
      this.y += Math.sin(ang) * 45 * dt;
    } else {
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
    this.spr.setTintFill(0xff3333); // (Phase 7) hit flash
    this.scene.time.delayedCall(70, () => { if (this.alive) this.spr.clearTint(); });
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
    if (!this.alive) return;
    this.alive = false;
    if (this.scene.dustAt) this.scene.dustAt(this.x, this.y);
    this.hpBarBg.destroy();
    this.hpBarFill.destroy();
    this.spr.clearTint();
    this.scene.tweens.add({ targets: this.spr, alpha: 0, duration: 450, onComplete: () => this.spr.destroy() });
  }
}

export class AIKingdom {
  constructor(scene, cfg = FACTIONS.red) {
    this.scene = scene;
    this.cfg = cfg;
    this.buildings = []; // { sprite, type }
    this.usedTiles = new Set();
    this.buildTimer = 0;
    this.waveTimer = cfg.firstWave;
    this.waveNumber = 0;
    this.regrouping = true;
    this.rebuildTimer = 0;
    this.castleAlive = true;
    this.startDay = cfg.startDay;

    this.placeCastle();
    this.addBuilding(); // (Phase B) each kingdom starts with its castle + 2 buildings
    this.addBuilding();
  }

  get barracksCount() {
    return this.buildings.filter((b) => b.type === 'barracks').length;
  }

  // My enemies currently alive on the shared enemy list.
  liveEnemies() {
    return this.scene.waves.enemies.filter((e) => e.faction === this);
  }

  // Rough army estimate for the kingdom status panel.
  estimatedArmy() {
    return Math.max(2, this.barracksCount * 2) + this.liveEnemies().length;
  }

  placeCastle() {
    const t = this.cfg.tile;
    this.castleCol = t.col;
    this.castleRow = t.row;
    const { x, y } = this.scene.tileCenter(t.col, t.row);
    this.castleX = x;
    this.castleY = y;
    this.castleHp = CASTLE_HP;
    this.castleAlive = true;

    this.castleSpr = this.scene.add.image(x, y, this.cfg.tex.castle).setDepth(5).setInteractive({ useHandCursor: true });
    const src = this.castleSpr.texture.getSourceImage();
    this.castleSpr.setScale(52 / Math.max(src.width, src.height));
    this.castleSpr.on('pointerdown', (p, lx, ly, ev) => {
      if (!p.leftButtonDown()) return; // right-click = send selected units to attack
      ev.stopPropagation();
      this.damageCastle(CLICK_DMG);
    });

    this.barW = 64;
    this.castleBarBg = this.scene.add.rectangle(x, y - 40, this.barW + 4, 10, 0x000000, 0.75).setDepth(11);
    this.castleBarFill = this.scene.add.rectangle(x - this.barW / 2, y - 40, this.barW, 7, this.cfg.color).setOrigin(0, 0.5).setDepth(12);
    this.castleLabel = this.scene.add.text(x, y - 52, this.cfg.name.toUpperCase().replace(' KINGDOM', ''), { fontFamily: 'monospace', fontSize: '10px', color: this.cfg.labelColor, fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(12);
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
    // This kingdom's assault stops: remove only ITS living enemies.
    for (const e of this.liveEnemies()) e.destroy();
    this.scene.waves.enemies = this.scene.waves.enemies.filter((e) => e.alive);
    if (this.scene.waveCoord && this.scene.waveCoord.holder === this) {
      this.scene.waveCoord.holder = null;
      this.scene.waveCoord.cooldown = GLOBAL_GAP;
    }
    this.castleSpr.setVisible(false);
    this.castleBarBg.setVisible(false);
    this.castleBarFill.setVisible(false);
    this.castleLabel.setText('REBUILDING');
    this.castleLabel.setVisible(true);
    this.scene.floatText(this.castleX, this.castleY - 30, `${this.cfg.name} castle destroyed!`, '#ffd23f');
    if (this.scene.territory) this.scene.territory.recompute();
  }

  reviveCastle() {
    this.castleAlive = true;
    this.castleHp = CASTLE_HP;
    this.castleBarFill.width = this.barW;
    this.castleSpr.setVisible(true);
    this.castleBarBg.setVisible(true);
    this.castleBarFill.setVisible(true);
    this.castleLabel.setText(this.cfg.name.toUpperCase().replace(' KINGDOM', ''));
    this.waveTimer = this.cfg.firstWave;
    if (this.scene.territory) this.scene.territory.recompute();
  }

  addBuilding() {
    const [c0, c1] = this.cfg.buildCols;
    const [r0, r1] = this.cfg.buildRows;
    for (let a = 0; a < 40; a++) {
      const col = Phaser.Math.Between(c0, c1);
      const row = Phaser.Math.Between(r0, r1);
      const key = `${col},${row}`;
      if (this.usedTiles.has(key)) continue;
      if (col === this.castleCol && row === this.castleRow) continue;
      if (this.scene.isBuildZone && this.scene.isBuildZone(col, row)) continue;
      if (this.scene.terrainType && this.scene.terrainType[row][col] === 'water') continue;
      this.usedTiles.add(key);
      const type = Phaser.Utils.Array.GetRandom(this.cfg.buildMix);
      const texKey = this.cfg.tex[type];
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
    const count = Math.max(2, Math.round(2 * this.barracksCount * this.cfg.countMul));
    // (Expansion Phase 2) March a visible army from the AI castle instead of
    // edge-spawning loose units. Falls back to the legacy spawn if unavailable.
    if (this.scene.spawnAIArmyAttack) {
      const archers = this.barracksCount >= 3 ? Math.max(1, Math.floor(this.barracksCount / 3)) : 0;
      this.scene.spawnAIArmyAttack(this, { warrior: count, archer: archers });
      return;
    }
    const hp = Math.round((30 + this.waveNumber * 8) * this.cfg.hpMul);
    for (let i = 0; i < count; i++) {
      const x = this.castleX + Phaser.Math.Between(-10, 30);
      const y = this.castleY + Phaser.Math.Between(-40, 40);
      const e = new Enemy(this.scene, x, y, hp, 1, this.cfg.warrior);
      e.faction = this;
      this.scene.waves.enemies.push(e);
    }
    if (this.barracksCount >= 3) {
      const archers = Math.max(1, Math.floor(this.barracksCount / 3));
      for (let i = 0; i < archers; i++) {
        const x = this.castleX + Phaser.Math.Between(-10, 30);
        const y = this.castleY + Phaser.Math.Between(-40, 40);
        const a = new AIArcher(this.scene, x, y);
        a.faction = this;
        this.scene.waves.enemies.push(a);
      }
    }
    if (this.scene.onKingdomAttack) this.scene.onKingdomAttack(this);
  }

  // One-word status for the kingdoms panel.
  statusWord() {
    if (!this.castleAlive) return 'Destroyed';
    if (this.scene.waveCoord && this.scene.waveCoord.holder === this) return 'Active';
    if (this.scene.gameDay < this.startDay) return 'Building';
    return 'Regrouping';
  }

  status() {
    if (!this.castleAlive) return `${this.cfg.name} rebuilding... (${Math.ceil(this.rebuildTimer)}s)`;
    if (this.scene.waveCoord && this.scene.waveCoord.holder === this) return `${this.cfg.name} assault! Wave ${this.waveNumber}`;
    if (this.scene.gameDay < this.startDay) return `${this.cfg.name} is growing (attacks day ${this.startDay})`;
    return `${this.cfg.name} is regrouping...`;
  }

  update(dt) {
    // Rebuild after the castle falls.
    if (!this.castleAlive) {
      this.rebuildTimer -= dt;
      if (this.rebuildTimer <= 0) this.reviveCastle();
      return;
    }

    // Grow the kingdom.
    this.buildTimer += dt;
    if (this.buildTimer >= this.cfg.buildEvery) {
      this.buildTimer = 0;
      this.addBuilding();
    }

    const coord = this.scene.waveCoord;
    if (coord && coord.holder === this) {
      // I'm attacking: once my wave is cleared, release the lock + regroup.
      if (this.liveEnemies().length === 0) {
        coord.holder = null;
        coord.cooldown = GLOBAL_GAP;
        this.regrouping = true;
        this.waveTimer = this.cfg.waveGap;
      }
      return;
    }

    // Want to attack? Only if it's my time, the lock is free and off cooldown,
    // and diplomacy permits it (a non-aggression pact / alliance stops attacks).
    const diploOk = !this.scene.diplomacy || this.scene.diplomacy.attackModifier(this) > 0;
    this.waveTimer -= dt;
    if (this.waveTimer <= 0 && this.scene.gameDay >= this.startDay && diploOk && coord && coord.holder === null && coord.cooldown <= 0) {
      coord.holder = this;
      this.launchWave();
    }
  }
}
