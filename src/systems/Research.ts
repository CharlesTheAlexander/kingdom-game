import { GAME_W, GAME_H } from '../scenes/GameScene.js';
import { GameWorld } from './GameWorld.js'; // (Phase 11) imperial branch stage gate + effects

// Research.js — (Expansion Phase 5) a 9-tech tree across 3 branches, unlocked by
// building a Library. `once` effects are saved via buffs/troops; `flag` effects
// are idempotent and re-applied on load.
// (Phase 11) A 4TH "Imperial" branch (3 techs) is gated at kingdom stage 7 (Small
// Castle) via `stageGate`. Its effects live on GameWorld flags so they apply at
// the CONTINENT level (Imperial Roads movement +50% + free roads) and on banking
// / elite training. `flag` effects are idempotent; restore() re-applies them.
const TECHS: any[] = [
  { id: 'iron_weapons', branch: 0, row: 0, name: 'Iron Weapons', desc: 'Warriors +20% damage', prereq: null, once: (s) => { s.buffs.warriorDamage *= 1.2; } },
  { id: 'heavy_armor', branch: 0, row: 1, name: 'Heavy Armor', desc: 'Warriors +30 HP', prereq: 'iron_weapons', once: (s) => { for (const w of s.troops.warriors) { w.maxHp += 30; w.hp += 30; } } },
  { id: 'battle_tactics', branch: 0, row: 2, name: 'Battle Tactics', desc: 'Formations +15% dmg', prereq: 'heavy_armor', flag: (s) => { s._researchBattleTactics = true; } },
  { id: 'adv_farming', branch: 1, row: 0, name: 'Advanced Farming', desc: 'Farms +50% food', prereq: null, flag: (s) => { s._researchFarmMult = 1.5; } },
  { id: 'mining_tech', branch: 1, row: 1, name: 'Mining Techniques', desc: 'Mines +50% stone', prereq: null, flag: (s) => { s._researchMineMult = 1.5; } },
  { id: 'trade_networks', branch: 1, row: 2, name: 'Trade Networks', desc: 'Market ratios +15%', prereq: 'adv_farming', flag: (s) => { s._researchMarketMult = 1.15; } },
  { id: 'cartography', branch: 2, row: 0, name: 'Cartography', desc: 'Fog reveals faster', prereq: null, flag: (s) => { s._researchFog = true; }, once: (s) => { const c = s.buildings.castle; if (c && s.revealAround) s.revealAround(c.col, c.row, 30); } },
  { id: 'ranger', branch: 2, row: 1, name: 'Ranger Training', desc: 'Expeditions -50% losses; Conservation (deer regrow)', prereq: 'cartography', flag: (s) => { s._researchRanger = true; s._conservation = true; } }, // (V2 P10) rangers practise sustainable hunting
  { id: 'espionage', branch: 2, row: 2, name: 'Espionage', desc: 'Always see AI armies', prereq: 'ranger', flag: (s) => { s._researchEspionage = true; s.intelUntilDay = 9e9; } },
  // (Phase 11) IMPERIAL BRANCH — unlocks at stage 7.
  { id: 'imperial_roads', branch: 3, row: 0, name: 'Imperial Roads', desc: 'Roads free; party movement +50% on the continent', prereq: null, stageGate: 7, flag: (s) => { s._researchFreeRoads = true; GameWorld.lateGameFlags.imperialRoads = true; } },
  { id: 'imperial_treasury', branch: 3, row: 1, name: 'Imperial Treasury', desc: 'Banking interest 2% → 4%', prereq: 'imperial_roads', stageGate: 7, flag: (s) => { s._researchBankRate = 0.04; GameWorld.lateGameFlags.imperialTreasury = true; } },
  { id: 'imperial_legion', branch: 3, row: 2, name: 'Imperial Legion', desc: 'Elite units +1 level', prereq: 'imperial_treasury', stageGate: 7, flag: (s) => { s._researchEliteBonus = 1; GameWorld.lateGameFlags.imperialLegion = true; } },
];
const BRANCH_COL = [0xc0392b, 0x2ecc71, 0x3498db, 0xd6a020];

export class Research {
  scene: any;
  completed: Set<string>;
  current: string | null;
  progress: number;
  _usedFree: boolean;
  [key: string]: any;

  constructor(scene: any) { this.scene = scene; this.completed = new Set<string>(); this.current = null; this.progress = 0; this._usedFree = false; }
  techs() { return TECHS; }
  hasLibrary() { return this.scene.buildings.countOfType('library') > 0; }
  library() { return this.scene.buildings.buildings.find((b) => b.typeKey === 'library' && b.alive); }
  isDone(id) { return this.completed.has(id); }
  available(t) {
    if (this.completed.has(t.id) || this.current === t.id) return false;
    if (t.prereq && !this.completed.has(t.prereq)) return false;
    // (Phase 11) Imperial branch is gated on the kingdom stage (Small Castle = 7).
    if (t.stageGate && GameWorld.kingdomStage() < t.stageGate) return false;
    return true;
  }
  /** (Phase 11) True once the imperial branch can be researched (stage ≥ 7). */
  imperialUnlocked() { return GameWorld.kingdomStage() >= 7; }

  start(id) {
    const t = TECHS.find((x) => x.id === id);
    if (!t || !this.available(t) || this.current) return;
    this.current = id; this.progress = 0;
    this.scene.introCard && this.scene.introCard('research', 'Research', 'Each technology grants a permanent bonus; some unlock new units or buildings. Staff the Library to progress.');
    if (this.scene.traitBonuses && this.scene.traitBonuses.freeResearch && !this._usedFree) { this._usedFree = true; this.complete(); }
    this.scene.refreshPanel && this.scene.refreshPanel();
  }

  complete() {
    const t = TECHS.find((x) => x.id === this.current); if (!t) return;
    this.completed.add(t.id); this.current = null; this.progress = 0;
    try { if (t.once) t.once(this.scene); if (t.flag) t.flag(this.scene); } catch (e) { console.error('[Research] effect failed', e); }
    this.scene.logEvent && this.scene.logEvent(`Research complete: ${t.name}`, 'green');
    this.scene.threatWarning && this.scene.threatWarning(`Research complete: ${t.name}`, 0x8ab0e6);
    this.scene.refreshPanel && this.scene.refreshPanel();
  }

  onNewDay() {
    if (!this.current) return;
    const lib = this.library();
    if (!lib || lib.workers <= 0) return;
    // (Session-1 Phase 3) Wandering Scholar patronage speeds research.
    const speed = (this.scene._researchSpeedMult || 1) * (this.scene._heroResearch || 1) * (this.scene._marriageResearchMult || 1); // (V2 P3) Tomas; (V2 P8) royal marriage
    this.progress += (lib.workers >= 2 ? 1.5 : 1) * speed;
    if (this.progress >= 3) this.complete();
  }

  daysLeft() {
    const lib = this.library(); const rate = lib && lib.workers >= 2 ? 1.5 : 1;
    return this.current ? Math.max(0, (3 - this.progress) / rate) : 0;
  }

  renderPanel() {
    const s = this.scene; const PY = s.PANEL_Y; const PANEL_H = GAME_H - PY;
    // (Visual P6) Research is a carved stone tablet framed in wood.
    if (s.stonePanel && s.woodFrame) {
      s.panel.add(s.stonePanel(4, PY + 4, GAME_W - 8, PANEL_H - 8, { seed: PY + 5 }));
      s.panel.add(s.woodFrame(4, PY + 4, GAME_W - 8, PANEL_H - 8, { thickness: 7 }));
    } else {
      s.panel.add(s.add.rectangle(4, PY + 4, GAME_W - 8, PANEL_H - 8, 0x0e1622, 0.96).setOrigin(0, 0).setStrokeStyle(2, 0xc9a14a, 0.7).setScrollFactor(0));
    }
    const cur = this.current ? TECHS.find((t) => t.id === this.current) : null;
    s.panelText(14, PY + 6, cur ? `RESEARCH — ${cur.name}: ${this.daysLeft().toFixed(1)} days left` : 'RESEARCH — pick a technology', { bold: true, color: '#bcd6f0' });
    // (Phase 11) 4 branches now: Military / Economy / Exploration / Imperial.
    const colX = [30, 280, 530, 780], rowY = [PY + 28, PY + 60, PY + 92];
    const BRANCH_NAME = ['Military', 'Economy', 'Exploration', 'Imperial'];
    for (let bi = 0; bi < BRANCH_NAME.length; bi++) s.panel.add(s.add.text(colX[bi], PY + 16, BRANCH_NAME[bi], { fontFamily: 'monospace', fontSize: '9px', color: '#8a7f6a', fontStyle: 'bold' }).setScrollFactor(0));
    // prerequisite lines (within each branch column)
    for (const t of TECHS) if (t.prereq) {
      const pr = TECHS.find((x) => x.id === t.prereq);
      const x = colX[t.branch] + 70;
      s.panel.add(s.add.rectangle(x, rowY[pr.row] + 26, 2, rowY[t.row] - rowY[pr.row], 0x55473a, 0.9).setOrigin(0.5, 0).setScrollFactor(0));
    }
    for (const t of TECHS) {
      const x = colX[t.branch], y = rowY[t.row];
      const done = this.completed.has(t.id), isCur = this.current === t.id, avail = this.available(t);
      // (Phase 11) Imperial techs locked by stage show greyed with a lock note.
      const stageLocked = !!(t.stageGate && GameWorld.kingdomStage() < t.stageGate && !done);
      const fill = done ? BRANCH_COL[t.branch] : isCur ? 0x2d4a6b : stageLocked ? 0x231d12 : 0x1a2230;
      const border = isCur || avail ? 0xffe23f : 0x55473a;
      const r = s.add.rectangle(x, y, 230, 26, fill, done ? 0.85 : 0.95).setOrigin(0, 0).setScrollFactor(0).setStrokeStyle(2, border, avail || isCur ? 1 : 0.6);
      s.panel.add(r);
      s.panel.add(s.add.text(x + 8, y + 3, (done ? '✓ ' : '') + t.name, { fontFamily: 'monospace', fontSize: '11px', color: stageLocked ? '#8a7f6a' : '#ffffff', fontStyle: 'bold' }).setScrollFactor(0));
      s.panel.add(s.add.text(x + 8, y + 15, stageLocked ? `Unlocks at stage ${t.stageGate}` : t.desc, { fontFamily: 'monospace', fontSize: '9px', color: stageLocked ? '#7d6b4a' : '#aeb9c6' }).setScrollFactor(0));
      if (isCur) { s.panel.add(s.add.rectangle(x, y + 24, 230 * (this.progress / 3), 2, 0xffe23f).setOrigin(0, 0).setScrollFactor(0)); }
      if (avail && !this.current) { r.setInteractive({ useHandCursor: true }); r.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.start(t.id); }); }
    }
    if (!this.hasLibrary()) s.panelText(GAME_W / 2 - 90, PY + PANEL_H - 24, 'Build a Library to research', { color: '#ff8a80', bold: true });
  }

  serialize() { return { completed: [...this.completed], current: this.current, progress: this.progress, usedFree: this._usedFree }; }
  restore(d: any) {
    if (!d) return;
    this.completed = new Set(d.completed || []); this.current = d.current || null; this.progress = d.progress || 0; this._usedFree = !!d.usedFree;
    // Re-apply only idempotent flag effects (buff/troop effects persist via the save).
    for (const id of this.completed) { const t = TECHS.find((x) => x.id === id); if (t && t.flag) try { t.flag(this.scene); } catch (e) {} }
  }
}
