import Phaser from 'phaser';
import { BuildingTypes, MAX_LEVEL, upgradeCost, outputMultiplier } from '../data/BuildingTypes.js';
import { sfx } from '../audio/SoundEngine.js';

// A single placed building: its visuals, HP, level and per-tick behaviour.
export class Building {
  scene: any;
  typeKey: string;
  type: any;
  col: number;
  row: number;
  level: number;
  maxHp: number;
  hp: number;
  alive: boolean;
  workers: number;
  x: number;
  y: number;
  rect: any;
  [key: string]: any;

  constructor(scene: any, typeKey: string, col: number, row: number) {
    this.scene = scene;
    this.typeKey = typeKey;
    this.type = BuildingTypes[typeKey];
    this.col = col;
    this.row = row;
    this.level = 1;
    this.maxHp = this.type.hp;
    this.hp = this.maxHp;
    this.prodTimer = 0; // seconds accumulated toward next production
    this.attackTimer = 0; // seconds accumulated toward next shot
    this.alive = true;
    this.slots = []; // barracks training slots: [{ type, timeLeft, total }] (Bug 4)
    this.workers = 0; // allocated workers (Phase 2)

    const { x, y } = scene.tileCenter(col, row);
    this.x = x;
    this.y = y;

    const size = 40;
    // (Phase 5) soft shadow at the base for depth.
    this.shadow = scene.add.ellipse(x, y + 16, 38, 14, 0x000000, 0.3).setDepth(4);
    // Real Tiny Swords sprite (texture key == typeKey). Scaled to sit neatly
    // inside the 48px tile while preserving the art's aspect ratio.
    this.rect = scene.add
      .image(x, y, this.type.tex || this.typeKey) // (Phase 5) tex override (Library reuses Mine art)
      .setDepth(5)
      .setInteractive({ useHandCursor: true });
    const src = this.rect.texture.getSourceImage();
    this.baseScale = 46 / Math.max(src.width, src.height);
    this.rect.setScale(this.baseScale);
    // Tiny random tilt + ±3px visual offset so buildings look hand-placed
    // (logic position stays on the grid at this.x/this.y).
    this.rect.setAngle(Phaser.Math.FloatBetween(-2, 2));
    this.rect.x += Phaser.Math.Between(-3, 3);
    this.rect.y += Phaser.Math.Between(-3, 3);
    this.rect.on('pointerdown', (p, lx, ly, ev) => {
      if (!p.leftButtonDown()) return; // right-click is reserved for unit move commands
      // (Bug 2 fix) While placing or moving a building, do NOT let this sprite
      // swallow the click — let it fall through to the world tile handler so the
      // 8 tiles around the (large) castle stay placeable.
      if (scene.placementType || scene.movingBuilding) return;
      ev.stopPropagation();
      scene.selectBuilding(this);
    });

    // HP bar above the building (small rectangle; the castle uses a sprite bar).
    this.hpBarBg = scene.add.rectangle(x, y - 26, size, 5, 0x000000, 0.6).setDepth(6);
    this.hpBar = scene.add
      .rectangle(x - size / 2, y - 26, size, 5, 0x2ecc71)
      .setOrigin(0, 0.5)
      .setDepth(7);
    this.hpBarWidth = size;

    // Level pip.
    this.levelText = scene.add
      .text(x + size / 2 - 2, y + size / 2 - 2, 'L1', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#ffff88',
      })
      .setOrigin(1, 1)
      .setDepth(7);

    // (Phase 2) Worker status indicator: red "!" if a production building has
    // no workers, green check if it does. Hidden for non-production buildings.
    if (this.type.maxWorkers > 0) {
      this.workerIcon = scene.add
        .text(x, y - 34, '!', { fontFamily: 'monospace', fontSize: '16px', fontStyle: 'bold', color: '#ff5252', stroke: '#000000', strokeThickness: 3 })
        .setOrigin(0.5)
        .setDepth(8);
      this.refreshWorkerIcon();
    }
  }

  refreshWorkerIcon() {
    if (!this.workerIcon) return;
    if (this.workers > 0) this.workerIcon.setText('✓').setColor('#5cff8a');
    else this.workerIcon.setText('!').setColor('#ff5252');
  }

  // Whole-number production. Called once per second by the manager.
  // (Bug 4) Soldiers are no longer auto-produced — the Barracks trains units
  // manually via its training slots, so 'soldiers' is skipped here.
  produce(resources: any, scene: any) {
    if (this.type.attack || !this.type.produces || this.type.produces === 'soldiers') return;
    // (Session-1 Phase 5) Tax revolt → workers strike, no production today.
    if (scene && scene._strikeUntil && scene.gameDay < scene._strikeUntil) return;
    // (Completion Phase 2) Manufacturing: consume a raw resource to make refined
    // goods. 1 worker = 1 output per 2 raw; 2 workers = 1 output per 1 raw.
    // Produced on a daily cadence (every ~DAY_SECONDS ticks) so rates read "/day".
    if (this.type.refineFrom) {
      if (this.workers <= 0) return;
      const period = (scene && scene.DAY_SECONDS) || 300;
      this.prodTimer += 1;
      if (this.prodTimer < period) return;
      this.prodTimer = 0;
      const rawPerUnit = this.workers >= 2 ? 1 : 2;
      const units = this.workers; // 1 or 2 refined goods per day
      let made = 0;
      for (let i = 0; i < units; i++) {
        if ((resources[this.type.refineFrom] || 0) < rawPerUnit) break;
        resources[this.type.refineFrom] -= rawPerUnit;
        resources.add(this.type.produces, 1);
        made++;
      }
      if (made > 0 && scene && scene.floatText) scene.floatText(this.x, this.y - 30, `+${made} ${this.type.produces === 'cutStone' ? 'cut stone' : 'planks'}`, '#c9a86a');
      return;
    }
    const interval = this.type.interval || 1;
    this.prodTimer += 1;
    if (this.prodTimer < interval) return;
    this.prodTimer = 0;
    let rate = this.currentOutput();
    // (Expansion Phase 5) happiness scales worker output (+10% happy / -20% / strike).
    if (scene && scene.population && this.type.maxWorkers > 0) rate *= scene.population.prodMult;
    // (Expansion Phase 3) seasonal farm modifier (autumn +25%, summer -10%).
    if (scene && this.typeKey === 'farm' && scene._seasonFarmMult) rate *= scene._seasonFarmMult;
    // (Expansion Phase 5) research: Advanced Farming / Mining Techniques.
    if (scene && this.typeKey === 'farm' && scene._researchFarmMult) rate *= scene._researchFarmMult;
    // (Session-1 Phase 3) Temporary event modifier on farm output (e.g. drought).
    if (scene && this.typeKey === 'farm' && scene._eventFarmMult) rate *= scene._eventFarmMult;
    if (scene && this.typeKey === 'mine' && scene._researchMineMult) rate *= scene._researchMineMult;
    // (Expansion Phase 4) Merchant trait: +15% Castle gold.
    if (scene && this.typeKey === 'castle' && scene.traitBonuses && scene.traitBonuses.goldMult) rate *= scene.traitBonuses.goldMult;
    // (Session-1 Phase 5) Tax rate scales Castle gold income.
    if (scene && this.typeKey === 'castle' && this.type.produces === 'gold' && scene._goldTaxMult) rate *= scene._goldTaxMult;
    // (Loop 3, Feature #3) Level 5 perks on the producers.
    if (this.typeKey === 'lumberyard' && this.level >= 5) rate *= 1.25; // L5: surplus output
    if (rate > 0) resources.add(this.type.produces, rate);
    // (Feature #3) Mine L4+: occasionally finds iron ore without an expedition.
    if (scene && this.typeKey === 'mine' && this.level >= 4 && this.workers > 0 && Math.random() < 0.10) {
      resources.add('iron', 1);
      if (scene.floatText) scene.floatText(this.x, this.y - 30, '+1 iron', '#9fb8d8');
    }
  }

  // (Completion Phase 2) High-tier upgrades also require refined goods, so the
  // Sawmill/Stonecutter become necessary mid-game. Keyed by the TARGET level.
  extraUpgradeCost(): Record<string, number> {
    const next = this.level + 1;
    const c: Record<string, number> = {};
    if (this.typeKey === 'barracks' && next === 4) c.planks = 20;
    if (this.typeKey === 'barracks' && next === 5) c.planks = 30;
    if (this.typeKey === 'library' || this.typeKey === 'market') c.planks = 10;
    return c;
  }

  // Building upgrades cost GOLD (+ refined goods at higher tiers).
  canUpgrade(resources: any): boolean {
    if (this.level >= MAX_LEVEL || resources.gold < this.nextUpgradeCost()) return false;
    const extra = this.extraUpgradeCost();
    for (const [r, amt] of Object.entries(extra)) if ((resources[r] || 0) < amt) return false;
    return true;
  }

  nextUpgradeCost(): number {
    return upgradeCost(this.type, this.level);
  }

  upgrade(resources: any): boolean {
    if (!this.canUpgrade(resources)) return false;
    resources.gold -= this.nextUpgradeCost();
    const extra = this.extraUpgradeCost();
    for (const [r, amt] of Object.entries(extra)) resources[r] -= amt;
    this.level += 1;
    this.maxHp = Math.round(this.type.hp * (1 + (this.level - 1) * 0.5));
    this.hp = this.maxHp;
    this.levelText.setText('L' + this.level);
    this.refreshHpBar();
    this.scene.tweens.add({ targets: this.rect, scale: this.baseScale * 1.3, yoyo: true, duration: 120 });
    return true;
  }

  currentOutput() {
    const mult = outputMultiplier(this.level);
    if (this.type.attack) return this.type.damage * mult;
    // Production scales with allocated workers; non-worker producers (castle)
    // use their flat base rate and are always on.
    if (this.type.maxWorkers > 0 && this.type.workerRates) {
      return (this.type.workerRates[this.workers] || 0) * mult;
    }
    return (this.type.rate || 0) * mult;
  }

  takeDamage(amount) {
    this.hp -= amount;
    this.refreshHpBar();
    if (this.hp <= 0) {
      this.hp = 0;
      this.destroy();
    }
  }

  refreshHpBar() {
    const pct = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    this.hpBar.width = this.hpBarWidth * pct;
    const color = pct > 0.5 ? 0x2ecc71 : pct > 0.25 ? 0xf1c40f : 0xe74c3c;
    this.hpBar.fillColor = color;
  }

  destroy() {
    this.alive = false;
    sfx.play('building_destroyed'); // (Polish Phase 2)
    if (this.scene.explosionAt) this.scene.explosionAt(this.x, this.y); // Phase 5 FX
    this.shadow.destroy();
    this.rect.destroy();
    this.hpBar.destroy();
    this.hpBarBg.destroy();
    this.levelText.destroy();
    if (this.workerIcon) this.workerIcon.destroy();
  }
}

// Owns the placement grid, worker accounting and all building updates.
export class BuildingManager {
  scene: any;
  cols: number;
  rows: number;
  buildings: any[];
  grid: any[][];
  castle: any;
  [key: string]: any;

  constructor(scene: any, cols: number, rows: number) {
    this.scene = scene;
    this.cols = cols;
    this.rows = rows;
    this.buildings = [];
    this.grid = Array.from({ length: rows }, () => Array(cols).fill(null));
    this.castle = null;
  }

  isOccupied(col, row) {
    return this.grid[row][col] !== null;
  }

  countOfType(typeKey) {
    return this.buildings.filter((b) => b.typeKey === typeKey).length;
  }

  // Placeable buildings count toward the settlement building cap (castle and
  // no-cap structures like Walls excluded).
  placedCount() {
    return this.buildings.filter((b) => b.typeKey !== 'castle' && !b.type.noCap).length;
  }

  // Sum of workers ALLOCATED to buildings (Phase 2 manual allocation).
  workersUsed() {
    return this.buildings.reduce((sum, b) => sum + (b.workers || 0), 0);
  }

  // (Save system) Recompute the worker cap from scratch (base 3 + Houses), so a
  // load that re-places Houses doesn't double-count the cap they already granted.
  refreshWorkerCap() {
    let cap = 3; // matches Resources constructor base
    for (const b of this.buildings) if (b.alive && b.type.capIncrease) cap += b.type.capIncrease;
    this.scene.resources.workersCap = cap;
  }

  // (Save system) Every building's placement + state (castle separate).
  serialize() {
    return this.buildings.filter((b) => b.alive).map((b) => ({
      type: b.typeKey, col: b.col, row: b.row, level: b.level || 1,
      hp: Math.round(b.hp), workers: b.workers || 0,
      recruitCd: b._recruitCd || 0,
    }));
  }

  availableWorkers(resources) {
    return resources.workersCap - this.workersUsed();
  }

  // Validate a build attempt. Returns { ok, reason }.
  canPlace(typeKey: string, resources: any, maxBuildings: number): { ok: boolean; reason?: string } {
    const type = BuildingTypes[typeKey];
    if (this.placedCount() >= maxBuildings) {
      return { ok: false, reason: 'Upgrade your settlement to build more' };
    }
    if (type.maxCount && this.countOfType(typeKey) >= type.maxCount) {
      return { ok: false, reason: `Max ${type.maxCount} ${type.name}s reached` };
    }
    if (!resources.canAfford(type.cost)) {
      return { ok: false, reason: 'Not enough resources' };
    }
    // (Phase 2) Buildings no longer require free workers to place — they are
    // built idle, then the player assigns workers to activate them.
    return { ok: true };
  }

  // (Audit FIX 8) Stage-gating is enforced here as well as in the build palette,
  // so no caller (or future code path) can place a tier-locked building early.
  // `opts.ignoreStage` lets save-load and the Scholar starting Library bypass it,
  // since those are authoritative placements.
  place(typeKey: string, col: number, row: number, opts: any = {}) {
    if (this.isOccupied(col, row)) return null;
    const type = BuildingTypes[typeKey];
    if (!opts.ignoreStage && type && type.stageUnlock && this.scene.currentStage && this.scene.currentStage() < type.stageUnlock) {
      const reqTier = this.scene.TIERS && this.scene.TIERS.find((t) => t.stage >= type.stageUnlock);
      const stageName = reqTier ? reqTier.name : `stage ${type.stageUnlock}`;
      if (this.scene.showToast) this.scene.showToast(`${type.name} requires ${stageName}`);
      return null;
    }
    const b = new Building(this.scene, typeKey, col, row);
    this.grid[row][col] = b;
    this.buildings.push(b);
    if (typeKey === 'castle') this.castle = b;
    // Houses raise the population cap.
    if (b.type.capIncrease) this.scene.resources.workersCap += b.type.capIncrease;
    return b;
  }

  remove(building) {
    this.grid[building.row][building.col] = null;
    this.buildings = this.buildings.filter((b) => b !== building);
    // Destroying a House lowers the population cap again.
    if (building.type.capIncrease) {
      this.scene.resources.workersCap = Math.max(0, this.scene.resources.workersCap - building.type.capIncrease);
    }
  }

  // Boolean obstacle grid for pathfinding (every building blocks).
  blockedGrid() {
    return this.grid.map((row) => row.map((cell) => cell !== null));
  }

  // Called once per second to generate resources / train soldiers.
  tick(resources, scene) {
    for (const b of this.buildings) b.produce(resources, scene);
  }

  // Called every frame; towers acquire and shoot the nearest enemy in range.
  updateTowers(dt, enemies) {
    for (const b of this.buildings) {
      if (!b.type.attack || !b.alive) continue;
      if (b.workers <= 0) continue; // (Phase 2) a Tower needs a worker to fire
      b.attackTimer += dt;
      if (b.attackTimer < b.type.attackInterval) continue;

      const rangePx = b.type.range * this.scene.TILE;
      let target = null;
      let best = Infinity;
      for (const e of enemies) {
        if (!e.alive) continue;
        const d = Phaser.Math.Distance.Between(b.x, b.y, e.x, e.y);
        if (d <= rangePx && d < best) {
          best = d;
          target = e;
        }
      }
      if (target) {
        b.attackTimer = 0;
        target.takeDamage(b.currentOutput());
        this.scene.spawnShot(b.x, b.y, target.x, target.y);
      }
    }
  }

  reap() {
    let changed = false;
    for (const b of [...this.buildings]) {
      if (!b.alive) {
        this.remove(b);
        changed = true;
      }
    }
    return changed;
  }
}
