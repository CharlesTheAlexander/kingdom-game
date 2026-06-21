import Phaser from 'phaser';
import { sfx } from '../audio/SoundEngine.js';

// TransitionOverlay (Polish Phase 10) — a small, reusable, self-cleaning loading
// card + scene-transition flourish. It is purely cosmetic: it draws a brief
// medieval "loading tablet" (kingdom banner, circular loader, rotating quote)
// over the CURRENT scene and dissolves itself after a short, skippable delay.
//
// Design constraints (per the polish brief):
//  • Additive only — it never touches game logic or the scenes it sits over.
//  • Short & skippable — it auto-clears after ~`hold` ms and the optional
//    `onMid` callback (the actual scene launch) fires at the midpoint, so the
//    launch is never blocked or delayed beyond a beat.
//  • Leak-safe — every object/tween/timer it creates is tracked and destroyed,
//    and it tears down on the scene's SHUTDOWN/DESTROY events so a scene.restart
//    can never strand a card or a running tween.

const QUOTES = [
  'A kingdom is built one stone at a time.',
  'Winter tests the wise ruler.',
  'The banner that bends does not break.',
  'Steel is forged; loyalty is earned.',
  'Every dawn, the realm draws breath.',
  'A full granary is a quiet crown.',
  'The council remembers every slight.',
  'Walls keep out wolves, not whispers.',
  'Glory fades; good harvests endure.',
  'The bold map the world; the patient hold it.',
];

export interface TransitionOpts {
  title?: string;       // big banner word (e.g. "TO BATTLE")
  subtitle?: string;    // small line under the banner
  hold?: number;        // total visible time in ms (default 900)
  onMid?: () => void;   // fired once at the midpoint (do the scene launch here)
  tint?: number;        // banner accent colour (default gold)
}

export function showTransition(scene: Phaser.Scene, opts: TransitionOpts = {}) {
  const W = (scene.scale && scene.scale.width) || 960;
  const H = (scene.scale && scene.scale.height) || 600;
  const cx = W / 2, cy = H / 2;
  const hold = Math.max(450, opts.hold || 900);
  const tint = opts.tint != null ? opts.tint : 0xe8c66a;

  // Everything goes in one container at a very high depth, so it sits above the
  // HUD of whatever scene we're over. Screen-fixed so panning can't move it.
  const layer = scene.add.container(0, 0).setDepth(99999).setScrollFactor(0).setAlpha(0);

  // Dim wash + a centred carved tablet.
  const dim = scene.add.rectangle(0, 0, W, H, 0x05070b, 0.72).setOrigin(0, 0).setInteractive();
  const tabW = Math.min(460, W - 80), tabH = 220;
  const tab = scene.add.rectangle(cx, cy, tabW, tabH, 0x171108, 0.98).setStrokeStyle(3, tint, 0.9);
  const tabInner = scene.add.rectangle(cx, cy, tabW - 14, tabH - 14, 0x000000, 0).setStrokeStyle(1, 0x6b5224, 0.6);
  layer.add([dim, tab, tabInner]);

  // Title banner.
  const title = scene.add.text(cx, cy - 58, (opts.title || 'LOADING').toUpperCase(),
    { fontFamily: 'serif', fontSize: '34px', color: '#f0e6d0', fontStyle: 'bold', stroke: '#0d0a04', strokeThickness: 6 }).setOrigin(0.5);
  const sub = scene.add.text(cx, cy - 26, opts.subtitle || 'Preparing the realm…',
    { fontFamily: 'monospace', fontSize: '13px', color: '#cbb787' }).setOrigin(0.5);
  layer.add([title, sub]);

  // Circular loader: a ring of dots whose brightness rotates (a "spinner").
  const ring = scene.add.container(cx, cy + 16);
  const dots: Phaser.GameObjects.Arc[] = [];
  const N = 12, R = 26;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const d = scene.add.circle(Math.cos(a) * R, Math.sin(a) * R, 3, tint, 0.25);
    dots.push(d); ring.add(d);
  }
  layer.add(ring);

  // Rotating medieval quote.
  const quote = scene.add.text(cx, cy + 70, '“' + Phaser.Utils.Array.GetRandom(QUOTES) + '”',
    { fontFamily: 'serif', fontSize: '13px', color: '#9fb0c0', fontStyle: 'italic', align: 'center', wordWrap: { width: tabW - 50 } }).setOrigin(0.5);
  layer.add(quote);

  // --- lifecycle bookkeeping (leak-safe) -----------------------------------
  let cleaned = false;
  let spin = 0;
  const tweens: Phaser.Tweens.Tween[] = [];
  const timers: Phaser.Time.TimerEvent[] = [];

  // Spinner: advance the bright dot on a repeating timer (cheap, no per-frame hook).
  const spinTimer = scene.time.addEvent({
    delay: 70, loop: true, callback: () => {
      spin = (spin + 1) % N;
      for (let i = 0; i < N; i++) {
        const dist = (i - spin + N) % N;
        dots[i].setAlpha(dist <= 3 ? 1 - dist * 0.25 : 0.18);
      }
    },
  });
  timers.push(spinTimer);

  const cleanup = () => {
    if (cleaned) return; cleaned = true;
    timers.forEach(t => { try { t.remove(false); } catch (e) {} });
    tweens.forEach(t => { try { t.stop(); } catch (e) {} });
    try { scene.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup); } catch (e) {}
    try { scene.events.off(Phaser.Scenes.Events.DESTROY, cleanup); } catch (e) {}
    try { layer.destroy(true); } catch (e) {}
  };
  // If the host scene tears down mid-transition, take everything with it.
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
  scene.events.once(Phaser.Scenes.Events.DESTROY, cleanup);

  try { sfx.play('transition'); } catch (e) {}

  // Fade in, do the launch at the midpoint, fade out, clean up.
  tweens.push(scene.tweens.add({ targets: layer, alpha: 1, duration: 220, ease: 'Quad.easeOut' }));
  timers.push(scene.time.delayedCall(Math.round(hold * 0.45), () => { try { opts.onMid && opts.onMid(); } catch (e) {} }));
  timers.push(scene.time.delayedCall(hold, () => {
    const out = scene.tweens.add({ targets: layer, alpha: 0, duration: 260, ease: 'Quad.easeIn', onComplete: cleanup });
    tweens.push(out);
  }));

  // Skippable: clicking the dim wash jumps straight to the end (but still runs
  // the midpoint launch if it hasn't fired yet).
  dim.once('pointerdown', () => {
    try { opts.onMid && opts.onMid(); opts.onMid = undefined; } catch (e) {}
    cleanup();
  });

  return { cleanup };
}
