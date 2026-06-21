// ============================================================================
// Biomes.ts — Phase 1 (Bannerlord rebuild) biome definitions & data table.
// ============================================================================
//
// PURE DATA MODULE. No Phaser, no runtime dependencies — safe to import from
// the world generator, the chunk renderer, and (Phase 2) the continent scene.
//
// DESIGN DECISIONS
// ----------------
// * Biomes are a flat numeric enum so a per-tile biome map can be stored as a
//   Uint8Array (1 byte/tile). At 1500×1500 that is ~2.25 MB — cheap, and far
//   cheaper than storing strings or objects per tile.
// * Each biome carries: a warm "Northgard"-style colour, a movement cost
//   (Phase 2 pathfinding), a `passable` flag, and a human display name.
// * The colour palette intentionally leans warm/desaturated (parchment, olive,
//   ochre, slate) to read as a hand-painted strategy map rather than a
//   saturated tile sheet.
// ============================================================================

/** Per-tile biome id. Stored as the value of a Uint8Array, so order/values
 *  matter — DO NOT renumber without bumping a save version. */
export enum Biome {
  OCEAN = 0,        // elevation <= 0.15 — deep water, IMPASSABLE
  COAST = 1,        // elevation <= 0.30 (and > 0.15) — shoreline / shallows
  PLAINS = 2,       // open grassland — fastest travel
  SCRUBLAND = 3,    // dry low brush
  DESERT = 4,       // hot + arid sand
  WETLAND = 5,      // marsh / bog — very slow
  TUNDRA = 6,       // cold low ground
  LUSH_FOREST = 7,  // dense temperate woodland (wood + sparse gold)
  HIGHLAND = 8,     // rocky hills (stone + iron)
  ALPINE_FOREST = 9,// cold high woodland
  MOUNTAIN_PEAK = 10,// snow-capped peak — IMPASSABLE
  RIVER = 11,       // carved river tile — passable but slow
}

/** Number of distinct biome ids (used to size histograms etc). */
export const BIOME_COUNT = 12;

export interface BiomeData {
  id: Biome;
  displayName: string;
  /** 0xRRGGBB base fill colour for the top-down map. */
  color: number;
  /** Phase-2 movement cost multiplier (1 = fastest, higher = slower). */
  movementCost: number;
  /** Can a party enter this tile at all? */
  passable: boolean;
}

// Warm Northgard-inspired palette. Keys are the Biome enum values.
export const BIOMES: Record<Biome, BiomeData> = {
  [Biome.OCEAN]:         { id: Biome.OCEAN,         displayName: 'Ocean',         color: 0x2e5e7e, movementCost: Infinity, passable: false },
  [Biome.COAST]:         { id: Biome.COAST,         displayName: 'Coast',         color: 0x6fa8c7, movementCost: 2.0,      passable: true  },
  [Biome.PLAINS]:        { id: Biome.PLAINS,        displayName: 'Plains',        color: 0x9bab5a, movementCost: 1.0,      passable: true  },
  [Biome.SCRUBLAND]:     { id: Biome.SCRUBLAND,     displayName: 'Scrubland',     color: 0xb6a662, movementCost: 1.4,      passable: true  },
  [Biome.DESERT]:        { id: Biome.DESERT,        displayName: 'Desert',        color: 0xd9c08a, movementCost: 1.8,      passable: true  },
  [Biome.WETLAND]:       { id: Biome.WETLAND,       displayName: 'Wetland',       color: 0x5d7a52, movementCost: 3.2,      passable: true  },
  [Biome.TUNDRA]:        { id: Biome.TUNDRA,        displayName: 'Tundra',        color: 0xa9b1a0, movementCost: 1.6,      passable: true  },
  [Biome.LUSH_FOREST]:   { id: Biome.LUSH_FOREST,   displayName: 'Lush Forest',   color: 0x4f7a3a, movementCost: 1.6,      passable: true  },
  [Biome.HIGHLAND]:      { id: Biome.HIGHLAND,      displayName: 'Highland',      color: 0x8a7d62, movementCost: 2.2,      passable: true  },
  [Biome.ALPINE_FOREST]: { id: Biome.ALPINE_FOREST, displayName: 'Alpine Forest', color: 0x5a6e54, movementCost: 2.4,      passable: true  },
  [Biome.MOUNTAIN_PEAK]: { id: Biome.MOUNTAIN_PEAK, displayName: 'Mountain Peak', color: 0xe8e8ec, movementCost: Infinity, passable: false },
  [Biome.RIVER]:         { id: Biome.RIVER,         displayName: 'River',         color: 0x4a86b0, movementCost: 2.6,      passable: true  },
};

/** Convenience: lookup the data for a biome id (with an OCEAN fallback). */
export function biomeData(id: number): BiomeData {
  return BIOMES[id as Biome] ?? BIOMES[Biome.OCEAN];
}

// ----------------------------------------------------------------------------
// Biome classification (the spec table)
// ----------------------------------------------------------------------------
//
// Given normalized elevation (0..1), temperature (0..1, where 1 = hot) and
// moisture (0..1, where 1 = wet), return the biome id. River carving is applied
// SEPARATELY by the generator (it overwrites tiles with Biome.RIVER), so this
// function never returns RIVER.
//
// Rules are evaluated top→bottom; the FIRST match wins, exactly as written in
// the Phase-1 spec so behaviour is auditable line-by-line.
export function classifyBiome(elevation: number, temperature: number, moisture: number): Biome {
  // --- High ground -------------------------------------------------------
  if (elevation > 0.85) return Biome.MOUNTAIN_PEAK;                       // impassable peak
  if (elevation > 0.7 && temperature < 0.4) return Biome.ALPINE_FOREST;   // cold + high
  if (elevation > 0.7) return Biome.HIGHLAND;                             // rocky hills

  // --- Mid ground --------------------------------------------------------
  if (elevation > 0.5 && moisture > 0.6 && temperature > 0.5) return Biome.LUSH_FOREST;
  if (elevation > 0.5 && moisture < 0.3) return Biome.SCRUBLAND;
  if (elevation > 0.5 && temperature < 0.3) return Biome.TUNDRA;

  // --- Low-mid ground ----------------------------------------------------
  if (elevation > 0.3 && moisture > 0.7) return Biome.WETLAND;            // very slow marsh
  if (elevation > 0.3 && temperature > 0.7 && moisture < 0.3) return Biome.DESERT;
  if (elevation > 0.3) return Biome.PLAINS;                               // fast open ground

  // --- Coast / water -----------------------------------------------------
  if (elevation > 0.15) return Biome.COAST;
  return Biome.OCEAN;                                                     // impassable deep water
}
