// ============================================================================
// WorldGenerator.ts — Phase 1 (Bannerlord rebuild) procedural world generation.
// ============================================================================
//
// Produces a deterministic 1500×1500-tile continent: heightmap, temperature &
// moisture fields, per-tile biomes, carved rivers, resource nodes, named
// regions/rivers, and the placement of player + AI factions, neutral
// settlements, goblin camps and ancient ruins.
//
// NO EXTERNAL LIBRARIES OR ASSETS. The PRNG and the 2D fractal value-noise are
// implemented here from a seeded permutation table. Same seed ⇒ identical world.
//
// ============================================================================
// KEY DESIGN DECISIONS
// ============================================================================
//
// 1. WORLD SIZE — 1500×1500 = 2,250,000 tiles. Big enough to feel like a
//    Bannerlord/Northgard continent, small enough that the per-tile typed
//    arrays stay cheap:
//        tileBiome     : Uint8Array  ~2.25 MB
//        tileElevation : Float32Array ~9.00 MB
//    (~11 MB total — fits comfortably in memory; generated once at new-game.)
//
// 2. NOISE — value noise (bilinear-interpolated lattice with a smootherstep
//    fade), built from a seeded 512-entry permutation. Value noise is cheaper
//    than simplex and visually indistinguishable once fractalised across 3
//    octaves, and it is trivial to make fully deterministic from one seed.
//    Three independent permutations (height / temperature / moisture) come from
//    three derived seeds so the fields are uncorrelated.
//
// 3. HEIGHTMAP — exactly the spec's octave mix:
//        h = oct(.003)*0.6 + oct(.01)*0.3 + oct(.04)*0.1
//    then a radial "continent" falloff pushes the map edges down into ocean so
//    we get a single landmass with coasts (not a wrapping noise plane), then
//    normalize 0..1.
//
// 4. RENDERING (see ChunkManager.ts) — the continent renders TOP-DOWN
//    (orthographic), NOT isometric. True iso of 2.25M tiles cannot hold 30 FPS;
//    a top-down grid of small colored cells, chunked & cached, can. This module
//    only produces DATA; ChunkManager turns it into cached chunk textures.
//
// 5. The generated WorldState is cached in module scope (`lastWorld`) so a later
//    phase's SaveManager can serialize it — but SaveManager is NOT touched here.
// ============================================================================

import { Biome, BIOME_COUNT, classifyBiome } from '../data/Biomes.js';

// ----------------------------------------------------------------------------
// 1. Seeded PRNG — mulberry32. Tiny, fast, good-enough statistical quality for
//    a game world, and 100% deterministic from a 32-bit seed.
// ----------------------------------------------------------------------------
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ----------------------------------------------------------------------------
// 2. Seeded 2D fractal value noise.
// ----------------------------------------------------------------------------
// A ValueNoise2D owns a 512-entry permutation derived from one seed and a small
// hash that maps lattice coords → a pseudo-random gradient value in [0,1).
// `fractal()` sums octaves at the caller-supplied base scale.
class ValueNoise2D {
  private perm: Uint8Array;

  constructor(seed: number) {
    // Build a 0..255 permutation, Fisher–Yates shuffled with a seeded PRNG,
    // then duplicated to 512 to avoid index wrapping in the hash.
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  // Pseudo-random value in [0,1) for an integer lattice point.
  private hash(ix: number, iy: number): number {
    const p = this.perm;
    // & 255 keeps indices in range; the double lookup decorrelates x & y.
    const h = p[(p[ix & 255] + iy) & 511];
    return h / 255;
  }

  // smootherstep (Perlin's 6t^5-15t^4+10t^3) for C2-continuous interpolation.
  private static fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  /** Single-octave value noise at world coords (x,y) for a given scale. */
  noise(x: number, y: number): number {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = ValueNoise2D.fade(x - x0);
    const fy = ValueNoise2D.fade(y - y0);
    const v00 = this.hash(x0, y0);
    const v10 = this.hash(x0 + 1, y0);
    const v01 = this.hash(x0, y0 + 1);
    const v11 = this.hash(x0 + 1, y0 + 1);
    const top = v00 + (v10 - v00) * fx;
    const bot = v01 + (v11 - v01) * fx;
    return top + (bot - top) * fy; // 0..1
  }
}

// ----------------------------------------------------------------------------
// WorldState + node/settlement/faction types
// ----------------------------------------------------------------------------
export type ResourceType =
  | 'wood' | 'gold' | 'stone' | 'iron' | 'farmland' | 'fish' | 'minerals';

export interface ResourceNode { type: ResourceType; col: number; row: number; }

export type SettlementKind =
  | 'player_castle' | 'ai_castle' | 'neutral' | 'goblin_camp' | 'ruin'
  // (Phase 5 Mercenary Camps) a roaming sellsword camp the player can travel to
  // and hire troops directly into the field party at a favourable rate.
  | 'mercenary';

export interface Settlement {
  kind: SettlementKind;
  name: string;
  col: number;
  row: number;
  biome: Biome;
  /** neutral settlements: a biome-matched economic specialty. */
  specialty?: ResourceType;
  /** ai_castle / player_castle: owning faction key. */
  faction?: string;
}

export interface Faction {
  key: string;
  name: string;
  /** 0xRRGGBB banner colour (matches existing AIKingdom palette). */
  color: number;
  personality: 'player' | 'aggressive' | 'merchant' | 'expansionist';
  castleCol: number;
  castleRow: number;
}

export interface RiverInfo {
  name: string;
  /** ordered tile path from source (peak) to mouth (sea/lake). */
  path: Array<{ col: number; row: number }>;
}

// (Phase 9) Bridges are DESTRUCTIBLE crossings. `id` is a stable key (so save +
// destroy/rebuild can reference it), `riverIdx` is which river it spans (for the
// river-control helper), and `destroyed` reverts a crossing to the slow ford cost.
// Serialization-friendly: plain fields, no live objects.
export interface BridgeInfo { id: string; col: number; row: number; riverIdx: number; destroyed?: boolean; }

export interface WorldState {
  seed: number;
  size: number;                 // 1500
  tileBiome: Uint8Array;        // size*size, values are Biome ids
  tileElevation: Float32Array;  // size*size, normalized 0..1
  resourceNodes: ResourceNode[];
  settlements: Settlement[];
  factions: Faction[];
  rivers: RiverInfo[];
  bridges: BridgeInfo[];
  regionNames: string[];
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------
const SIZE = 1500;
const TILES = SIZE * SIZE;

// Spec octave scales for the heightmap.
const H_OCT1 = 0.003, H_OCT2 = 0.01, H_OCT3 = 0.04;
const TEMP_SCALE = 0.005;
const MOIST_SCALE = 0.008;

// Seed offsets so the three fields use uncorrelated permutations.
const SEED_OFFSET_TEMP = 0x9e3779b1 | 0;
const SEED_OFFSET_MOIST = 0x85ebca6b | 0;

// Module-cached last world (for a future SaveManager — not modified this phase).
let lastWorld: WorldState | null = null;
export function getLastWorld(): WorldState | null { return lastWorld; }

const idx = (col: number, row: number) => row * SIZE + col;

// ----------------------------------------------------------------------------
// 6. Procedural medieval name table
// ----------------------------------------------------------------------------
const NAME_PREFIX = [
  'Black', 'White', 'Grey', 'Red', 'Gold', 'Iron', 'Stone', 'Oak', 'Thorn',
  'Frost', 'Storm', 'Raven', 'Wolf', 'Bram', 'Ash', 'Fen', 'Mire', 'Dun',
  'High', 'Wind', 'Bright', 'Shadow', 'Elder', 'Wyn', 'Mar', 'Cald', 'Vor',
];
const NAME_SUFFIX = [
  'haven', 'hold', 'ford', 'wick', 'mere', 'fell', 'crag', 'moor', 'reach',
  'gard', 'keep', 'watch', 'vale', 'march', 'brook', 'wood', 'glen', 'spire',
  'barrow', 'hollow', 'rest', 'gate', 'cairn', 'stead', 'thorpe',
];
const RIVER_SUFFIX = ['water', 'run', 'flow', 'rede', 'esk', 'wash', 'burn', 'dance', 'reach'];
const REGION_SUFFIX = ['Reach', 'Wold', 'Marches', 'Expanse', 'Downs', 'Vale', 'Wilds', 'Holt', 'Steppe'];

function makeName(rnd: () => number, suffixes: string[]): string {
  const p = NAME_PREFIX[Math.floor(rnd() * NAME_PREFIX.length)];
  const s = suffixes[Math.floor(rnd() * suffixes.length)];
  return p + s;
}

// ============================================================================
// generateWorld(seed?) — the entry point.
// ============================================================================
export function generateWorld(seed: number = (Math.random() * 0xffffffff) >>> 0): WorldState {
  seed = seed >>> 0;
  const rnd = mulberry32(seed);

  // --- Noise generators (3 uncorrelated fields) --------------------------
  const heightNoise = new ValueNoise2D(seed);
  const tempNoise = new ValueNoise2D((seed + SEED_OFFSET_TEMP) >>> 0);
  const moistNoise = new ValueNoise2D((seed + SEED_OFFSET_MOIST) >>> 0);

  const tileElevation = new Float32Array(TILES);
  const tileBiome = new Uint8Array(TILES);
  // Temperature & moisture are needed for biome classification AND for resource
  // / river logic; we keep moisture mutable so rivers can boost it.
  const temperature = new Float32Array(TILES);
  const moisture = new Float32Array(TILES);

  // --- 2. Heightmap + temperature + moisture -----------------------------
  // First pass: raw fields. Track min/max height for normalization.
  const cx = SIZE / 2, cy = SIZE / 2;
  const maxR = Math.hypot(cx, cy);
  let hMin = Infinity, hMax = -Infinity;

  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const i = idx(col, row);

      // 3-octave height per spec.
      const h =
        heightNoise.noise(col * H_OCT1, row * H_OCT1) * 0.6 +
        heightNoise.noise(col * H_OCT2, row * H_OCT2) * 0.3 +
        heightNoise.noise(col * H_OCT3, row * H_OCT3) * 0.1;

      // Radial continent falloff: a single landmass surrounded by ocean.
      // d=0 at centre, 1 at the far corner; subtract a curved falloff so the
      // outer ring drops below the OCEAN threshold.
      const d = Math.hypot(col - cx, row - cy) / maxR;
      const falloff = Math.pow(d, 2.1) * 0.9;
      const hv = h - falloff;

      tileElevation[i] = hv;
      if (hv < hMin) hMin = hv;
      if (hv > hMax) hMax = hv;

      // Temperature: base noise + a north→south gradient (cooler north,
      // warmer south). row 0 = north.
      const latWarmth = row / SIZE; // 0 (north/cool) .. 1 (south/warm)
      const tRaw = tempNoise.noise(col * TEMP_SCALE, row * TEMP_SCALE);
      temperature[i] = tRaw * 0.6 + latWarmth * 0.4;

      // Moisture: pure noise for now; rivers boost nearby tiles afterwards.
      moisture[i] = moistNoise.noise(col * MOIST_SCALE, row * MOIST_SCALE);
    }
  }

  // Normalize elevation to 0..1.
  const hRange = hMax - hMin || 1;
  for (let i = 0; i < TILES; i++) {
    tileElevation[i] = (tileElevation[i] - hMin) / hRange;
  }
  // Higher ground is cooler: subtract elevation influence from temperature so
  // peaks read alpine even in the warm south.
  for (let i = 0; i < TILES; i++) {
    temperature[i] = Math.min(1, Math.max(0, temperature[i] - tileElevation[i] * 0.25));
  }

  // --- 4. Rivers: carve BEFORE biome classification so river tiles win, and
  //        so moisture boost feeds into lush/wetland classification. ---------
  const rivers = carveRivers(seed, tileElevation, moisture);

  // --- 3. Biome assignment per tile --------------------------------------
  for (let i = 0; i < TILES; i++) {
    tileBiome[i] = classifyBiome(tileElevation[i], temperature[i], moisture[i]);
  }
  // Overwrite carved river paths with RIVER biome (only on land — a river that
  // reaches the sea simply ends there).
  for (const river of rivers) {
    for (const { col, row } of river.path) {
      const i = idx(col, row);
      if (tileBiome[i] !== Biome.OCEAN && tileBiome[i] !== Biome.COAST) {
        tileBiome[i] = Biome.RIVER;
      }
    }
  }

  // --- 5. Resource nodes -------------------------------------------------
  const resourceNodes = placeResources(seed, tileBiome, rivers);

  // --- 6. Region & river names -------------------------------------------
  const regionNames: string[] = [];
  const regionRnd = mulberry32((seed + 0x1234) >>> 0);
  for (let i = 0; i < 5; i++) {
    const p = NAME_PREFIX[Math.floor(regionRnd() * NAME_PREFIX.length)];
    const s = REGION_SUFFIX[Math.floor(regionRnd() * REGION_SUFFIX.length)];
    regionNames.push(`The ${p} ${s}`);
  }
  // Name the carved rivers.
  const riverRnd = mulberry32((seed + 0x5678) >>> 0);
  for (const r of rivers) r.name = `The ${makeName(riverRnd, RIVER_SUFFIX)}`;

  // --- 7. Factions, settlements, camps, ruins ----------------------------
  const { factions, settlements } = placeFactionsAndSettlements(
    seed, tileBiome, tileElevation, rivers,
  );

  // --- bridges: mark a few river-crossing tiles for Phase 2 --------------
  const bridges = placeBridges(seed, tileBiome, rivers);

  const world: WorldState = {
    seed,
    size: SIZE,
    tileBiome,
    tileElevation,
    resourceNodes,
    settlements,
    factions,
    rivers,
    bridges,
    regionNames,
  };
  lastWorld = world;
  return world;
}

// ============================================================================
// 4. Rivers — find high "peak" sources, flow downhill via steepest descent.
// ============================================================================
// We sample a set of candidate sources near the high country, then for each we
// walk to the lowest neighbour repeatedly until we hit the sea, a basin
// (local minimum), or a step limit. 3–5 long rivers are kept. Each river boosts
// moisture in a small radius around its path (feeds lush/wetland biomes).
function carveRivers(
  seed: number,
  elevation: Float32Array,
  moisture: Float32Array,
): RiverInfo[] {
  const rnd = mulberry32((seed + 0xa5a5) >>> 0);
  const rivers: RiverInfo[] = [];
  const TARGET = 4;            // aim for 4 major rivers (within the 3–5 range)
  const MIN_LEN = 120;         // a "major" river must cross a lot of land
  const SEA_LEVEL = 0.15;      // matches OCEAN threshold

  // Collect high candidate sources by random sampling (cheaper than scanning
  // all 2.25M tiles) and keeping the highest hits.
  const candidates: Array<{ col: number; row: number; h: number }> = [];
  for (let k = 0; k < 4000; k++) {
    const col = 1 + Math.floor(rnd() * (SIZE - 2));
    const row = 1 + Math.floor(rnd() * (SIZE - 2));
    const h = elevation[idx(col, row)];
    if (h > 0.7) candidates.push({ col, row, h });
  }
  candidates.sort((a, b) => b.h - a.h);

  const used = new Set<number>(); // tiles already part of a river

  for (const src of candidates) {
    if (rivers.length >= TARGET) break;

    const path: Array<{ col: number; row: number }> = [];
    let col = src.col, row = src.row;
    let prevH = elevation[idx(col, row)];

    for (let step = 0; step < 4000; step++) {
      const i = idx(col, row);
      if (used.has(i)) break;           // merged into an existing river
      path.push({ col, row });

      if (elevation[i] <= SEA_LEVEL) break; // reached the sea

      // steepest descent over 8-neighbourhood
      let bestH = prevH, bc = col, br = row;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dc && !dr) continue;
          const nc = col + dc, nr = row + dr;
          if (nc < 0 || nr < 0 || nc >= SIZE || nr >= SIZE) continue;
          const nh = elevation[idx(nc, nr)];
          if (nh < bestH) { bestH = nh; bc = nc; br = nr; }
        }
      }
      if (bc === col && br === row) break; // basin / local minimum — stop
      col = bc; row = br; prevH = bestH;
    }

    if (path.length < MIN_LEN) continue; // not a major river

    // Reserve the path tiles and a margin so rivers don't bunch up.
    for (const p of path) used.add(idx(p.col, p.row));
    rivers.push({ name: '', path });

    // Boost moisture in a radius-3 band around the path.
    for (const p of path) {
      for (let dr = -3; dr <= 3; dr++) {
        for (let dc = -3; dc <= 3; dc++) {
          const nc = p.col + dc, nr = p.row + dr;
          if (nc < 0 || nr < 0 || nc >= SIZE || nr >= SIZE) continue;
          const dist = Math.abs(dc) + Math.abs(dr);
          const boost = Math.max(0, 0.35 - dist * 0.05);
          const j = idx(nc, nr);
          moisture[j] = Math.min(1, moisture[j] + boost);
        }
      }
    }
  }

  return rivers;
}

// ============================================================================
// 5. Resource nodes — placed biome-appropriately by sparse random sampling.
// ============================================================================
// Mapping (per spec):
//   lush forest → wood (+ sparse gold)   highland → stone + iron
//   peak        → iron + gold            plains   → farmland + stone
//   coast/river → fish                   desert   → gold
//   tundra      → rare minerals
// We sample N random tiles and emit a node when the tile's biome matches, with
// per-biome probabilities so wood/stone are common and gold/minerals are rare.
function placeResources(
  seed: number,
  biome: Uint8Array,
  rivers: RiverInfo[],
): ResourceNode[] {
  const rnd = mulberry32((seed + 0xbeef) >>> 0);
  const nodes: ResourceNode[] = [];
  const SAMPLES = 60000; // ~2.7% of tiles sampled; yields a few thousand nodes

  const emit = (type: ResourceType, col: number, row: number) =>
    nodes.push({ type, col, row });

  for (let k = 0; k < SAMPLES; k++) {
    const col = Math.floor(rnd() * SIZE);
    const row = Math.floor(rnd() * SIZE);
    const b = biome[idx(col, row)] as Biome;
    const r = rnd();
    switch (b) {
      case Biome.LUSH_FOREST:
      case Biome.ALPINE_FOREST:
        if (r < 0.30) emit('wood', col, row);
        else if (r < 0.33) emit('gold', col, row);     // sparse gold
        break;
      case Biome.HIGHLAND:
        if (r < 0.22) emit('stone', col, row);
        else if (r < 0.35) emit('iron', col, row);
        break;
      case Biome.MOUNTAIN_PEAK:
        if (r < 0.18) emit('iron', col, row);
        else if (r < 0.28) emit('gold', col, row);
        break;
      case Biome.PLAINS:
        if (r < 0.16) emit('farmland', col, row);
        else if (r < 0.22) emit('stone', col, row);
        break;
      case Biome.DESERT:
        if (r < 0.20) emit('gold', col, row);
        break;
      case Biome.TUNDRA:
        if (r < 0.10) emit('minerals', col, row);      // rare minerals
        break;
      case Biome.COAST:
        if (r < 0.18) emit('fish', col, row);
        break;
      default:
        break;
    }
  }

  // Guarantee some fish along the rivers (coast sampling can miss inland rivers).
  const riverRnd = mulberry32((seed + 0xfee1) >>> 0);
  for (const river of rivers) {
    for (let i = 0; i < river.path.length; i += 25) {
      if (riverRnd() < 0.5) {
        const p = river.path[i];
        emit('fish', p.col, p.row);
      }
    }
  }

  return nodes;
}

// ============================================================================
// 7. Factions + settlements + goblin camps + ruins, with min-distance rules.
// ============================================================================
function placeFactionsAndSettlements(
  seed: number,
  biome: Uint8Array,
  elevation: Float32Array,
  rivers: RiverInfo[],
): { factions: Faction[]; settlements: Settlement[] } {
  const rnd = mulberry32((seed + 0xc0ffee) >>> 0);
  const factions: Faction[] = [];
  const settlements: Settlement[] = [];
  const nameRnd = mulberry32((seed + 0xd00d) >>> 0);

  const dist = (ac: number, ar: number, bc: number, br: number) =>
    Math.hypot(ac - bc, ar - br);

  // Build a quick set of "near river" tiles for placement queries.
  const riverTiles = new Set<number>();
  for (const r of rivers) for (const p of r.path) riverTiles.add(idx(p.col, p.row));
  const nearRiver = (col: number, row: number, radius = 6): boolean => {
    for (let dr = -radius; dr <= radius; dr += 2) {
      for (let dc = -radius; dc <= radius; dc += 2) {
        const nc = col + dc, nr = row + dr;
        if (nc < 0 || nr < 0 || nc >= SIZE || nr >= SIZE) continue;
        if (riverTiles.has(idx(nc, nr))) return true;
      }
    }
    return false;
  };

  // Generic constrained finder: try random tiles until one satisfies `ok`,
  // is far enough from all already-placed `avoid` points, and is on land.
  const findSpot = (
    ok: (col: number, row: number, b: Biome, h: number) => boolean,
    avoid: Array<{ col: number; row: number; min: number }>,
    tries = 20000,
  ): { col: number; row: number } | null => {
    for (let t = 0; t < tries; t++) {
      const col = Math.floor(rnd() * SIZE);
      const row = Math.floor(rnd() * SIZE);
      const i = idx(col, row);
      const b = biome[i] as Biome;
      const h = elevation[i];
      if (b === Biome.OCEAN || b === Biome.MOUNTAIN_PEAK) continue;
      if (!ok(col, row, b, h)) continue;
      let bad = false;
      for (const a of avoid) {
        if (dist(col, row, a.col, a.row) < a.min) { bad = true; break; }
      }
      if (bad) continue;
      return { col, row };
    }
    return null;
  };

  const placed: Array<{ col: number; row: number; min: number }> = [];

  // --- AI factions (place first; player is then pushed ≥400 tiles away) ---
  // Red (aggressive) → highland / mountain edge.
  const redSpot =
    findSpot((c, r, b) => b === Biome.HIGHLAND || b === Biome.ALPINE_FOREST, placed) ||
    findSpot((c, r, b) => b !== Biome.OCEAN, placed)!;
  factions.push({
    key: 'red', name: 'Red Kingdom', color: 0xc0392b, personality: 'aggressive',
    castleCol: redSpot.col, castleRow: redSpot.row,
  });
  placed.push({ col: redSpot.col, row: redSpot.row, min: 250 });

  // Purple (merchant) → plains near a river.
  const purpleSpot =
    findSpot((c, r, b) => b === Biome.PLAINS && nearRiver(c, r), placed) ||
    findSpot((c, r, b) => b === Biome.PLAINS, placed)!;
  factions.push({
    key: 'purple', name: 'Purple Kingdom', color: 0x8e44ad, personality: 'merchant',
    castleCol: purpleSpot.col, castleRow: purpleSpot.row,
  });
  placed.push({ col: purpleSpot.col, row: purpleSpot.row, min: 250 });

  // Yellow (expansionist) → large plains (just plains; expansion room implied).
  const yellowSpot =
    findSpot((c, r, b) => b === Biome.PLAINS, placed) ||
    findSpot((c, r, b) => b !== Biome.OCEAN, placed)!;
  factions.push({
    key: 'yellow', name: 'Yellow Kingdom', color: 0xf1c40f, personality: 'expansionist',
    castleCol: yellowSpot.col, castleRow: yellowSpot.row,
  });
  placed.push({ col: yellowSpot.col, row: yellowSpot.row, min: 250 });

  // --- Player → plains near river, balanced, ≥400 tiles from EVERY AI ------
  const aiAvoid = factions.map(f => ({ col: f.castleCol, row: f.castleRow, min: 400 }));
  let playerSpot =
    findSpot((c, r, b) => b === Biome.PLAINS && nearRiver(c, r), aiAvoid, 60000) ||
    findSpot((c, r, b) => b === Biome.PLAINS, aiAvoid, 60000) ||
    // last resort: any passable land ≥400 from AIs
    findSpot((c, r, b) => b !== Biome.OCEAN && b !== Biome.MOUNTAIN_PEAK, aiAvoid, 60000);

  // Absolute fallback (should never trigger on a normal continent): pick the
  // land tile maximizing the minimum distance to the AI castles.
  if (!playerSpot) {
    let best = { col: cxClamp(0), row: 0 }, bestD = -1;
    const rnd2 = mulberry32((seed + 0x7777) >>> 0);
    for (let t = 0; t < 40000; t++) {
      const col = Math.floor(rnd2() * SIZE), row = Math.floor(rnd2() * SIZE);
      const b = biome[idx(col, row)] as Biome;
      if (b === Biome.OCEAN || b === Biome.MOUNTAIN_PEAK) continue;
      let mind = Infinity;
      for (const a of aiAvoid) mind = Math.min(mind, dist(col, row, a.col, a.row));
      if (mind > bestD) { bestD = mind; best = { col, row }; }
    }
    playerSpot = best;
  }

  factions.push({
    key: 'player', name: 'Your Realm', color: 0x2e86de, personality: 'player',
    castleCol: playerSpot.col, castleRow: playerSpot.row,
  });
  const playerB = biome[idx(playerSpot.col, playerSpot.row)] as Biome;
  settlements.push({
    kind: 'player_castle', name: 'Your Castle', col: playerSpot.col, row: playerSpot.row,
    biome: playerB, faction: 'player',
  });
  placed.push({ col: playerSpot.col, row: playerSpot.row, min: 120 });

  // AI castles as settlements too.
  for (const f of factions) {
    if (f.personality === 'player') continue;
    settlements.push({
      kind: 'ai_castle', name: `${f.name} Hold`,
      col: f.castleCol, row: f.castleRow,
      biome: biome[idx(f.castleCol, f.castleRow)] as Biome, faction: f.key,
    });
  }

  // --- 9 neutral settlements (river crossings / valleys / coast) ----------
  const SPECIALTY_BY_BIOME: Partial<Record<Biome, ResourceType>> = {
    [Biome.PLAINS]: 'farmland',
    [Biome.LUSH_FOREST]: 'wood',
    [Biome.ALPINE_FOREST]: 'wood',
    [Biome.HIGHLAND]: 'stone',
    [Biome.MOUNTAIN_PEAK]: 'iron',
    [Biome.COAST]: 'fish',
    [Biome.DESERT]: 'gold',
    [Biome.TUNDRA]: 'minerals',
    [Biome.SCRUBLAND]: 'stone',
    [Biome.WETLAND]: 'fish',
    [Biome.RIVER]: 'fish',
  };
  // Rotate the *preferred* placement category per settlement so the 9 neutral
  // towns spread across river-valleys, coasts and inland biomes rather than all
  // clustering on the first biome the random sampler happens to hit. Each falls
  // back to any land if its preferred category can't be satisfied.
  const NEUTRAL_PREFS: Array<(c: number, r: number, b: Biome) => boolean> = [
    (c, r, b) => nearRiver(c, r) && b !== Biome.RIVER && b !== Biome.COAST, // river valley
    (c, r, b) => b === Biome.COAST,                                          // coast
    (c, r, b) => b === Biome.PLAINS,                                         // open plains
    (c, r, b) => b === Biome.LUSH_FOREST,                                    // forest town
    (c, r, b) => b === Biome.HIGHLAND,                                       // hill town
  ];
  for (let n = 0; n < 9; n++) {
    const pref = NEUTRAL_PREFS[n % NEUTRAL_PREFS.length];
    const spot =
      findSpot((c, r, b) => pref(c, r, b), placed, 12000) ||
      findSpot((c, r, b) => b === Biome.PLAINS || b === Biome.COAST, placed, 8000) ||
      findSpot((c, r, b) => b !== Biome.OCEAN && b !== Biome.MOUNTAIN_PEAK, placed, 8000);
    if (!spot) continue;
    const b = biome[idx(spot.col, spot.row)] as Biome;
    settlements.push({
      kind: 'neutral', name: makeName(nameRnd, NAME_SUFFIX),
      col: spot.col, row: spot.row, biome: b,
      specialty: SPECIALTY_BY_BIOME[b] ?? 'wood',
    });
    placed.push({ col: spot.col, row: spot.row, min: 90 });
  }

  // --- 9 goblin camps (forest / wildland edges, far from castles) ---------
  const campAvoid = [
    ...placed.filter(p => p.min >= 120), // keep clear of castles
  ];
  for (let n = 0; n < 9; n++) {
    const spot =
      findSpot((c, r, b) => b === Biome.LUSH_FOREST || b === Biome.ALPINE_FOREST || b === Biome.SCRUBLAND, campAvoid, 6000) ||
      findSpot((c, r, b) => b !== Biome.OCEAN && b !== Biome.MOUNTAIN_PEAK, campAvoid, 6000);
    if (!spot) continue;
    settlements.push({
      kind: 'goblin_camp', name: `${makeName(nameRnd, ['fang', 'maw', 'den', 'pit', 'warren'])} Camp`,
      col: spot.col, row: spot.row, biome: biome[idx(spot.col, spot.row)] as Biome,
    });
    campAvoid.push({ col: spot.col, row: spot.row, min: 60 });
  }

  // --- 6 ancient ruins (dramatic spots: high peaks, deserts, deep forest) --
  const ruinAvoid = [...placed.filter(p => p.min >= 120)];
  for (let n = 0; n < 6; n++) {
    const spot =
      findSpot((c, r, b, h) => (b === Biome.HIGHLAND || b === Biome.DESERT || b === Biome.LUSH_FOREST) && h > 0.55, ruinAvoid, 6000) ||
      findSpot((c, r, b) => b !== Biome.OCEAN, ruinAvoid, 6000);
    if (!spot) continue;
    settlements.push({
      kind: 'ruin', name: `Ruins of ${makeName(nameRnd, NAME_SUFFIX)}`,
      col: spot.col, row: spot.row, biome: biome[idx(spot.col, spot.row)] as Biome,
    });
    ruinAvoid.push({ col: spot.col, row: spot.row, min: 80 });
  }

  return { factions, settlements };
}

// tiny clamp helper used by the absolute-fallback player placement.
function cxClamp(v: number): number { return Math.max(0, Math.min(SIZE - 1, v)); }

// ============================================================================
// Bridges — mark a handful of river tiles as crossings for Phase 2 pathing.
// ============================================================================
function placeBridges(
  seed: number,
  biome: Uint8Array,
  rivers: RiverInfo[],
): BridgeInfo[] {
  const rnd = mulberry32((seed + 0xb2147) >>> 0);
  const bridges: BridgeInfo[] = [];
  for (let ri = 0; ri < rivers.length; ri++) {
    const river = rivers[ri];
    // 2–3 bridges per river, spaced along its course.
    const count = 2 + (rnd() < 0.5 ? 1 : 0);
    for (let b = 0; b < count; b++) {
      const i = Math.floor(((b + 1) / (count + 1)) * river.path.length);
      const p = river.path[i];
      if (p && biome[idx(p.col, p.row)] === Biome.RIVER) {
        // (Phase 9) stable id from river index + tile so destroy/rebuild + save can key it.
        bridges.push({ id: `br_${ri}_${p.col}_${p.row}`, col: p.col, row: p.row, riverIdx: ri });
      }
    }
  }
  return bridges;
}

// ----------------------------------------------------------------------------
// Small helpers for analysis/tests (used by the headless audit).
// ----------------------------------------------------------------------------
/** Histogram of biome ids across the whole world. Index = Biome id. */
export function biomeHistogram(world: WorldState): number[] {
  const hist = new Array(BIOME_COUNT).fill(0);
  const b = world.tileBiome;
  for (let i = 0; i < b.length; i++) hist[b[i]]++;
  return hist;
}

/** Count of carved river tiles in the biome map. */
export function riverTileCount(world: WorldState): number {
  let n = 0;
  const b = world.tileBiome;
  for (let i = 0; i < b.length; i++) if (b[i] === Biome.RIVER) n++;
  return n;
}
