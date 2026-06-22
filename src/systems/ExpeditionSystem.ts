// ============================================================================
// ExpeditionSystem.ts — Phase 5 (Bannerlord rebuild) LIVING expedition system.
// ============================================================================
//
// Phase 5 turns the legacy timer-button "expeditions" into VISIBLE journeys on
// the continent. Everything here is campaign LOGIC operating on the shared
// GameWorld state; the per-frame motion + rendering of any new party flavour
// lives in ContinentScene (exactly as Pioneers do — see PioneerSystem's header).
// No new movement engine: worker parties reuse the Phase-4 A*/per-biome budget.
//
// ============================================================================
// THE SIX MECHANICS (each a static entry point so any scene / the headless
// audit can drive them without a singleton; all state lives in GameWorld and
// stays JSON-friendly for Phase 12's SaveManager):
//
//   1. RUINS EXPLORATION   exploreRuin(ruinId)      — start a ~1-day on-site
//                          dig; tickRuinExploration advances it; on complete a
//                          reward is granted and the ruin flagged explored.
//   2. GOBLIN CAMP RAIDS   raidCamp(campId)         — builds a goblin army scaled
//                          to the camp and hands ContinentScene the BattleScene
//                          launch contract (the scene actually launches it);
//                          onCampRaidWon credits loot + clears the camp.
//   3. WORKER EXPEDITIONS  sendWorkers(fromId,c,r)  — spawns a non-combat worker
//                          party that travels to a deposit, mines ~2 days, then
//                          auto-returns to the nearest player settlement and
//                          deposits the haul. tickWorkers drives mining/return.
//   4. MERCENARY CAMPS     hireMercenaries(campId,n)— hire troops straight into
//                          the field party at a favourable per-head rate.
//   5. CARAVAN RAID        raidCaravan(caravanId)   — a quick (NON-BattleScene)
//                          skirmish vs an enemy caravan: steal cargo + bank a
//                          −20 relation delta for that faction (Phase 7 applies).
//   6. EXPEDITION PANEL    (UI in ContinentScene) reads activeExpeditions() +
//                          GameWorld.discovered + quickTravelCost()/quickTravel.
//
// DESIGN DECISIONS
// ----------------
// * RUIN REWARDS are a clean 4-way set (gold / resources / artifact / relic),
//   chosen deterministically from the ruin id so the same ruin always yields the
//   same reward (save-stable). Resource hauls + artifact/relic gold bonuses land
//   in the NEAREST player settlement's stockpile (gold always to campaign gold).
// * GOBLIN ARMY scales with how many camps are nearby is overkill; we scale a
//   single camp's defenders off a stable per-camp hash (12–28 goblins) so weak
//   and tough camps both exist. Real BattleScene is reused via ContinentScene.
// * WORKERS are deliberately COMBAT-FREE and vulnerable (HP, goblin-proximity
//   damage in tickWorkers) so the "send an escort" fantasy (P6) has a hook, but
//   the system never crashes without one (escort optional, like pioneers).
// * MERC RATE is intentionally GOOD (cheaper than training): MERC_COST_PER_HEAD
//   gold buys a veteran warrior straight into the field — the player trades gold
//   for instant army, the whole point of a mercenary camp.
// * CARAVAN RAID is a SIMPLE RESOLVE (no BattleScene): a one-shot odds check on
//   army size vs the caravan's light guard. Win → steal cargo + −20 relations;
//   the caravan leaves the map. Loss → minor losses, caravan flees. This keeps
//   raids snappy and distinct from pitched battles.
// ============================================================================

import { GameWorld } from './GameWorld.js';
import type { WorkerParty, RuinReward, ArmyGroup, AIParty } from './GameWorld.js';
import type { Settlement, ResourceNode } from './WorldGenerator.js';

// --- Tunables ---------------------------------------------------------------
export const RUIN_EXPLORE_DAYS = 1;        // on-site dig duration (game days)
export const WORKER_MINE_DAYS = 2;         // time spent mining at the deposit
export const WORKER_HAUL = 120;            // units of resource a party brings home
export const WORKER_HP = 24;               // worker-party hit points (no combat)
export const WORKER_AMBUSH_RANGE = 10;     // goblin-camp proximity that hurts workers
export const WORKER_AMBUSH_DPS = 4;        // HP/game-day lost inside ambush range
export const MERC_COST_PER_HEAD = 35;      // gold per mercenary (a good rate)
export const MERC_MAX_HIRE = 30;           // cap troops per camp visit
export const CARAVAN_RELATION_HIT = -20;   // relation delta per successful raid
export const QUICK_TRAVEL_COST = 50;       // gold to dispatch the main party

/** Result of a ruin-exploration kickoff. */
export interface ExploreResult { ok: boolean; reason?: string; etaDays?: number; }
/** Result of a goblin-camp raid kickoff (the scene launches the actual battle). */
export interface RaidResult {
  ok: boolean;
  reason?: string;
  /** the camp under attack (so the scene can launch BattleScene against it). */
  camp?: Settlement;
  /** the goblin army to fight (BattleScene army contract: {type,count}[]). */
  goblinArmy?: ArmyGroup[];
}
/** Result of a worker dispatch. */
export interface WorkerResult { ok: boolean; reason?: string; worker?: WorkerParty; }
/** Result of a mercenary hire. */
export interface HireResult { ok: boolean; reason?: string; hired?: number; cost?: number; }
/** Result of a caravan raid (simple resolve, no BattleScene). */
export interface CaravanRaidResult {
  ok: boolean;
  reason?: string;
  victory?: boolean;
  /** resources stolen on a win. */
  loot?: { gold: number; wood: number; stone: number; iron: number };
  /** faction whose relations dropped, and the delta applied. */
  faction?: string;
  relationDelta?: number;
}
/** A row in the expedition panel's "Active journeys" list. */
export interface ActiveExpedition {
  kind: 'main' | 'pioneer' | 'worker';
  label: string;
  /** sub-purpose, e.g. 'mining iron', 'returning', 'marching'. */
  purpose: string;
  etaDays: number;
  col: number;
  row: number;
}

// Base plains tiles per day, mirrored from ContinentScene so ETA math here lines
// up with the actual movement budget (kept in sync deliberately).
const BASE_TILES_PER_DAY = 9;

export class ExpeditionSystem {
  // Static mirrors of the tunables (callers can read without bare imports).
  static readonly RUIN_EXPLORE_DAYS = RUIN_EXPLORE_DAYS;
  static readonly WORKER_MINE_DAYS = WORKER_MINE_DAYS;
  static readonly WORKER_HAUL = WORKER_HAUL;
  static readonly WORKER_HP = WORKER_HP;
  static readonly MERC_COST_PER_HEAD = MERC_COST_PER_HEAD;
  static readonly MERC_MAX_HIRE = MERC_MAX_HIRE;
  static readonly CARAVAN_RELATION_HIT = CARAVAN_RELATION_HIT;
  static readonly QUICK_TRAVEL_COST = QUICK_TRAVEL_COST;

  // In-flight ruin digs, keyed by ruin id: { daysLeft } counted down by
  // tickRuinExploration. Module state (not GameWorld) is fine: the dig is a
  // transient between exploreRuin() and its completion within one session; if the
  // game is saved mid-dig, P12 simply restarts the dig on load (acceptable).
  private static _activeDigs: Record<string, number> = {};

  // ==========================================================================
  // Helpers
  // ==========================================================================
  /** Stable settlement id (index string) for a Settlement. */
  static idOf(s: Settlement): string {
    const w = GameWorld.world;
    return w ? String(w.settlements.indexOf(s)) : '-1';
  }

  /** Squared-distance-free Euclidean distance between two tiles. */
  private static dist(ac: number, ar: number, bc: number, br: number): number {
    return Math.hypot(ac - bc, ar - br);
  }

  /** Nearest player-owned settlement to a tile (for deposits / rewards). Falls
   *  back to the home castle, then null if the player holds nothing. */
  static nearestPlayerSettlement(col: number, row: number): Settlement | null {
    const w = GameWorld.world;
    if (!w) return null;
    let best: Settlement | null = null, bestD = Infinity;
    for (const s of w.settlements) {
      if (s.kind !== 'player_castle') continue;
      const d = this.dist(col, row, s.col, s.row);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /** Record a discovered continent location for the expedition panel. */
  static discover(kind: string, name: string, col: number, row: number): void {
    const id = `${kind}:${col},${row}`;
    if (!GameWorld.discovered[id]) {
      GameWorld.discovered[id] = { kind, name, col, row, day: GameWorld.displayDay() };
    }
  }

  // ==========================================================================
  // 1. RUINS EXPLORATION
  // ==========================================================================
  /** Begin exploring an unexplored ancient ruin. The party must be ~1 tile away
   *  (the dig happens on-site; ContinentScene keeps the party parked while
   *  _activeDigs counts down via tickRuinExploration). Returns the ETA in days. */
  static exploreRuin(ruinId: string): ExploreResult {
    const w = GameWorld.world;
    if (!w) return { ok: false, reason: 'No world.' };
    const ruin = GameWorld.settlementById(ruinId);
    if (!ruin || ruin.kind !== 'ruin') return { ok: false, reason: 'Not a ruin.' };
    if (GameWorld.exploredRuins[ruinId]) return { ok: false, reason: 'Already explored.' };
    if (this._activeDigs[ruinId] != null) return { ok: false, reason: 'Already exploring.' };
    // Must be within ~1 tile of the ruin to dig it.
    const d = this.dist(GameWorld.player.col, GameWorld.player.row, ruin.col, ruin.row);
    if (d > 1.6) return { ok: false, reason: 'Move your party onto the ruin to explore it.' };
    this._activeDigs[ruinId] = RUIN_EXPLORE_DAYS;
    this.discover('ruin', ruin.name, ruin.col, ruin.row);
    return { ok: true, etaDays: RUIN_EXPLORE_DAYS };
  }

  /** True if a dig is in progress for this ruin. */
  static isExploring(ruinId: string): boolean { return this._activeDigs[ruinId] != null; }
  /** 0..1 progress of an in-flight dig (1 = complete). */
  static digProgress(ruinId: string): number {
    const left = this._activeDigs[ruinId];
    if (left == null) return GameWorld.exploredRuins[ruinId] ? 1 : 0;
    return Math.max(0, Math.min(1, 1 - left / RUIN_EXPLORE_DAYS));
  }

  /** Advance all in-flight ruin digs by `dayDelta` game days. Returns the list of
   *  ruins COMPLETED this tick with their granted rewards (for the caller to
   *  surface as notifications). Frame-rate independent (called per continent tick). */
  static tickRuinExploration(dayDelta: number): Array<{ ruinId: string; ruin: Settlement; reward: RuinReward }> {
    const done: Array<{ ruinId: string; ruin: Settlement; reward: RuinReward }> = [];
    if (dayDelta <= 0) return done;
    for (const ruinId of Object.keys(this._activeDigs)) {
      this._activeDigs[ruinId] -= dayDelta;
      if (this._activeDigs[ruinId] <= 0) {
        delete this._activeDigs[ruinId];
        const ruin = GameWorld.settlementById(ruinId);
        if (!ruin || GameWorld.exploredRuins[ruinId]) continue;
        const reward = this.grantRuinReward(ruinId, ruin);
        GameWorld.exploredRuins[ruinId] = true;
        done.push({ ruinId, ruin, reward });
      }
    }
    return done;
  }

  /** Deterministically pick + apply a reward for exploring a ruin. */
  static grantRuinReward(ruinId: string, ruin: Settlement): RuinReward {
    // Stable hash from the ruin id so the reward is save-consistent.
    let h = 2166136261 >>> 0;
    for (let i = 0; i < ruinId.length; i++) { h ^= ruinId.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const roll = h % 100;
    const ARTIFACTS = ['the Crown of Ages', 'the Sunspear', 'the Obsidian Sigil', 'the Verdant Chalice'];
    const RELICS = ['a Saint\'s Reliquary', 'the First King\'s Banner', 'an Ancient War-Horn', 'the Pale Idol'];

    let reward: RuinReward;
    if (roll < 40) {
      // 40% — a gold hoard.
      const gold = 150 + (h % 250);
      reward = { kind: 'gold', gold, resources: { wood: 0, stone: 0, iron: 0 }, treasure: '', summary: `Recovered a hoard of ${gold} gold` };
    } else if (roll < 70) {
      // 30% — bulk building materials.
      const wood = 80 + (h % 120), stone = 60 + ((h >>> 3) % 100), iron = 20 + ((h >>> 5) % 40);
      reward = { kind: 'resources', gold: 0, resources: { wood, stone, iron }, treasure: '', summary: `Salvaged ${wood} wood, ${stone} stone, ${iron} iron` };
    } else if (roll < 90) {
      // 20% — an artifact (valuable; sells / inspires — credited as gold + flavour).
      const treasure = ARTIFACTS[h % ARTIFACTS.length];
      const gold = 300 + (h % 200);
      reward = { kind: 'artifact', gold, resources: { wood: 0, stone: 0, iron: 0 }, treasure, summary: `Unearthed ${treasure} (+${gold} gold)` };
    } else {
      // 10% — a relic (the richest find).
      const treasure = RELICS[h % RELICS.length];
      const gold = 500 + (h % 300);
      reward = { kind: 'relic', gold, resources: { wood: 0, stone: 0, iron: 0 }, treasure, summary: `Recovered ${treasure} (+${gold} gold)` };
    }

    // Apply the reward. Gold → campaign gold. Resources → nearest player town.
    GameWorld.gold += reward.gold;
    // (Phase 11) Exploring a ruin is a prestige source (+20). An artifact/relic
    // also banks a spendable artifact (heroFlags.artifacts) toward Legendary gear.
    GameWorld.addPrestige(20, 'an ancient ruin yields its secrets');
    if (reward.kind === 'artifact' || reward.kind === 'relic') {
      GameWorld.heroFlags.artifacts = (GameWorld.heroFlags.artifacts || 0) + 1;
    }
    const r = reward.resources;
    if (r.wood || r.stone || r.iron) {
      const town = this.nearestPlayerSettlement(ruin.col, ruin.row);
      if (town) {
        const st = GameWorld.settlementState(this.idOf(town));
        if (st) {
          st.resources.wood = (st.resources.wood || 0) + r.wood;
          st.resources.stone = (st.resources.stone || 0) + r.stone;
          st.resources.iron = (st.resources.iron || 0) + r.iron;
        }
      }
    }
    return reward;
  }

  // ==========================================================================
  // 2. GOBLIN CAMP RAIDS
  // ==========================================================================
  /** Begin a raid on a goblin camp: validate proximity, build a scaled goblin
   *  army, and return the BattleScene army for ContinentScene to launch (the
   *  scene owns the BattleScene contract; on victory it calls onCampRaidWon). */
  static raidCamp(campId: string): RaidResult {
    const w = GameWorld.world;
    if (!w) return { ok: false, reason: 'No world.' };
    const camp = GameWorld.settlementById(campId);
    if (!camp || camp.kind !== 'goblin_camp') return { ok: false, reason: 'Not a goblin camp.' };
    if (GameWorld.clearedCamps[campId]) return { ok: false, reason: 'Camp already cleared.' };
    const d = this.dist(GameWorld.player.col, GameWorld.player.row, camp.col, camp.row);
    if (d > 1.6) return { ok: false, reason: 'March onto the camp to raid it.' };
    this.discover('goblin_camp', camp.name, camp.col, camp.row);
    const goblinArmy = this.goblinArmyFor(campId);
    return { ok: true, camp, goblinArmy };
  }

  /** Build a goblin defender army scaled to the camp (stable per-camp size). */
  static goblinArmyFor(campId: string): ArmyGroup[] {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < campId.length; i++) { h ^= campId.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const total = 12 + (h % 17); // 12..28 goblins
    const archers = Math.floor(total * 0.3);
    const warriors = total - archers;
    const army: ArmyGroup[] = [{ type: 'warrior', count: warriors }];
    if (archers > 0) army.push({ type: 'archer', count: archers });
    return army;
  }

  /** Called by ContinentScene after a WON camp raid: clear the camp, change its
   *  flavour, and award loot (gold + iron) into the nearest player settlement /
   *  campaign gold. `loot` is the BattleScene loot object ({gold, iron}). */
  static onCampRaidWon(campId: string, loot: { gold?: number; iron?: number } | null): { gold: number; iron: number; wood: number } {
    GameWorld.clearedCamps[campId] = true;
    const camp = GameWorld.settlementById(campId);
    // Base plunder scaled to the camp, plus whatever BattleScene reported.
    let h = 2166136261 >>> 0;
    for (let i = 0; i < campId.length; i++) { h ^= campId.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const gold = (loot && loot.gold ? loot.gold : 0) + 40 + (h % 80);
    const iron = (loot && loot.iron ? loot.iron : 0) + 10 + (h % 25);
    const wood = 20 + ((h >>> 4) % 40);
    GameWorld.gold += gold;
    if (camp) {
      const town = this.nearestPlayerSettlement(camp.col, camp.row);
      if (town) {
        const st = GameWorld.settlementState(this.idOf(town));
        if (st) { st.resources.iron = (st.resources.iron || 0) + iron; st.resources.wood = (st.resources.wood || 0) + wood; }
      }
    }
    return { gold, iron, wood };
  }

  // ==========================================================================
  // 3. WORKER EXPEDITIONS
  // ==========================================================================
  /** Dispatch a non-combat worker party from a player settlement to a continent
   *  deposit tile. The party travels (ContinentScene movement), mines for
   *  WORKER_MINE_DAYS, then auto-returns to the nearest player settlement and
   *  deposits WORKER_HAUL of the deposit's resource. */
  static sendWorkers(fromSettlementId: string, depositCol: number, depositRow: number): WorkerResult {
    const w = GameWorld.world;
    if (!w) return { ok: false, reason: 'No world.' };
    const origin = GameWorld.settlementById(fromSettlementId);
    if (!origin || origin.kind !== 'player_castle') return { ok: false, reason: 'Workers must set out from a settlement you own.' };
    depositCol = Math.max(0, Math.min(w.size - 1, Math.round(depositCol)));
    depositRow = Math.max(0, Math.min(w.size - 1, Math.round(depositRow)));
    const resource = this.resourceAt(depositCol, depositRow);
    const worker: WorkerParty = {
      id: `worker_${GameWorld.workerCounter++}`,
      col: origin.col, row: origin.row,
      depositCol, depositRow,
      resource,
      carrying: 0,
      homeSettlementId: fromSettlementId,
      destCol: depositCol, destRow: depositRow,
      hp: WORKER_HP, maxHp: WORKER_HP,
      status: 'outbound',
      mineDaysLeft: WORKER_MINE_DAYS,
      label: `Miners → ${resource}`,
    };
    GameWorld.workers.push(worker);
    this.discover('deposit', `${resource} deposit`, depositCol, depositRow);
    return { ok: true, worker };
  }

  /** Find the resource type at/near a tile from the world's resource nodes
   *  (defaults to 'iron' since the spec headlines iron deposits in mountains). */
  static resourceAt(col: number, row: number): string {
    const w = GameWorld.world;
    if (!w) return 'iron';
    let best: ResourceNode | null = null, bestD = Infinity;
    for (const n of w.resourceNodes) {
      const d = this.dist(col, row, n.col, n.row);
      if (d < bestD) { bestD = d; best = n; }
    }
    // Only count a node if it is reasonably close to where we sent the workers.
    if (best && bestD <= 3) return best.type;
    return 'iron';
  }

  static workerById(id: string): WorkerParty | null {
    return GameWorld.workers.find(p => p.id === id) || null;
  }

  /** Per-continent-tick driver for worker mining + return retargeting + ambush.
   *  Movement itself is done by ContinentScene (same A-star budget as pioneers);
   *  this handles the AT-DESTINATION state machine + goblin-proximity damage.
   *  Returns events for the caller to surface (deposits + losses). */
  static tickWorkers(dayDelta: number): Array<{ type: 'arrived' | 'deposited' | 'lost'; worker: WorkerParty }> {
    const events: Array<{ type: 'arrived' | 'deposited' | 'lost'; worker: WorkerParty }> = [];
    const w = GameWorld.world;
    if (!w || !GameWorld.workers.length) return events;
    const camps = w.settlements.filter(s => s.kind === 'goblin_camp' && !GameWorld.clearedCamps[this.idOf(s)]);

    for (const p of GameWorld.workers) {
      if (p.status === 'done' || p.status === 'lost') continue;

      // --- Goblin-proximity damage (no combat; escort optional) -----------
      if (camps.length) {
        let threatened = false;
        for (const c of camps) { if (this.dist(c.col, c.row, p.col, p.row) <= WORKER_AMBUSH_RANGE) { threatened = true; break; } }
        if (threatened) {
          const escort = (p as any).escortStrength;
          const mult = (typeof escort === 'number' && escort > 0) ? 0.5 : 1;
          p.hp = Math.max(0, p.hp - WORKER_AMBUSH_DPS * Math.max(0, dayDelta) * mult);
          if (p.hp <= 0) { p.status = 'lost'; events.push({ type: 'lost', worker: p }); continue; }
        }
      }

      // --- State machine at the current tile ------------------------------
      if (p.status === 'outbound') {
        if (this.dist(p.col, p.row, p.depositCol, p.depositRow) <= 1.5) {
          p.status = 'mining';
          p.mineDaysLeft = WORKER_MINE_DAYS;
          events.push({ type: 'arrived', worker: p });
        }
      } else if (p.status === 'mining') {
        p.mineDaysLeft -= dayDelta;
        if (p.mineDaysLeft <= 0) {
          p.carrying = WORKER_HAUL;
          // Re-target the NEAREST player settlement for the return leg.
          const home = this.nearestPlayerSettlement(p.col, p.row);
          if (home) { p.homeSettlementId = this.idOf(home); p.destCol = home.col; p.destRow = home.row; }
          p.status = 'returning';
          p.label = `Miners → home (${p.carrying} ${p.resource})`;
        }
      } else if (p.status === 'returning') {
        const home = GameWorld.settlementById(p.homeSettlementId);
        const tc = home ? home.col : p.destCol, tr = home ? home.row : p.destRow;
        if (this.dist(p.col, p.row, tc, tr) <= 1.5) {
          // Deposit the haul into the home settlement's stockpile.
          if (home) {
            const st = GameWorld.settlementState(this.idOf(home));
            if (st) {
              const res = p.resource;
              const bucket = (res === 'wood' || res === 'stone' || res === 'iron' || res === 'food') ? res : 'iron';
              st.resources[bucket] = (st.resources[bucket] || 0) + p.carrying;
            }
          }
          p.status = 'done';
          events.push({ type: 'deposited', worker: p });
        }
      }
    }

    // Reap finished/lost workers.
    GameWorld.workers = GameWorld.workers.filter(p => p.status !== 'done' && p.status !== 'lost');
    return events;
  }

  // ==========================================================================
  // 4. MERCENARY CAMPS
  // ==========================================================================
  /** Hire mercenaries from a camp directly into the field party. The party must
   *  be ~1 tile from the camp. Costs MERC_COST_PER_HEAD gold each (a good rate);
   *  hired troops are veterans (warriors) added to the player's army. */
  static hireMercenaries(campId: string, count: number): HireResult {
    const w = GameWorld.world;
    if (!w) return { ok: false, reason: 'No world.' };
    const camp = GameWorld.settlementById(campId);
    if (!camp || camp.kind !== 'mercenary') return { ok: false, reason: 'Not a mercenary camp.' };
    const d = this.dist(GameWorld.player.col, GameWorld.player.row, camp.col, camp.row);
    if (d > 1.6) return { ok: false, reason: 'Travel to the camp to hire.' };
    count = Math.max(1, Math.min(MERC_MAX_HIRE, Math.floor(count)));
    const cost = count * MERC_COST_PER_HEAD;
    if (GameWorld.gold < cost) {
      const affordable = Math.floor(GameWorld.gold / MERC_COST_PER_HEAD);
      if (affordable <= 0) return { ok: false, reason: `Need ${MERC_COST_PER_HEAD} gold per mercenary.` };
      count = affordable;
    }
    const realCost = count * MERC_COST_PER_HEAD;
    GameWorld.gold -= realCost;
    // Add as veteran warriors (battles=2 so they read as seasoned in BattleScene).
    const grp = GameWorld.player.army.find(g => g.type === 'warrior');
    if (grp) grp.count += count;
    else GameWorld.player.army.push({ type: 'warrior', count, battles: 2 });
    this.discover('mercenary', camp.name, camp.col, camp.row);
    return { ok: true, hired: count, cost: realCost };
  }

  // ==========================================================================
  // 5. CARAVAN RAID (player as raider) — simple resolve, NOT BattleScene.
  // ==========================================================================
  /** Raid an enemy caravan the player has intercepted (same/adjacent tile). A
   *  quick odds check (army size vs the caravan's light guard) decides it; on a
   *  win the player steals the cargo and the caravan's faction loses 20 relations
   *  (banked in GameWorld.relationDeltas for Phase 7). The caravan leaves the
   *  map either way (raided or fled). */
  static raidCaravan(caravanId: string): CaravanRaidResult {
    const w = GameWorld.world;
    if (!w) return { ok: false, reason: 'No world.' };
    const caravan = GameWorld.aiParties.find(a => a.id === caravanId && a.isCaravan);
    if (!caravan) return { ok: false, reason: 'No such caravan.' };
    const d = this.dist(GameWorld.player.col, GameWorld.player.row, caravan.col, caravan.row);
    if (d > 1.6) return { ok: false, reason: 'Intercept the caravan to raid it.' };

    // Simple resolve: player army vs the caravan's light guard (≈ armyEstimate).
    const playerStrength = GameWorld.armySize();
    const guard = Math.max(1, caravan.armyEstimate);
    const victory = playerStrength >= guard * 0.6; // caravans are lightly defended

    // Always bank the relation hit + remove the caravan from the map afterwards.
    const removeCaravan = () => {
      const i = GameWorld.aiParties.indexOf(caravan);
      if (i >= 0) GameWorld.aiParties.splice(i, 1);
    };

    if (!victory) {
      // The guard fought off the raid and the caravan flees; still soured.
      GameWorld.relationDeltas[caravan.factionKey] = (GameWorld.relationDeltas[caravan.factionKey] || 0) + CARAVAN_RELATION_HIT;
      // Light raider losses (lose ~10% of the army).
      this.applyArmyLosses(0.1);
      removeCaravan();
      return { ok: true, victory: false, faction: caravan.factionKey, relationDelta: CARAVAN_RELATION_HIT, loot: { gold: 0, wood: 0, stone: 0, iron: 0 } };
    }

    const cargo = caravan.cargo || this.defaultCaravanCargo(caravan);
    // Steal it: gold → campaign gold; bulk → nearest player settlement.
    GameWorld.gold += cargo.gold;
    const town = this.nearestPlayerSettlement(GameWorld.player.col, GameWorld.player.row);
    if (town && (cargo.wood || cargo.stone || cargo.iron)) {
      const st = GameWorld.settlementState(this.idOf(town));
      if (st) {
        st.resources.wood = (st.resources.wood || 0) + cargo.wood;
        st.resources.stone = (st.resources.stone || 0) + cargo.stone;
        st.resources.iron = (st.resources.iron || 0) + cargo.iron;
      }
    }
    GameWorld.relationDeltas[caravan.factionKey] = (GameWorld.relationDeltas[caravan.factionKey] || 0) + CARAVAN_RELATION_HIT;
    removeCaravan();
    return { ok: true, victory: true, faction: caravan.factionKey, relationDelta: CARAVAN_RELATION_HIT, loot: { ...cargo } };
  }

  /** A default cargo if a caravan was flagged without one. */
  static defaultCaravanCargo(caravan: AIParty): { gold: number; wood: number; stone: number; iron: number } {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < caravan.id.length; i++) { h ^= caravan.id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return { gold: 80 + (h % 160), wood: 40 + ((h >>> 3) % 80), stone: 20 + ((h >>> 5) % 50), iron: 10 + ((h >>> 7) % 30) };
  }

  /** Flag an existing AI party as a laden caravan (used by ContinentScene to turn
   *  a few merchant parties into raidable caravans). Idempotent + gives cargo. */
  static makeCaravan(party: AIParty): void {
    party.isCaravan = true;
    party.armyEstimate = Math.max(3, Math.round(party.armyEstimate * 0.4)); // lightly guarded
    if (!party.cargo) party.cargo = this.defaultCaravanCargo(party);
    party.destLabel = 'laden caravan';
  }

  /** Apply a fractional loss across the player's army groups. */
  private static applyArmyLosses(frac: number): void {
    for (const g of GameWorld.player.army) {
      g.count = Math.max(0, Math.round(g.count * (1 - frac)));
    }
    GameWorld.player.army = GameWorld.player.army.filter(g => g.count > 0);
    if (!GameWorld.player.army.length) GameWorld.player.army = [{ type: 'warrior', count: 1 }];
  }

  // ==========================================================================
  // 6. EXPEDITION PANEL support
  // ==========================================================================
  /** All ACTIVE player journeys for the panel's "Active" list: the main party
   *  (when marching), each travelling pioneer, and each worker party — with a
   *  purpose + rough ETA. ContinentScene supplies the main party's remaining
   *  path length (it owns the live path), defaulting to 0 = "holding position". */
  static activeExpeditions(mainRemainingTiles = 0): ActiveExpedition[] {
    const out: ActiveExpedition[] = [];
    if (mainRemainingTiles > 0.5) {
      out.push({
        kind: 'main', label: 'Main Host', purpose: 'marching',
        etaDays: Math.max(1, Math.round(mainRemainingTiles / BASE_TILES_PER_DAY)),
        col: GameWorld.player.col, row: GameWorld.player.row,
      });
    }
    for (const pio of GameWorld.pioneers) {
      if (pio.status === 'founded' || pio.status === 'lost') continue;
      const eta = Math.max(1, Math.round(this.dist(pio.col, pio.row, pio.destCol, pio.destRow) / BASE_TILES_PER_DAY));
      out.push({ kind: 'pioneer', label: 'Pioneers', purpose: pio.status === 'arrived' ? 'ready to found' : 'seeking land', etaDays: eta, col: pio.col, row: pio.row });
    }
    for (const wk of GameWorld.workers) {
      if (wk.status === 'done' || wk.status === 'lost') continue;
      let purpose = 'travelling';
      if (wk.status === 'mining') purpose = `mining ${wk.resource} (${Math.max(0, Math.ceil(wk.mineDaysLeft))}d)`;
      else if (wk.status === 'returning') purpose = `returning ${wk.resource}`;
      else purpose = `to ${wk.resource} deposit`;
      const eta = wk.status === 'mining' ? Math.max(1, Math.ceil(wk.mineDaysLeft))
        : Math.max(1, Math.round(this.dist(wk.col, wk.row, wk.destCol, wk.destRow) / BASE_TILES_PER_DAY));
      out.push({ kind: 'worker', label: 'Workers', purpose, etaDays: eta, col: wk.col, row: wk.row });
    }
    return out;
  }

  /** Discovered locations sorted newest-first for the panel. */
  static discoveredLocations(): Array<{ id: string; kind: string; name: string; col: number; row: number; day: number }> {
    return Object.entries(GameWorld.discovered)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.day - a.day);
  }

  /** Quick-travel: spend QUICK_TRAVEL_COST gold to send the MAIN party pathing to
   *  a previously-visited location. Returns the destination so ContinentScene can
   *  issue the actual move order via its pathfinder. */
  static quickTravelCost(): number { return QUICK_TRAVEL_COST; }
  static quickTravel(col: number, row: number): { ok: boolean; reason?: string; col?: number; row?: number } {
    if (GameWorld.gold < QUICK_TRAVEL_COST) return { ok: false, reason: `Need ${QUICK_TRAVEL_COST} gold to dispatch.` };
    GameWorld.gold -= QUICK_TRAVEL_COST;
    return { ok: true, col, row };
  }
}
