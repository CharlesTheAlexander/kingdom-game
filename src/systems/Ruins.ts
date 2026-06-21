import Phaser from 'phaser';

// Ruins.js — (Session-1 Phase 1) six ancient ruins scattered across the
// wilderness. Each is drawn with Graphics (no new sprites), hidden in fog until a
// player unit comes within 5 tiles, then explorable ONCE via an expedition for a
// unique, non-repeating reward.

const RUIN_NAMES = [
  'The Sunken Citadel', 'The Wanderer’s Rest', 'The Forge of Ages',
  'The Shattered Keep', 'The Drowned Temple', 'The Iron Throne',
  'The Hollow Spire', 'The Ashen Vault', 'The Weeping Arch',
];

// Reward kinds (assigned one-each, shuffled, at map generation).
// (Improvement session) 10 reward types shuffled across the ruins, so each
// playthrough reveals a different subset — the world feels less predictable.
export const RUIN_REWARDS = ['whetstone', 'map', 'iron', 'tome', 'champion', 'cursed', 'armory', 'hoard', 'relic', 'stoneworks'];

const REVEAL_TILES = 5;

export class Ruins {
  scene: any;
  list: any[];
  [key: string]: any;

  constructor(scene: any) {
    this.scene = scene;
    this.list = []; // { name, col, row, x, y, reward, discovered, explored, g, nameText }
    this.generate();
  }

  // --- placement -----------------------------------------------------------
  generate() {
    const s = this.scene;
    const castle = s.buildings.castle;
    const aiCastles = (s.kingdoms || []).map((k) => ({ col: k.castleCol, row: k.castleRow }));
    const farEnough = (col, row) => {
      if (castle && Math.hypot(col - castle.col, row - castle.row) < 40) return false;
      for (const a of aiCastles) if (Math.hypot(col - a.col, row - a.row) < 20) return false;
      return true;
    };
    // biome → how many ruins go there
    const plan: any[] = [['forest', 3], ['mountains', 2], ['wildlands', 2], ['delta', 1]]; // (Improvement) 8 ruins for more reward variety
    const rewards = Phaser.Utils.Array.Shuffle([...RUIN_REWARDS]);
    let ni = 0;
    for (const [biome, n] of plan) {
      for (let k = 0; k < n; k++) {
        const pos = this.findTile(biome, farEnough);
        if (!pos) continue;
        const name = RUIN_NAMES[ni] || `Ruin ${ni + 1}`;
        const reward = rewards[ni] || 'iron';
        ni++;
        const { x, y } = s.tileCenter(pos.col, pos.row);
        const ruin = { name, col: pos.col, row: pos.row, x, y, reward, discovered: false, explored: false };
        this.draw(ruin);
        this.list.push(ruin);
      }
    }
  }

  findTile(biome, ok) {
    const s = this.scene;
    for (let tries = 0; tries < 400; tries++) {
      let col, row;
      if (biome === 'forest') { col = Phaser.Math.Between(55, 145); row = Phaser.Math.Between(5, 45); }
      else if (biome === 'mountains') { col = Phaser.Math.Between(152, 196); row = Phaser.Math.Between(20, 180); }
      else if (biome === 'wildlands') { col = Phaser.Math.Between(5, 45); row = Phaser.Math.Between(40, 160); }
      else { col = Phaser.Math.Between(55, 145); row = Phaser.Math.Between(155, 195); } // delta
      if (s.biomeAt(col, row) !== biome) continue;
      if (s.terrainType && s.terrainType[row] && s.terrainType[row][col] === 'water') continue;
      if (!ok(col, row)) continue;
      return { col, row };
    }
    return null;
  }

  // --- visuals -------------------------------------------------------------
  draw(ruin) {
    const s = this.scene;
    const g = s.add.graphics().setDepth(4).setPosition(ruin.x, ruin.y);
    this.paint(g, ruin);
    g.setVisible(false); // hidden until discovered
    ruin.g = g;
  }

  paint(g, ruin) {
    g.clear();
    // overgrown base — scattered green tufts
    for (let i = 0; i < 9; i++) {
      g.fillStyle(0x3f6a2e, 0.7);
      g.fillCircle(Phaser.Math.Between(-34, 34), Phaser.Math.Between(2, 26), Phaser.Math.Between(2, 5));
    }
    // crumbled walls — dark gray angled rectangles
    const wall = (x, y, w, h, ang) => { g.save(); g.translateCanvas(x, y); g.rotateCanvas(ang); g.fillStyle(0x4a4a52, 1); g.fillRect(-w / 2, -h / 2, w, h); g.lineStyle(1, 0x2b2b30, 1); g.strokeRect(-w / 2, -h / 2, w, h); g.restore(); };
    wall(-22, 8, 30, 12, -0.12);
    wall(20, 10, 26, 12, 0.10);
    wall(-2, -4, 34, 10, 0.02);
    // broken pillars — vertical gray rectangles of varying height
    const pillar = (x, h) => { g.fillStyle(0x6a6a72, 1); g.fillRect(x - 4, -h, 8, h); g.fillStyle(0x82828a, 1); g.fillRect(x - 4, -h, 8, 3); };
    pillar(-26, 26); pillar(0, 34); pillar(24, 20);
    // excavated / flag-planted look once explored
    if (ruin.explored) {
      g.fillStyle(0x6b4a2a, 1); g.fillRect(30, -38, 2, 24); // flag pole
      g.fillStyle(0x3a7ad0, 1); g.fillTriangle(32, -38, 32, -28, 48, -33); // banner
      g.fillStyle(0x2a2a30, 0.5); g.fillEllipse(0, 16, 70, 22); // dug-out pit
    }
  }

  // --- discovery -----------------------------------------------------------
  update() {
    if (this._done()) return;
    const s = this.scene;
    const units: any[] = [];
    if (s.troops) for (const u of s.troops.allUnits()) units.push(u);
    if (s.pawns) for (const p of s.pawns.pawns) units.push(p);
    if (s.armyMgr) for (const a of s.armyMgr.playerArmies()) { const c = s.tileCenter(a.col, a.row); units.push({ x: c.x, y: c.y }); }
    if (!units.length) return;
    const reach = REVEAL_TILES * s.TILE;
    for (const ruin of this.list) {
      if (ruin.discovered) continue;
      for (const u of units) {
        if (Math.hypot(u.x - ruin.x, u.y - ruin.y) <= reach) { this.discover(ruin); break; }
      }
    }
  }

  _done() { return this.list.every((r) => r.discovered); }

  discover(ruin) {
    if (ruin.discovered) return;
    ruin.discovered = true;
    const s = this.scene;
    ruin.g.setVisible(true);
    if (s.revealAround) s.revealAround(ruin.col, ruin.row, 6);
    // gold italic name above the ruin
    ruin.nameText = s.add.text(ruin.x, ruin.y - 48, ruin.name, { fontFamily: 'serif', fontSize: '14px', color: '#ffe066', fontStyle: 'bold italic', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(9000);
    // golden shimmer
    const ring = s.add.circle(ruin.x, ruin.y, 12, 0xffe066, 0.5).setDepth(8999);
    s.tweens.add({ targets: ring, radius: 70, alpha: 0, duration: 900, ease: 'Cubic.out', onComplete: () => ring.destroy() });
    // a discovery-history panel (Phase 4) + the investigate world event
    if (s.showDiscovery) s.showDiscovery('ruin', ruin.name, 'An ancient ruin, silent for centuries. Something may yet remain within.');
    if (s.worldEvents) s.worldEvents.pushNews(`Your scouts discovered ${ruin.name}. Send an expedition to investigate.`);
    if (s.logEvent) s.logEvent(`Discovered ${ruin.name}`, 'gold');
    if (s.introCard) s.introCard('ruin', 'Ancient Ruin', 'Send an Expedition (Military panel → Ruins) to explore it for a rare, one-time reward.');
    if (s.stats) s.stats.note('ruinsDiscovered');
  }

  // ruins discovered but not yet explored — drives the expedition dropdown
  available() { return this.list.filter((r) => r.discovered && !r.explored); }
  byName(name) { return this.list.find((r) => r.name === name); }
  exploredCount() { return this.list.filter((r) => r.explored).length; }

  // --- exploration reward --------------------------------------------------
  explore(ruin) {
    if (!ruin || ruin.explored) return;
    ruin.explored = true;
    this.paint(ruin.g, ruin); // excavated look + flag
    this.applyReward(ruin);
    if (this.scene.heroes) this.scene.heroes.offer('mira'); // (V2 Phase 3) Mira found in a ruin
    if (this.scene.stats) this.scene.stats.note('ruinsExplored');
    this.scene.refreshPanel && this.scene.refreshPanel();
  }

  applyReward(ruin) {
    const s = this.scene;
    const toast = (t: string, c?: string) => { s.showToast && s.showToast(t); s.logEvent && s.logEvent(t, c || 'green'); };
    switch (ruin.reward) {
      case 'whetstone':
        s.buffs.warriorDamage = (s.buffs.warriorDamage || 1) * 1.25;
        if (s.artifacts && !s.artifacts.includes('whetstone')) s.artifacts.push('whetstone');
        toast(`${ruin.name}: Ancient Whetstone — warriors +25% damage!`); break;
      case 'map':
        this.revealEntireMap();
        toast(`${ruin.name}: Forgotten Map — the whole continent is revealed!`); break;
      case 'iron':
        s.resources.add('iron', 150); toast(`${ruin.name}: Iron Cache — +150 iron!`); break;
      case 'tome':
        if (s.research) {
          if (s.research.current) { s.research.complete(); toast(`${ruin.name}: Lost Tome — research completed instantly!`); }
          else {
            const avail = s.research.techs().filter((t) => s.research.available(t));
            if (avail.length) { s.research.start(avail[0].id); s.research.complete(); toast(`${ruin.name}: Lost Tome — free research unlocked!`); }
            else toast(`${ruin.name}: Lost Tome — but all research is done. +1 scroll.`), (s.scrolls = (s.scrolls || 0) + 1);
          }
        } break;
      case 'champion':
        if (s.troops.spawnChampion) s.troops.spawnChampion();
        toast(`${ruin.name}: The Ancient — a legendary champion joins you!`); break;
      case 'cursed':
        this.offerCursedGold(ruin); break;
      // (Improvement session) more reward variety
      case 'armory':
        for (const w of s.troops.warriors) { w.maxHp += 15; w.hp = Math.min(w.maxHp, w.hp + 15); }
        s.buffs.warriorBonusHp = (s.buffs.warriorBonusHp || 0) + 15;
        toast(`${ruin.name}: Ancient Armory — all warriors gain +15 HP!`); break;
      case 'hoard':
        s.resources.add('gold', 300); s.resources.add('iron', 40);
        toast(`${ruin.name}: Dragon's Hoard — +300 gold, +40 iron!`); break;
      case 'relic': {
        // A holy relic: a lasting happiness blessing + protector renown.
        if (s.population) s.population.addTempMod('Holy relic', 15, 12);
        if (s.reputation) s.reputation.add('protector', 10);
        toast(`${ruin.name}: Sacred Relic — your people are blessed (happiness +15).`); break;
      }
      case 'stoneworks':
        s.resources.add('cutStone', 80); s.resources.add('planks', 60);
        toast(`${ruin.name}: Master Stoneworks — +80 cut stone, +60 planks!`); break;
      default:
        // Unknown reward → a modest gold + iron find, so a ruin is never a dud.
        s.resources.add('gold', 120); s.resources.add('iron', 20);
        toast(`${ruin.name}: an old cache — +120 gold, +20 iron.`); break;
    }
  }

  // Warn before accepting the cursed reward (a choice via the messenger panel).
  offerCursedGold(ruin) {
    const s = this.scene;
    const def = {
      id: 'cursed_' + ruin.name, title: 'Cursed Gold', body: () => `${ruin.name} held a hoard of gold, cursed by its keepers. Accept anyway?`,
      choices: [
        { label: 'Accept (+500 gold, -20 happiness 5d)', effect: () => { s.resources.add('gold', 500); if (s.population) s.population.addTempMod('Cursed gold', -20, 5); s.logEvent && s.logEvent(`${ruin.name}: Accepted the cursed gold (+500 gold)`, 'gold'); } },
        { label: 'Leave it', effect: () => { s.logEvent && s.logEvent(`${ruin.name}: Left the cursed gold untouched`, 'info'); } },
      ],
    };
    if (s.worldEvents) { s.worldEvents.queue.push(def); s.worldEvents.refreshMessenger(); s.worldEvents.openPanel(); }
  }

  revealEntireMap() {
    const s = this.scene;
    if (!s.territory) return;
    const t = s.territory;
    for (let r = 0; r < s.ROWS; r++) for (let c = 0; c < s.COLS; c++) {
      if (!t.explored[r][c]) { t.explored[r][c] = true; const bob = s.terrainTiles[r] && s.terrainTiles[r][c]; if (bob) bob.setTint(t.tintFor(c, r)); }
    }
    s._fogDirty = true; // (BUG 7)
  }

  // --- save ----------------------------------------------------------------
  serialize() { return this.list.map((r) => ({ name: r.name, col: r.col, row: r.row, reward: r.reward, discovered: r.discovered, explored: r.explored })); }
  restore(data: any) {
    if (!data || !data.length) return;
    // Match by name (positions are deterministic per save's stored col/row).
    for (const d of data) {
      let ruin = this.byName(d.name);
      if (!ruin) continue;
      ruin.reward = d.reward; ruin.discovered = d.discovered; ruin.explored = d.explored;
      // reposition to the saved tile so it lines up with the saved fog
      const { x, y } = this.scene.tileCenter(d.col, d.row);
      ruin.col = d.col; ruin.row = d.row; ruin.x = x; ruin.y = y; ruin.g.setPosition(x, y);
      this.paint(ruin.g, ruin);
      ruin.g.setVisible(!!d.discovered);
      if (d.discovered && !ruin.nameText) ruin.nameText = this.scene.add.text(x, y - 48, ruin.name, { fontFamily: 'serif', fontSize: '14px', color: '#ffe066', fontStyle: 'bold italic', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(9000);
    }
  }
}
