// ============================================================================
// PioneerSystem.ts — Phase 4 (Bannerlord rebuild) Pioneer / colonisation system.
// ============================================================================
//
// Lets the player FOUND brand-new settlements anywhere on the continent. A
// "pioneer party" is dispatched from an existing player settlement, travels the
// continent in real time (reusing the exact same continent-party framework that
// already moves the player + AI parties: A* on the per-biome movement cost,
// driven each frame by ContinentScene), and on reaching a valid destination it
// can be turned into a new tier-1 founding camp the player can immediately enter
// and build up.
//
// ============================================================================
// HOW PIONEERS INTEGRATE WITH THE CONTINENT-PARTY FRAMEWORK
// ============================================================================
// The player party and AI parties already live as plain data in GameWorld and
// are advanced + drawn by ContinentScene every frame. Pioneers follow the SAME
// pattern: GameWorld.pioneers[] is a list of plain PioneerParty records;
// ContinentScene.updatePioneers(delta) advances each one along an A* path using
// ContinentPathfinder + BASE_TILES_PER_DAY scaled by the tile movement cost
// (identical to advanceParty / updateAIParties), and ContinentScene.layoutIcons
// draws a cart/wagon icon in the player colour with a hover tooltip. No new
// movement engine — pioneers are just a third flavour of continent party whose
// ARRIVAL behaviour is "offer to found" instead of "fight" (player) or "patrol"
// (AI). This module owns only the spawn / found / specialty / ambush LOGIC; the
// per-frame motion + rendering stay in ContinentScene where the others live.
//
// ============================================================================
// DESIGN DECISIONS
// ============================================================================
// * COSTS (per spec): sending a pioneer party costs 10 workers (the founding
//   population) + 200 wood + 100 stone from the ORIGIN settlement's local
//   resources, and the origin must retain >= 5 workers afterwards. The 10
//   workers + 200 wood + 100 stone travel WITH the party and are deposited into
//   the new settlement on founding (lost entirely if the party is ambushed).
// * FOUNDING VALIDITY: the destination tile must be passable, have NO existing
//   settlement within FOUND_MIN_DISTANCE (15) tiles, and not sit in enemy
//   territory (FOUND_ENEMY_TERRITORY tiles of an ai_castle / goblin_camp).
// * SPECIALIZATION by destination biome (stored on BOTH the Settlement and its
//   SettlementState, shown in the continent tooltip, and applied as +25% to the
//   matching local production in IsometricScene):
//       mountain/highland → Iron Colony   (+25% iron)
//       forest            → Lumber Camp    (+25% wood)
//       plains            → Farmstead      (+25% food)
//       river/wetland     → River Post     (trade/fish, +25% fish)
//       coast             → Harbor Town    (future naval, +25% fish)
// * VULNERABILITY (simple proximity-damage model, documented): each continent
//   tick, every goblin_camp within AMBUSH_RANGE (10) tiles of a travelling
//   pioneer deals AMBUSH_DPS damage scaled by the game-days elapsed that frame.
//   A pioneer has PIONEER_HP (20). At 0 HP the party is destroyed, its carried
//   resources lost, and an "ambushed" notification fires. An escorting army
//   (any player AIParty-style escort) is OPTIONAL — tickAmbush simply does not
//   crash when none is present; if a future phase tags an escort onto a pioneer
//   we halve incoming damage (see tickAmbush).
//
// The system is a static helper class (no instance state) so any scene can call
// PioneerSystem.sendPioneer / tryFound without wiring a singleton — all state
// lives in GameWorld, keeping it serialization-friendly for Phase 12.
// ============================================================================

import { GameWorld } from './GameWorld.js';
import type { PioneerParty } from './GameWorld.js';
import type { Settlement } from './WorldGenerator.js';
import { makeSettlementState } from './SettlementState.js';
import type { SettlementState } from './SettlementState.js';
import { Biome, biomeData } from '../data/Biomes.js';

// --- Tunables ---------------------------------------------------------------
export const PIONEER_WORKER_COST = 10;   // founding population sent with the party
export const PIONEER_WOOD_COST = 200;    // founding timber
export const PIONEER_STONE_COST = 100;   // founding masonry
export const PIONEER_MIN_REMAIN = 5;     // workers the origin must keep
export const PIONEER_HP = 20;            // pioneer party hit points
export const FOUND_MIN_DISTANCE = 15;    // tiles to nearest existing settlement
export const FOUND_ENEMY_TERRITORY = 12; // tiles of an enemy hold = "enemy territory"
export const AMBUSH_RANGE = 10;          // goblin-camp proximity that triggers attacks
export const AMBUSH_DPS = 4;             // HP lost per game-day inside ambush range

/** The economic specialty a destination biome confers on a founded settlement. */
export interface PioneerSpecialty {
  /** human label stored on the settlement + shown in the tooltip. */
  label: string;
  /** the raw resource boosted +25% in the local economy. */
  resource: string;
}

/** Result of a sendPioneer attempt — ok + the new party, or a reason it failed. */
export interface SendResult {
  ok: boolean;
  pioneer?: PioneerParty;
  reason?: string;
}

/** Result of a tryFound attempt — ok + the new settlement id, or a reason. */
export interface FoundResult {
  ok: boolean;
  settlementId?: string;
  settlement?: Settlement;
  state?: SettlementState;
  specialty?: PioneerSpecialty;
  reason?: string;
}

export class PioneerSystem {
  // Static mirrors of the module tunables so callers can read e.g.
  // PioneerSystem.PIONEER_WOOD_COST without importing the bare constants.
  static readonly PIONEER_WORKER_COST = PIONEER_WORKER_COST;
  static readonly PIONEER_WOOD_COST = PIONEER_WOOD_COST;
  static readonly PIONEER_STONE_COST = PIONEER_STONE_COST;
  static readonly PIONEER_MIN_REMAIN = PIONEER_MIN_REMAIN;
  static readonly PIONEER_HP = PIONEER_HP;
  static readonly FOUND_MIN_DISTANCE = FOUND_MIN_DISTANCE;
  static readonly FOUND_ENEMY_TERRITORY = FOUND_ENEMY_TERRITORY;
  static readonly AMBUSH_RANGE = AMBUSH_RANGE;
  static readonly AMBUSH_DPS = AMBUSH_DPS;

  // --------------------------------------------------------------------------
  // SPECIALIZATION — map a destination biome to its colony specialty.
  // --------------------------------------------------------------------------
  static specialtyForBiome(biome: Biome): PioneerSpecialty {
    switch (biome) {
      case Biome.HIGHLAND:
      case Biome.MOUNTAIN_PEAK:
        return { label: 'Iron Colony', resource: 'iron' };
      case Biome.LUSH_FOREST:
      case Biome.ALPINE_FOREST:
        return { label: 'Lumber Camp', resource: 'wood' };
      case Biome.RIVER:
      case Biome.WETLAND:
        return { label: 'River Post', resource: 'fish' };
      case Biome.COAST:
        return { label: 'Harbor Town', resource: 'fish' };
      case Biome.PLAINS:
      case Biome.SCRUBLAND:
      case Biome.DESERT:
      case Biome.TUNDRA:
      default:
        return { label: 'Farmstead', resource: 'food' };
    }
  }

  // --------------------------------------------------------------------------
  // Helpers for founding-site validation (also reused by ContinentScene UI).
  // --------------------------------------------------------------------------

  /** Distance (Chebyshev-ish euclidean) to the nearest existing settlement of any
   *  kind. Used to forbid founding too close to an existing town. */
  static nearestSettlementDistance(col: number, row: number): number {
    const w = GameWorld.world;
    if (!w) return Infinity;
    let best = Infinity;
    for (const s of w.settlements) {
      const d = Math.hypot(s.col - col, s.row - row);
      if (d < best) best = d;
    }
    return best;
  }

  /** Distance to the nearest ENEMY hold (ai_castle or goblin_camp). */
  static nearestEnemyDistance(col: number, row: number): number {
    const w = GameWorld.world;
    if (!w) return Infinity;
    let best = Infinity;
    for (const s of w.settlements) {
      if (s.kind !== 'ai_castle' && s.kind !== 'goblin_camp') continue;
      const d = Math.hypot(s.col - col, s.row - row);
      if (d < best) best = d;
    }
    return best;
  }

  /** True if a tile is passable land (biome.passable === true). */
  static isPassable(col: number, row: number): boolean {
    const w = GameWorld.world;
    if (!w) return false;
    if (col < 0 || row < 0 || col >= w.size || row >= w.size) return false;
    const b = w.tileBiome[row * w.size + col];
    return biomeData(b).passable;
  }

  /** Validate a founding tile. Returns { ok, reason } so callers can show the
   *  exact obstruction to the player. */
  static canFoundAt(col: number, row: number): { ok: boolean; reason?: string } {
    if (!GameWorld.world) return { ok: false, reason: 'No world.' };
    if (!this.isPassable(col, row)) return { ok: false, reason: 'That ground cannot be settled.' };
    if (this.nearestSettlementDistance(col, row) < FOUND_MIN_DISTANCE) {
      return { ok: false, reason: `Too close to another settlement (need ${FOUND_MIN_DISTANCE} tiles).` };
    }
    if (this.nearestEnemyDistance(col, row) < FOUND_ENEMY_TERRITORY) {
      return { ok: false, reason: 'This land lies in enemy territory.' };
    }
    return { ok: true };
  }

  // --------------------------------------------------------------------------
  // SENDING — spawn a pioneer party from an origin settlement to a destination.
  // --------------------------------------------------------------------------
  // Deducts 10 workers + 200 wood + 100 stone from the ORIGIN's local
  // SettlementState (requiring >= 5 workers to remain), then spawns a travelling
  // PioneerParty at the origin's continent tile aimed at (destCol, destRow). The
  // motion itself runs in ContinentScene every frame.
  //
  // Programmatic test entry point: PioneerSystem.sendPioneer(fromId, dc, dr).
  static sendPioneer(fromSettlementId: string, destCol: number, destRow: number): SendResult {
    const w = GameWorld.world;
    if (!w) return { ok: false, reason: 'No world.' };
    const origin = GameWorld.settlementById(fromSettlementId);
    if (!origin) return { ok: false, reason: 'Unknown origin settlement.' };
    const st = GameWorld.settlementState(fromSettlementId);
    if (!st) return { ok: false, reason: 'Origin has no state.' };

    // --- Requirements -----------------------------------------------------
    // `workers` here is the settlement's employed population; we use the
    // population count as the founding-population pool (workers are drawn from
    // it). Keep this consistent with how IsometricScene saves population/workers.
    const availWorkers = Math.max(st.workers || 0, st.population || 0);
    if (availWorkers - PIONEER_WORKER_COST < PIONEER_MIN_REMAIN) {
      return { ok: false, reason: `Need ${PIONEER_WORKER_COST + PIONEER_MIN_REMAIN} population (keep ${PIONEER_MIN_REMAIN} behind).` };
    }
    if ((st.resources.wood || 0) < PIONEER_WOOD_COST) {
      return { ok: false, reason: `Need ${PIONEER_WOOD_COST} wood.` };
    }
    if ((st.resources.stone || 0) < PIONEER_STONE_COST) {
      return { ok: false, reason: `Need ${PIONEER_STONE_COST} stone.` };
    }

    // --- Deduct costs from the origin -------------------------------------
    st.resources.wood -= PIONEER_WOOD_COST;
    st.resources.stone -= PIONEER_STONE_COST;
    // Remove the founding population from BOTH the headcount and the worker pool.
    st.population = Math.max(0, (st.population || 0) - PIONEER_WORKER_COST);
    st.workers = Math.max(0, (st.workers || 0) - PIONEER_WORKER_COST);

    // --- Spawn the party at the origin tile -------------------------------
    const dest = this.clampTile(destCol, destRow);
    const p: PioneerParty = {
      id: `pioneer_${GameWorld.pioneerCounter++}`,
      col: origin.col,
      row: origin.row,
      destCol: dest.col,
      destRow: dest.row,
      workers: PIONEER_WORKER_COST,
      wood: PIONEER_WOOD_COST,
      stone: PIONEER_STONE_COST,
      hp: PIONEER_HP,
      maxHp: PIONEER_HP,
      fromSettlementId,
      status: 'travelling',
      destLabel: 'Pioneers seeking new land',
    };
    GameWorld.pioneers.push(p);
    return { ok: true, pioneer: p };
  }

  /** Lookup a live pioneer by id (travelling or arrived). */
  static byId(id: string): PioneerParty | null {
    return GameWorld.pioneers.find(p => p.id === id) || null;
  }

  // --------------------------------------------------------------------------
  // GUIDING — re-target a pioneer's destination (the player clicked a new tile).
  // --------------------------------------------------------------------------
  static guidePioneer(id: string, destCol: number, destRow: number): boolean {
    const p = this.byId(id);
    if (!p || p.status === 'founded' || p.status === 'lost') return false;
    const dest = this.clampTile(destCol, destRow);
    p.destCol = dest.col;
    p.destRow = dest.row;
    p.status = 'travelling';
    return true;
  }

  // --------------------------------------------------------------------------
  // FOUNDING — turn an (ideally arrived) pioneer into a new settlement.
  // --------------------------------------------------------------------------
  // Validates the destination, appends a new Settlement to WorldState.settlements
  // (so the continent renders it immediately, flagged `founded`), creates its
  // tier-1 SettlementState (the carried population + materials, local map themed
  // by the destination biome via the Phase-3 system), tags the specialty, and
  // removes the pioneer party from the map.
  //
  // Programmatic test entry point: PioneerSystem.tryFound(pioneerId, name).
  static tryFound(pioneerId: string, name: string): FoundResult {
    const w = GameWorld.world;
    if (!w) return { ok: false, reason: 'No world.' };
    const p = this.byId(pioneerId);
    if (!p) return { ok: false, reason: 'Unknown pioneer party.' };
    if (p.status === 'founded') return { ok: false, reason: 'Already founded.' };
    if (p.status === 'lost') return { ok: false, reason: 'These pioneers are gone.' };

    // Found at the party's CURRENT tile (snapped to integer) — that is where it
    // physically stands, which after arrival equals the destination.
    const col = Math.round(p.col);
    const row = Math.round(p.row);
    const valid = this.canFoundAt(col, row);
    if (!valid.ok) return { ok: false, reason: valid.reason };

    const cleanName = (name && name.trim()) ? name.trim().slice(0, 24) : 'New Settlement';
    const biome = w.tileBiome[row * w.size + col] as Biome;
    const specialty = this.specialtyForBiome(biome);

    // --- Append the Settlement so the continent renders it now ------------
    const settlement: Settlement = {
      kind: 'player_castle', // a player-owned hold (rendered + ownable like home)
      name: cleanName,
      col,
      row,
      biome,
      faction: 'player',
      specialty: specialty.resource as any,
      // Tag this as player-founded (vs the starting castle / conquered holds) so
      // ContinentScene can draw a planted-flag icon. Extra field is harmless to
      // the existing typed Settlement consumers (they ignore unknown keys).
      ...( { founded: true } as any ),
    };
    w.settlements.push(settlement);
    const id = String(w.settlements.length - 1);

    // --- Build its tier-1 SettlementState (empty founding camp) -----------
    const st = makeSettlementState({
      id,
      name: cleanName,
      faction: 'player',
      biome,
      playerOwned: true,
      day: GameWorld.day,
    });
    // Founding camp: the carried population + materials seed the new town. tier 1
    // (index 0 = the first tier; "tier 1" in spec = the starting tier) with the
    // pioneers as its initial workforce and the founding materials in its store.
    st.tier = 0;
    st.population = Math.max(st.population, p.workers);
    st.workers = 0; // workers start idle in the new camp until the player assigns
    st.resources.wood = p.wood;
    st.resources.stone = p.stone;
    st.resources.food = Math.max(st.resources.food, 60);
    st.specialty = specialty.label;
    st.specialtyResource = specialty.resource;
    st.founded = true;
    GameWorld.settlementStates[id] = st;

    // --- Retire the pioneer party ----------------------------------------
    p.status = 'founded';
    const i = GameWorld.pioneers.indexOf(p);
    if (i >= 0) GameWorld.pioneers.splice(i, 1);

    GameWorld.notify(`${cleanName} founded — a ${specialty.label}!`, 0x2a7a4f);
    return { ok: true, settlementId: id, settlement, state: st, specialty };
  }

  // --------------------------------------------------------------------------
  // VULNERABILITY — proximity damage from goblin camps (called per continent tick).
  // --------------------------------------------------------------------------
  // For each TRAVELLING pioneer, if any goblin_camp is within AMBUSH_RANGE tiles
  // it loses AMBUSH_DPS * dayDelta HP (scaled by game-days elapsed this frame, so
  // it is frame-rate independent like all the other continent timers). At 0 HP the
  // party is destroyed (resources lost) and an "ambushed" notification fires.
  // `dayDelta` is the fraction of a game day elapsed this frame (delta / DAY_MS).
  //
  // Returns the list of pioneers lost this tick (for the caller to surface).
  static tickAmbush(dayDelta: number): PioneerParty[] {
    const w = GameWorld.world;
    if (!w || !GameWorld.pioneers.length) return [];
    const lost: PioneerParty[] = [];
    const camps = w.settlements.filter(s => s.kind === 'goblin_camp');
    if (!camps.length) return [];

    for (const p of GameWorld.pioneers) {
      if (p.status !== 'travelling' && p.status !== 'arrived') continue;
      let underThreat = false;
      for (const c of camps) {
        if (Math.hypot(c.col - p.col, c.row - p.row) <= AMBUSH_RANGE) { underThreat = true; break; }
      }
      if (!underThreat) continue;
      // OPTIONAL escort: if a future phase tags `escortStrength` onto the party,
      // halve incoming damage. Absent = full damage; never crashes without one.
      const escort = (p as any).escortStrength;
      const mult = (typeof escort === 'number' && escort > 0) ? 0.5 : 1;
      p.hp = Math.max(0, p.hp - AMBUSH_DPS * Math.max(0, dayDelta) * mult);
      if (p.hp <= 0) { p.status = 'lost'; lost.push(p); }
    }

    if (lost.length) {
      for (const p of lost) {
        const i = GameWorld.pioneers.indexOf(p);
        if (i >= 0) GameWorld.pioneers.splice(i, 1);
      }
      GameWorld.notify('Pioneer party was ambushed!', 0x8c2b2b);
    }
    return lost;
  }

  // --------------------------------------------------------------------------
  private static clampTile(col: number, row: number): { col: number; row: number } {
    const w = GameWorld.world;
    const size = w ? w.size : 1500;
    return {
      col: Math.max(0, Math.min(size - 1, Math.round(col))),
      row: Math.max(0, Math.min(size - 1, Math.round(row))),
    };
  }
}
