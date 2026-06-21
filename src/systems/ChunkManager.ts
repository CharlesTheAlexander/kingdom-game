// ============================================================================
// ChunkManager.ts — Phase 1 (Bannerlord rebuild) chunked top-down map renderer.
// ============================================================================
//
// Turns the WorldState's per-tile biome/elevation data into a bounded set of
// cached chunk textures that Phase 2 can drive from a camera. Phase 1 is
// ADDITIVE — this class is a clean, self-contained API; nothing wires it into a
// scene yet.
//
// ============================================================================
// RENDERING DESIGN DECISIONS
// ============================================================================
//
// 1. TOP-DOWN, NOT ISOMETRIC. The continent map is orthographic: each tile is a
//    small axis-aligned colored cell. True isometric rendering of 2,250,000
//    tiles (depth-sorted diamonds, per-tile sprites) cannot hold 30 FPS at this
//    scale. A top-down grid of flat cells, pre-rasterised to chunk images, can.
//    (Per-settlement views in IsometricScene stay isometric — that's Phase 3.)
//
// 2. CHUNKS. The world is 1500×1500 tiles. We divide it into 50×50-tile chunks
//    ⇒ 30×30 = 900 chunks. Each chunk is pre-rendered ONCE to an offscreen
//    <canvas> at CHUNK_PX pixels per chunk (PX_PER_TILE px per tile), uploaded
//    to the GPU as a Phaser texture, and cached. Drawing 50×50 = 2500 fillRect
//    cells per chunk happens a single time per chunk lifetime.
//
// 3. MEMORY BUDGET. PX_PER_TILE = 4 ⇒ each chunk canvas is 200×200 px ⇒ 160 KB
//    of RGBA on the GPU. We keep at most MAX_RESIDENT (~36) chunks resident,
//    so the chunk texture pool is bounded to ~5.8 MB regardless of how the
//    camera roams. Chunks that leave the view+margin window are destroyed
//    (canvas + GPU texture freed). `update(view)` is the single entry point: it
//    computes the visible chunk window, loads what entered, unloads what left.
//
// 4. SOFT VARIATION. Each cell gets a tiny deterministic brightness jitter
//    derived from its tile coords so large biome regions don't look flat;
//    rivers are drawn on top, and resource nodes can be sprinkled as 1px dots.
//
// The class is renderer-agnostic about *placement*: it just builds textures and
// reports which chunks are visible. Phase 2 owns the camera and the Image game
// objects; ChunkManager owns the texture lifecycle.
// ============================================================================

import Phaser from 'phaser';
import type { WorldState } from './WorldGenerator.js';
import { biomeData, Biome } from '../data/Biomes.js';

export const CHUNK_TILES = 50;                 // 50×50 tiles per chunk
export const PX_PER_TILE = 4;                  // pixels per tile in a chunk image
export const CHUNK_PX = CHUNK_TILES * PX_PER_TILE; // 200 px per chunk side
// (Phase 2) Hard cap on resident chunks. The Phase-1 default of 36 was sized for
// a near-1× zoom; the continent's default zoom (~0.4×) over a 1440×900 viewport
// can show ~18×12 ≈ 220 chunks + a 1-chunk margin at once, so the cap MUST exceed
// the visible window or the LRU pass would evict chunks it just reported visible
// (binding an Image to a removed CanvasTexture crashes the canvas renderer).
// At PX_PER_TILE=4 a chunk texture is 200×200 RGBA ≈ 160 KB, so 320 chunks is a
// ~51 MB upper bound — comfortable for a desktop browser. evict() additionally
// NEVER LRU-drops a chunk inside the current visible window (see below), so the
// real resident set tracks the viewport regardless of this number.
export const MAX_RESIDENT = 320;               // hard cap on resident chunks

/** Camera view in WORLD-TILE space, used to compute visible chunks. */
export interface ChunkView {
  /** top-left tile column currently visible */
  tileLeft: number;
  /** top-left tile row currently visible */
  tileTop: number;
  /** number of tiles spanned horizontally by the viewport (after zoom) */
  tileWide: number;
  /** number of tiles spanned vertically by the viewport (after zoom) */
  tileHigh: number;
}

interface ResidentChunk {
  cx: number;
  cy: number;
  key: string;       // Phaser texture key
  lastSeen: number;  // frame/tick stamp for LRU eviction
}

export class ChunkManager {
  private scene: Phaser.Scene;
  private world: WorldState;
  readonly chunksX: number;
  readonly chunksY: number;
  private resident = new Map<string, ResidentChunk>();
  private tick = 0;

  /** When true, sprinkle resource-node dots into chunk textures. */
  drawResourceDots = true;

  constructor(scene: Phaser.Scene, world: WorldState) {
    this.scene = scene;
    this.world = world;
    this.chunksX = Math.ceil(world.size / CHUNK_TILES);
    this.chunksY = Math.ceil(world.size / CHUNK_TILES);

    // Pre-index resource nodes by chunk so chunk rendering is O(nodes-in-chunk),
    // not O(all-nodes) per chunk.
    this.indexResourcesByChunk();
  }

  private nodesByChunk = new Map<string, Array<{ col: number; row: number; type: string }>>();
  private riverTilesByChunk = new Map<string, Set<number>>();

  private indexResourcesByChunk(): void {
    for (const n of this.world.resourceNodes) {
      const cx = Math.floor(n.col / CHUNK_TILES);
      const cy = Math.floor(n.row / CHUNK_TILES);
      const k = `${cx},${cy}`;
      let arr = this.nodesByChunk.get(k);
      if (!arr) { arr = []; this.nodesByChunk.set(k, arr); }
      arr.push({ col: n.col, row: n.row, type: n.type });
    }
  }

  private chunkKey(cx: number, cy: number): string { return `wgchunk_${cx}_${cy}`; }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /** Resident texture keys (for Phase 2 to attach/position Image objects). */
  residentKeys(): string[] {
    return [...this.resident.values()].map(r => r.key);
  }
  residentCount(): number { return this.resident.size; }

  /** Pixel offset (in world-pixel space) of a chunk's top-left corner. */
  chunkWorldPos(cx: number, cy: number): { x: number; y: number } {
    return { x: cx * CHUNK_TILES * PX_PER_TILE, y: cy * CHUNK_TILES * PX_PER_TILE };
  }

  /** Compute the inclusive range of chunk coords overlapping a tile view. */
  visibleChunkRange(view: ChunkView): { x0: number; y0: number; x1: number; y1: number } {
    const x0 = Math.max(0, Math.floor(view.tileLeft / CHUNK_TILES));
    const y0 = Math.max(0, Math.floor(view.tileTop / CHUNK_TILES));
    const x1 = Math.min(this.chunksX - 1, Math.floor((view.tileLeft + view.tileWide) / CHUNK_TILES));
    const y1 = Math.min(this.chunksY - 1, Math.floor((view.tileTop + view.tileHigh) / CHUNK_TILES));
    return { x0, y0, x1, y1 };
  }

  /**
   * Drive from a camera view. Loads chunks that entered the view (+1 chunk
   * margin so panning doesn't flash), refreshes lastSeen on visible chunks,
   * then evicts least-recently-seen chunks beyond MAX_RESIDENT (and any clearly
   * off-window chunks). Returns the keys now visible.
   */
  update(view: ChunkView): string[] {
    this.tick++;
    const r = this.visibleChunkRange(view);
    const margin = 1;
    const x0 = Math.max(0, r.x0 - margin), y0 = Math.max(0, r.y0 - margin);
    const x1 = Math.min(this.chunksX - 1, r.x1 + margin);
    const y1 = Math.min(this.chunksY - 1, r.y1 + margin);

    const visibleKeys: string[] = [];
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = this.loadChunk(cx, cy);
        visibleKeys.push(key);
      }
    }
    this.evict(x0, y0, x1, y1);
    return visibleKeys;
  }

  /** Ensure a chunk texture exists & is cached; returns its texture key. */
  loadChunk(cx: number, cy: number): string {
    const id = `${cx},${cy}`;
    const existing = this.resident.get(id);
    if (existing) { existing.lastSeen = this.tick; return existing.key; }

    const key = this.chunkKey(cx, cy);
    if (!this.scene.textures.exists(key)) this.renderChunkTexture(cx, cy, key);
    this.resident.set(id, { cx, cy, key, lastSeen: this.tick });
    return key;
  }

  /** Force-unload a single chunk (frees its GPU texture). */
  unloadChunk(cx: number, cy: number): void {
    const id = `${cx},${cy}`;
    const rc = this.resident.get(id);
    if (!rc) return;
    if (this.scene.textures.exists(rc.key)) this.scene.textures.remove(rc.key);
    this.resident.delete(id);
  }

  /** Destroy ALL resident chunk textures (e.g. on scene shutdown). */
  destroy(): void {
    for (const rc of this.resident.values()) {
      if (this.scene.textures.exists(rc.key)) this.scene.textures.remove(rc.key);
    }
    this.resident.clear();
  }

  // --------------------------------------------------------------------------
  // Eviction: drop anything outside the [x0..x1]×[y0..y1] window first, then,
  // if still over budget, evict least-recently-seen chunks.
  // --------------------------------------------------------------------------
  private evict(x0: number, y0: number, x1: number, y1: number): void {
    // 1. Window cull.
    for (const rc of [...this.resident.values()]) {
      if (rc.cx < x0 || rc.cx > x1 || rc.cy < y0 || rc.cy > y1) {
        this.unloadChunk(rc.cx, rc.cy);
      }
    }
    // 2. Hard cap (LRU) — but NEVER evict a chunk inside the current visible
    //    window (those are about to be rendered; dropping their texture while an
    //    Image still references it crashes the canvas renderer). If the window
    //    itself exceeds the cap we keep all of it; only out-of-window chunks are
    //    eligible for LRU trimming.
    if (this.resident.size <= MAX_RESIDENT) return;
    const inWindow = (rc: ResidentChunk) => rc.cx >= x0 && rc.cx <= x1 && rc.cy >= y0 && rc.cy <= y1;
    const evictable = [...this.resident.values()].filter(rc => !inWindow(rc)).sort((a, b) => a.lastSeen - b.lastSeen);
    let over = this.resident.size - MAX_RESIDENT;
    for (const rc of evictable) {
      if (over-- <= 0) break;
      this.unloadChunk(rc.cx, rc.cy);
    }
  }

  // --------------------------------------------------------------------------
  // Rasterise one chunk to an offscreen canvas, then register it as a Phaser
  // CanvasTexture. Drawn ONCE per chunk lifetime.
  // --------------------------------------------------------------------------
  private renderChunkTexture(cx: number, cy: number, key: string): void {
    const size = this.world.size;
    const tex = this.scene.textures.createCanvas(key, CHUNK_PX, CHUNK_PX);
    if (!tex) return;
    const ctx = tex.getContext();
    const tileBiome = this.world.tileBiome;

    const baseCol = cx * CHUNK_TILES;
    const baseRow = cy * CHUNK_TILES;

    for (let ty = 0; ty < CHUNK_TILES; ty++) {
      const row = baseRow + ty;
      if (row >= size) break;
      for (let tx = 0; tx < CHUNK_TILES; tx++) {
        const col = baseCol + tx;
        if (col >= size) break;
        const b = tileBiome[row * size + col];
        const base = biomeData(b).color;

        // Soft deterministic brightness jitter so big regions aren't flat.
        // Hash the tile coords → ±~8% lightness.
        const jitter = (((col * 73856093) ^ (row * 19349663)) & 0xff) / 255; // 0..1
        const shade = 0.92 + jitter * 0.16; // 0.92 .. 1.08
        ctx.fillStyle = ChunkManager.shadeColor(base, shade);
        ctx.fillRect(tx * PX_PER_TILE, ty * PX_PER_TILE, PX_PER_TILE, PX_PER_TILE);
      }
    }

    // Resource dots (tiny, on top of the terrain).
    if (this.drawResourceDots) {
      const nodes = this.nodesByChunk.get(`${cx},${cy}`);
      if (nodes) {
        for (const n of nodes) {
          const tx = n.col - baseCol, ty = n.row - baseRow;
          if (tx < 0 || ty < 0 || tx >= CHUNK_TILES || ty >= CHUNK_TILES) continue;
          ctx.fillStyle = ChunkManager.RESOURCE_DOT[n.type] || '#ffffff';
          const px = tx * PX_PER_TILE + (PX_PER_TILE >> 1) - 1;
          const py = ty * PX_PER_TILE + (PX_PER_TILE >> 1) - 1;
          ctx.fillRect(px, py, 2, 2);
        }
      }
    }

    tex.refresh(); // upload canvas → GPU
  }

  // Resource-dot colours (kept here so the renderer is self-contained).
  private static RESOURCE_DOT: Record<string, string> = {
    wood: '#2e5e1f', gold: '#ffd84d', stone: '#cfcfcf', iron: '#9aa0aa',
    farmland: '#e9d27a', fish: '#bfe6ff', minerals: '#c79bff',
  };

  // Multiply a 0xRRGGBB colour's channels by `f` and return a #hex string.
  private static shadeColor(rgb: number, f: number): string {
    const r = Math.min(255, Math.round(((rgb >> 16) & 0xff) * f));
    const g = Math.min(255, Math.round(((rgb >> 8) & 0xff) * f));
    const b = Math.min(255, Math.round((rgb & 0xff) * f));
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  }

  // --------------------------------------------------------------------------
  // Whole-world overview: draw the entire 1500×1500 map at `pxPerTile` px/tile
  // into a single CanvasTexture. Default 1px/tile ⇒ a 1500×1500 minimap. Used
  // by the audit overview screenshot and (Phase 2) the strategic minimap.
  // --------------------------------------------------------------------------
  buildOverviewTexture(key = 'wg_overview', pxPerTile = 1): string {
    const size = this.world.size;
    const W = size * pxPerTile, H = size * pxPerTile;
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    const tex = this.scene.textures.createCanvas(key, W, H);
    if (!tex) return key;
    const ctx = tex.getContext();
    const tileBiome = this.world.tileBiome;

    // Step by an integer so a 1px overview samples every tile.
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const b = tileBiome[row * size + col];
        ctx.fillStyle = ChunkManager.hex(biomeData(b).color);
        ctx.fillRect(col * pxPerTile, row * pxPerTile, pxPerTile, pxPerTile);
      }
    }

    // Settlement / faction markers so the overview shows placements too.
    for (const s of this.world.settlements) {
      let color = '#ffffff';
      if (s.kind === 'player_castle') color = '#2e86de';
      else if (s.kind === 'ai_castle') color = '#ff5252';
      else if (s.kind === 'goblin_camp') color = '#7cb342';
      else if (s.kind === 'ruin') color = '#d7c0ff';
      else color = '#fff3c4';
      ctx.fillStyle = color;
      const px = s.col * pxPerTile, py = s.row * pxPerTile;
      ctx.fillRect(px - 2, py - 2, 5, 5);
    }

    tex.refresh();
    return key;
  }

  private static hex(rgb: number): string {
    return `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;
  }
}

// Re-export Biome so consumers can import everything chunk-related from here.
export { Biome };
