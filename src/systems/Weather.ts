// (V2 Phase 12) Weather that affects gameplay, not just visuals.
//
//   • Harsh winter — army movement -30%, food consumption +30%, rivers freeze
//     (armies may cross water tiles).
//   • Drought (summer) — farms -50% output, but scarcity makes trade +20%.
//   • Storm (spring/autumn) — armies cannot move for 1-2 days.
//   • Clear — no modifiers.
//
// The manager sets scene flags each new day; the consuming systems (ArmyManager
// speed, the food-upkeep calc, Building farm output, the market) read them.

export class Weather {
  scene: any;
  cond: string;
  stormDaysLeft: number;
  [key: string]: any;

  constructor(scene: any) {
    this.scene = scene;
    this.cond = 'clear';
    this.stormDaysLeft = 0;
    this.apply();
  }

  // Reset all gameplay flags to neutral, then set them for the current cond.
  apply() {
    const s = this.scene;
    s._weatherMoveMult = 1;
    s._weatherFoodMult = 1;
    s._weatherFarmMult = 1;
    s._weatherTradeMult = 1;
    s._riversFrozen = false;
    switch (this.cond) {
      case 'winter':
        s._weatherMoveMult = 0.7; s._weatherFoodMult = 1.3; s._riversFrozen = true; break;
      case 'drought':
        s._weatherFarmMult = 0.5; s._weatherTradeMult = 1.2; break;
      case 'storm':
        s._weatherMoveMult = 0; break;
    }
  }

  label() {
    return ({ winter: 'Harsh Winter', drought: 'Drought', storm: 'Storm', clear: 'Clear skies' } as Record<string, string>)[this.cond] || 'Clear skies';
  }

  onNewDay() {
    const s = this.scene;
    const season = s.seasonHint ? s.seasonHint(s.gameDay) : 'Summer';
    let next = 'clear';
    // An ongoing storm runs its 1-2 day course first.
    if (this.stormDaysLeft > 0) {
      this.stormDaysLeft -= 1;
      next = this.stormDaysLeft > 0 ? 'storm' : 'clear';
    } else if (season === 'Winter') {
      next = 'winter';
    } else if (season === 'Summer') {
      next = Math.random() < 0.18 ? 'drought' : 'clear';
    } else if (season.indexOf('Spring') >= 0 || season.indexOf('Autumn') >= 0) {
      if (Math.random() < 0.12) { next = 'storm'; this.stormDaysLeft = Math.floor(Math.random() * 2) + 1; }
    }
    const changed = next !== this.cond;
    this.cond = next;
    this.apply();
    if (changed && this.cond !== 'clear') {
      const msgs: Record<string, string> = {
        winter: '❄ Harsh winter sets in — armies slow, food dwindles, rivers freeze over',
        drought: '☀ Drought grips the land — farms wither, but scarce goods trade higher',
        storm: '⛈ A storm rolls in — armies are pinned down until it passes',
      };
      if (s.threatWarning) s.threatWarning(msgs[this.cond] || this.label(), 0x9fc4d2, false);
    }
  }

  serialize() { return { cond: this.cond, stormDaysLeft: this.stormDaysLeft }; }
  restore(d: any) { if (!d) return; this.cond = d.cond || 'clear'; this.stormDaysLeft = d.stormDaysLeft || 0; this.apply(); }
}
