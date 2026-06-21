// Reputation.js — (Expansion Phase 4) four reputation tracks that shape your
// kingdom's title and unlock passive effects at 50+.

export class Reputation {
  scene: any;
  scores: Record<string, number>;

  constructor(scene: any) {
    this.scene = scene;
    this.scores = { conqueror: 0, merchant: 0, protector: 0, destroyer: 0 };
  }

  add(type: string, n: number) {
    if (this.scores[type] == null) return;
    const before = this.scores[type];
    this.scores[type] = Math.max(0, Math.min(100, before + n));
    if (before < 50 && this.scores[type] >= 50) this.scene.logEvent && this.scene.logEvent(`Reputation milestone: ${type} 50+`, 'green');
  }

  highest(): string | null {
    let best: string | null = null, bv = 49; // need 50+ to earn a title
    for (const [k, v] of Object.entries(this.scores)) if (v > bv) { bv = v; best = k; }
    return best;
  }

  title(name: string): string | null {
    const h = this.highest();
    if (!h) return null;
    return (({ conqueror: `The ${name} Conquerors`, merchant: `The ${name} Trading Company`, protector: `The Shield of ${name}`, destroyer: `The ${name} Scourge` }) as Record<string, string>)[h];
  }

  // Extra market bonus from Merchant reputation (read by the Market panel).
  marketBonus() { return this.scores.merchant >= 50 ? 0.1 : 0; }

  onNewDay() {
    const s = this.scene;
    if (this.scores.protector >= 50 && s.diplomacy) for (const k of s.kingdoms || []) s.diplomacy.change(k.cfg.key, 1); // allies warm to you
    if (this.scores.destroyer >= 50) s._goblinTruceUntilDay = Math.max(s._goblinTruceUntilDay || 0, s.gameDay + 2); // goblins avoid your lands
    if (this.scores.merchant >= 75) s.resources.add('gold', 5); // trade networks
  }

  serialize() { return { ...this.scores }; }
  restore(d: any) { if (d) this.scores = { conqueror: 0, merchant: 0, protector: 0, destroyer: 0, ...d }; }
}

// Trait definitions — id → {name, icon-colour, desc, bonuses, oneTime(scene)}.
export const TRAITS: Record<string, any> = {
  warlord: { name: 'Warlord', color: 0xc0392b, desc: ['Troops cost 20% less food.', 'Army cap +3.'], bonuses: { foodMult: 0.8, armyCap: 6 } },
  merchant: { name: 'Merchant', color: 0xf1c40f, desc: ['Market trades 25% better.', 'Gold income +15%.'], bonuses: { marketMult: 1.25, goldMult: 1.15 } },
  builder: { name: 'Builder', color: 0xe67e22, desc: ['Buildings cost 15% less wood.', 'Instant placement.'], bonuses: { woodCostMult: 0.85 } },
  diplomat: { name: 'Diplomat', color: 0x3498db, desc: ['Start +20 relations', 'with all factions.'], bonuses: {}, oneTime: (s) => { if (s.diplomacy) for (const k of s.kingdoms || []) s.diplomacy.rel[k.cfg.key] = 20; } },
  explorer: { name: 'Explorer', color: 0x2ecc71, desc: ['Fog reveals 30% faster.', 'Expeditions 1 day sooner.'], bonuses: { fogMult: 1.3, expDays: -1 }, oneTime: (s) => { const c = s.buildings.castle; if (c && s.revealAround) s.revealAround(c.col, c.row, 26); } },
  scholar: { name: 'Scholar', color: 0x9b59b6, desc: ['Library built at start.', 'First research free.'], bonuses: { freeResearch: true }, oneTime: (s) => { if (s.spawnStartingLibrary) s.spawnStartingLibrary(); } },
};

export function defaultBonuses() {
  return { foodMult: 1, marketMult: 1, goldMult: 1, woodCostMult: 1, fogMult: 1, expDays: 0, armyCap: 3, freeResearch: false };
}
