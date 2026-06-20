import Phaser from 'phaser';

// Discovery.js — (Session-1 Phase 4) the first time a player unit comes within 5
// tiles of a point of interest, show a brief authored history and log it. Makes
// the world feel hand-made rather than procedural. Ruins call scene.showDiscovery
// directly (Phase 1); this system handles settlements, goblin camps, AI castles,
// and first-entry biome messages.

const SETTLEMENT_HISTORIES = [
  'A fishing village founded three generations ago. The smell of smoked fish carries for miles.',
  'Once a prosperous mining town, now half-abandoned after the eastern veins ran dry.',
  'Built around a natural spring, this settlement has never known drought.',
  'A waystation for travelers crossing the continent. Its tavern is legendary.',
  'Founded by refugees from the last great war. They have rebuilt quietly and kept to themselves.',
  "A craftsman's town known for the finest ironwork outside of the mountains.",
  "Sits atop ancient ruins — the settlers don't speak of what they found beneath.",
  'A farming community that has survived three raids through sheer stubbornness.',
  'Once governed by a council of seven elders. Only two remain.',
  'The birthplace of the last king before the dark age.',
];

const BIOME_HISTORIES = {
  forest: 'The northern forests. Ancient trees older than any kingdom, and wolves that have never feared men.',
  mountains: 'The eastern highlands. Stone and iron in abundance, but the altitude is unforgiving.',
  delta: 'The southern plains. Rich farmland fed by the great river — travelers call it the breadbasket of the continent.',
  wildlands: 'The western reaches. Lawless land claimed by goblin clans and wandering mercenaries.',
};

const CAMP_HISTORY = 'A goblin encampment. Disorganized but numerous — they raid anything within reach.';

export class Discovery {
  constructor(scene) {
    this.scene = scene;
    this.seen = {};            // key -> true
    this.settlementHist = {};  // settlement name -> assigned history
    this._histPool = Phaser.Utils.Array.Shuffle([...SETTLEMENT_HISTORIES]);
  }

  has(key) { return !!this.seen[key]; }
  mark(key) { this.seen[key] = true; }

  unitPoints() {
    const s = this.scene; const pts = [];
    if (s.troops) for (const u of s.troops.allUnits()) pts.push({ x: u.x, y: u.y });
    if (s.pawns) for (const p of s.pawns.pawns) pts.push({ x: p.x, y: p.y });
    if (s.armyMgr) for (const a of s.armyMgr.playerArmies()) pts.push(s.tileCenter(a.col, a.row));
    return pts;
  }

  update() {
    const s = this.scene;
    const pts = this.unitPoints();
    if (!pts.length) return;
    const reach = 5 * s.TILE;
    const near = (x, y) => pts.some((p) => Math.hypot(p.x - x, p.y - y) <= reach);

    // Neutral settlements
    for (const st of (s.settlements && s.settlements.list) || []) {
      const key = 'settlement:' + st.name;
      if (this.has(key)) continue;
      if (near(st.x, st.y)) {
        this.mark(key);
        let hist = this.settlementHist[st.name];
        if (!hist) { hist = this._histPool.pop() || Phaser.Utils.Array.GetRandom(SETTLEMENT_HISTORIES); this.settlementHist[st.name] = hist; }
        s.showDiscovery && s.showDiscovery('settlement', st.name, hist);
      }
    }
    // Goblin camps
    (s.goblinCamps && s.goblinCamps.list || []).forEach((cmp, i) => {
      const key = 'camp:' + i;
      if (this.has(key) || !cmp.alive) return;
      if (near(cmp.x, cmp.y)) { this.mark(key); s.showDiscovery && s.showDiscovery('camp', 'Goblin Encampment', CAMP_HISTORY); }
    });
    // AI castles
    for (const k of s.kingdoms || []) {
      const key = 'ai:' + k.cfg.key;
      if (this.has(key)) continue;
      if (near(k.castleX, k.castleY)) { this.mark(key); s.showDiscovery && s.showDiscovery('castle', `The seat of the ${k.cfg.name}`, `The seat of the ${k.cfg.name}. They have been watching your kingdom grow.`); }
    }
    // Biome first-entry (check the tile under each unit)
    for (const p of pts) {
      const t = s.screenToTile(p.x, p.y);
      const b = s.biomeAt(t.col, t.row);
      const key = 'biome:' + b;
      if (this.has(key) || !BIOME_HISTORIES[b]) continue;
      this.mark(key);
      const nm = { forest: 'Deep Forest', mountains: 'Iron Mountains', delta: 'River Delta', wildlands: 'Western Wildlands' }[b] || b;
      s.showDiscovery && s.showDiscovery('biome', nm, BIOME_HISTORIES[b]);
    }
  }

  // Stats helpers (Phase 6)
  settlementsDiscovered() { return Object.keys(this.seen).filter((k) => k.startsWith('settlement:')).length; }
  biomesExplored() { return Object.keys(this.seen).filter((k) => k.startsWith('biome:')).length; }

  serialize() { return { seen: this.seen, settlementHist: this.settlementHist }; }
  restore(d) { if (!d) return; this.seen = d.seen || {}; this.settlementHist = d.settlementHist || {}; }
}
