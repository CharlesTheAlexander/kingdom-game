// Shared type definitions used across multiple systems.
// Kept intentionally permissive (many optional fields, loose unions) so they
// describe the existing dynamic game objects without forcing a rewrite. As the
// migration matures these can be tightened.

// ---- Resources -------------------------------------------------------------
export interface ResourceState {
  wood: number;
  stone: number;
  food: number;
  gold: number;
  iron: number;
  equipment: number;
  planks: number;
  cutStone: number;
}

// A cost / partial bundle of resources (any subset of the six).
export type ResourceCost = Partial<Record<keyof ResourceState, number>>;

// ---- Building definitions (src/data/BuildingTypes.ts) ----------------------
export interface BuildingType {
  key: string;
  name: string;
  cost: ResourceCost;
  hp: number;
  desc?: string;
  maxWorkers?: number;
  workerCost?: number;
  interval?: number;
  refineFrom?: keyof ResourceState | string;
  produces?: keyof ResourceState | string;
  rate?: number;
  workerRates?: number[];
  production?: boolean;
  placeable?: boolean;
  capIncrease?: number;
  maxCount?: number;
  range?: number;
  damage?: number;
  attackInterval?: number;
  attack?: boolean;
  footprint?: number;
  stageUnlock?: number;
  councilUnlock?: boolean;
  revealRadius?: number;
  tex?: string;
  wall?: boolean;
  noCap?: boolean;
  anywhere?: boolean;
  /** (Phase 11) A MONUMENT — a one-time late-game gold sink raised in the home
   *  settlement. Its cost/effects (prestige, morale) are authoritative on
   *  GameWorld.MONUMENT_DEFS; the placement flow charges via GameWorld.buildMonument. */
  monument?: boolean;
}

// ---- Live game objects -----------------------------------------------------
export interface BuildingData {
  id?: string;
  type?: string;
  typeKey?: string;
  gridCol?: number;
  gridRow?: number;
  col?: number;
  row?: number;
  level?: number;
  hp?: number;
  maxHp?: number;
  workersAssigned?: number;
}

export type UnitType = 'warrior' | 'archer' | 'monk' | 'knight' | 'mercenary' | string;
export type Faction = 'player' | 'red' | 'purple' | 'yellow' | string;

export interface UnitData {
  id?: string;
  type?: UnitType;
  hp?: number;
  maxHp?: number;
  x?: number;
  y?: number;
  armyId?: string | null;
  playerCommanded?: boolean;
}

export type ArmyState = 'idle' | 'marching' | 'engaging' | 'garrisoning' | 'returning' | string;

export interface ArmyData {
  id?: string;
  name?: string;
  faction?: Faction;
  units?: UnitData[];
  col?: number;
  row?: number;
  state?: ArmyState;
  morale?: number;
  supplyDays?: number;
}

export interface GameState {
  day: number;
  resources: ResourceState;
  buildings: BuildingData[];
  units: UnitData[];
  armies: ArmyData[];
  settlementStage: number;
  population: number;
  happiness: number;
}
