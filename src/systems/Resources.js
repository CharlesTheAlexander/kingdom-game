// Player economy (Phase 1 overhaul): Wood, Stone, Food, Gold, Workers cap, Soldiers.
export class Resources {
  constructor() {
    // (Phase 3 rebalance) opening-pace starting values.
    this.wood = 80;
    this.stone = 20;
    this.food = 60;
    this.gold = 150;
    this.iron = 0; // (Phase 5) special resource — only from expeditions, future Knight cost
    this.workersCap = 3; // population cap (raised by Houses); pawns spawn up to this
    this.soldiers = 0; // driven by the live warrior count (Phase 4)
  }

  // cost is an object like { gold: 80, wood: 40 }.
  canAfford(cost) {
    for (const [res, amt] of Object.entries(cost)) {
      if ((this[res] ?? 0) < amt) return false;
    }
    return true;
  }

  spend(cost) {
    if (!this.canAfford(cost)) return false;
    for (const [res, amt] of Object.entries(cost)) this[res] -= amt;
    return true;
  }

  add(type, amount) {
    if (type in this) this[type] += amount;
  }
}
