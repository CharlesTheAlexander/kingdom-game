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
    // (Polish Phase 6 balance) Trimmed 2 -> 1.5 gold/sec. Sim showed ~600 gold/day
    // vs early costs of 30-150 made gold trivially oversupplied; 1.5/s (~450/day)
    // is still comfortable but less absurd. See BALANCE_REPORT.md.
    produces: 'gold', rate: 1.5, placeable: false,
    desc: 'The heart of your kingdom. Always generates 1.5 gold/sec. Protect it!',
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
  // (Phase 2) Advanced buildings, gated by settlement stage (see stageUnlock).
  market: {
    key: 'market', name: 'Market', cost: { gold: 100, wood: 60 }, maxWorkers: 1, hp: 120,
    footprint: 2, placeable: true, stageUnlock: 4,
    desc: 'Trade resources at fixed ratios, as often as you like. Needs 1 worker.',
  },
  blacksmith: {
    key: 'blacksmith', name: 'Blacksmith', cost: { gold: 80, stone: 60, iron: 20 }, maxWorkers: 2, hp: 150,
    footprint: 2, placeable: true, stageUnlock: 5,
    desc: 'Crafts Equipment (1/day per worker). Enables Knight training. 1-2 workers.',
  },
  watchtower: {
    key: 'watchtower', name: 'Watchtower', cost: { wood: 40, stone: 20 }, maxWorkers: 1, hp: 100,
    revealRadius: 8, placeable: true, stageUnlock: 2,
    desc: 'Reveals fog within 8 tiles. Does not attack. Needs 1 worker.',
  },
  tavern: {
    key: 'tavern', name: 'Tavern', cost: { gold: 80, wood: 60 }, maxWorkers: 1, hp: 130,
    footprint: 2, placeable: true, stageUnlock: 3,
    desc: '+10 battle morale. Recruit a mercenary (50g / 3 days). Needs 1 worker.',
  },
  wall: {
    key: 'wall', name: 'Wall', cost: { stone: 20 }, maxWorkers: 0, hp: 100,
    wall: true, placeable: true, noCap: true, anywhere: true, stageUnlock: 3,
    desc: 'Blocks enemies (100 HP). Place along your border, anywhere.',
  },
};

// Order shown in the build menu. Advanced types appear once their stage unlocks.
export const BUILD_ORDER = ['house', 'lumberyard', 'mine', 'farm', 'barracks', 'tower', 'watchtower', 'wall', 'market', 'tavern', 'blacksmith'];
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

const RES_ABBR = { gold: 'G', wood: 'W', stone: 'S', food: 'F', iron: 'Fe', equipment: 'Eq' };
export function formatCost(cost) {
  const parts = Object.entries(cost).map(([k, v]) => `${v}${RES_ABBR[k] || k}`);
  return parts.length ? parts.join(' ') : 'Free';
}
