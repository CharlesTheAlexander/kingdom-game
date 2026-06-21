import Phaser from 'phaser';

// ArmyManager.js — (Expansion) Bannerlord-style armies on the map.
//
// Troops can be organised into named Armies that exist as icons on the iso map.
// Player armies are formed from the unassigned troop pool; AI armies (Phase 2)
// march from their castle toward the player. Armies march across terrain (speed
// varies by biome), carry food supply, and have morale that feeds the BattleScene.

const UNIT_HP: Record<string, number> = { warrior: 50, archer: 40, monk: 30, knight: 120, mercenary: 50, siege: 80 };
const FACTION_COLOR: Record<string, number> = { player: 0x3a7bd5, red: 0xd64a4a, purple: 0xa45ad6, yellow: 0xd6c04a };
const MARCH_SPEED: Record<string, number> = { plains: 3, start: 3, middle: 3, delta: 3, forest: 1.5, mountains: 1, wildlands: 2 }; // tiles per game-hour
const DAY_MS = 300000;

export class ArmyManager {
  scene: any;
  armies: any[];
  _idc: number;
  selected: any;
  maxPlayerArmies: number;
  [key: string]: any;

  constructor(scene: any) {
    this.scene = scene;
    this.armies = [];
    this._idc = 0;
    this.selected = null;
    this.maxPlayerArmies = (scene.traitBonuses && scene.traitBonuses.armyCap) || 3;
  }

  playerArmies() { return this.armies.filter((a) => a.faction === 'player'); }
  aiArmies() { return this.armies.filter((a) => a.faction !== 'player'); }
  byId(id) { return this.armies.find((a) => a.id === id); }

  // --- the unassigned troop pool (units not in any army) -------------------
  availableUnits() {
    const t = this.scene.troops;
    const w = t.warriors.filter((u) => !u.knight && !u.mercenary && !u.siege).length;
    return {
      warrior: w,
      knight: t.warriors.filter((u) => u.knight).length,
      mercenary: t.warriors.filter((u) => u.mercenary).length,
      siege: t.warriors.filter((u) => u.siege).length,
      archer: t.archers.length,
      monk: t.monks.length,
    };
  }

  // Remove `count` units of `type` from the live troop pool (they join an army).
  takeFromPool(type, count) {
    const t = this.scene.troops;
    let taken = 0;
    const kill = (u) => { u.alive = false; if (u.spr) u.spr.destroy(); if (u.label) u.label.destroy(); if (u.selRing) u.selRing.destroy(); };
    if (type === 'archer') { while (taken < count && t.archers.length) { kill(t.archers.pop()); taken++; } }
    else if (type === 'monk') { while (taken < count && t.monks.length) { kill(t.monks.pop()); taken++; } }
    else {
      const match = (u: any) => (type === 'knight' ? u.knight : type === 'mercenary' ? u.mercenary : type === 'siege' ? u.siege : !u.knight && !u.mercenary && !u.siege);
      for (let i = t.warriors.length - 1; i >= 0 && taken < count; i--) if (match(t.warriors[i])) { kill(t.warriors.splice(i, 1)[0]); taken++; }
    }
    return taken;
  }

  // Return an army's units to the castle pool (disband / partial).
  returnToPool(units) {
    const c = this.scene.buildings.castle; if (!c) return;
    for (const u of units) for (let i = 0; i < u.count; i++) {
      if (u.type === 'archer') this.scene.troops.spawnArcher(c);
      else if (u.type === 'monk') this.scene.troops.spawnMonk(c);
      else if (u.type === 'knight' && this.scene.troops.spawnKnight) this.scene.troops.spawnKnight(c);
      else if (u.type === 'mercenary' && this.scene.troops.spawnMercenary) this.scene.troops.spawnMercenary();
      else if (u.type === 'siege' && this.scene.troops.spawnSiege) this.scene.troops.spawnSiege(c);
      else this.scene.troops.spawnAt(c.x + Phaser.Math.Between(-30, 30), c.y + Phaser.Math.Between(20, 40));
    }
  }

  // --- formation -----------------------------------------------------------
  formArmy(spec: any, name?: string) {
    if (this.playerArmies().length >= this.maxPlayerArmies) { this.scene.showToast(`Army limit reached (${this.maxPlayerArmies})`); return null; }
    const units: any[] = [];
    let total = 0;
    for (const [type, want] of Object.entries(spec)) {
      if (!want) continue;
      const got = this.takeFromPool(type, want);
      if (got > 0) { units.push({ type, count: got, hp: UNIT_HP[type] || 50, maxHp: UNIT_HP[type] || 50 }); total += got; }
    }
    if (total === 0) { this.scene.showToast('Add at least one unit'); return null; }
    const c = this.scene.buildings.castle;
    const food = this.scene.resources.food;
    const supplyFood = Math.min(food * 0.3, total * 5);
    this.scene.resources.food = Math.max(0, food - supplyFood);
    const army = {
      id: 'army_' + (++this._idc), name: name || `Army ${this.playerArmies().length + 1}`, faction: 'player', units,
      col: c.col + 2, row: c.row + 2, state: 'idle', marchTargetCol: null, marchTargetRow: null, marchProgress: 0,
      garrisonSettlementId: null, morale: 75, supplyDays: total > 0 ? Math.floor(supplyFood / total) : 0, sprite: null,
      attackTarget: null,
    };
    this.armies.push(army);
    this.makeIcon(army);
    this.scene.logEvent && this.scene.logEvent(`Formed ${army.name} (${total} units)`, 'info');
    return army;
  }

  // Create an AI army at a position (Phase 2).
  // (BUG 4) Hard cap on units in a single AI army.
  aiArmiesFor(faction) { return this.armies.filter((a) => a.faction === faction); }
  spawnAIArmy(faction, col, row, unitCounts, name) {
    // (BUG 4) Cap each AI army at 15 units total.
    let budget = 15;
    const units: any[] = [];
    for (const [type, n] of Object.entries(unitCounts) as [string, number][]) {
      if (n <= 0 || budget <= 0) continue;
      const count = Math.min(n, budget); budget -= count;
      units.push({ type, count, hp: UNIT_HP[type] || 50, maxHp: UNIT_HP[type] || 50 });
    }
    // (BUG 3) Never form a 0-unit army.
    if (!units.length || units.reduce((s, u) => s + u.count, 0) <= 0) return null;
    const army = { id: 'army_' + (++this._idc), name: name || (faction + ' army'), faction, units, col, row, state: 'idle', marchTargetCol: null, marchTargetRow: null, marchProgress: 0, garrisonSettlementId: null, morale: 75, supplyDays: 99, sprite: null, attackTarget: null, _warned: false };
    this.armies.push(army);
    this.makeIcon(army);
    return army;
  }

  totalUnits(army) { return army.units.reduce((s, u) => s + u.count, 0); }

  // (Phase 2) Rebuild an army's roster from a BattleScene survivor list [{type,count}].
  setUnitsFromBattle(army, resArmy) {
    army.units = (resArmy || []).filter((g) => g.count > 0).map((g) => ({ type: g.type, count: g.count, hp: UNIT_HP[g.type] || 50, maxHp: UNIT_HP[g.type] || 50 }));
  }

  disband(army) {
    if (army.faction === 'player') this.returnToPool(army.units);
    this.removeArmy(army);
    this.scene.logEvent && this.scene.logEvent(`${army.name} disbanded`, 'info');
  }

  removeArmy(army) {
    if (this.selected === army) this.selected = null;
    if (army.sprite) army.sprite.destroy();
    if (army._ring) army._ring.destroy();
    if (army._path) army._path.destroy();
    if (army._eta) army._eta.destroy();
    this.armies = this.armies.filter((a) => a !== army);
  }

  // --- movement ------------------------------------------------------------
  marchTo(army: any, col: number, row: number, opts: any = {}) {
    army.marchTargetCol = col; army.marchTargetRow = row;
    army.state = opts.garrison ? 'garrisoning' : opts.returning ? 'returning' : 'marching';
    army.attackTarget = opts.attackTarget || null;
    army.garrisonSettlementId = opts.garrison || null;
  }

  stopMarch(army) { army.marchTargetCol = null; army.marchTargetRow = null; army.state = 'idle'; army.attackTarget = null; if (army._path) { army._path.clear(); } if (army._eta) army._eta.setVisible(false); }

  speedAt(col: number, row: number) {
    // (Completion Phase 5) Roads are the fastest path across any terrain.
    if (this.scene.roads && this.scene.roads.has(col, row)) return 4;
    let b = 'plains';
    try { b = this.scene.biomeAt(Math.round(col), Math.round(row)) || 'plains'; } catch (e) {}
    return MARCH_SPEED[b] || 2;
  }

  etaDays(army) {
    if (army.marchTargetCol == null) return 0;
    const d = Phaser.Math.Distance.Between(army.col, army.row, army.marchTargetCol, army.marchTargetRow);
    const sp = this.speedAt(army.col, army.row);
    return d / sp / 24; // hours→days
  }

  // Called every frame with the scaled game-delta (ms).
  update(gdeltaMs) {
    const hours = (gdeltaMs / DAY_MS) * 24;
    for (const army of this.armies) {
      // (BUG 5) Mid-march AI armies pause for a few days after a save load.
      if (army._resumeDay && (this.scene.gameDay || 0) < army._resumeDay) continue;
      if (army.marchTargetCol != null) {
        const dc = army.marchTargetCol - army.col, dr = army.marchTargetRow - army.row;
        const dist = Math.hypot(dc, dr);
        const step = this.speedAt(army.col, army.row) * hours;
        if (dist <= step || dist < 0.05) {
          army.col = army.marchTargetCol; army.row = army.marchTargetRow;
          this.onArrive(army);
        } else {
          army.col += (dc / dist) * step; army.row += (dr / dist) * step;
        }
      }
    }
    this.updateIcons();
    if (this.scene.armiesOnInterceptCheck) this.scene.armiesOnInterceptCheck();
  }

  onArrive(army) {
    const prevState = army.state;
    army.marchTargetCol = null; army.marchTargetRow = null;
    if (prevState === 'garrisoning' && army.garrisonSettlementId) { army.state = 'garrisoning'; }
    else army.state = 'idle';
    if (army._path) army._path.clear();
    if (army._eta) army._eta.setVisible(false);
    // Phase 2 hands off combat on arrival at a hostile target.
    if (this.scene.onArmyArrive) this.scene.onArmyArrive(army);
  }

  // --- supply + morale (daily) --------------------------------------------
  onNewDay() {
    const castle = this.scene.buildings.castle;
    for (const army of this.playerArmies()) {
      const total = this.totalUnits(army);
      const home = castle && Math.abs(army.col - castle.col) < 4 && Math.abs(army.row - castle.row) < 4;
      if (!home && army.state !== 'garrisoning') {
        army.supplyDays -= 1;
        if (army.supplyDays < 0) { army.supplyDays = 0; army.morale = Math.max(0, army.morale - 5); }
      } else if (army.supplyDays < total * 5 / Math.max(1, total)) {
        // resting at home slowly resupplies
        army.supplyDays = Math.min(5, army.supplyDays + 1);
      }
      if (army.morale <= 20 && !home && army.state !== 'returning') {
        this.marchTo(army, castle.col + 2, castle.row + 2, { returning: true });
        this.scene.logEvent && this.scene.logEvent(`${army.name} is retreating — morale collapsed`, 'red');
      }
    }
  }

  sendSupplies(army) {
    const total = this.totalUnits(army);
    const cost = total * 5;
    if (this.scene.resources.food < cost) { this.scene.showToast(`Need ${cost} food`); return; }
    this.scene.resources.food -= cost;
    army.supplyDays += 5;
    army.morale = Math.min(100, army.morale + 3);
    this.scene.showToast(`Supplies sent to ${army.name}`);
  }

  addMorale(army, d) { army.morale = Math.max(0, Math.min(100, army.morale + d)); }

  // --- icons ---------------------------------------------------------------
  makeIcon(army) {
    const s = this.scene;
    const p = s.tileCenter(army.col, army.row);
    const cont = s.add.container(p.x, p.y).setDepth(9999);
    const g = s.add.graphics();
    const count = s.add.text(0, -3, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
    const dot = s.add.graphics();
    const name = s.add.text(0, 22, army.name, { fontFamily: 'monospace', fontSize: '11px', color: '#ffffff', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
    cont.add([g, dot, count, name]);
    army.sprite = cont; army._g = g; army._count = count; army._dot = dot; army._name = name;
    // Player army icons are clickable to select.
    g.setInteractive(new Phaser.Geom.Circle(0, 0, 20), Phaser.Geom.Circle.Contains);
    g.on('pointerdown', (pt, lx, ly, ev) => { if (ev) ev.stopPropagation(); if (army.faction === 'player') this.selectArmy(army); });
    this.drawIcon(army);
  }

  drawIcon(army) {
    const g = army._g; g.clear();
    const col = FACTION_COLOR[army.faction] || 0x888888;
    g.fillStyle(col, 1); g.lineStyle(2, 0xffffff, 0.9);
    g.beginPath(); g.moveTo(0, -16); g.lineTo(14, 0); g.lineTo(0, 16); g.lineTo(-14, 0); g.closePath(); g.fillPath(); g.strokePath();
    army._count.setText('' + this.totalUnits(army));
    const m = army.morale, mc = m >= 60 ? 0x4ad66b : m >= 30 ? 0xe6c84a : 0xd64a4a;
    army._dot.clear(); army._dot.fillStyle(mc, 1).fillCircle(0, 10, 3.5);
  }

  selectArmy(army) {
    this.selected = army;
    if (!army._ring) { army._ring = this.scene.add.graphics().setDepth(9998); }
    army._ring.clear().lineStyle(2.5, 0xffe23f, 0.95).strokeCircle(0, 0, 22);
    // attach ring to follow icon position via updateIcons
    this.scene.showToast && this.scene.showToast(`${army.name} selected — right-click to march`);
  }

  deselect() { this.selected = null; for (const a of this.armies) if (a._ring) a._ring.clear(); }

  updateIcons() {
    const s = this.scene;
    for (const army of this.armies) {
      if (!army.sprite) continue;
      const p = s.tileCenter(army.col, army.row);
      army.sprite.setPosition(p.x, p.y);
      this.drawIcon(army);
      // selection ring + march path + ETA only for the selected player army
      if (army._ring) { if (this.selected === army) army._ring.setVisible(true).setPosition(p.x, p.y); else army._ring.setVisible(false); }
      if (army.marchTargetCol != null && this.selected === army) {
        if (!army._path) army._path = s.add.graphics().setDepth(9997);
        const t = s.tileCenter(army.marchTargetCol, army.marchTargetRow);
        army._path.clear().lineStyle(2, 0xffe23f, 0.6);
        // simple dashed line
        const steps = 16;
        for (let i = 0; i < steps; i += 2) {
          const x1 = Phaser.Math.Linear(p.x, t.x, i / steps), y1 = Phaser.Math.Linear(p.y, t.y, i / steps);
          const x2 = Phaser.Math.Linear(p.x, t.x, (i + 1) / steps), y2 = Phaser.Math.Linear(p.y, t.y, (i + 1) / steps);
          army._path.lineBetween(x1, y1, x2, y2);
        }
        if (!army._eta) army._eta = s.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '11px', color: '#ffe23f', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(9999);
        army._eta.setVisible(true).setPosition(p.x, p.y - 30).setText(`~${this.etaDays(army).toFixed(1)} days`);
      } else if (army._path) { army._path.clear(); if (army._eta) army._eta.setVisible(false); }
    }
  }

  // --- save / load ---------------------------------------------------------
  serialize() {
    return this.armies.map((a) => ({ id: a.id, name: a.name, faction: a.faction, units: a.units.map((u) => ({ ...u })), col: a.col, row: a.row, state: a.state, marchTargetCol: a.marchTargetCol, marchTargetRow: a.marchTargetRow, garrisonSettlementId: a.garrisonSettlementId, morale: a.morale, supplyDays: a.supplyDays }));
  }

  restore(list: any) {
    for (const a of [...this.armies]) this.removeArmy(a);
    this.armies = []; this._idc = 0;
    for (const d of list || []) {
      const army = { ...d, units: d.units.map((u) => ({ ...u })), sprite: null, attackTarget: null, marchProgress: 0 };
      const n = parseInt((d.id || '').split('_')[1], 10);
      if (n > this._idc) this._idc = n;
      this.armies.push(army);
      this.makeIcon(army);
    }
  }
}
