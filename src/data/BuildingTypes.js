// Definitions for every building type in the game (Phase 1 resource overhaul).
// Costs are objects keyed by resource: { wood, stone, food, gold }.
// `workerCost` = workers consumed to operate the building (population).
// Production buildings set `produces` + `rate` (per `interval` seconds, default 1s)
// and `production: true` to mark them as places worker pawns visit (Phase 3).
// Each building's sprite/texture key == its key (loaded in GameScene.preload()).

// (Phase 2 — worker allocation) Production buildings define `maxWorkers` and a
// `workerRates` table indexed by the number of allocated workers (rate per sec
// for `produces`). 0 workers = 0 production. Workers are assigned manually.
export const BuildingTypes = {
  castle: {
    key: 'castle', name: 'Castle', cost: {}, maxWorkers: 0, hp: 200,
    produces: 'gold', rate: 2, placeable: false,
    desc: 'The heart of your kingdom. Always generates 2 gold/sec. Protect it!',
  },
  house: {
    key: 'house', name: 'House', cost: { wood: 30 }, maxWorkers: 0, hp: 80,
    capIncrease: 2, maxCount: 3, placeable: true,
    desc: 'Houses workers. +2 Workers cap (max 3 houses = +6).',
  },
  lumberyard: {
    key: 'lumberyard', name: 'Lumberyard', cost: { wood: 40 }, maxWorkers: 3, hp: 90,
    produces: 'wood', workerRates: [0, 2, 4, 7], production: true, placeable: true,
    // No dedicated lumberyard art in the free pack — Archery.png is a stand-in.
    desc: 'Wood. Assign workers: 1→2, 2→4, 3→7 /sec.',
  },
  mine: {
    key: 'mine', name: 'Mine', cost: { stone: 50 }, maxWorkers: 3, hp: 90,
    produces: 'stone', workerRates: [0, 1, 2, 4], production: true, placeable: true,
    // No dedicated mine art in the free pack — Monastery.png is a stand-in.
    desc: 'Stone. Assign workers: 1→1, 2→2, 3→4 /sec.',
  },
  farm: {
    key: 'farm', name: 'Farm', cost: { wood: 40 }, maxWorkers: 3, hp: 80,
    produces: 'food', workerRates: [0, 2, 4, 7], production: true, placeable: true,
    desc: 'Food. Assign workers: 1→2, 2→4, 3→7 /sec.',
  },
  barracks: {
    key: 'barracks', name: 'Barracks', cost: { gold: 80, wood: 40 }, maxWorkers: 2, hp: 120,
    placeable: true,
    desc: 'Trains units. Assign workers to train: 2 workers = 1.5x speed.',
  },
  tower: {
    key: 'tower', name: 'Tower', cost: { stone: 60, wood: 20 }, maxWorkers: 1, hp: 120,
    range: 3, damage: 10, attackInterval: 1, attack: true, placeable: true,
    desc: 'Attacks enemies within 3 tiles. Needs 1 worker to operate.',
  },
};

// Order shown in the build menu (all 6 placeable types).
export const BUILD_ORDER = ['house', 'lumberyard', 'mine', 'farm', 'barracks', 'tower'];
export const PLACEABLE = BUILD_ORDER.map((k) => BuildingTypes[k]);

export const MAX_LEVEL = 3;

// Building upgrades stay simple: they cost GOLD only (doubling each level) and
// double the building's output. (Settlement tiers are the main progression.)
export function upgradeCost(type, level) {
  return Math.round(60 * Math.pow(2, level - 1));
}
export function outputMultiplier(level) {
  return Math.pow(2, level - 1);
}

const RES_ABBR = { gold: 'G', wood: 'W', stone: 'S', food: 'F' };
export function formatCost(cost) {
  const parts = Object.entries(cost).map(([k, v]) => `${v}${RES_ABBR[k] || k}`);
  return parts.length ? parts.join(' ') : 'Free';
}
