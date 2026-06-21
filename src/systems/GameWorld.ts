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
import { Heroes } from './Heroes.js';
import { Diplomacy } from './Diplomacy.js';
import { FactionLeaders } from './FactionLeaders.js';
import type { LeaderMemory } from './WorldDiplomacy.js';

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
  /** (Phase 5 Caravan Raid) when true this AI party is a laden enemy CARAVAN: a
   *  fat, lightly-defended supply train the player can intercept and raid for a
   *  quick (non-BattleScene) skirmish. `cargo` is the loot it carries. Plain data
   *  so Phase 12 can serialize it; absent on ordinary war parties. */
  isCaravan?: boolean;
  cargo?: { gold: number; wood: number; stone: number; iron: number };
}

/** (Phase 5 Worker Expedition) A non-combat worker party sent from a player
 *  settlement to a continent resource deposit (e.g. an iron vein in the
 *  mountains). It travels to the deposit, MINES there for a couple of game days,
 *  then auto-returns to the nearest player settlement and deposits the haul into
 *  that settlement's stockpile. It reuses the exact Phase-4 continent-party
 *  movement framework (A* + per-biome cost in ContinentScene); ARRIVAL behaviour
 *  is "mine, then go home" instead of "fight"/"found". Vulnerable like pioneers
 *  (no combat) — goblin proximity damages its HP. Plain JSON for Phase 12. */
export interface WorkerParty {
  id: string;
  /** real-time continent position (fractional while moving). */
  col: number;
  row: number;
  /** the deposit tile they are mining. */
  depositCol: number;
  depositRow: number;
  /** resource type mined at the deposit (iron / stone / gold / minerals…). */
  resource: string;
  /** units of resource carried home once mining completes. */
  carrying: number;
  /** which settlement they set out from / will return to (id). Re-targeted on
   *  the return leg to the NEAREST player settlement (see ExpeditionSystem). */
  homeSettlementId: string | null;
  /** the tile they are currently pathing toward (deposit while outbound, the home
   *  settlement tile while returning). Driven by ContinentScene movement. */
  destCol: number;
  destRow: number;
  /** vulnerability HP (no combat). 0 = the party is lost. */
  hp: number;
  maxHp: number;
  /** lifecycle: outbound → mining (parked at the deposit) → returning → done. */
  status: 'outbound' | 'mining' | 'returning' | 'done' | 'lost';
  /** game-days of mining remaining while status === 'mining'. */
  mineDaysLeft: number;
  /** human label for the hover tooltip. */
  label: string;
}

/** (Phase 5 Ruins) Reward granted for exploring an ancient ruin. */
export interface RuinReward {
  /** category for flavour + icon: gold / resources / artifact / relic. */
  kind: 'gold' | 'resources' | 'artifact' | 'relic';
  gold: number;
  /** bulk resources granted into the nearest player settlement (or home). */
  resources: { wood: number; stone: number; iron: number };
  /** the named treasure (artifact/relic) recovered, or '' for plain hauls. */
  treasure: string;
  /** a one-line summary for the notification + expedition log. */
  summary: string;
}

/** (Phase 4 Pioneer) A pioneer/colonist party roaming the continent toward a tile
 *  the player chose, carrying the founding population + materials. It reuses the
 *  same A* + per-biome movement as the player/AI parties (ContinentScene drives
 *  it), but on arrival it can FOUND a brand-new settlement instead of fighting.
 *  Plain JSON-friendly data so Phase 12's SaveManager can serialize it. */
export interface PioneerParty {
  id: string;
  /** real-time continent position (fractional while moving). */
  col: number;
  row: number;
  /** chosen founding destination tile. */
  destCol: number;
  destRow: number;
  /** founding population carried (the future settlement's starting workers). */
  workers: number;
  /** founding materials carried, deposited into the new settlement on founding. */
  wood: number;
  stone: number;
  /** vulnerability: pioneers have HP; goblin proximity damages it; 0 = wiped out. */
  hp: number;
  maxHp: number;
  /** which settlement id this party set out from (for notifications/flavour). */
  fromSettlementId: string | null;
  /** 'travelling' (en route), 'arrived' (waiting at dest for a Found decision),
   *  'founded' (settled — removed from the map) or 'lost' (ambushed). */
  status: 'travelling' | 'arrived' | 'founded' | 'lost';
  /** human label for the hover tooltip ("Pioneers → The Frontier"). */
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

  /** (Phase 4 Pioneer) live pioneer parties on the continent. ContinentScene
   *  renders + advances them every frame; PioneerSystem owns the spawn/found logic. */
  pioneers: PioneerParty[] = [];

  /** Monotonic counter for unique pioneer ids (stable across the session). */
  pioneerCounter = 0;

  // --- Phase 5 (Living Expeditions) campaign layer ------------------------
  /** (Phase 5 Worker Expedition) live worker parties mining continent deposits.
   *  ContinentScene advances them; ExpeditionSystem owns spawn/mine/return logic. */
  workers: WorkerParty[] = [];

  /** Monotonic counter for unique worker-party ids (stable across the session). */
  workerCounter = 0;

  /** (Phase 5 Ruins) ids (Settlement index strings) of ruins already explored,
   *  so the continent draws a distinct "explored" icon and a ruin grants a reward
   *  only once. A Record (not Set) so it serialises cleanly for Phase 12. */
  exploredRuins: Record<string, boolean> = {};

  /** (Phase 5 Goblin Raids) ids of goblin camps the player has cleared. Cleared
   *  camps change icon, stop ambushing, and cannot be raided again. */
  clearedCamps: Record<string, boolean> = {};

  /** (Phase 5 Caravan Raid) faction-relation deltas accumulated by raiding enemy
   *  caravans. Diplomacy isn't wired at the continent level until Phase 7, so we
   *  bank the −20-per-raid deltas here keyed by faction key for P7 to apply. */
  relationDeltas: Record<string, number> = {};

  /** (Phase 5 Expedition Panel) ids of continent locations the player has
   *  DISCOVERED (walked the fog off / interacted with): ruins, goblin camps,
   *  resource deposits, mercenary camps. Drives the panel's "Discovered" list and
   *  the quick-travel menu. Keyed by a stable location id (see ExpeditionSystem). */
  discovered: Record<string, { kind: string; name: string; col: number; row: number; day: number }> = {};

  // --- Phase 6 (Heroes as real characters in the world) -------------------
  // The hero roster is RE-HOMED to the continent here (it was inert inside the
  // now-per-settlement IsometricScene). `heroes` is a real Heroes instance whose
  // "scene" is a small JSON-free adapter (heroHost) so the existing passives /
  // levels / arrival conditions keep working at the WORLD level. ContinentScene
  // ticks arrivals from onNewDay and drives dialogue/quests/stationing via
  // HeroWorld. All NEW hero campaign state below is plain JSON for Phase 12.
  heroes: Heroes = new Heroes(this.heroHost());

  /** Per-hero campaign state keyed by hero id. `station` = settlement id the hero
   *  is garrisoned at (null = travelling with the party). Serialization-friendly. */
  heroStations: Record<string, string | null> = {};

  /** Throttle/bookkeeping for the contextual dialogue system: last game-day a line
   *  was shown (global cooldown), and a set of one-shot line keys already fired so
   *  unique story beats don't repeat. Plain JSON. */
  heroDialogue: { lastShownDay: number; firedOnce: Record<string, boolean> } = { lastShownDay: -99, firedOnce: {} };

  /** Per-hero quest state: status + the target tile. status: 'inactive' (not yet
   *  triggered) | 'active' (marker on map, travel to it) | 'done'. JSON-friendly. */
  heroQuests: Record<string, { status: 'inactive' | 'active' | 'done'; col: number; row: number; title: string; targetName: string }> = {};

  /** Phase-6 flags later phases consume (P8 win conditions, P7 diplomacy). Plain
   *  booleans/strings so they serialize. e.g. fourthWinCondition, hidden 7th
   *  fortress revealed, friendly-neutral villages, caravan/garrison allies. */
  heroFlags: Record<string, any> = {};

  // --- Phase 7 (Diplomatic narrative — leader memory, honor) ---------------
  // RE-HOMED diplomacy to the world level. `diplomacy` (relation meters / treaties
  // / NAP / alliance) and `leaders` (named rulers Valdris/Elowen/Krag with voices)
  // were both neutered inside the now-per-settlement IsometricScene; here they are
  // real instances backed by a tiny world-level host adapter (diploHost) so the
  // EXISTING logic keeps working at the CONTINENT level. WorldDiplomacy is the
  // brain on top (memory, dialogue, memory events, betrayal, honor). Lazily wired
  // by initDiplomacy() (called from WorldDiplomacy.ensure / startNewCampaign). All
  // NEW campaign state below is plain JSON for Phase 12.
  diplomacy: Diplomacy | null = null;
  leaders: FactionLeaders | null = null;

  /** Per-faction remembered history of the relationship (battles/treaties/tributes
   *  /wars/alliance/first-contact). Source of truth for history-based dialogue.
   *  JSON-friendly; keyed by faction key (red/purple/yellow). */
  leaderMemory: Record<string, LeaderMemory> = {};

  /** Player honor: +1 per treaty upheld over time, −3 per betrayal. Drives treaty
   *  cost (≥+10 cheaper, ≤−5 +50/faction) and is surfaced in the diplomacy panel. */
  honor = 0;

  /** Phase-7 diplomacy flags (serialization-friendly): one-shot memory events,
   *  caravan-avoid expiry after a betrayal, intel-shared, the unique artifact,
   *  treaty-upheld accrual bookkeeping, and the deltas-applied guard. */
  diploFlags: Record<string, any> = {};

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
  // Phase 6 — Hero host adapter
  // --------------------------------------------------------------------------
  /** The `Heroes` class was written against a per-settlement IsometricScene and
   *  calls a handful of scene methods (gameDay, logEvent, showToast, refreshPanel,
   *  buildings/research/reputation/leaders for arrival conditions). At the WORLD
   *  level we satisfy that contract with this tiny adapter so Heroes keeps working
   *  unchanged. Arrivals are auto-accepted (no per-settlement worldEvents queue);
   *  ContinentScene surfaces the join via a banner + dialogue. The notify hook
   *  routes hero log lines into the shared pendingNotifications queue. */
  private heroHost(): any {
    const gw = this;
    return {
      get gameDay() { return gw.displayDay(); },
      // Arrival conditions read these; at world level we map them to GameWorld so
      // e.g. Caelan (merchant rep) / Tomas (library+research) still gate sensibly.
      buildings: { countOfType: (_k: string) => 0 },
      research: { completed: { size: 0 } },
      reputation: { scores: {} as Record<string, number> },
      leaders: { kragRespects: () => false },
      logEvent: (text: string, _color?: string) => { gw.notify(text); },
      showToast: (_t: string) => { /* surfaced by ContinentScene banner */ },
      threatWarning: (_t: string) => { /* no-op at world level */ },
      stats: { note: (_k: string) => {} },
      population: { addTempMod: (_n: string, _v: number, _d: number) => {} },
      refreshPanel: () => { /* ContinentScene re-lays icons every frame */ },
      // worldEvents intentionally ABSENT → Heroes.offer() auto-joins via add().
    };
  }

  /** Re-bind the hero roster to a fresh host (used on new campaign / restore so the
   *  Heroes instance never points at stale state). */
  rebindHeroes(): void { this.heroes.scene = this.heroHost(); }

  // --------------------------------------------------------------------------
  // Phase 7 — Diplomacy host adapter
  // --------------------------------------------------------------------------
  /** The `Diplomacy` + `FactionLeaders` classes were written against the per-
   *  settlement IsometricScene and read a handful of scene members (`kingdoms`
   *  as {cfg:{key,name,color}, castleAlive}, `resources.spend/add`, `gameDay`,
   *  `showToast`/`logEvent`, cross-refs `diplomacy`/`leaders`, plus per-settlement
   *  hooks like buildings/armyMgr/troops/reputation). At the WORLD level we satisfy
   *  that contract with this adapter so BOTH systems keep working unchanged:
   *   - `kingdoms` maps the 3 AI factions (red/purple/yellow) to the shape they
   *     expect (always castleAlive at world scale; combat/sieges are P9+).
   *   - `resources` routes spend/add to GameWorld.gold (so treaty/tribute costs
   *     and alliance/trade income flow through the campaign purse).
   *   - per-settlement-only hooks (buildings/armyMgr/troops/recallFactionArmies/
   *     threatWarning/refreshPanel) are harmless no-ops; the continent surfaces
   *     speech via WorldDiplomacy + ContinentScene's showLeaderSpeech instead. */
  diploHost(): any {
    const gw = this;
    return {
      get gameDay() { return gw.displayDay(); },
      get kingdoms() {
        const out: any[] = [];
        if (!gw.world) return out;
        for (const f of gw.world.factions) {
          if (f.personality === 'player') continue;
          out.push({ cfg: { key: f.key, name: f.name, color: f.color }, castleAlive: true });
        }
        return out;
      },
      resources: {
        spend: (cost: any) => { const g = cost && cost.gold ? cost.gold : 0; if (gw.gold < g) return false; gw.gold -= g; return true; },
        add: (_kind: string, amt: number) => { gw.gold += amt; },
      },
      // Cross-references so Diplomacy.declareWar/proposeAlliance can call leaders.say
      // and FactionLeaders.onTrade/onDefeatInBattle can change relations.
      get diplomacy() { return gw.diplomacy; },
      get leaders() { return gw.leaders; },
      // Speech is surfaced by ContinentScene via this hook (set by the scene); a
      // no-op when headless / inside a settlement.
      showLeaderSpeech: (faction: string, line: string) => { if (gw._leaderSpeechHook) gw._leaderSpeechHook(faction, line); },
      logEvent: (text: string, _color?: string) => { gw.notify(text); },
      showToast: (text: string) => { gw.notify(text, 0x8c2b2b); },
      threatWarning: (_t: string) => { /* no-op at world level */ },
      refreshPanel: () => { if (gw._diploPanelHook) gw._diploPanelHook(); },
      // Per-settlement-only systems the classes guard for — left absent/empty so
      // the existing `if (this.scene.x)` checks short-circuit safely.
      reputation: { scores: {} as Record<string, number> },
      buildings: { castle: null, countOfType: (_k: string) => 0 },
    };
  }

  /** Hook ContinentScene sets so leader speech bubbles render on the continent. */
  _leaderSpeechHook: ((faction: string, line: string) => void) | null = null;
  /** Hook ContinentScene sets so an open diplomacy panel re-renders on changes. */
  _diploPanelHook: (() => void) | null = null;

  /** Lazily construct the world-level Diplomacy + FactionLeaders instances on a
   *  fresh host. Idempotent (no-op if already wired). Called by WorldDiplomacy
   *  .ensure() and on new campaign. */
  initDiplomacy(): void {
    if (this.diplomacy && this.leaders) return;
    const host = this.diploHost();
    this.diplomacy = new Diplomacy(host);
    this.leaders = new FactionLeaders(host);
  }

  /** Re-bind diplomacy/leaders to a fresh host (new campaign / restore). */
  rebindDiplomacy(): void {
    const host = this.diploHost();
    if (this.diplomacy) this.diplomacy.scene = host;
    if (this.leaders) this.leaders.scene = host;
  }

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
    this.pioneers = [];
    this.pioneerCounter = 0;
    // --- Phase 5 reset ---
    this.workers = [];
    this.workerCounter = 0;
    this.exploredRuins = {};
    this.clearedCamps = {};
    this.relationDeltas = {};
    this.discovered = {};
    this.settlementStates = {};
    this.pendingNotifications = [];
    // --- Phase 6 hero reset (roster re-homed to the continent) ---
    this.heroes = new Heroes(this.heroHost());
    this.heroStations = {};
    this.heroDialogue = { lastShownDay: -99, firedOnce: {} };
    this.heroQuests = {};
    this.heroFlags = {};
    // --- Phase 7 diplomacy reset (re-homed to the continent) ---
    this.diplomacy = null;
    this.leaders = null;
    this.leaderMemory = {};
    this.honor = 0;
    this.diploFlags = {};
    this.initDiplomacy(); // wire fresh Diplomacy + FactionLeaders to the new world
    this.spawnAIParties();
    this.spawnMercenaryCamps();
    this.started = true;
  }

  /** (Phase 5 Mercenary Camps) append 3–5 mercenary camps to the world's
   *  settlement list (as `kind: 'mercenary'`) on passable land, spread out and
   *  clear of castles. They render + are travelled-to exactly like any other
   *  continent location; ExpeditionSystem.hireMercenaries handles the contract. */
  private spawnMercenaryCamps(): void {
    if (!this.world) return;
    const w = this.world;
    // Deterministic-ish placement from the world seed so a re-rolled world is
    // stable. We scatter around the map centre, accepting passable, non-water
    // tiles a sensible distance from existing settlements.
    let a = (w.seed ^ 0x5e7c0a11) >>> 0;
    const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const target = 4; // within the 3–5 spec range
    let placed = 0, tries = 0;
    const MERC_NAMES = ['Free Company', 'Iron Brotherhood', 'The Wandering Blades', 'Crimson Sellswords', 'The Broken Spears'];
    while (placed < target && tries < 8000) {
      tries++;
      const col = Math.floor(rnd() * w.size);
      const row = Math.floor(rnd() * w.size);
      const b = w.tileBiome[row * w.size + col];
      // Passable land only (skip ocean=0 / peaks). biomeData import avoided here to
      // keep GameWorld light; rely on a cheap "not ocean / not peak" elevation gate.
      if (b === Biome.OCEAN || b === Biome.MOUNTAIN_PEAK) continue;
      // Keep clear of any existing settlement (≥ 50 tiles) and other merc camps.
      let bad = false;
      for (const s of w.settlements) {
        const min = s.kind === 'mercenary' ? 120 : 50;
        if (Math.hypot(s.col - col, s.row - row) < min) { bad = true; break; }
      }
      if (bad) continue;
      w.settlements.push({
        kind: 'mercenary',
        name: MERC_NAMES[placed % MERC_NAMES.length] + ' Camp',
        col, row,
        biome: b as Biome,
      });
      placed++;
    }
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
      // NOTE: AI party col/row are FRACTIONAL while moving, so the raw index could
      // be fractional → candidates[2.7] === undefined → a crash. Floor + abs the
      // index so it is always a valid integer slot. (Phase 6 hardening.)
      const idx = Math.abs(Math.floor(p.col + p.row + candidates.length)) % candidates.length;
      const pick = candidates[idx];
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
      pioneers: this.pioneers,
      pioneerCounter: this.pioneerCounter,
      gold: this.gold,
      day: this.day,
      currentSettlementId: this.currentSettlementId,
      // (Phase 5) Living-expedition campaign layer. All plain JSON for Phase 12.
      workers: this.workers,
      workerCounter: this.workerCounter,
      exploredRuins: this.exploredRuins,
      clearedCamps: this.clearedCamps,
      relationDeltas: this.relationDeltas,
      discovered: this.discovered,
      // Per-settlement persisted states (Phase 3). Plain JSON; Phase 12 reloads.
      settlementStates: this.settlementStates,
      // (Phase 6) Hero campaign layer — roster (XP/levels/passives via Heroes
      // .serialize()) + stations + dialogue throttle + quests + flags. All JSON.
      heroes: this.heroes.serialize(),
      heroStations: this.heroStations,
      heroDialogue: this.heroDialogue,
      heroQuests: this.heroQuests,
      heroFlags: this.heroFlags,
      // (Phase 7) Diplomacy campaign layer — relations/treaties (Diplomacy.serialize)
      // + named-leader state (FactionLeaders.serialize) + remembered leader memory
      // + honor + the diplomacy flags (memory events / caravan-avoid / artifact).
      // All plain JSON; Phase 12 rebuilds the instances on a fresh host then
      // restore()s these.
      diplomacy: this.diplomacy ? this.diplomacy.serialize() : null,
      leaders: this.leaders ? this.leaders.serialize() : null,
      leaderMemory: this.leaderMemory,
      honor: this.honor,
      diploFlags: this.diploFlags,
      started: this.started,
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The single shared campaign-state instance. */
export const GameWorld = new GameWorldState();
