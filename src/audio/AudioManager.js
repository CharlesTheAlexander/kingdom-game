/*
 * AudioManager.js — AUDIO ROADMAP (placeholder, no real audio yet)
 * ===================================================================
 * This file documents every gameplay event that should eventually play a
 * sound. When audio is added, wire each event to a clip here and call
 * AudioManager.play('<event>') from the noted location in the code.
 *
 * SOUND EVENTS TO IMPLEMENT:
 *   - 'building_placed'   → when a building is placed   (GameScene.tryBuild / placeFX)
 *   - 'building_destroyed'→ when a building is destroyed (Buildings.Building.destroy / explosionAt)
 *   - 'unit_trained'      → when a Barracks finishes a unit (GameScene training tick / onSoldierProduced)
 *   - 'resource_collected'→ when a pawn delivers to the castle (Pawns.Pawn → floatText)
 *   - 'enemy_dies'        → when an enemy is killed       (Waves.Enemy.destroy)
 *   - 'soldier_dies'      → when a friendly unit dies     (Troops.*.die / dustAt)
 *   - 'tier_upgrade'      → on settlement tier upgrade    (GameScene.upgradeTier / announce)
 *   - 'wave_start'        → when a new AI wave begins     (GameScene.onWaveStart)
 *   - 'expedition_return' → when an expedition returns    (Expeditions.resolve)
 *   - 'ui_click'          → on bottom-panel button press  (GameScene.spriteButton)
 *   - 'unit_select'       → on box-select confirm         (GameScene.selectUnits)
 *   - 'unit_command'      → on right-click move order      (GameScene.commandUnits)
 *
 * Suggested API once audio exists:
 *   const audio = new AudioManager(scene);
 *   audio.play('building_placed');
 * ===================================================================
 */

// Placeholder no-op so future imports don't break. Logs nothing in production.
export class AudioManager {
  constructor(scene) {
    this.scene = scene;
  }

  // eslint-disable-next-line no-unused-vars
  play(event) {
    // TODO: map `event` -> a loaded sound and play it. No-op for now.
  }
}
