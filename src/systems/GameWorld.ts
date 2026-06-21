// ============================================================================
// GameWorld.ts — Phase 2 (Bannerlord rebuild) shared game-state singleton.
// ============================================================================
//
// A SINGLE lightweight module that owns the live campaign state so every scene
// (ContinentScene now; IsometricScene/BattleScene as stand-ins this phase; the
// SaveManager rewrite in Phase 12) can read and write the same data without
// going through Phaser scene-to-scene messaging.
//
// DESIGN DECISIONS
// ----------------
// * Singleton module, not a Phaser registry, because the WorldState contains big
//   typed arrays (tileBiome / tileElevation, ~11 MB) we never want copied or
//   serialized into Phaser's data manager. Scenes import `GameWorld` and mutate
//   in place.
// * Everything EXCEPT the WorldState typed arrays is plain JSON-friendly data
//   (numbers / strings / small objects), so Phase 12's SaveManager can serialize
//   `serializable()` and re-attach a freshly `generateWorld(seed)`-ed WorldState
//   on load (the world is deterministic from its seed, so we never persist the
//   2.25M-tile arrays — just the seed + the mutable campaign layer).
// * `currentSettlementId` is the bridge for "enter settlement": ContinentScene
//   sets it, the per-settlement view (IsometricScene stand-in) reads it.
// * A `pendingBattle` slot carries the continent return-position into BattleScene
//   so the player drops back where the fight happened.
// ============================================================================

import type { WorldState, Faction, Settlement } from './WorldGenerator.js';
import type { SettlementState } from './SettlementState.js';
import { makeSettlementState } from './SettlementState.js';
import { Biome } from '../data/Biomes.js';

/** Supply state, surfaced as a coloured dot in the HUD/minimap. */
export type SupplyState = 'green' | 'yellow' | 'red';

/** A unit group in a party (kept compatible with BattleScene's army contract:
 *  arrays of { type, count }). */
export interface ArmyGroup { type: string; count: number; battles?: number; }

/** The player's roaming party on the continent. */
export interface PlayerParty {
  col: number;
  row: number;
  /** Whole-army troop groups (drives the army-size badge + battles). */
  army: ArmyGroup[];
  /** Days of food remaining. Drains 1/soldier/day while away from a held town. */
  supply: number;
  /** 0..100; low supply nibbles morale (a flag/hook for later phases). */
  morale: number;
}

/** A simple AI party roaming the continent toward an objective. */
export interface AIParty {
  id: string;
  factionKey: string;
  color: number;
  col: number;
  row: number;
  /** current destination tile (objective) */
  destCol: number;
  destRow: number;
  /** rough army size for the hover tooltip + battle generation */
  armyEstimate: number;
  /** 'aggressive' | 'merchant' | 'expansionist' — drives objective choice. */
  personality: string;
  /** human label for the destination, for the hover tooltip. */
  destLabel: string;
}

/** King identity chosen at creation (mirrors the legacy kg_king localStorage). */
export interface KingInfo { kingdom: string; ruler: string; trait: string | null; }

/** Carries continent context into BattleScene so we can return cleanly. */
export interface PendingBattle {
  returnCol: number;
  returnRow: number;
  enemyPartyId: string | null;
  enemyFaction: string;
}

class GameWorldState {
  /** The generated continent (typed arrays + placements). Set at new-game. */
  world: WorldState | null = null;

  king: KingInfo = { kingdom: 'Your Kingdom', ruler: 'The King', trait: null };

  /** Player faction colour, copied from the world's player faction. */
  playerColor = 0x2e86de;

  player: PlayerParty = {
    col: 0, row: 0,
    army: [{ type: 'warrior', count: 24 }, { type: 'archer', count: 10 }],
    supply: 10, morale: 80,
  };

  aiParties: AIParty[] = [];

  gold = 500;

  /** Continuous day counter (fractional during a day; floor() for display). */
  day = 1;

  /** Which settlement the player is "inside" (per-settlement view), or null. */
  currentSettlementId: string | null = null;

  /** Per-settlement persisted state, keyed by settlement id. Lazily created on
   *  first entry (see settlementState()). The home castle is one of these. This
   *  whole map is JSON-friendly so Phase 12's SaveManager can serialize it. */
  settlementStates: Record<string, SettlementState> = {};

  /** A simple notification queue the per-settlement view drains on entry, and a
   *  hook later phases can push "something happened elsewhere" messages into
   *  even while the player is inside a town. Each is {text, color}. */
  pendingNotifications: Array<{ text: string; color: number }> = [];

  /** Battle hand-off context, or null when not in a battle. */
  pendingBattle: PendingBattle | null = null;

  /** Whether the active campaign has been initialised from a world. */
  started = false;

  // --------------------------------------------------------------------------
  // Derived helpers
  // --------------------------------------------------------------------------

  /** Total soldiers across all groups in the player party. */
  armySize(): number {
    return this.player.army.reduce((s, g) => s + (g.count || 0), 0);
  }

  /** Integer day for display. */
  displayDay(): number { return Math.max(1, Math.floor(this.day)); }

  /** Supply dot colour from remaining days of food. */
  supplyState(): SupplyState {
    if (this.player.supply <= 2) return 'red';
    if (this.player.supply <= 5) return 'yellow';
    return 'green';
  }

  /** Simple four-season cycle (~30 days each) for HUD flavour. */
  season(): string {
    const s = Math.floor((this.displayDay() - 1) / 30) % 4;
    return ['Spring', 'Summer', 'Autumn', 'Winter'][s];
  }

  playerFaction(): Faction | null {
    if (!this.world) return null;
    return this.world.factions.find(f => f.personality === 'player') || null;
  }

  settlementById(id: string | null): Settlement | null {
    if (!this.world || id == null) return null;
    const i = parseInt(String(id), 10);
    return Number.isFinite(i) ? (this.world.settlements[i] || null) : null;
  }

  /** Stable id for a settlement = its index in the world settlement list. */
  settlementId(s: Settlement): string {
    if (!this.world) return '-1';
    return String(this.world.settlements.indexOf(s));
  }

  /** Lazily fetch (creating on first call) the persisted per-settlement state for
   *  a settlement id. This is the bridge the per-settlement view (IsometricScene)
   *  reads on entry and writes on leave. Returns null only if the id is unknown. */
  settlementState(id: string | null): SettlementState | null {
    if (id == null) return null;
    const existing = this.settlementStates[id];
    if (existing) return existing;
    const s = this.settlementById(id);
    if (!s) return null;
    const playerOwned = s.kind === 'player_castle';
    const st = makeSettlementState({
      id,
      name: s.name,
      faction: s.faction || (playerOwned ? 'player' : 'neutral'),
      biome: (s.biome as Biome) ?? Biome.PLAINS,
      playerOwned,
      day: this.day,
    });
    this.settlementStates[id] = st;
    return st;
  }

  /** Push a notification the per-settlement view (or continent) can surface. */
  notify(text: string, color = 0xc9a14a): void {
    this.pendingNotifications.push({ text, color });
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /** Initialise a fresh campaign from a generated world + chosen king. */
  startNewCampaign(world: WorldState, king?: Partial<KingInfo>): void {
    this.world = world;
    if (king) this.king = { ...this.king, ...king };
    const pf = world.factions.find(f => f.personality === 'player');
    if (pf) {
      this.playerColor = pf.color;
      this.player.col = pf.castleCol;
      this.player.row = pf.castleRow;
    }
    this.player.army = [{ type: 'warrior', count: 24 }, { type: 'archer', count: 10 }];
    this.player.supply = 10;
    this.player.morale = 80;
    this.gold = 500;
    this.day = 1;
    this.currentSettlementId = null;
    this.pendingBattle = null;
    this.aiParties = [];
    this.settlementStates = {};
    this.pendingNotifications = [];
    this.spawnAIParties();
    this.started = true;
  }

  /** 1–3 faction-coloured AI parties per non-player faction, seeded near their
   *  castle and aimed at a personality-appropriate objective. */
  private spawnAIParties(): void {
    if (!this.world) return;
    const w = this.world;
    let counter = 0;
    for (const f of w.factions) {
      if (f.personality === 'player') continue;
      const n = 1 + (Math.abs((f.castleCol * 31 + f.castleRow * 17)) % 3); // 1..3
      for (let i = 0; i < n; i++) {
        const jitterC = ((i * 53 + f.castleCol) % 21) - 10;
        const jitterR = ((i * 29 + f.castleRow) % 21) - 10;
        const col = clamp(f.castleCol + jitterC, 1, w.size - 2);
        const row = clamp(f.castleRow + jitterR, 1, w.size - 2);
        const party: AIParty = {
          id: `ai_${f.key}_${i}_${counter++}`,
          factionKey: f.key,
          color: f.color,
          col, row,
          destCol: col, destRow: row,
          armyEstimate: 8 + ((i * 37 + f.castleCol) % 22),
          personality: f.personality,
          destLabel: 'patrolling',
        };
        this.pickAIObjective(party);
        this.aiParties.push(party);
      }
    }
  }

  /** Choose a destination tile for an AI party based on personality. */
  pickAIObjective(p: AIParty): void {
    if (!this.world) return;
    const w = this.world;
    if (p.personality === 'aggressive') {
      // March on the player party.
      p.destCol = this.player.col;
      p.destRow = this.player.row;
      p.destLabel = 'hunting your party';
      return;
    }
    // merchant / expansionist → head for a settlement.
    const wantNeutral = p.personality === 'expansionist';
    const candidates = w.settlements.filter(s =>
      wantNeutral ? s.kind === 'neutral' : (s.kind === 'neutral' || s.kind === 'ai_castle'));
    if (candidates.length) {
      const pick = candidates[(p.col + p.row + candidates.length) % candidates.length];
      p.destCol = pick.col;
      p.destRow = pick.row;
      p.destLabel = (p.personality === 'merchant' ? 'trading with ' : 'marching on ') + pick.name;
    } else {
      p.destCol = clamp(p.col + (((p.col * 7) % 41) - 20), 1, w.size - 2);
      p.destRow = clamp(p.row + (((p.row * 13) % 41) - 20), 1, w.size - 2);
      p.destLabel = 'patrolling';
    }
  }

  /** A JSON-friendly snapshot for Phase-12 SaveManager. The big typed arrays are
   *  intentionally omitted; the world is rebuilt from its seed on load. */
  serializable(): any {
    return {
      seed: this.world ? this.world.seed : null,
      king: this.king,
      player: this.player,
      aiParties: this.aiParties,
      gold: this.gold,
      day: this.day,
      currentSettlementId: this.currentSettlementId,
      // Per-settlement persisted states (Phase 3). Plain JSON; Phase 12 reloads.
      settlementStates: this.settlementStates,
      started: this.started,
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The single shared campaign-state instance. */
export const GameWorld = new GameWorldState();
