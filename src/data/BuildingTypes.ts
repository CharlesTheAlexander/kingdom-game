// Definitions for every building type in the game (Phase 1 resource overhaul).
// Costs are objects keyed by resource: { wood, stone, food, gold }.
// `workerCost` = workers consumed to operate the building (population).
// Production buildings set `produces` + `rate` (per `interval` seconds, default 1s)
// and `production: true` to mark them as places worker pawns visit (Phase 3).
// Each building's sprite/texture key == its key (loaded in GameScene.preload()).

// (Phase 2 — worker allocation) Production buildings define `maxWorkers` and a
// `workerRates` table indexed by the number of allocated workers (rate per sec
// for `produces`). 0 workers = 0 production. Workers are assigned manually.
import type { BuildingType, ResourceCost } from '../types';

export const BuildingTypes: Record<string, BuildingType> = {
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
  // (Expansion Phase 5) Library — unlocks the research tree. Reuses the mine
  // sprite (tinted blue + floating book icon) since the pack has no library art.
  library: {
    key: 'library', name: 'Library', cost: { gold: 100, wood: 80, stone: 40 }, maxWorkers: 2, hp: 130,
    footprint: 2, placeable: true, stageUnlock: 2,
    desc: 'Unlocks research. 1 worker = 1 tech / 3 days, 2 workers = faster.',
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
  // (Completion Phase 2) Manufacturing — refine raw materials into goods that
  // advanced upgrades require. Handled specially in Building.produce().
  sawmill: {
    key: 'sawmill', name: 'Sawmill', cost: { wood: 60, stone: 20 }, maxWorkers: 2, hp: 100,
    produces: 'planks', refineFrom: 'wood', production: true, placeable: true, stageUnlock: 2, tex: 'lumberyard',
    desc: 'Converts Wood into Planks. 1 worker: 1 plank/2 wood/day. 2: 1 plank/1 wood/day.',
  },
  stonecutter: {
    key: 'stonecutter', name: 'Stonecutter', cost: { stone: 40, gold: 30 }, maxWorkers: 2, hp: 100,
    produces: 'cutStone', refineFrom: 'stone', production: true, placeable: true, stageUnlock: 2, tex: 'mine',
    desc: 'Cuts Stone into Cut Stone. 1 worker: 1/2 stone/day. 2: 1/1 stone/day.',
  },
  // (Completion Phase 3) Treasury — unlocks banking (reserves + loans).
  treasury: {
    key: 'treasury', name: 'Treasury', cost: { gold: 200, stone: 100, cutStone: 50 }, maxWorkers: 1, hp: 160,
    footprint: 2, placeable: true, stageUnlock: 7,
    desc: 'Banking: deposit gold for 2%/week interest, or take loans (repay +20%).',
  },
  wall: {
    key: 'wall', name: 'Wall', cost: { stone: 20 }, maxWorkers: 0, hp: 100,
    wall: true, placeable: true, noCap: true, anywhere: true, stageUnlock: 3,
    desc: 'Blocks enemies (100 HP). Place along your border, anywhere.',
  },
};

// Order shown in the build menu. (Phase 4 Decision 1) 'wall' removed — walls now
// grow automatically by settlement tier. The wall type def is kept above only so
// old saves containing a placed Wall still load without error.
export const BUILD_ORDER = ['house', 'lumberyard', 'mine', 'farm', 'barracks', 'tower', 'watchtower', 'market', 'tavern', 'blacksmith', 'library', 'sawmill', 'stonecutter', 'treasury'];
export const PLACEABLE = BUILD_ORDER.map((k) => BuildingTypes[k]);

// (Loop 3, Feature #3) Buildings upgrade through 5 levels. Output scales on a
// gentle curve (not the old 2^level, which would be 16x at L5). Levels 4–5 also
// grant per-building perks (see Building.produce / trainUnit).
export const MAX_LEVEL = 5;

const OUTPUT_CURVE = [1, 1.5, 2.25, 3, 4]; // index = level-1

// Upgrades cost GOLD only and rise each level (gates the high tiers).
export function upgradeCost(type: string, level: number): number {
  return Math.round(60 * Math.pow(1.8, level - 1));
}
export function outputMultiplier(level: number): number {
  return OUTPUT_CURVE[Math.max(0, Math.min(OUTPUT_CURVE.length - 1, level - 1))] || 1;
}

const RES_ABBR: Record<string, string> = { gold: 'G', wood: 'W', stone: 'S', food: 'F', iron: 'Fe', equipment: 'Eq' };
export function formatCost(cost: ResourceCost): string {
  const parts = Object.entries(cost).map(([k, v]) => `${v}${RES_ABBR[k] || k}`);
  return parts.length ? parts.join(' ') : 'Free';
}
