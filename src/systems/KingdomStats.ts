// KingdomStats.js — (Session-1 Phase 6) all-time records for the statistics panel.
// Counters are incremented via note(); resource totals are captured by wrapping
// Resources.add so every gain is tallied. Derived figures (stage, research,
// discoveries) are read live from their systems at render time.

export class KingdomStats {
  scene: any;
  s: any;
  [key: string]: any;

  constructor(scene: any) {
    this.scene = scene;
    this.s = this.blank();
    this.wrapResources();
  }

  blank() {
    return {
      battlesWon: 0, battlesLost: 0, soldiersTrained: 0, enemiesDefeated: 0,
      marketTrades: 0, caravanTrades: 0, caravansDelivered: 0, expeditions: 0,
      ruinsDiscovered: 0, ruinsExplored: 0,
      gathered: { wood: 0, stone: 0, food: 0, gold: 0, iron: 0 },
    };
  }

  note(key: string, amt = 1) { if (key in this.s && typeof this.s[key] === 'number') this.s[key] += amt; }

  // Tally every positive resource gain by wrapping Resources.add. Idempotent:
  // the true original is cached on _origAdd so restore() can safely re-point the
  // tally without double-wrapping.
  wrapResources() {
    const r = this.scene.resources;
    if (!r) return;
    if (!r._origAdd) r._origAdd = r.add.bind(r);
    const orig = r._origAdd;
    const tally = this.s.gathered;
    r.add = (type, amt) => { orig(type, amt); if (amt > 0 && tally[type] != null) tally[type] += amt; };
  }

  serialize() { return this.s; }
  restore(d: any) {
    if (!d) return;
    const base = this.blank();
    this.s = Object.assign(base, d);
    this.s.gathered = Object.assign(base.gathered, d.gathered || {});
    this.wrapResources(); // re-point the wrapper at the restored tally object
  }
}
