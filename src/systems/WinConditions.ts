// WinConditions.js — (Audit FIX 2) victory resolution.
//
// Three win paths from the expansion doc §8, checked once per game-day:
//   1. Conquest  — control 75% of all settlements (incl. fallen AI castles).
//   2. Diplomacy — Alliance status (+80 relations) with every surviving kingdom.
//   3. Legacy    — a Small Castle (stage 7+) with population 50+, 5+ research
//                  techs, and happiness 80+ sustained for 5 consecutive days.
//
// The actual VICTORY / DEFEAT overlay lives in IsometricScene.showEndScreen so it
// can share one layout with the (improved) defeat screen and reach scene helpers.

export const LEGACY_HAPPY_DAYS = 5;
export const CONQUEST_FRACTION = 0.75;
export const ALLY_RELATIONS = 80;

export class WinConditions {
  scene: any;
  legacyHappyDays: number;
  triggered: boolean;

  constructor(scene: any) {
    this.scene = scene;
    this.legacyHappyDays = 0; // consecutive days at happiness >= 80
    this.triggered = false;   // a win has already been shown (won't nag again)
  }

  // Total settlements on the map = neutral/player settlements + AI castles.
  totalSettlements(): number {
    const s = this.scene;
    const neutral = s.settlements && s.settlements.list ? s.settlements.list.length : 0;
    const ai = (s.kingdoms || []).length;
    return neutral + ai;
  }

  // What the player controls = player-owned settlements + fallen AI castles.
  playerControlled() {
    const s = this.scene;
    const owned = s.settlements && s.settlements.list ? s.settlements.list.filter((x) => x.owner === 'player').length : 0;
    const fallen = (s.kingdoms || []).filter((k) => !k.castleAlive).length;
    return owned + fallen;
  }

  // Returns a win-path name or null. Pure (no side effects) so it's testable.
  check(): string | null {
    const s = this.scene;
    // (V2 Phase 11) The secret fourth path — restore the old empire.
    if (s.narrative && s.narrative.empireRestored) return 'Empire';
    const total = this.totalSettlements();
    if (total > 0 && this.playerControlled() / total >= CONQUEST_FRACTION) return 'Conquest';

    if (s.diplomacy && s.kingdoms) {
      const alive = s.kingdoms.filter((k) => k.castleAlive);
      if (alive.length >= 1 && alive.every((k) => s.diplomacy.get(k.cfg.key) >= ALLY_RELATIONS)) return 'Diplomat';
    }

    const stage = s.currentStage ? s.currentStage() : 0;
    const pop = s.population ? s.population.count : 0;
    const techs = s.research ? s.research.completed.size : 0;
    if (stage >= 7 && pop >= 50 && this.legacyHappyDays >= LEGACY_HAPPY_DAYS && techs >= 5) return 'Legacy';

    return null;
  }

  onNewDay() {
    if (this.triggered) return;
    const happy = this.scene.population ? this.scene.population.happiness : 0;
    if (happy >= 80) this.legacyHappyDays += 1; else this.legacyHappyDays = 0;
    const path = this.check();
    if (path) {
      this.triggered = true;
      const label = path === 'Empire' ? 'The Old Empire Restored —' : path; // (V2 P11) unique 4th ending
      if (this.scene.showEndScreen) this.scene.showEndScreen(true, label);
    }
  }

  serialize() { return { legacyHappyDays: this.legacyHappyDays, triggered: this.triggered }; }
  restore(d: any) { if (!d) return; this.legacyHappyDays = d.legacyHappyDays || 0; this.triggered = !!d.triggered; }
}
