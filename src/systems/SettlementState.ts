// ============================================================================
// SettlementState.ts — Phase 3 (Bannerlord rebuild) per-settlement save state.
// ============================================================================
//
// One of these exists for every settlement the player has ENTERED at least once
// (they are created lazily, on first entry, by GameWorld.settlementState(id)).
// IsometricScene is now a PER-SETTLEMENT view: when the player enters a town it
// loads that town's SettlementState, restores its buildings at their saved
// positions, resumes any in-progress construction/training, and on "Leave"
// writes the live scene state back into this object so the next visit resumes.
//
// DESIGN DECISIONS
// ----------------
// * PLAIN, JSON-FRIENDLY DATA ONLY. No Phaser objects, no functions, no typed
//   arrays — every field is a number / string / small array of plain objects so
//   Phase 12's SaveManager rewrite can JSON.stringify a settlementStates map and
//   reload it verbatim. The local map is NOT stored tile-by-tile; instead we
//   keep a tiny `localMap` DESCRIPTOR (biome + seed) and regenerate the 40×40
//   grid deterministically on entry (same trick GameWorld uses for the world).
// * SAVED BUILDINGS are the source of truth for what gets rebuilt on entry; the
//   scene mirrors them into its live BuildingManager and writes them back on
//   leave. Construction/training "slots" carry the remaining time so a half-built
//   barracks or half-trained warrior resumes exactly where it left off.
// * `lastVisitedDay` lets later phases (P5/6/7) compute "what happened while you
//   were away" by diffing GameWorld.day against it.
// ============================================================================

import { Biome } from '../data/Biomes.js';

/** A building the player has placed in a settlement, persisted across visits. */
export interface SavedBuilding {
  typeKey: string;
  col: number;
  row: number;
  /** upgrade level (1+); construction stage handled by `building` slots. */
  level: number;
  /** workers currently assigned (re-applied on entry). */
  workers: number;
}

/** An in-progress construction or training task that resumes on re-entry. */
export interface SavedTask {
  kind: 'construction' | 'training';
  /** building key (for construction) or unit type (for training). */
  what: string;
  /** grid position the task belongs to. */
  col: number;
  row: number;
  /** seconds of work remaining when the player left. */
  timeLeft: number;
}

/** A garrison stack defending the settlement (kept simple this phase). */
export interface GarrisonStack { type: string; count: number; }

/** The local stockpile of resources held INSIDE this settlement (distinct from
 *  the player party's field supply and the campaign-level gold in GameWorld). */
export interface LocalResources {
  wood: number;
  stone: number;
  food: number;
  iron: number;
  [k: string]: number;
}

/** Tiny descriptor used to regenerate the local map deterministically. The full
 *  40×40 grid is rebuilt from (biome, seed) on entry — never stored per-tile. */
export interface LocalMapDescriptor {
  /** the WORLD biome the settlement sits in — drives the whole local theme. */
  biome: Biome;
  /** deterministic seed so the same town always regenerates the same layout. */
  seed: number;
  /** local grid size (square). */
  size: number;
  /** true for the player's home castle: castle centre + buildable ring. */
  playerOwned: boolean;
}

/** The complete persisted state for a single settlement. */
export interface SettlementState {
  /** stable settlement id (its index string in the world settlement list). */
  id: string;
  name: string;
  /** owning faction key ('player' for the home castle). */
  faction: string;
  /** (Phase 4 Pioneer) biome-derived economic specialty label, e.g. 'Iron Colony'.
   *  Drives the +25% local-production bonus and the continent tooltip. Optional so
   *  existing (pre-P4) saved states stay valid; undefined = no specialty. */
  specialty?: string;
  /** (Phase 4 Pioneer) which raw resource the specialty boosts (wood/stone/iron/food
   *  /fish), so production code can apply the +25% without re-deriving from biome. */
  specialtyResource?: string;
  /** (Phase 4 Pioneer) true for a settlement the player FOUNDED via a pioneer party
   *  (vs the starting castle or a conquered hold) — drives the planted-flag icon. */
  founded?: boolean;
  /** settlement tier index 0..8 (Small Village → Large Castle). */
  tier: number;
  buildings: SavedBuilding[];
  /** in-progress construction/training that resumes on entry. */
  tasks: SavedTask[];
  /** workers employed locally. */
  workers: number;
  /** maximum workers this settlement can employ (grows with houses/tier). */
  workerCap: number;
  /** local resource stockpile. */
  resources: LocalResources;
  garrison: GarrisonStack[];
  population: number;
  /** 0..100 contentment of the local populace. */
  happiness: number;
  /** GameWorld.day when the player last left (for "while you were away"). */
  lastVisitedDay: number;
  /** true once the player has actually entered (so we only init defaults once). */
  visited: boolean;
  /** does this town have a resident administrator running it while away? */
  hasAdministrator: boolean;
  administratorName: string | null;
  localMap: LocalMapDescriptor;
}

/** Build a fresh SettlementState for a settlement the player just entered for the
 *  first time. `world` here is the lightweight {name, biome, faction, kind} view
 *  from GameWorld; we keep this decoupled from WorldGenerator's heavy types. */
export function makeSettlementState(args: {
  id: string;
  name: string;
  faction: string;
  biome: Biome;
  playerOwned: boolean;
  day: number;
}): SettlementState {
  // Deterministic per-settlement seed from the id so the local map is stable.
  let seed = 0;
  for (let i = 0; i < args.id.length; i++) seed = (seed * 31 + args.id.charCodeAt(i)) | 0;
  seed = (seed ^ 0x9e3779b9) >>> 0;

  return {
    id: args.id,
    name: args.name,
    faction: args.faction,
    tier: 0,
    buildings: [],
    tasks: [],
    workers: 0,
    workerCap: args.playerOwned ? 12 : 8,
    resources: { wood: args.playerOwned ? 60 : 30, stone: args.playerOwned ? 30 : 15, food: 80, iron: 0 },
    garrison: args.playerOwned ? [] : [{ type: 'warrior', count: 6 + (seed % 8) }],
    population: args.playerOwned ? 12 : 8 + (seed % 20),
    happiness: 70,
    lastVisitedDay: args.day,
    visited: false,
    hasAdministrator: !args.playerOwned,
    administratorName: args.playerOwned ? null : 'Steward',
    localMap: {
      biome: args.biome,
      seed,
      size: 40,
      playerOwned: args.playerOwned,
    },
  };
}
