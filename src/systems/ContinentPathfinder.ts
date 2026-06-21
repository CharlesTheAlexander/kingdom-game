// ============================================================================
// ContinentPathfinder.ts — Phase 2 (Bannerlord rebuild) A* over the tile grid.
// ============================================================================
//
// A* on the 1500×1500 biome grid using per-biome movementCost as the step cost.
// Impassable tiles (MOUNTAIN_PEAK / OCEAN, i.e. biomeData.passable === false)
// are never entered.
//
// DESIGN DECISIONS
// ----------------
// * 8-directional movement. Diagonal step cost is the tile cost × √2 so paths
//   read naturally and don't zig-zag.
// * BOUNDED SEARCH. A naive A* over 2.25M tiles could explode if the player
//   clicks an unreachable tile (e.g. across an ocean). We cap the number of
//   expanded nodes (MAX_EXPANSIONS). If we blow the cap we return the best
//   partial path toward the goal — the party still moves sensibly and the world
//   never stalls.
// * BINARY-HEAP open set so each pop is O(log n); with the expansion cap the
//   whole search stays well under a frame even for long cross-map routes.
// * Cost arrays are sized to the search bound, not the whole world, by hashing
//   visited tiles into Maps — we never allocate a 2.25M-entry array per query.
// ============================================================================

import type { WorldState } from './WorldGenerator.js';
import { biomeData } from '../data/Biomes.js';

export interface PathStep { col: number; row: number; }

/** Result of a pathfinding query. `cost` is the summed movement cost (game-day
 *  proxy); `reached` is false when only a partial path toward the goal exists. */
export interface PathResult {
  path: PathStep[];
  cost: number;
  reached: boolean;
}

const MAX_EXPANSIONS = 9000; // hard cap on A* node expansions per query
const SQRT2 = Math.SQRT2;

// Minimal binary min-heap keyed by `f`. Stores packed tile indices.
class MinHeap {
  private keys: number[] = []; // tile index
  private fs: number[] = [];   // priority

  get size(): number { return this.keys.length; }

  push(key: number, f: number): void {
    this.keys.push(key); this.fs.push(f);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.fs[p] <= this.fs[i]) break;
      this.swap(i, p); i = p;
    }
  }

  pop(): number {
    const top = this.keys[0];
    const lastK = this.keys.pop()!;
    const lastF = this.fs.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lastK; this.fs[0] = lastF;
      let i = 0; const n = this.keys.length;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let s = i;
        if (l < n && this.fs[l] < this.fs[s]) s = l;
        if (r < n && this.fs[r] < this.fs[s]) s = r;
        if (s === i) break;
        this.swap(i, s); i = s;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const tk = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = tk;
    const tf = this.fs[a]; this.fs[a] = this.fs[b]; this.fs[b] = tf;
  }
}

export class ContinentPathfinder {
  private world: WorldState;
  private size: number;
  // Per-biome movement cost cache (Infinity for impassable).
  private cost: Float64Array;

  constructor(world: WorldState) {
    this.world = world;
    this.size = world.size;
    this.cost = new Float64Array(256);
    for (let b = 0; b < 256; b++) {
      const d = biomeData(b);
      this.cost[b] = d.passable ? d.movementCost : Infinity;
    }
  }

  passable(col: number, row: number): boolean {
    if (col < 0 || row < 0 || col >= this.size || row >= this.size) return false;
    const b = this.world.tileBiome[row * this.size + col];
    return this.cost[b] !== Infinity;
  }

  /** Movement cost to ENTER (col,row); Infinity if impassable/out of bounds. */
  tileCost(col: number, row: number): number {
    if (col < 0 || row < 0 || col >= this.size || row >= this.size) return Infinity;
    return this.cost[this.world.tileBiome[row * this.size + col]];
  }

  /** A* from (sc,sr) to (tc,tr). Returns a (possibly partial) path. */
  find(sc: number, sr: number, tc: number, tr: number): PathResult {
    const size = this.size;
    const startI = sr * size + sc;
    const goalI = tr * size + tc;

    // If the goal is impassable, snap to the nearest passable neighbour so a
    // click on a peak/ocean edge still routes to the adjacent shore/foothill.
    if (!this.passable(tc, tr)) {
      const snap = this.nearestPassable(tc, tr);
      if (!snap) return { path: [], cost: 0, reached: false };
      tc = snap.col; tr = snap.row;
    }
    if (sc === tc && sr === tr) return { path: [], cost: 0, reached: true };

    const open = new MinHeap();
    const gScore = new Map<number, number>();
    const cameFrom = new Map<number, number>();
    gScore.set(startI, 0);
    open.push(startI, this.heuristic(sc, sr, tc, tr));

    let expansions = 0;
    let best = startI; // closest-to-goal node seen, for partial fallback
    let bestH = this.heuristic(sc, sr, tc, tr);

    while (open.size > 0) {
      const cur = open.pop();
      if (cur === goalI) return this.reconstruct(cameFrom, cur, gScore.get(cur) || 0, true);
      if (++expansions > MAX_EXPANSIONS) break;

      const ccol = cur % size, crow = (cur - ccol) / size;
      const curG = gScore.get(cur)!;

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dc && !dr) continue;
          const ncol = ccol + dc, nrow = crow + dr;
          const stepCost = this.tileCost(ncol, nrow);
          if (stepCost === Infinity) continue;
          // Prevent cutting diagonally through two impassable orthogonal tiles.
          if (dc !== 0 && dr !== 0) {
            if (this.tileCost(ccol + dc, crow) === Infinity &&
                this.tileCost(ccol, crow + dr) === Infinity) continue;
          }
          const ni = nrow * size + ncol;
          const move = (dc !== 0 && dr !== 0) ? stepCost * SQRT2 : stepCost;
          const tentative = curG + move;
          const known = gScore.get(ni);
          if (known === undefined || tentative < known) {
            gScore.set(ni, tentative);
            cameFrom.set(ni, cur);
            const h = this.heuristic(ncol, nrow, tc, tr);
            open.push(ni, tentative + h);
            if (h < bestH) { bestH = h; best = ni; }
          }
        }
      }
    }

    // No full path within the budget — return the best partial toward the goal.
    if (best !== startI) {
      return this.reconstruct(cameFrom, best, gScore.get(best) || 0, false);
    }
    return { path: [], cost: 0, reached: false };
  }

  // Octile distance heuristic (admissible for 8-dir with our min step cost = 1).
  private heuristic(c: number, r: number, tc: number, tr: number): number {
    const dx = Math.abs(c - tc), dy = Math.abs(r - tr);
    return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
  }

  private reconstruct(cameFrom: Map<number, number>, end: number, cost: number, reached: boolean): PathResult {
    const size = this.size;
    const path: PathStep[] = [];
    let cur: number | undefined = end;
    while (cur !== undefined) {
      const col = cur % size, row = (cur - col) / size;
      path.push({ col, row });
      cur = cameFrom.get(cur);
    }
    path.reverse();
    // Drop the start tile (the party is already standing on it).
    if (path.length > 1) path.shift();
    return { path, cost, reached };
  }

  /** Spiral outward (bounded) to find the closest passable tile to (col,row). */
  private nearestPassable(col: number, row: number): PathStep | null {
    for (let r = 1; r <= 20; r++) {
      for (let dr = -r; dr <= r; dr++) {
        for (let dc = -r; dc <= r; dc++) {
          if (Math.abs(dc) !== r && Math.abs(dr) !== r) continue; // ring only
          if (this.passable(col + dc, row + dr)) return { col: col + dc, row: row + dr };
        }
      }
    }
    return null;
  }
}
