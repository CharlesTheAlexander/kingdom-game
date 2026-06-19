// Definitions for every building type in the game (Phase 1 resource overhaul).
// Costs are objects keyed by resource: { wood, stone, food, gold }.
// `workerCost` = workers consumed to operate the building (population).
// Production buildings set `produces` + `rate` (per `interval` seconds, default 1s)
// and `production: true` to mark them as places worker pawns visit (Phase 3).
// Each building's sprite/texture key == its key (loaded in GameScene.preload()).

export const BuildingTypes = {
  castle: {
    key: 'castle', name: 'Castle', cost: {}, workerCost: 0, hp: 200,
    produces: 'gold', rate: 2, placeable: false,
    desc: 'The heart of your kingdom. Generates 2 gold/sec. Protect it!',
  },
  house: {
    key: 'house', name: 'House', cost: { wood: 30 }, workerCost: 0, hp: 80,
    capIncrease: 1, maxCount: 3, placeable: true,
    desc: 'Houses a worker. +1 Workers cap (max 3 houses).',
  },
  lumberyard: {
    key: 'lumberyard', name: 'Lumberyard', cost: { wood: 40 }, workerCost: 1, hp: 90,
    produces: 'wood', rate: 2, production: true, placeable: true,
    // No dedicated lumberyard art in the free pack — Archery.png is a stand-in.
    desc: 'Produces 2 wood/sec. Needs 1 worker.',
  },
  mine: {
    key: 'mine', name: 'Mine', cost: { stone: 50 }, workerCost: 1, hp: 90,
    produces: 'stone', rate: 1, production: true, placeable: true,
    // No dedicated mine art in the free pack — Monastery.png is a stand-in.
    desc: 'Produces 1 stone/sec. Needs 1 worker.',
  },
  farm: {
    key: 'farm', name: 'Farm', cost: { wood: 40 }, workerCost: 1, hp: 80,
    produces: 'food', rate: 2, production: true, placeable: true,
    desc: 'Produces 2 food/sec. Needs 1 worker.',
  },
  barracks: {
    key: 'barracks', name: 'Barracks', cost: { gold: 80, wood: 40 }, workerCost: 2, hp: 120,
    produces: 'soldiers', rate: 1, interval: 20, placeable: true,
    desc: 'Trains 1 soldier every 20s. Needs 2 workers.',
  },
  tower: {
    key: 'tower', name: 'Tower', cost: { stone: 60, wood: 20 }, workerCost: 1, hp: 120,
    range: 3, damage: 10, attackInterval: 1, attack: true, placeable: true,
    desc: 'Attacks enemies within 3 tiles. Needs 1 worker.',
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
