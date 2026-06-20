// Population.js — (Expansion Phase 5) population + a single kingdom happiness
// meter that feeds back into worker production. Kept deliberately simple: one
// population number, one happiness value, recomputed each game-day.

export class Population {
  constructor(scene) {
    this.scene = scene;
    this.count = 10;
    this.happiness = 60;
    this.prodMult = 1;          // production modifier applied in Buildings.produce()
    this._growthAcc = 0;        // days accumulated toward the next +1 person
    this.modifiers = [];        // [{label, value}] active happiness modifiers (for the tooltip)
  }

  capacity() {
    const houses = this.scene.buildings ? this.scene.buildings.countOfType('house') : 0;
    return 10 + houses * 4; // base 10, +4 per House
  }

  // Called once per game-day from onNewDay().
  onNewDay() {
    const s = this.scene;
    const cap = this.capacity();
    const food = s.resources ? s.resources.food : 0;

    // --- Happiness: recompute from a neutral baseline + active modifiers ------
    const mods = [];
    if (food > 100) mods.push({ label: 'Food surplus', value: 15 });
    if (food <= 0) mods.push({ label: 'Starving', value: -30 });
    const day = s.gameDay || 0;
    if (day - (s._lastAttackDay ?? -99) >= 5) mods.push({ label: 'No recent attacks', value: 10 });
    if (s.hasTavern && s.hasTavern()) mods.push({ label: 'Tavern', value: 15 });
    else if (this.count > 20) mods.push({ label: 'No entertainment', value: -5 });
    if (day - (s._lastBattleWonDay ?? -99) <= 3) mods.push({ label: 'Recent victory', value: 5 });
    if (day - (s._lastBattleLostDay ?? -99) <= 3) mods.push({ label: 'Recent defeat', value: -15 });
    if (day - (s._lastCastleDamageDay ?? -99) <= 3) mods.push({ label: 'Castle damaged', value: -20 });
    if (this.count >= cap) mods.push({ label: 'Overcrowded', value: -10 });
    else if (this.count < cap - 4) mods.push({ label: 'Roomy housing', value: 3 });

    let h = 50;
    for (const m of mods) h += m.value;
    this.happiness = Math.max(0, Math.min(100, Math.round(h)));
    this.modifiers = mods;

    // --- Production modifier ---------------------------------------------------
    this.prodMult = this.happiness >= 70 ? 1.1 : this.happiness >= 40 ? 1.0 : this.happiness >= 20 ? 0.8 : 0;

    // --- Growth: +1 person every 3 days if fed and below capacity -------------
    if (this.happiness >= 30 && food > 0 && this.count < cap) {
      this._growthAcc += 1;
      if (this._growthAcc >= 3) { this._growthAcc = 0; this.count = Math.min(cap, this.count + 1); }
    } else {
      this._growthAcc = 0;
    }
    // Very low happiness: people leave.
    if (this.happiness < 10 && this.count > 1) this.count -= 1;
  }

  // For the happiness tooltip: "Food surplus: +15 | No Tavern: -5"
  breakdown() {
    if (!this.modifiers.length) return 'Content (no strong feelings)';
    return this.modifiers.map((m) => `${m.label}: ${m.value > 0 ? '+' : ''}${m.value}`).join('  |  ');
  }

  prodLabel() {
    if (this.prodMult >= 1.1) return '+10% (Happy)';
    if (this.prodMult <= 0) return 'STRIKE (no output)';
    if (this.prodMult < 1) return '-20% (Unhappy)';
    return 'normal';
  }

  serialize() { return { count: this.count, happiness: this.happiness, growthAcc: this._growthAcc }; }
  restore(d) { if (!d) return; this.count = d.count; this.happiness = d.happiness; this._growthAcc = d.growthAcc || 0; }
}
