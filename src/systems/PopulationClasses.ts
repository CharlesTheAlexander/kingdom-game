// (V2 Phase 13) Population Classes.
//
// As a settlement grows, social classes emerge from its buildings:
//   • Peasants  — the base workforce (farmers, miners, labourers).
//   • Craftsmen — skilled workers; emerge with a Blacksmith.
//   • Merchants — traders; emerge with a Market.
//   • Nobles    — emerge at higher stages with a Grand Hall or Treasury, and
//                 provide governance bonuses.
//
// Each class has needs. A satisfied class lends a happiness/economy bonus; an
// ignored class breeds unrest that drags happiness down. Counts and mods are
// recomputed each day and fed into the existing happiness meter.

export class PopulationClasses {
  scene: any;
  classes: any;
  [key: string]: any;

  constructor(scene: any) {
    this.scene = scene;
    this.classes = { peasants: 0, craftsmen: 0, merchants: 0, nobles: 0 };
  }

  has(key: string) { return this.scene.buildings && this.scene.buildings.buildings.some((b: any) => b.alive && b.typeKey === key); }
  staffed(key: string) { return this.scene.buildings && this.scene.buildings.buildings.some((b: any) => b.alive && b.typeKey === key && b.workers > 0); }

  recompute() {
    const s = this.scene;
    const total = s.population ? s.population.count : 0;
    const stage = s.currentStage ? s.currentStage() : 1;
    // (Assets V2) Manor is the canonical noble seat, Guildhall the craftsmen's
    // home; the older blacksmith/grandhall still count as fallbacks.
    const nobles = (stage >= 5 && (this.has('manor') || this.has('grandhall') || this.has('treasury'))) ? Math.round(total * 0.10) : 0;
    const merchants = this.has('market') ? Math.round(total * 0.20) : 0;
    const craftsmen = (this.has('guildhall') || this.has('blacksmith')) ? Math.round(total * 0.25) : 0;
    const peasants = Math.max(0, total - nobles - merchants - craftsmen);
    this.classes = { peasants, craftsmen, merchants, nobles };
    return this.classes;
  }

  // Per-class satisfaction. A class is content when its needs are met.
  satisfied(cls: string) {
    const s = this.scene;
    switch (cls) {
      case 'peasants': return (s.resources ? s.resources.food : 0) > 0;
      case 'craftsmen': return this.staffed('guildhall') || this.staffed('blacksmith'); // need work + materials
      case 'merchants': return this.staffed('market');               // need active trade
      case 'nobles': return this.has('manor') || this.has('grandhall'); // need luxury/prestige
      default: return true;
    }
  }

  // Happiness modifiers fed into Population.onNewDay().
  happinessMods() {
    this.recompute();
    const mods: any[] = [];
    const labels: Record<string, string> = { peasants: 'Peasants', craftsmen: 'Craftsmen', merchants: 'Merchants', nobles: 'Nobles' };
    for (const cls of Object.keys(this.classes)) {
      if (this.classes[cls] <= 0) continue;
      if (!this.satisfied(cls)) mods.push({ label: `${labels[cls]} unrest`, value: -8 });
      else if (cls === 'nobles') mods.push({ label: 'Noble governance', value: 8 });
    }
    return mods;
  }

  // Daily economic bonuses from satisfied classes.
  onNewDay() {
    this.recompute();
    const s = this.scene;
    if (this.classes.nobles > 0 && this.satisfied('nobles')) s.resources.add('gold', this.classes.nobles); // governance taxes
    if (this.classes.merchants > 0 && this.satisfied('merchants')) s.resources.add('gold', Math.round(this.classes.merchants / 2)); // trade tariffs
    if (this.classes.craftsmen > 0 && this.satisfied('craftsmen')) s.resources.add('equipment', Math.max(1, Math.round(this.classes.craftsmen / 4))); // crafted goods
  }

  summary() {
    this.recompute();
    const c = this.classes;
    const parts: string[] = [];
    for (const [k, label] of [['peasants', 'Peasants'], ['craftsmen', 'Craftsmen'], ['merchants', 'Merchants'], ['nobles', 'Nobles']] as [string, string][]) {
      if (c[k] > 0) parts.push(`${label} ${c[k]}${this.satisfied(k) ? '' : ' (unrest)'}`);
    }
    return parts.length ? parts.join('  |  ') : 'A small village of peasants';
  }
}
