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
import type { SettlementState, GarrisonStack } from './SettlementState.js';
import { makeSettlementState } from './SettlementState.js';
import { Biome } from '../data/Biomes.js';
import { Heroes } from './Heroes.js';
import { Diplomacy } from './Diplomacy.js';
import { FactionLeaders } from './FactionLeaders.js';
import type { LeaderMemory } from './WorldDiplomacy.js';
import { Reputation } from './Reputation.js';

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

// ----------------------------------------------------------------------------
// Phase 8 (Late-game content — Stage 8 Medium Castle & Stage 9 Large Castle)
// ----------------------------------------------------------------------------
// The "kingdom stage" is the player's HOME CASTLE settlement tier (1..9). All
// Phase-8 unlocks gate on GameWorld.kingdomStage(). Every new field below is
// plain JSON (numbers/strings/small objects/booleans) so Phase 12's SaveManager
// can serialize it verbatim. The heavier logic lives in LateGame.ts (a static
// system like WorldDiplomacy/HeroWorld); GameWorld holds the state + thin
// wrapper methods so both `GameWorld.startTournament()` and the audit's `__P8`
// hook drive the same code.

/** (Phase 8) Live state of the Grand Tournament (stage-8 home-castle action). A
 *  multi-day festival: when active, tournament grounds (tents/flags) are drawn
 *  near the home castle; on completion a faction champion joins the army, all
 *  factions warm +10, happiness +30 for 5 days, +10 Protector reputation. */
export interface TournamentState {
  active: boolean;
  /** game-day the tournament finishes (resolved by the daily tick). */
  endDay: number;
  /** continent tile the grounds sit on (just outside the home castle). */
  col: number;
  row: number;
  /** how many tournaments have been held (flavour / chronicle). */
  held: number;
}

/** (Phase 8) A named emissary travelling the continent as a continent party
 *  (scroll/envelope icon) toward a faction's territory. On arrival it founds a
 *  PERMANENT embassy → passive +2 relations/day with that faction. If the target
 *  faction is hostile it may be captured en route (ransom 200 gold to free).
 *  Plain JSON for Phase 12. */
export interface EmissaryParty {
  id: string;
  name: string;
  /** target AI faction key (red/purple/yellow). */
  faction: string;
  color: number;
  /** real-time continent position (fractional while moving). */
  col: number;
  row: number;
  /** the faction-castle tile the emissary is travelling toward. */
  destCol: number;
  destRow: number;
  /** lifecycle: travelling → embassy (arrived, passive bonus active) | captured. */
  status: 'travelling' | 'embassy' | 'captured';
}

/** (Phase 8) A single in-world Chronicle entry — a narrative record of a major
 *  event ("Day 12: Aldric the Unbroken joined the kingdom."). Plain JSON. */
export interface ChronicleEntry { day: number; text: string; }

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

  // --- Phase 8 (Late-game content — Stage 8 & Stage 9) --------------------
  /** Max number of player armies/parties (continent parties). Raised +1 at
   *  stage 8 (the "second/extra army slot"). The main party always exists; this
   *  cap governs how many ADDITIONAL field armies can be formed. */
  armyCap = 1;

  /** (Phase 8) Grand Tournament live state (stage-8 home-castle action). */
  tournament: TournamentState = { active: false, endDay: 0, col: 0, row: 0, held: 0 };

  /** (Phase 8) Live emissary parties roaming the continent toward a faction.
   *  ContinentScene renders + advances them; LateGame owns send/arrive/capture. */
  emissaries: EmissaryParty[] = [];
  /** Monotonic counter for unique emissary ids. */
  emissaryCounter = 0;
  /** Faction keys with a standing embassy (passive +2 relations/day). Record so
   *  it serializes cleanly. Value = day the embassy was established. */
  embassies: Record<string, number> = {};

  /** (Phase 8) True once the Imperial Proclamation has been declared (stage 9).
   *  Phase 10 reads this + `imperialEndingUnlocked` to grant a unique ending. */
  imperialProclaimed = false;
  /** (Phase 8) A flag Phase-10 consumes: a win AFTER the proclamation is the
   *  unique "Imperial" ending. Set alongside imperialProclaimed. */
  imperialEndingUnlocked = false;

  /** (Phase 8) The Chronicle of the Kingdom — an ordered list of narrative
   *  entries. Key systems append via GameWorld.recordChronicle(text). The
   *  scribe-tower building (stage 9) surfaces a readable panel of these. */
  chronicle: ChronicleEntry[] = [];

  /** (Phase 8) Highest kingdom stage reached so far — drives the one-shot
   *  transition events (stage-8 travellers, stage-9 leader messages) so each
   *  fires exactly once even if the tier is re-read. */
  highestStageSeen = 1;

  /** (Phase 8) One-shot guards for transition events + late-game unlocks, so a
   *  re-read of the tier never re-fires a beat. Plain JSON. */
  lateGameFlags: Record<string, any> = {};

  // --- Phase 9 (Battle fog of war) ----------------------------------------
  /** (Phase 9) Fresh intelligence on enemy FACTIONS, keyed by faction key. A spy
   *  mission / Gather-Intel sets {level, day}; BattleScene reads it (within ~5 days)
   *  to decide how much of the enemy formation to reveal before the fight. Plain
   *  JSON so it serializes. 'basic' = unit types; 'full' = formation + commander. */
  intelFlags: Record<string, { level: 'basic' | 'full'; day: number }> = {};

  // --- Phase 9 (River strategic system) -----------------------------------
  /** (Phase 9) Per-bridge runtime state keyed by BridgeInfo.id. `destroyed` reverts
   *  a crossing to the slow ford; `rebuildEndDay` (when set) is the game-day the
   *  5-day/40-wood rebuild completes. Serialization-friendly. */
  bridgeState: Record<string, { destroyed: boolean; rebuildEndDay?: number }> = {};

  /** (Phase 9) Ferry docks the player has built at river-adjacent tiles. Each
   *  reduces its river's crossing cost to ~1.5× (between ford and bridge). `relations`
   *  is the optional revenue hook (5 gold/crossing when relations positive — stored,
   *  not yet wired to a gold tick). Keyed/stable for save. */
  ferryDocks: Array<{ id: string; col: number; row: number; riverIdx: number; revenue: boolean }> = [];
  /** Monotonic counter for unique ferry-dock ids. */
  ferryCounter = 0;

  // --- Phase 10 (Win consequences — reputation re-homed to the world) -------
  // Reputation (conqueror / merchant / protector / destroyer) was neutered inside
  // the now-per-settlement IsometricScene. Here it is a REAL Reputation instance
  // whose "scene" is a tiny world-level adapter (repHost) so the existing add /
  // highest / title / serialize logic keeps working at the CONTINENT level — the
  // same re-homing pattern Phases 6/7 used for heroes/diplomacy. The four scores
  // shape the ENDING variant the player earns (see WinConsequences). The player's
  // chosen start TRAIT stays accessible at world level via `king.trait`.
  // Serialization-friendly: `reputation.serialize()` is plain {conqueror,…}.
  reputation: Reputation = new Reputation(this.repHost());

  /** (Phase 10) True once a win has been resolved + the end screen shown, so the
   *  per-day check never re-triggers (mirrors WinConditions.triggered). The won
   *  PATH ('Conquest'|'Diplomacy'|'Legacy'|'Empire') is recorded for the ending.
   *  Plain JSON for Phase 12. */
  winTriggered = false;
  wonPath: string | null = null;

  /** (Phase 10) Consecutive game-days the home settlement has held happiness ≥ 80
   *  — the sustained-happiness gate for the LEGACY win. JSON-friendly. */
  legacyHappyDays = 0;

  /** (Phase 10) One-shot guards for the ongoing world-reaction effects (so e.g. a
   *  given neutral settlement only joins once for high Protector). Plain JSON. */
  reactionFlags: Record<string, any> = {};

  // --- Phase 11 (Economy reinvestment — give mid/late-game gold sinks) --------
  // Everything below is plain JSON (numbers / strings / small records / arrays
  // of strings) so Phase 12's SaveManager serializes it verbatim alongside the
  // rest of the campaign layer. The heavy logic lives in thin methods on this
  // singleton (craftEquipment / invest / addPrestige / buildMonument) so both
  // the UI (IsometricScene / ContinentScene) and the headless audit drive the
  // SAME code paths.

  /** ARMY-WIDE equipment tier 0..3 = Basic / Iron / Steel / Legendary. Crafted at
   *  the Blacksmith (Iron/Steel) or Legendary Forge (Legendary). Applies an
   *  army-wide damage multiplier in BattleScene + a progressive armour sheen on
   *  the player's units. ONE value for the whole army (not per-unit). */
  equipmentTier = 0;

  /** KINGDOM PRESTIGE — earned from Grand Hall, big battle wins, the Great
   *  Council, reaching Stage 9, exploring ruins, and heroes reaching Lv5. Drives
   *  late-game world reactions (better neutral prices at 50+, the fame event at
   *  100+, pilgrims at 200+, the unique 7th hero "The Ancient" at 300+) and at
   *  500+ counts toward the Legacy win score. Monotonic; never spent. */
  prestige = 0;

  /** One-shot guards for prestige sources + threshold events so a re-read never
   *  double-awards (e.g. the +50 Grand-Hall bonus, per-hero Lv5 +30, the 100/200
   *  /300 threshold beats, the 7th-hero release). Plain JSON. */
  prestigeFlags: Record<string, any> = {};

  /** MONUMENTS the player has raised in the home settlement (late-game gold
   *  sinks). Stored as building typeKeys ('victoryarch' | 'greatstatue' |
   *  'imperialpalace') so each is built once; their effects (prestige, battle
   *  morale, the Imperial Palace's stage-9 link) are applied on construction. */
  monuments: string[] = [];

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
  // Phase 10 — Reputation host adapter
  // --------------------------------------------------------------------------
  /** The `Reputation` class was written against the per-settlement IsometricScene
   *  and touches `logEvent` (milestone toast) plus, in its own `onNewDay`, the
   *  scene's diplomacy/kingdoms/resources/goblin-truce. At the WORLD level we drive
   *  reputation EFFECTS ourselves (see WinConsequences ongoing reactions), so we
   *  only need the milestone log here; the rest are harmless. Routing logEvent into
   *  the shared notification queue surfaces "Reputation milestone: protector 50+"
   *  banners on the continent. The same re-homing pattern as heroHost/diploHost. */
  private repHost(): any {
    const gw = this;
    return {
      logEvent: (text: string, _color?: string) => { gw.notify(text, 0xd6c04a); },
      // Absent/empty so the class's own onNewDay short-circuits safely if ever
      // called directly (WinConsequences owns the world-level reactions instead).
      diplomacy: null,
      kingdoms: [],
      resources: { add: (_k: string, _n: number) => {} },
    };
  }

  /** Re-bind the reputation tracker to a fresh host (new campaign / restore). */
  rebindReputation(): void { this.reputation.scene = this.repHost(); }

  /** Add to a reputation track from a WORLD event (the single entry point so call
   *  sites stay readable + future-proof). type ∈ conqueror|merchant|protector|
   *  destroyer. Clamped 0..100 inside Reputation.add. */
  addReputation(type: string, n: number): void { this.reputation.add(type, n); }

  /** The player's chosen start TRAIT id (warlord/merchant/builder/diplomat/
   *  explorer/scholar) or null — kept accessible at world level for the ending
   *  variants (e.g. Legacy + Scholar / Builder). */
  trait(): string | null { return this.king.trait || null; }

  // --------------------------------------------------------------------------
  // Derived helpers
  // --------------------------------------------------------------------------

  /** Total soldiers across all groups in the player party. */
  armySize(): number {
    return this.player.army.reduce((s, g) => s + (g.count || 0), 0);
  }

  // --------------------------------------------------------------------------
  // Phase 8 — kingdom stage + home settlement helpers
  // --------------------------------------------------------------------------

  /** The player's HOME castle settlement (kind 'player_castle'), or null before a
   *  world exists. The home castle's tier IS the kingdom stage. */
  homeSettlement(): Settlement | null {
    if (!this.world) return null;
    return this.world.settlements.find(s => s.kind === 'player_castle') || null;
  }

  /** The stable id of the home castle settlement (its index string), or null. */
  homeSettlementId(): string | null {
    const s = this.homeSettlement();
    return s ? this.settlementId(s) : null;
  }

  /** The persisted SettlementState for the home castle (lazily created). */
  homeState(): SettlementState | null {
    return this.settlementState(this.homeSettlementId());
  }

  /** THE KINGDOM STAGE (1..9) = the home castle settlement's `tier` + 1.
   *  SettlementState.tier is 0-indexed (0 = Small Village … 8 = Large Castle), so
   *  stage = tier + 1. Returns 1 when no home state exists yet. This is the single
   *  gate every Phase-8 unlock checks (action availability, transition events). */
  kingdomStage(): number {
    const st = this.homeState();
    const tier = st ? (st.tier || 0) : 0;
    return Math.max(1, Math.min(9, tier + 1));
  }

  /** TEST HOOK: force the kingdom stage by setting the home castle tier directly.
   *  Used by the headless audit to jump to stage 8/9 without grinding upgrades.
   *  Clamps to 1..9 and returns the resulting stage. */
  setKingdomStage(stage: number): number {
    const st = this.homeState();
    if (st) st.tier = Math.max(0, Math.min(8, Math.round(stage) - 1));
    return this.kingdomStage();
  }

  // --------------------------------------------------------------------------
  // Phase 8 — Chronicle of the Kingdom
  // --------------------------------------------------------------------------
  /** Append a narrative entry to the Chronicle ("Day 12: …"). Key systems call
   *  this on major events (hero joins, war declared, settlement founded, stage
   *  reached). `once` (a stable key) makes a beat fire only the first time. The
   *  log works even if only a few sources are wired (it is purely additive). */
  recordChronicle(text: string, once?: string): void {
    if (once) {
      this.lateGameFlags.chronicleOnce = this.lateGameFlags.chronicleOnce || {};
      if (this.lateGameFlags.chronicleOnce[once]) return;
      this.lateGameFlags.chronicleOnce[once] = true;
    }
    this.chronicle.push({ day: this.displayDay(), text });
    // Keep the log bounded so a very long campaign never balloons the save.
    if (this.chronicle.length > 200) this.chronicle.splice(0, this.chronicle.length - 200);
  }

  // --------------------------------------------------------------------------
  // Phase 8 — small diplomacy helper (relations change without importing the
  // WorldDiplomacy module here, to avoid a circular import). Operates on the
  // re-homed Diplomacy instance + leader memory. faction = red/purple/yellow.
  // --------------------------------------------------------------------------
  changeRelation(faction: string, delta: number, reason = ''): void {
    if (this.diplomacy) this.diplomacy.change(faction, delta, reason);
  }
  /** Faction keys for the three AI powers, derived from the world (red/purple/yellow). */
  factionKeys(): string[] {
    if (!this.world) return ['red', 'purple', 'yellow'];
    return this.world.factions.filter(f => f.personality !== 'player').map(f => f.key);
  }

  // ==========================================================================
  // Phase 9 — BATTLE INTEL (spy / Gather-Intel → pre-battle fog level)
  // ==========================================================================
  /** Number of days fresh intel on a faction stays valid before fog returns. */
  static readonly INTEL_TTL_DAYS = 5;

  /** Record fresh intelligence on a faction (espionage / expeditions call this).
   *  Defaults to 'full'; pass 'basic' for a weaker source. Serialization-friendly. */
  setIntelOnFaction(faction: string, level: 'basic' | 'full' = 'full'): void {
    if (!faction) return;
    this.intelFlags[faction] = { level, day: this.displayDay() };
  }

  /** Current intel level the player holds on a faction's armies. Returns 'none'
   *  once the report is older than INTEL_TTL_DAYS (~5 days). BattleScene + the
   *  launch sites read this to gate how much enemy detail is shown pre-battle. */
  intelOnFaction(faction: string): 'none' | 'basic' | 'full' {
    const f = this.intelFlags[faction];
    if (!f) return 'none';
    if (this.displayDay() - f.day > GameWorldState.INTEL_TTL_DAYS) return 'none';
    return f.level;
  }

  // ==========================================================================
  // Phase 9 — RIVER SYSTEM (bridges, ferry docks, river control)
  // ==========================================================================
  /** Is a bridge currently destroyed (or mid-rebuild)? A destroyed bridge reverts
   *  its tile to the slow ~2.5× ford cost and shows a broken-bridge icon. */
  isBridgeDestroyed(id: string): boolean { return !!(this.bridgeState[id] && this.bridgeState[id].destroyed); }

  /** Destroy a bridge (enemy sabotage, scorched-earth retreat, etc). The tile
   *  reverts to ford cost; the continent re-syncs the pathfinder + icons. */
  destroyBridge(id: string): boolean {
    const b = this.world && this.world.bridges.find(x => x.id === id);
    if (!b) return false;
    this.bridgeState[id] = { destroyed: true };
    b.destroyed = true; // mirror onto the live BridgeInfo for renderers/queries
    return true;
  }

  /** Begin (and, here, immediately complete for simplicity) a bridge rebuild:
   *  5 days + 40 wood from the nearest player settlement. Returns {ok, reason}.
   *  The 5-day timer is recorded on bridgeState.rebuildEndDay so a later phase can
   *  gate completion on time; the bridge becomes usable when the timer elapses. */
  rebuildBridge(id: string): { ok: boolean; reason?: string } {
    const b = this.world && this.world.bridges.find(x => x.id === id);
    if (!b) return { ok: false, reason: 'No such bridge.' };
    if (!this.isBridgeDestroyed(id)) return { ok: false, reason: 'Bridge is intact.' };
    // Spend 40 wood from the nearest player settlement's stockpile.
    const town = this.nearestPlayerSettlementTo(b.col, b.row);
    const st = town ? this.settlementStates[town] : null;
    const wood = st ? (st.resources.wood || 0) : 0;
    if (!st || wood < 40) return { ok: false, reason: 'Need 40 wood at a nearby settlement.' };
    st.resources.wood = wood - 40;
    // 5-day rebuild; record the completion day. tickRivers() flips destroyed off.
    this.bridgeState[id] = { destroyed: true, rebuildEndDay: this.displayDay() + 5 };
    return { ok: true };
  }

  /** Advance any in-progress bridge rebuilds (call from onNewDay). When the 5-day
   *  timer elapses the bridge is restored (fast crossing again). */
  tickRivers(): void {
    const today = this.displayDay();
    for (const id of Object.keys(this.bridgeState)) {
      const s = this.bridgeState[id];
      if (s.destroyed && s.rebuildEndDay !== undefined && today >= s.rebuildEndDay) {
        s.destroyed = false; s.rebuildEndDay = undefined;
        const b = this.world && this.world.bridges.find(x => x.id === id);
        if (b) b.destroyed = false;
      }
    }
  }

  /** Build a ferry dock at a river-adjacent tile: ~60 wood, reduces that river's
   *  crossing cost to ~1.5×. The tile must be passable land orthogonally adjacent
   *  to a RIVER tile (so it sits on the bank). Returns {ok, reason, id}. */
  buildFerryDock(col: number, row: number): { ok: boolean; reason?: string; id?: string } {
    const w = this.world;
    if (!w) return { ok: false, reason: 'No world.' };
    const riverIdx = this.adjacentRiverIndex(col, row);
    if (riverIdx < 0) return { ok: false, reason: 'Must be built on a river bank.' };
    if (this.ferryDocks.some(d => d.col === col && d.row === row)) return { ok: false, reason: 'A ferry already stands here.' };
    // Spend 60 wood from the nearest player settlement.
    const town = this.nearestPlayerSettlementTo(col, row);
    const st = town ? this.settlementStates[town] : null;
    const wood = st ? (st.resources.wood || 0) : 0;
    if (!st || wood < 60) return { ok: false, reason: 'Need 60 wood at a nearby settlement.' };
    st.resources.wood = wood - 60;
    const id = `ferry_${++this.ferryCounter}`;
    this.ferryDocks.push({ id, col, row, riverIdx, revenue: false });
    return { ok: true, id };
  }

  /** The index of a RIVER river adjacent to (col,row), or -1. The ferry's effect
   *  is applied to the river tile(s) it touches. Used by buildFerryDock + cost sync. */
  adjacentRiverIndex(col: number, row: number): number {
    const w = this.world; if (!w) return -1;
    const RIVER = 11; // Biome.RIVER
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dc && !dr) continue;
      const c = col + dc, r = row + dr;
      if (c < 0 || r < 0 || c >= w.size || r >= w.size) continue;
      if (w.tileBiome[r * w.size + c] === RIVER) {
        // Which named river does this tile belong to?
        for (let ri = 0; ri < w.rivers.length; ri++) {
          if (w.rivers[ri].path.some(p => p.col === c && p.row === r)) return ri;
        }
        return 0; // a river tile not on a named path still counts
      }
    }
    return -1;
  }

  /** (Phase 9, light river control) Who controls a major river? A river is
   *  "controlled" by a side that holds ALL of its intact bridges. Returns
   *  'player' | a faction key | 'contested' | 'none'. Currently the player only
   *  gains control via ferry docks / cleared crossings; enemy-blocking AI is left
   *  as a flag for a later phase. */
  riverControlledBy(riverIdx: number): 'player' | 'contested' | 'none' {
    const w = this.world; if (!w) return 'none';
    const bridges = w.bridges.filter(b => b.riverIdx === riverIdx && !this.isBridgeDestroyed(b.id));
    if (!bridges.length) return 'none';
    // The player "controls" a river when they hold a ferry dock on it AND no
    // crossing is destroyed/contested — a readable, queryable state for now.
    const hasFerry = this.ferryDocks.some(d => d.riverIdx === riverIdx);
    return hasFerry ? 'player' : 'none';
  }

  /** Nearest player-owned settlement id to a continent tile, or null. */
  private nearestPlayerSettlementTo(col: number, row: number): string | null {
    const w = this.world; if (!w) return null;
    let best: string | null = null, bd = Infinity;
    for (const s of w.settlements) {
      if (s.kind !== 'player_castle' && !(s as any).founded) continue;
      const d = Math.hypot(s.col - col, s.row - row);
      if (d < bd) { bd = d; best = this.settlementId(s); }
    }
    return best;
  }

  // ==========================================================================
  // Phase 8 — GRAND TOURNAMENT (stage-8 home-castle action)
  // ==========================================================================
  /** Can the Grand Tournament be started right now? Stage ≥ 8, not already
   *  running, and the player can afford 300 gold + 50 food (food from the home
   *  settlement stockpile). Returns {ok, reason}. */
  canStartTournament(): { ok: boolean; reason?: string } {
    if (this.kingdomStage() < 8) return { ok: false, reason: 'Requires a Medium Castle (stage 8).' };
    if (this.tournament.active) return { ok: false, reason: 'A tournament is already underway.' };
    if (this.gold < 300) return { ok: false, reason: 'Need 300 gold.' };
    const home = this.homeState();
    if (!home || (home.resources.food || 0) < 50) return { ok: false, reason: 'Need 50 food at your castle.' };
    return { ok: true };
  }

  /** Start a ~3-day Grand Tournament at the home castle. Spends 300 gold + 50
   *  food, marks it active (the daily tick resolves it). Returns ok + reason. */
  startTournament(): { ok: boolean; reason?: string } {
    const c = this.canStartTournament();
    if (!c.ok) return c;
    this.gold -= 300;
    const home = this.homeState();
    if (home) home.resources.food = Math.max(0, (home.resources.food || 0) - 50);
    const hs = this.homeSettlement();
    // Grounds sit just outside the castle (offset a couple tiles, clamped on-map).
    const sz = this.world ? this.world.size : 1500;
    const col = hs ? Math.max(1, Math.min(sz - 2, hs.col + 3)) : 0;
    const row = hs ? Math.max(1, Math.min(sz - 2, hs.row + 3)) : 0;
    this.tournament = { active: true, endDay: this.displayDay() + 3, col, row, held: this.tournament.held };
    this.notify('A Grand Tournament begins! Champions gather at your castle.', 0xd6c04a);
    this.recordChronicle(`The Grand Tournament is proclaimed at ${this.king.kingdom}. Champions ride from every corner of the continent.`);
    return { ok: true };
  }

  /** Daily tick: finishes a running tournament once its end day is reached.
   *  Rewards: a faction champion joins the army, all factions +10 relations,
   *  home happiness +30 for 5 days, +10 Protector reputation. Returns true the
   *  day it completes (so the scene can flash a banner). */
  tickTournament(): boolean {
    const t = this.tournament;
    if (!t.active) return false;
    if (this.displayDay() < t.endDay) return false;
    t.active = false;
    t.held += 1;
    // 1) A faction champion temporarily joins the player army (an elite warrior
    //    group). Kept simple: a strong warrior stack; the equip/hero system is P11.
    const army = this.player.army;
    const w = army.find(g => g.type === 'champion');
    if (w) w.count += 8; else army.push({ type: 'champion', count: 8 });
    // 2) All AI factions warm +10.
    for (const k of this.factionKeys()) this.changeRelation(k, 10, 'honoured at your tournament');
    // 3) Home happiness +30 for 5 days (temporary modifier stored on the state).
    const home = this.homeState();
    if (home) {
      home.happiness = Math.min(100, (home.happiness || 70) + 30);
      home.tempHappy = { value: 30, untilDay: this.displayDay() + 5 };
    }
    // 4) +10 Protector reputation. (Phase 10 re-homed Reputation to the world, so
    //    this now feeds the real tracker that shapes the ending; the legacy
    //    lateGameFlags.protectorRep mirror is kept for back-compat readers.)
    this.addReputation('protector', 10);
    this.lateGameFlags.protectorRep = (this.lateGameFlags.protectorRep || 0) + 10;
    this.notify('The Tournament ends in glory! A champion joins your host; all realms honour you.', 0xd6c04a);
    this.recordChronicle('The Grand Tournament ends in triumph. A renowned champion pledges their blade to the kingdom.');
    return true;
  }

  // ==========================================================================
  // Phase 8 — LEGENDARY FORGE (upgrade Blacksmith → produces legendaryEquipment)
  // The consuming/equip economy is Phase 11; here we only add the building
  // upgrade + the stocked resource + a basic hero-weapon upgrade hook.
  // ==========================================================================
  /** True once the home Blacksmith has been upgraded to a Legendary Forge. The
   *  forge produces "legendaryEquipment" into the home stockpile. */
  hasLegendaryForge(): boolean { return !!this.lateGameFlags.legendaryForge; }

  /** Can the Legendary Forge upgrade be bought? Stage ≥ 8, a Blacksmith exists at
   *  home, not already upgraded, and 200 iron + 100 stone available at home. */
  canBuildLegendaryForge(): { ok: boolean; reason?: string } {
    if (this.kingdomStage() < 8) return { ok: false, reason: 'Requires a Medium Castle (stage 8).' };
    if (this.hasLegendaryForge()) return { ok: false, reason: 'Already a Legendary Forge.' };
    const home = this.homeState();
    if (!home) return { ok: false, reason: 'No home castle.' };
    const hasSmith = home.buildings.some(b => b.typeKey === 'blacksmith');
    if (!hasSmith) return { ok: false, reason: 'Build a Blacksmith first.' };
    if ((home.resources.iron || 0) < 200) return { ok: false, reason: 'Need 200 iron.' };
    if ((home.resources.stone || 0) < 100) return { ok: false, reason: 'Need 100 stone.' };
    return { ok: true };
  }

  /** Upgrade the home Blacksmith → Legendary Forge (200 iron + 100 stone). It
   *  begins producing legendaryEquipment via the daily tick. Returns ok+reason. */
  buildLegendaryForge(): { ok: boolean; reason?: string } {
    const c = this.canBuildLegendaryForge();
    if (!c.ok) return c;
    const home = this.homeState()!;
    home.resources.iron -= 200;
    home.resources.stone -= 100;
    this.lateGameFlags.legendaryForge = true;
    // Mark the blacksmith building's level so the per-settlement view can show it.
    const smith = home.buildings.find(b => b.typeKey === 'blacksmith');
    if (smith) smith.level = Math.max(smith.level || 1, 2);
    if (home.resources.legendaryEquipment == null) home.resources.legendaryEquipment = 0;
    this.notify('The Blacksmith is reforged into a Legendary Forge!', 0xffe08a);
    this.recordChronicle('Master smiths raise a Legendary Forge, its fires hot enough to shape weapons of legend.');
    return { ok: true };
  }

  /** Daily tick: a standing Legendary Forge produces 1 legendaryEquipment/day
   *  into the home stockpile (simple, non-overlapping with the P11 economy). */
  tickLegendaryForge(): void {
    if (!this.hasLegendaryForge()) return;
    const home = this.homeState();
    if (!home) return;
    home.resources.legendaryEquipment = (home.resources.legendaryEquipment || 0) + 1;
  }

  /** Stocked Legendary Equipment at the home castle. */
  legendaryEquipmentStock(): number {
    const home = this.homeState();
    return home ? (home.resources.legendaryEquipment || 0) : 0;
  }

  /** Upgrade a hero's weapon with 1 legendaryEquipment: that hero gains +40%
   *  damage and a flag for a unique visual (consumed by Phase 11). Returns
   *  {ok, reason}. The damage bonus is stored on heroFlags so it serializes and
   *  BattleScene / later phases can read it without touching the Heroes class. */
  upgradeHeroWeapon(heroId: string): { ok: boolean; reason?: string } {
    if (!this.hasLegendaryForge()) return { ok: false, reason: 'Build a Legendary Forge first.' };
    if (this.legendaryEquipmentStock() < 1) return { ok: false, reason: 'No Legendary Equipment in stock.' };
    const h = this.heroes.byId(heroId);
    if (!h) return { ok: false, reason: 'No such hero.' };
    const home = this.homeState()!;
    home.resources.legendaryEquipment -= 1;
    this.heroFlags.legendaryWeapon = this.heroFlags.legendaryWeapon || {};
    this.heroFlags.legendaryWeapon[heroId] = { damageMult: 1.4, uniqueVisual: true };
    this.notify(`${h.name}'s weapon is reforged with legendary steel (+40% damage).`, 0xffe08a);
    this.recordChronicle(`${h.name} is armed from the Legendary Forge — a weapon worthy of song.`);
    return { ok: true };
  }

  // ==========================================================================
  // Phase 8 — EMISSARY SYSTEM (send a named envoy → permanent embassy)
  // ==========================================================================
  /** Can an emissary be sent to a faction? Stage ≥ 8, the faction is real, no
   *  embassy or emissary already in flight to it. */
  canSendEmissary(faction: string): { ok: boolean; reason?: string } {
    if (this.kingdomStage() < 8) return { ok: false, reason: 'Requires a Medium Castle (stage 8).' };
    if (!this.factionKeys().includes(faction)) return { ok: false, reason: 'Unknown faction.' };
    if (this.embassies[faction] != null) return { ok: false, reason: 'An embassy already stands there.' };
    if (this.emissaries.some(e => e.faction === faction && e.status === 'travelling')) return { ok: false, reason: 'An emissary is already on the road.' };
    return { ok: true };
  }

  /** Send a named emissary as a continent party toward a faction's castle. On
   *  arrival (driven by ContinentScene movement → LateGame.tickEmissaries) it
   *  founds a permanent embassy (passive +2 relations/day). Returns ok + the
   *  spawned emissary (or reason). */
  sendEmissary(faction: string): { ok: boolean; reason?: string; emissary?: EmissaryParty } {
    const c = this.canSendEmissary(faction);
    if (!c.ok) return c;
    const f = this.world ? this.world.factions.find(x => x.key === faction) : null;
    if (!f) return { ok: false, reason: 'Unknown faction.' };
    const home = this.homeSettlement();
    const startCol = home ? home.col : this.player.col;
    const startRow = home ? home.row : this.player.row;
    const NAMES = ['Envoy Lysa', 'Herald Bram', 'Ambassador Corin', 'Emissary Talia', 'Legate Orin', 'Envoy Sable'];
    const em: EmissaryParty = {
      id: `emissary_${this.emissaryCounter++}`,
      name: NAMES[this.emissaryCounter % NAMES.length],
      faction,
      color: f.color,
      col: startCol, row: startRow,
      destCol: f.castleCol, destRow: f.castleRow,
      status: 'travelling',
    };
    this.emissaries.push(em);
    this.notify(`${em.name} sets out to open an embassy with ${f.name}.`, 0xc9a14a);
    this.recordChronicle(`${em.name} departs the capital, bearing the kingdom's word to ${f.name}.`);
    return { ok: true, emissary: em };
  }

  /** Establish a permanent embassy on arrival (called by LateGame when the
   *  emissary reaches its destination). Passive +2 relations/day begins. */
  establishEmbassy(em: EmissaryParty): void {
    em.status = 'embassy';
    this.embassies[em.faction] = this.displayDay();
    const f = this.world ? this.world.factions.find(x => x.key === em.faction) : null;
    const name = f ? f.name : em.faction;
    this.notify(`An embassy opens with ${name}. Relations will warm steadily.`, 0x2a7a4f);
    this.recordChronicle(`A permanent embassy is established with ${name}. Goodwill flows between the realms.`);
  }

  /** Mark an emissary captured (hostile faction). Ransom 200 gold to free. */
  captureEmissary(em: EmissaryParty): void {
    em.status = 'captured';
    const f = this.world ? this.world.factions.find(x => x.key === em.faction) : null;
    const name = f ? f.name : em.faction;
    this.notify(`${em.name} has been seized by ${name}! Pay 200 gold to ransom them.`, 0x8c2b2b);
    this.recordChronicle(`${em.name} is taken captive by ${name}. The court debates the ransom.`);
  }

  /** Pay 200 gold to free a captured emissary (they return home, no embassy). */
  ransomEmissary(id: string): { ok: boolean; reason?: string } {
    const em = this.emissaries.find(e => e.id === id);
    if (!em || em.status !== 'captured') return { ok: false, reason: 'No captive to ransom.' };
    if (this.gold < 200) return { ok: false, reason: 'Need 200 gold.' };
    this.gold -= 200;
    // Freed → removed from the map (returns home; no embassy founded).
    this.emissaries = this.emissaries.filter(e => e.id !== id);
    this.notify(`${em.name} is ransomed and returns home safely.`, 0xc9a14a);
    return { ok: true };
  }

  /** Daily tick over standing embassies: +2 relations/day with each faction that
   *  has an embassy (skips factions at open war if that would feel odd — we keep
   *  it simple and always warm). */
  tickEmbassies(): void {
    for (const k of Object.keys(this.embassies)) this.changeRelation(k, 2, 'an embassy maintains goodwill');
  }

  // ==========================================================================
  // Phase 8 — IMPERIAL PROCLAMATION (stage-9 momentous action)
  // ==========================================================================
  /** Can the Imperial Proclamation be declared? Stage 9, not already proclaimed,
   *  and 1000 gold + 300 stone + 200 iron available (gold from the purse; stone/
   *  iron from the home stockpile). */
  canDeclareImperial(): { ok: boolean; reason?: string } {
    if (this.kingdomStage() < 9) return { ok: false, reason: 'Requires a Large Castle (stage 9).' };
    if (this.imperialProclaimed) return { ok: false, reason: 'The Empire is already proclaimed.' };
    if (this.gold < 1000) return { ok: false, reason: 'Need 1000 gold.' };
    const home = this.homeState();
    if (!home) return { ok: false, reason: 'No home castle.' };
    if ((home.resources.stone || 0) < 300) return { ok: false, reason: 'Need 300 stone.' };
    if ((home.resources.iron || 0) < 200) return { ok: false, reason: 'Need 200 iron.' };
    return { ok: true };
  }

  /** Declare the Imperial Proclamation (stage 9). Allied factions celebrate (a
   *  gold gift + relations up), neutral factions −30 relations, hostile factions
   *  declare war immediately. Sets imperialProclaimed + the Phase-10 ending flag.
   *  Returns ok + a per-faction reaction summary for the scene. */
  declareImperial(): { ok: boolean; reason?: string; reactions?: Record<string, string> } {
    const c = this.canDeclareImperial();
    if (!c.ok) return c;
    this.gold -= 1000;
    const home = this.homeState()!;
    home.resources.stone -= 300;
    home.resources.iron -= 200;
    this.imperialProclaimed = true;
    this.imperialEndingUnlocked = true; // Phase 10 grants a unique ending on a win
    const reactions: Record<string, string> = {};
    for (const k of this.factionKeys()) {
      const allied = this.diplomacy ? this.diplomacy.isAllied(k) : false;
      const rel = this.diplomacy ? this.diplomacy.get(k) : 0;
      if (allied) {
        // Allies celebrate: a gold gift + relations up.
        this.gold += 150;
        this.changeRelation(k, 20, 'your ally celebrates the new Empire');
        reactions[k] = 'celebrates';
      } else if (rel <= -50) {
        // Already hostile → open war immediately.
        if (this.diplomacy) {
          this.diplomacy.rel[k] = -100; this.diplomacy.nap[k] = false; this.diplomacy.ally[k] = false;
          const t = this.diplomacy.tr(k); t.alliance = false; t.trade = false;
        }
        reactions[k] = 'war';
      } else {
        // Neutral powers resent the upstart Empire.
        this.changeRelation(k, -30, 'they resent your Imperial ambition');
        // If that pushed them to hostile, they too declare war.
        if (this.diplomacy && this.diplomacy.get(k) <= -50) {
          this.diplomacy.rel[k] = -100; this.diplomacy.nap[k] = false;
          reactions[k] = 'war';
        } else {
          reactions[k] = 'neutral';
        }
      }
    }
    this.notify(`${this.king.kingdom} is proclaimed an EMPIRE! The continent will never be the same.`, 0xffe08a);
    this.recordChronicle(`${this.king.ruler} proclaims the founding of the Empire of ${this.king.kingdom}. Allies cheer; rivals tremble; enemies march.`);
    return { ok: true, reactions };
  }

  // ==========================================================================
  // Phase 10 — RESTORE THE EMPIRE (the secret FOURTH win condition)
  // ==========================================================================
  /** Cost of the empire-restoration ritual (a deliberately large gold sink so the
   *  4th win is a momentous, earned act — paid out of the campaign purse). */
  static readonly EMPIRE_RESTORE_COST = 5000;

  /** Can the empire-restoration ritual be performed? The hidden `fourthWinCondition`
   *  flag must be set (revealed via Tomas / the ancient ruins quest in Phase 6),
   *  not already won, and the player must afford the ritual's huge cost. */
  canRestoreEmpire(): { ok: boolean; reason?: string } {
    if (!this.heroFlags.fourthWinCondition) return { ok: false, reason: 'The path to the Empire has not been revealed.' };
    if (this.wonPath === 'Empire') return { ok: false, reason: 'The Empire is already restored.' };
    if (this.gold < GameWorldState.EMPIRE_RESTORE_COST) return { ok: false, reason: `The ritual demands ${GameWorldState.EMPIRE_RESTORE_COST} gold.` };
    return { ok: true };
  }

  /** Perform the restore-the-empire ritual: spend the large sum, mark the unique
   *  EMPIRE win path, and unlock the imperial ending. The actual end screen is shown
   *  by ContinentScene's win check (which sees wonPath === 'Empire'). Returns
   *  {ok, reason}. Idempotent against a double-call (canRestoreEmpire guards). */
  restoreEmpire(): { ok: boolean; reason?: string } {
    const c = this.canRestoreEmpire();
    if (!c.ok) return c;
    this.gold -= GameWorldState.EMPIRE_RESTORE_COST;
    this.wonPath = 'Empire';
    this.imperialEndingUnlocked = true; // the unique imperial ending is now granted
    this.notify('The vault is open. The Old Empire stirs back to life beneath your hand.', 0xffe08a);
    this.recordChronicle(`${this.king.ruler} completes the ancient ritual. The vault opens; the Empire of old is reborn.`);
    return { ok: true };
  }

  // ==========================================================================
  // Phase 11 — ARMY EQUIPMENT TIERS (army-wide upgrade at the Blacksmith / Forge)
  // ==========================================================================
  // One tier for the WHOLE army (not per-unit): 0 Basic / 1 Iron / 2 Steel /
  // 3 Legendary. Each tier is crafted by paying a one-time cost (iron/planks from
  // the home stockpile + gold from the purse, and an artifact OR a unit of
  // legendaryEquipment for the top tier). The effect is a flat army-wide damage
  // multiplier (+15% / +30% / +50%) read by BattleScene, plus a progressive
  // armour sheen on the player's units (legendary = a unique glow). Tiers must be
  // crafted in order (can't skip to Legendary).

  /** Recipe table indexed by target tier (1..3). gold from the purse; iron/planks
   *  from the home stockpile; `artifact` true = also consume 1 artifact OR 1
   *  legendaryEquipment for the top tier. */
  static readonly EQUIPMENT_RECIPES: Record<number, { iron: number; planks: number; gold: number; artifact?: boolean; name: string; mult: number }> = {
    1: { iron: 40, planks: 0, gold: 60, name: 'Iron', mult: 1.15 },
    2: { iron: 80, planks: 30, gold: 120, name: 'Steel', mult: 1.30 },
    3: { iron: 150, planks: 50, gold: 200, artifact: true, name: 'Legendary', mult: 1.50 },
  };

  /** The recipe for an equipment tier (1..3), or null. Instance accessor so the
   *  UI doesn't reach through `.constructor` for the static table. */
  equipmentRecipe(tier: number): { iron: number; planks: number; gold: number; artifact?: boolean; name: string; mult: number } | null {
    return GameWorldState.EQUIPMENT_RECIPES[tier] || null;
  }

  /** Display name of the current army equipment tier. */
  equipmentTierName(): string {
    return ['Basic', 'Iron', 'Steel', 'Legendary'][Math.max(0, Math.min(3, this.equipmentTier))];
  }

  /** The army-wide DAMAGE multiplier from the current equipment tier (1.0 / 1.15
   *  / 1.30 / 1.50). BattleScene folds this into the player's per-strike power. */
  equipmentDamageMult(): number {
    return [1, 1.15, 1.30, 1.50][Math.max(0, Math.min(3, this.equipmentTier))];
  }

  /** Count of recoverable artifacts available to spend on a Legendary craft.
   *  Artifacts are recorded as a count flag (ruin/relic finds) on heroFlags so
   *  this stays decoupled from the per-settlement artifact UI; the Legendary
   *  Forge's legendaryEquipment stock also counts. */
  artifactStock(): number { return Math.max(0, Math.floor(this.heroFlags.artifacts || 0)); }

  /** Can a given equipment tier be crafted right now? Must be the NEXT tier up
   *  (no skipping), with the recipe affordable. Iron/Steel need a Blacksmith at
   *  home; Legendary needs the Legendary Forge (Phase 8) — reuses it, doesn't
   *  duplicate it. Returns {ok, reason}. */
  canCraftEquipment(tier: number): { ok: boolean; reason?: string } {
    const r = GameWorldState.EQUIPMENT_RECIPES[tier];
    if (!r) return { ok: false, reason: 'No such equipment tier.' };
    if (tier !== this.equipmentTier + 1) {
      if (tier <= this.equipmentTier) return { ok: false, reason: `Army already at ${this.equipmentTierName()} tier.` };
      return { ok: false, reason: `Craft the ${GameWorldState.EQUIPMENT_RECIPES[this.equipmentTier + 1]?.name || 'previous'} tier first.` };
    }
    const home = this.homeState();
    if (!home) return { ok: false, reason: 'No home castle.' };
    const hasSmith = home.buildings.some(b => b.typeKey === 'blacksmith');
    if (!hasSmith) return { ok: false, reason: 'Build a Blacksmith first.' };
    if (tier === 3 && !this.hasLegendaryForge()) return { ok: false, reason: 'Legendary gear needs a Legendary Forge.' };
    if ((home.resources.iron || 0) < r.iron) return { ok: false, reason: `Need ${r.iron} iron.` };
    if (r.planks && (home.resources.planks || 0) < r.planks) return { ok: false, reason: `Need ${r.planks} planks.` };
    if (this.gold < r.gold) return { ok: false, reason: `Need ${r.gold} gold.` };
    if (r.artifact && this.artifactStock() < 1 && this.legendaryEquipmentStock() < 1) return { ok: false, reason: 'Need 1 artifact or 1 Legendary Equipment.' };
    return { ok: true };
  }

  /** Craft the army-wide equipment of `tier` (1..3): spend the recipe, raise the
   *  tier. The new tier's damage multiplier + visual sheen apply on the next
   *  battle. Returns {ok, reason}. The single entry point used by the UI + audit. */
  craftEquipment(tier: number): { ok: boolean; reason?: string } {
    const c = this.canCraftEquipment(tier);
    if (!c.ok) return c;
    const r = GameWorldState.EQUIPMENT_RECIPES[tier];
    const home = this.homeState()!;
    home.resources.iron -= r.iron;
    if (r.planks) home.resources.planks = (home.resources.planks || 0) - r.planks;
    this.gold -= r.gold;
    if (r.artifact) {
      // Prefer spending a loose artifact; fall back to Legendary Equipment stock.
      if (this.artifactStock() >= 1) this.heroFlags.artifacts = this.artifactStock() - 1;
      else home.resources.legendaryEquipment = (home.resources.legendaryEquipment || 0) - 1;
    }
    this.equipmentTier = tier;
    const pct = Math.round((r.mult - 1) * 100);
    this.notify(`Your army is re-equipped with ${r.name} gear (+${pct}% damage).`, tier === 3 ? 0xffe08a : 0xc9d3df);
    this.recordChronicle(`The host is rearmed in ${r.name} steel — every blade strikes ${pct}% harder.`);
    return { ok: true };
  }

  // ==========================================================================
  // Phase 11 — SETTLEMENT INVESTMENT (permanent per-settlement upgrades)
  // ==========================================================================
  // Each investment is a one-time gold/resource sink that sets a flag on the
  // settlement's SettlementState (so it serializes for Phase 12) and applies a
  // permanent (or timed) effect. The per-settlement view reads invest.* to apply
  // the production multiplier, daily gold, growth, etc. `invest(settlementId,kind)`
  // is the single entry point used by the UI + the headless audit.

  /** Investment definitions: cost (gold from purse; stone/food from the local
   *  stockpile) + a short label. */
  static readonly INVEST_DEFS: Record<string, { gold: number; stone?: number; food?: number; name: string; desc: string }> = {
    infrastructure: { gold: 200, name: 'Infrastructure', desc: '+10% all production here (permanent).' },
    fortification: { gold: 150, stone: 50, name: 'Fortification', desc: '+50% auto-wall HP, +3 permanent garrison.' },
    population: { gold: 100, food: 50, name: 'Population', desc: '+5 pop now, +50% growth for 10 days.' },
    trade: { gold: 150, name: 'Trade', desc: '+5 gold/day, caravan income +20% (permanent).' },
  };

  /** Instance accessor for the investment definition table (so the UI reads it
   *  off the singleton instead of reaching through `.constructor`). */
  get INVEST_DEFS() { return GameWorldState.INVEST_DEFS; }
  /** Instance accessor for the monument definition table. */
  get MONUMENT_DEFS() { return GameWorldState.MONUMENT_DEFS; }

  /** Has a settlement already taken a given investment? */
  hasInvestment(settlementId: string | null, kind: string): boolean {
    const st = this.settlementState(settlementId) as any;
    return !!(st && st.invest && st.invest[kind]);
  }

  /** The permanent local-production multiplier from a settlement's investments
   *  (currently the Infrastructure +10%). Read by the per-settlement economy. */
  investProductionMult(settlementId: string | null): number {
    return this.hasInvestment(settlementId, 'infrastructure') ? 1.1 : 1;
  }

  /** Bonus gold/day a settlement's Trade investment yields (permanent). */
  investGoldPerDay(settlementId: string | null): number {
    return this.hasInvestment(settlementId, 'trade') ? 5 : 0;
  }

  /** Can a settlement take a given investment? Not already taken, and affordable
   *  (gold from the purse, stone/food from THAT settlement's stockpile). */
  canInvest(settlementId: string | null, kind: string): { ok: boolean; reason?: string } {
    const def = GameWorldState.INVEST_DEFS[kind];
    if (!def) return { ok: false, reason: 'Unknown investment.' };
    const st = this.settlementState(settlementId);
    if (!st) return { ok: false, reason: 'Unknown settlement.' };
    if (this.hasInvestment(settlementId, kind)) return { ok: false, reason: `${def.name} already built here.` };
    if (this.gold < def.gold) return { ok: false, reason: `Need ${def.gold} gold.` };
    if (def.stone && (st.resources.stone || 0) < def.stone) return { ok: false, reason: `Need ${def.stone} stone here.` };
    if (def.food && (st.resources.food || 0) < def.food) return { ok: false, reason: `Need ${def.food} food here.` };
    return { ok: true };
  }

  /** Make a permanent investment in a settlement: spend the cost, set the flag on
   *  its SettlementState, and apply the immediate effect. Returns {ok, reason}.
   *  - infrastructure → flag only (production mult read via investProductionMult).
   *  - fortification  → flag (+50% wall HP) + 3 permanent garrison warriors.
   *  - population     → immediate +5 pop + a 10-day +50% growth window.
   *  - trade          → flag (+5 gold/day + caravan income +20%, both read live). */
  invest(settlementId: string | null, kind: string): { ok: boolean; reason?: string } {
    const c = this.canInvest(settlementId, kind);
    if (!c.ok) return c;
    const def = GameWorldState.INVEST_DEFS[kind];
    const st = this.settlementState(settlementId)! as any;
    this.gold -= def.gold;
    if (def.stone) st.resources.stone = (st.resources.stone || 0) - def.stone;
    if (def.food) st.resources.food = (st.resources.food || 0) - def.food;
    if (!st.invest) st.invest = {};
    st.invest[kind] = true;
    // Apply the immediate, state-stored effects.
    if (kind === 'fortification') {
      const g = st.garrison.find((x: GarrisonStack) => x.type === 'warrior');
      if (g) g.count += 3; else st.garrison.push({ type: 'warrior', count: 3 });
    } else if (kind === 'population') {
      st.population = (st.population || 0) + 5;
      st.investGrowthUntil = this.displayDay() + 10; // +50% growth window for the local view
    }
    this.notify(`${def.name} built in ${st.name}.`, 0x2a7a4f);
    this.recordChronicle(`${def.name} is established in ${st.name}.`, `invest_${settlementId}_${kind}`);
    return { ok: true };
  }

  // ==========================================================================
  // Phase 11 — PRESTIGE SYSTEM (a kingdom-fame meter + its world effects)
  // ==========================================================================
  // Prestige is a single monotonic number earned from notable deeds. addPrestige
  // is the single entry point every source funnels through; it also fires the
  // one-shot threshold beats (100 fame event, 200 pilgrims, 300 → release the
  // 7th hero "The Ancient"). 50+ improves neutral prices; 500+ feeds the Legacy
  // win score (read by WinConsequences). All guards are JSON for Phase 12.

  /** Add prestige from a world deed and fire any newly-crossed threshold beats.
   *  `once` (a stable key) makes a source award exactly once (e.g. Grand Hall,
   *  per-hero Lv5, Stage 9). Returns the prestige actually granted (0 if guarded). */
  addPrestige(amount: number, reason = '', once?: string): number {
    if (amount <= 0) return 0;
    if (once) {
      this.prestigeFlags.once = this.prestigeFlags.once || {};
      if (this.prestigeFlags.once[once]) return 0;
      this.prestigeFlags.once[once] = true;
    }
    const before = this.prestige;
    this.prestige += amount;
    if (reason) this.notify(`Prestige +${amount}: ${reason} (total ${this.prestige}).`, 0xd6c04a);
    this.checkPrestigeThresholds(before, this.prestige);
    return amount;
  }

  /** Fire the one-shot prestige threshold beats when the meter crosses 100 / 200
   *  / 300. 50+ (better neutral prices) and 500+ (Legacy score) are read live
   *  where they apply, so they need no event here. */
  private checkPrestigeThresholds(before: number, after: number): void {
    const crossed = (t: number) => before < t && after >= t;
    if (crossed(100)) {
      this.notify('Your fame spreads across the continent — minstrels sing of your kingdom.', 0xffe08a);
      this.recordChronicle('Word of the kingdom\'s glory spreads to every corner of the continent.', 'prestige_100');
    }
    if (crossed(200)) {
      this.notify('Pilgrims now seek out your territory, drawn by your renown.', 0xffe08a);
      this.recordChronicle('Pilgrims and seekers journey to your lands, drawn by their fame.', 'prestige_200');
    }
    if (crossed(300)) this.releaseAncientHero();
  }

  /** At 300+ prestige, release the unique 7th hero "The Ancient" from a ruin —
   *  offered once. Heroes.offer() with no worldEvents host auto-joins (world-level
   *  roster), so this both unlocks AND grants the hero. Safe to call repeatedly. */
  releaseAncientHero(): void {
    if (this.prestige < 300) return;
    if (this.prestigeFlags.ancientReleased) return;
    if (this.heroes.byId('ancient') || this.heroes.offered?.['ancient']) { this.prestigeFlags.ancientReleased = true; return; }
    this.prestigeFlags.ancientReleased = true;
    this.heroes.offer('ancient');
    this.notify('Your renown stirs an ancient power — The Ancient is freed from a forgotten ruin and pledges to you.', 0xffe08a);
    this.recordChronicle('Drawn by the kingdom\'s fame, The Ancient rises from a sealed ruin to serve the realm.', 'ancient_join');
  }

  /** True once the 7th hero "The Ancient" is available (released at 300 prestige). */
  ancientHeroAvailable(): boolean { return !!this.prestigeFlags.ancientReleased; }

  /** Neutral-settlement price improvement from prestige (≥50 → 10% better trade
   *  prices). Read by the market/trade UIs. Returns a multiplier on the player's
   *  favour (1.10 = 10% better). */
  prestigePriceBonus(): number { return this.prestige >= 50 ? 1.1 : 1; }

  /** Prestige contribution to the Legacy win score (≥500 → counts). Read by
   *  WinConsequences. Returns a small bonus only past the 500 milestone. */
  prestigeLegacyBonus(): number { return this.prestige >= 500 ? 1 : 0; }

  // ==========================================================================
  // Phase 11 — MONUMENTS (late-game gold sinks built in the home settlement)
  // ==========================================================================
  // A new building CATEGORY raised at the home castle. Each is a deliberately
  // large gold/stone sink that grants prestige (and, for the Great Statue, a
  // standing battle-morale bonus; the Imperial Palace links to the stage-9
  // Imperial path). Built once each — recorded in `monuments` by typeKey. The
  // per-settlement view places the building; this method applies the EFFECTS.

  /** Monument definitions: cost + prestige + extra effects. Costs: gold from the
   *  purse; stone/iron/planks from the home stockpile. */
  static readonly MONUMENT_DEFS: Record<string, { gold: number; stone?: number; iron?: number; planks?: number; prestige: number; morale?: number; name: string }> = {
    victoryarch: { gold: 500, stone: 100, prestige: 50, name: 'Victory Arch' },
    greatstatue: { gold: 800, stone: 150, iron: 50, prestige: 100, morale: 15, name: 'Great Statue' },
    imperialpalace: { gold: 1500, stone: 200, planks: 100, prestige: 200, name: 'Imperial Palace' },
  };

  /** Has a given monument been raised? */
  hasMonument(key: string): boolean { return this.monuments.includes(key); }

  /** The standing battle-morale bonus from monuments (the Great Statue's +15).
   *  Read by BattleScene when seeding the player's starting morale. */
  monumentMoraleBonus(): number {
    let m = 0;
    for (const k of this.monuments) m += (GameWorldState.MONUMENT_DEFS[k]?.morale || 0);
    return m;
  }

  /** Can a monument be built? Stage gate (Victory Arch any time at the home
   *  castle; Great Statue ≥ stage 7; Imperial Palace ≥ stage 9), not already
   *  built, and affordable (gold from purse, materials from the home stockpile). */
  canBuildMonument(key: string): { ok: boolean; reason?: string } {
    const def = GameWorldState.MONUMENT_DEFS[key];
    if (!def) return { ok: false, reason: 'Unknown monument.' };
    if (this.hasMonument(key)) return { ok: false, reason: `${def.name} already stands.` };
    const home = this.homeState();
    if (!home) return { ok: false, reason: 'No home castle.' };
    if (key === 'greatstatue' && this.kingdomStage() < 7) return { ok: false, reason: 'Requires a Small Castle (stage 7).' };
    if (key === 'imperialpalace' && this.kingdomStage() < 9) return { ok: false, reason: 'Requires a Large Castle (stage 9).' };
    if (this.gold < def.gold) return { ok: false, reason: `Need ${def.gold} gold.` };
    if (def.stone && (home.resources.stone || 0) < def.stone) return { ok: false, reason: `Need ${def.stone} stone.` };
    if (def.iron && (home.resources.iron || 0) < def.iron) return { ok: false, reason: `Need ${def.iron} iron.` };
    if (def.planks && (home.resources.planks || 0) < def.planks) return { ok: false, reason: `Need ${def.planks} planks.` };
    return { ok: true };
  }

  /** Build a monument: spend the cost, record it, and apply its effects (prestige
   *  + any standing bonus; the Imperial Palace also unlocks the Imperial
   *  Proclamation path link by recording itself). Returns {ok, reason}. The
   *  per-settlement view raises the building sprite separately. */
  buildMonument(key: string): { ok: boolean; reason?: string } {
    const c = this.canBuildMonument(key);
    if (!c.ok) return c;
    const def = GameWorldState.MONUMENT_DEFS[key];
    const home = this.homeState()!;
    this.gold -= def.gold;
    if (def.stone) home.resources.stone = (home.resources.stone || 0) - def.stone;
    if (def.iron) home.resources.iron = (home.resources.iron || 0) - def.iron;
    if (def.planks) home.resources.planks = (home.resources.planks || 0) - def.planks;
    this.monuments.push(key);
    this.addPrestige(def.prestige, `the ${def.name} is raised`);
    if (key === 'imperialpalace') {
      // Replaces the Castle visual + flags the Imperial path link (stage-9
      // Proclamation is already gated; the palace makes it a destination build).
      this.lateGameFlags.imperialPalace = true;
      this.notify('The Imperial Palace dwarfs the old keep — your seat is fit for an Empire.', 0xffe08a);
    }
    this.recordChronicle(`The ${def.name} is raised at ${this.king.kingdom} — a monument to endure for ages.`, `monument_${key}`);
    return { ok: true };
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
    // --- Phase 8 late-game reset (all JSON for Phase 12) ---
    this.armyCap = 1;
    this.tournament = { active: false, endDay: 0, col: 0, row: 0, held: 0 };
    this.emissaries = [];
    this.emissaryCounter = 0;
    this.embassies = {};
    this.imperialProclaimed = false;
    this.imperialEndingUnlocked = false;
    this.chronicle = [];
    this.highestStageSeen = 1;
    this.lateGameFlags = {};
    // --- Phase 9 reset (battle intel + river system; all JSON for Phase 12) ---
    this.intelFlags = {};
    this.bridgeState = {};
    this.ferryDocks = [];
    this.ferryCounter = 0;
    // --- Phase 10 reset (reputation re-homed + win consequences; all JSON) ---
    this.reputation = new Reputation(this.repHost());
    this.winTriggered = false;
    this.wonPath = null;
    this.legacyHappyDays = 0;
    this.reactionFlags = {};
    // --- Phase 11 reset (economy reinvestment; all plain JSON for Phase 12) ---
    this.equipmentTier = 0;
    this.prestige = 0;
    this.prestigeFlags = {};
    this.monuments = [];
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
      // (Phase 8) Late-game campaign layer — all plain JSON for Phase 12.
      armyCap: this.armyCap,
      tournament: this.tournament,
      emissaries: this.emissaries,
      emissaryCounter: this.emissaryCounter,
      embassies: this.embassies,
      imperialProclaimed: this.imperialProclaimed,
      imperialEndingUnlocked: this.imperialEndingUnlocked,
      chronicle: this.chronicle,
      highestStageSeen: this.highestStageSeen,
      lateGameFlags: this.lateGameFlags,
      // (Phase 9) Battle intel + river system — all plain JSON. Bridge runtime
      // state (destroyed / rebuild timer) is keyed by stable id; ferry docks carry
      // their tile + river index so both survive a seed-rebuilt world.
      intelFlags: this.intelFlags,
      bridgeState: this.bridgeState,
      ferryDocks: this.ferryDocks,
      ferryCounter: this.ferryCounter,
      // (Phase 10) Win-consequence layer — reputation scores (Reputation.serialize)
      // + the resolved win path / trigger guard + the legacy happiness streak +
      // ongoing-reaction one-shot guards. All plain JSON; Phase 12 rebuilds the
      // Reputation instance on a fresh host then restore()s the scores.
      reputation: this.reputation.serialize(),
      winTriggered: this.winTriggered,
      wonPath: this.wonPath,
      legacyHappyDays: this.legacyHappyDays,
      reactionFlags: this.reactionFlags,
      // (Phase 11) Economy-reinvestment layer — army equipment tier, kingdom
      // prestige (+ its one-shot guards), and the raised monuments. The per-
      // settlement INVEST flags live on each SettlementState (already serialized
      // via settlementStates above), so they ride along automatically.
      equipmentTier: this.equipmentTier,
      prestige: this.prestige,
      prestigeFlags: this.prestigeFlags,
      monuments: this.monuments,
      started: this.started,
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The single shared campaign-state instance. */
export const GameWorld = new GameWorldState();
