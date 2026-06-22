// ============================================================================
// LateGame.ts — Phase 8 (Bannerlord rebuild) LATE-GAME CONTENT (Stage 8 & 9).
// ============================================================================
//
// Phase 8 makes the final two kingdom stages MEANINGFUL. The "kingdom stage" is
// the player's HOME castle settlement tier (GameWorld.kingdomStage(), 1..9).
//
//   STAGE 8 (Medium Castle) unlocks:
//     1. GRAND TOURNAMENT  — a home-castle action (300g + 50 food, ~3 days) →
//        a faction champion joins, all factions +10, happiness +30/5d, +10 rep.
//     2. LEGENDARY FORGE   — upgrade the Blacksmith (200 iron + 100 stone) →
//        produces a new "legendaryEquipment" resource + a hero-weapon upgrade.
//     3. EXTRA ARMY SLOT   — raise the player army/party cap by 1.
//     4. EMISSARY SYSTEM   — send a named envoy (continent party) to a faction →
//        a permanent embassy (passive +2 relations/day); risk of capture.
//
//   STAGE 9 (Large Castle) unlocks:
//     5. IMPERIAL PROCLAMATION — a momentous act (1000g + 300 stone + 200 iron):
//        allies celebrate, neutrals −30, hostiles declare war; sets the Phase-10
//        unique-ending flag.
//     6. CHRONICLE OF THE KINGDOM — a scribe-tower building that records major
//        events as narrative entries (GameWorld.chronicle, append-only).
//     7. CAPS — population cap → 500, building cap → 50 at the home settlement.
//
//   TRANSITION EVENTS — reaching stage 8 / stage 9 fire one-shot world events.
//
// DESIGN DECISIONS
// ----------------
// * STATELESS STATIC API (mirrors WorldDiplomacy / HeroWorld / ExpeditionSystem):
//   every method operates on GameWorld so any scene OR the headless audit can
//   drive it. ALL persistent state lives on GameWorld and stays JSON-friendly
//   for Phase 12's SaveManager (no instances, no Phaser objects here).
// * The HEAVY action methods (startTournament / buildLegendaryForge / sendEmissary
//   / declareImperial / recordChronicle / kingdomStage) live on GameWorld so the
//   spec's `GameWorld.method()` contract holds and there is no circular import.
//   LateGame ORCHESTRATES the per-day ticks (resolution, embassy bonus, emissary
//   movement/arrival/capture) and the stage-transition events on top of them.
// * STAGE-9 CAPS are exposed as pure getters (populationCap / buildingCap) the
//   per-settlement view reads, so the cap logic has a single source of truth.
// ============================================================================

import { GameWorld } from './GameWorld.js';
import type { EmissaryParty } from './GameWorld.js';

/** Stage-9 raised caps (per spec). Read by the home settlement's cap logic. */
export const STAGE9_POP_CAP = 500;
export const STAGE9_BUILDING_CAP = 50;
/** Stage 8 raises the army/party cap by this much. */
export const STAGE8_ARMY_BONUS = 1;
/** Tiles from a hostile faction's castle within which an emissary risks capture. */
const EMISSARY_ARRIVE_DIST = 1.6;

export class LateGame {
  static readonly STAGE9_POP_CAP = STAGE9_POP_CAP;
  static readonly STAGE9_BUILDING_CAP = STAGE9_BUILDING_CAP;

  // ==========================================================================
  // STAGE CAPS — single source of truth the per-settlement view reads. At stage
  // 9 the home settlement's population cap → 500 and building cap → 50. Below
  // stage 9 these return 0 (= "use the existing per-tier value") so we never
  // shrink lower-stage caps.
  // ==========================================================================
  /** Population cap OVERRIDE for the home settlement (0 = no override). */
  static populationCap(): number {
    return GameWorld.kingdomStage() >= 9 ? STAGE9_POP_CAP : 0;
  }
  /** Building cap OVERRIDE for the home settlement (0 = no override). */
  static buildingCap(): number {
    return GameWorld.kingdomStage() >= 9 ? STAGE9_BUILDING_CAP : 0;
  }

  // ==========================================================================
  // ARMY CAP — stage 8 raises it by one (the extra army slot). Idempotent: we
  // recompute from a base of 1 + the stage-8 bonus so re-reads never stack.
  // ==========================================================================
  static syncArmyCap(): void {
    GameWorld.armyCap = 1 + (GameWorld.kingdomStage() >= 8 ? STAGE8_ARMY_BONUS : 0);
  }

  // ==========================================================================
  // DAILY TICK — orchestrate every Phase-8 per-day effect. Called once per game
  // day from ContinentScene.onNewDay (after the existing P5/6/7 ticks). Returns
  // a list of {text,color} banner messages the scene can surface. Cheap +
  // idempotent; safe to call headless.
  // ==========================================================================
  static onNewDay(): Array<{ text: string; color: number }> {
    const banners: Array<{ text: string; color: number }> = [];
    this.syncArmyCap();
    // 1) Grand Tournament resolution.
    if (GameWorld.tickTournament()) banners.push({ text: 'The Grand Tournament ends in glory! A champion joins your host.', color: 0xd6c04a });
    // 2) Legendary Forge production.
    GameWorld.tickLegendaryForge();
    // 3) Standing embassies warm relations.
    GameWorld.tickEmbassies();
    // 4) Stage transition events (one-shot per stage).
    const t = this.checkStageTransitions();
    for (const b of t) banners.push(b);
    return banners;
  }

  // ==========================================================================
  // EMISSARIES — advance each travelling emissary toward its target faction's
  // castle; on arrival, found an embassy (or get captured if the faction is
  // hostile). Movement is a simple step-toward (the same cheap model as AI
  // parties) so it does not need the A* pathfinder. Driven from ContinentScene's
  // per-frame update with a day-delta. Returns banner messages on state changes.
  // ==========================================================================
  static tickEmissaries(dayDelta: number): Array<{ text: string; color: number }> {
    const banners: Array<{ text: string; color: number }> = [];
    if (!GameWorld.world) return banners;
    // Travel speed: a touch slower than the player party (BASE 9 tiles/day).
    const step = dayDelta * 7;
    for (const em of GameWorld.emissaries) {
      if (em.status !== 'travelling') continue;
      const dc = em.destCol - em.col, dr = em.destRow - em.row;
      const dist = Math.hypot(dc, dr);
      if (dist <= EMISSARY_ARRIVE_DIST) {
        // Arrived at the faction castle → embassy, or capture if hostile.
        const rel = GameWorld.diplomacy ? GameWorld.diplomacy.get(em.faction) : 0;
        const allied = GameWorld.diplomacy ? GameWorld.diplomacy.isAllied(em.faction) : false;
        // Hostile (rel <= -50 and not allied) → ~60% capture chance.
        if (!allied && rel <= -50 && Math.random() < 0.6) {
          GameWorld.captureEmissary(em);
          banners.push({ text: `${em.name} was seized! Ransom 200 gold to free them.`, color: 0x8c2b2b });
        } else {
          GameWorld.establishEmbassy(em);
          banners.push({ text: `An embassy opens with ${this.factionName(em.faction)}.`, color: 0x2a7a4f });
        }
        continue;
      }
      // Step toward the destination.
      const m = Math.min(step, dist);
      em.col = em.col + (dc / dist) * m;
      em.row = em.row + (dr / dist) * m;
    }
    return banners;
  }

  static factionName(faction: string): string {
    const f = GameWorld.world && GameWorld.world.factions.find(x => x.key === faction);
    return f ? f.name : faction;
  }

  /** Live (on-map) emissaries: travelling or captured (an embassy emissary has
   *  reached its destination and is no longer a roaming icon). */
  static liveEmissaries(): EmissaryParty[] {
    return GameWorld.emissaries.filter(e => e.status === 'travelling' || e.status === 'captured');
  }

  // ==========================================================================
  // STAGE TRANSITION EVENTS — fire ONCE each, gated on highestStageSeen so a
  // re-read of the tier never re-fires. Reaching stage 8 → "travellers come to
  // see your great castle" + neutral NPC flavour. Reaching stage 9 → each leader
  // sends a message + "the continent watches you with awe and fear". Both also
  // append to the Chronicle. Returns banner messages for the scene.
  // ==========================================================================
  static checkStageTransitions(): Array<{ text: string; color: number }> {
    const banners: Array<{ text: string; color: number }> = [];
    const stage = GameWorld.kingdomStage();
    if (stage <= GameWorld.highestStageSeen) return banners;

    // Walk up through every newly-reached stage (so a jump from 7→9 fires both).
    for (let s = GameWorld.highestStageSeen + 1; s <= stage; s++) {
      GameWorld.recordChronicle(`The kingdom reaches stage ${s} — ${this.stageName(s)}.`, `stage_${s}`);
      if (s === 8) banners.push(...this.fireStage8());
      if (s === 9) banners.push(...this.fireStage9());
    }
    GameWorld.highestStageSeen = stage;
    return banners;
  }

  static stageName(stage: number): string {
    const names = ['', 'Small Village', 'Medium Village', 'Large Village', 'Small Town', 'Medium Town', 'Large Town', 'Small Castle', 'Medium Castle', 'Large Castle'];
    return names[stage] || `Stage ${stage}`;
  }

  /** Stage-8 transition: travellers come to marvel at the great castle. */
  static fireStage8(): Array<{ text: string; color: number }> {
    const f = GameWorld.lateGameFlags;
    if (f.stage8FlavourFired) return [];
    f.stage8FlavourFired = true;
    const NPC = [
      'A pilgrim murmurs: "I walked thirty leagues to see these walls."',
      'A bard tunes his lute: "There is a song in such a castle."',
      'A merchant grins: "Trade follows great keeps. I shall stay a while."',
    ];
    GameWorld.notify('Travellers come from across the land to marvel at your great castle.', 0xc9a14a);
    for (const line of NPC) GameWorld.notify(line, 0x8a7e62);
    GameWorld.recordChronicle('Word spreads of the Medium Castle. Travellers, bards and merchants gather at its gates.');
    return [{ text: 'Travellers come to marvel at your great castle.', color: 0xc9a14a }];
  }

  /** Stage-9 transition: each leader sends a message + an awe-and-fear event. */
  static fireStage9(): Array<{ text: string; color: number }> {
    const f = GameWorld.lateGameFlags;
    if (f.stage9MessagesFired) return [];
    f.stage9MessagesFired = true;
    // Leader lines (from the spec voices). Surfaced via notify + chronicle; the
    // scene also pops leader-speech bubbles for the live faction keys.
    const lines: Record<string, string> = {
      red: 'General Valdris: "A fortress worthy of a true war. I will be watching your every move."',
      purple: 'Countess Elowen: "Such a seat of power. We must speak — there is much to gain, or lose."',
      yellow: 'Warlord Krag: "BIG castle! Krag wants to SMASH it... or feast in it. Krag undecided!"',
    };
    for (const k of GameWorld.factionKeys()) {
      const line = lines[k];
      if (line) { GameWorld.notify(line, 0xc9a14a); GameWorld.recordChronicle(line); }
    }
    GameWorld.notify('The continent watches you with awe and fear.', 0xffe08a);
    GameWorld.recordChronicle('The Large Castle is complete. The whole continent watches the kingdom with awe and fear.');
    // (Phase 11) Reaching Stage 9 is the single largest prestige source (+200).
    GameWorld.addPrestige(200, 'your realm reaches its zenith — a Large Castle', 'prestige_stage9');
    // Signal the scene to pop the three leader-speech bubbles next onNewDay frame.
    GameWorld.lateGameFlags._stage9SpeechPending = true;
    return [{ text: 'Your Large Castle is complete — the continent watches with awe and fear.', color: 0xffe08a }];
  }

  // ==========================================================================
  // CHRONICLE WIRING — thin helpers key systems call so the event sources are
  // consistent. Each delegates to GameWorld.recordChronicle (append-only, with
  // an optional one-shot key). The Chronicle works even if only a few sources
  // are wired (it is purely additive).
  // ==========================================================================
  static chronicleHeroJoined(name: string, title: string): void {
    GameWorld.recordChronicle(`${name}${title ? ' ' + title : ''} joined the kingdom.`, 'hero_join_' + name);
  }
  static chronicleWarDeclared(factionName: string): void {
    GameWorld.recordChronicle(`War is declared upon ${factionName}.`);
  }
  static chronicleSettlementFounded(name: string): void {
    GameWorld.recordChronicle(`A new settlement, ${name}, is founded.`, 'founded_' + name);
  }

  // ==========================================================================
  // CHRONICLE READOUT — narrative-style entries for the panel.
  // ==========================================================================
  static chronicleLines(): string[] {
    return GameWorld.chronicle.map(e => `Day ${e.day}: ${e.text}`);
  }
}
