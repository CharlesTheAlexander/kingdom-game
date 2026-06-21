import Phaser from 'phaser';

// (Polish Phase 1) Central registry + driver for all unit frame animations.
//
// Implementation note: the Tiny Swords unit art ships as horizontal multi-frame
// spritesheets (192px frames), NOT separate per-pose PNGs, so we animate them
// with Phaser's spritesheet animations — proper multi-frame motion — rather than
// swapping a single static texture each tick (which would only ever show one
// frame per pose). Every unit drives its state — idle / walk / attack / shoot /
// heal / interact — through playLoop() and playOnce() below, so all animation
// logic lives in one place.

// [textureKey, lastFrameIndex, framesPerSecond]
const LOOPS: any[] = [
  ['blue_warrior_idle', 7, 8], ['warrior_idle', 7, 8], ['yellow_warrior_idle', 7, 8], ['purple_warrior_idle', 7, 8], ['goblin_idle', 7, 8],
  ['blue_warrior_run', 5, 12], ['red_warrior_run', 5, 12], ['yellow_warrior_run', 5, 12], ['purple_warrior_run', 5, 12], ['goblin_run', 5, 12],
  ['blue_archer_idle', 5, 8], ['red_archer_idle', 5, 8], ['blue_archer_run', 3, 12],
  ['monk_idle', 5, 7], ['monk_run', 3, 12],
  ['pawn_idle', 7, 8], ['pawn_run', 5, 12], ['pawn_run_wood', 5, 12], ['pawn_run_gold', 5, 12], ['pawn_run_meat', 5, 12],
  ['pawn_run_axe', 5, 12], ['pawn_run_pickaxe', 5, 12], ['pawn_interact_axe', 5, 9], ['pawn_interact_pickaxe', 5, 9],
];
const ONCE: any[] = [
  ['blue_archer_shoot', 7, 16], ['red_archer_shoot', 7, 16], ['monk_heal', 10, 16],
];
// Combined melee swing: Attack1 frames then Attack2 frames, played as one
// one-shot (the spec's Attack1 → Attack2 → Idle). [animKey, sheet1, sheet2].
const COMBO_ATTACKS: any[] = [
  ['blue_warrior_attack', 'blue_warrior_attack', 'blue_warrior_attack2'],
  ['red_warrior_attack', 'red_warrior_attack', 'red_warrior_attack2'],
  ['yellow_warrior_attack', 'yellow_warrior_attack', 'yellow_warrior_attack2'],
  ['purple_warrior_attack', 'purple_warrior_attack', 'purple_warrior_attack2'],
  ['goblin_attack', 'goblin_attack', 'goblin_attack2'],
];

// Create every unit animation once per scene (idempotent; skips missing textures).
export function registerUnitAnimations(scene: any) {
  for (const [key, end, fps] of LOOPS) {
    if (scene.textures.exists(key) && !scene.anims.exists(key)) scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(key, { start: 0, end }), frameRate: fps, repeat: -1 });
  }
  for (const [key, end, fps] of ONCE) {
    if (scene.textures.exists(key) && !scene.anims.exists(key)) scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(key, { start: 0, end }), frameRate: fps, repeat: 0 });
  }
  for (const [key, s1, s2] of COMBO_ATTACKS) {
    if (scene.anims.exists(key) || !scene.textures.exists(s1)) continue;
    const f1 = scene.anims.generateFrameNumbers(s1, { start: 0, end: 3 });
    const f2 = scene.textures.exists(s2) ? scene.anims.generateFrameNumbers(s2, { start: 0, end: 3 }) : [];
    scene.anims.create({ key, frames: f1.concat(f2), frameRate: 14, repeat: 0 });
  }
}

// Play a looping state animation. No-op if it is already the current anim, and
// never interrupts an in-progress one-shot (a sword swing / arrow loose / heal).
export function playLoop(spr: any, key: string) {
  if (!spr || !spr.scene || spr._oneShot || !key || !spr.scene.anims.exists(key)) return;
  const cur = spr.anims && spr.anims.currentAnim;
  if (cur && cur.key === key && spr.anims.isPlaying) return;
  spr.play(key);
}

// Play a one-shot animation once, then fall back to backKey. Ignored while a
// previous one-shot is still mid-play so repeated triggers don't stutter.
export function playOnce(spr: any, key: string, backKey?: string) {
  if (!spr || !spr.scene || spr._oneShot || !key || !spr.scene.anims.exists(key)) return;
  spr._oneShot = key;
  spr.play(key);
  spr.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
    spr._oneShot = null;
    if (backKey && spr.active && spr.scene && spr.scene.anims.exists(backKey)) spr.play(backKey);
  });
}
