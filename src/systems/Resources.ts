// Player economy (Phase 1 overhaul): Wood, Stone, Food, Gold, Workers cap, Soldiers.
import type { ResourceCost } from '../types';

export class Resources {
  wood: number;
  stone: number;
  food: number;
  gold: number;
  iron: number;
  equipment: number;
  planks: number;
  cutStone: number;
  workersCap: number;
  soldiers: number;
  // Allows dynamic resource access (this[res]) used by canAfford/spend/add.
  [key: string]: any;

  constructor() {
    // (Phase 3 rebalance) opening-pace starting values.
    this.wood = 80;
    this.stone = 20;
    this.food = 60;
    this.gold = 150;
    this.iron = 0; // (Phase 5) special resource — from expeditions / goblin camps
    this.equipment = 0; // (Phase 2) crafted by the Blacksmith, consumed training Knights
    this.planks = 0; // (Completion Phase 2) refined at the Sawmill from wood
    this.cutStone = 0; // (Completion Phase 2) refined at the Stonecutter from stone
    this.workersCap = 3; // population cap (raised by Houses); pawns spawn up to this
    this.soldiers = 0; // driven by the live warrior count (Phase 4)
  }

  // cost is an object like { gold: 80, wood: 40 }.
  canAfford(cost: ResourceCost): boolean {
    for (const [res, amt] of Object.entries(cost)) {
      if ((this[res] ?? 0) < amt) return false;
    }
    return true;
  }

  spend(cost: ResourceCost): boolean {
    if (!this.canAfford(cost)) return false;
    for (const [res, amt] of Object.entries(cost)) this[res] -= amt;
    return true;
  }

  add(type: string, amount: number) {
    if (type in this) this[type] += amount;
  }
}
