import Phaser from 'phaser';
import { GAME_W, GAME_H } from './GameScene.js';

// IntroCutsceneScene (Phase 11) — a one-time illustrated intro that plays on the
// first new game (after king creation, before the player takes control). Seven
// procedurally-drawn full-screen panels in the team's warm Northgard style, a
// word-by-word typed narration overlay, best-effort AI voice narration (Web
// Speech API), and a per-scene Web Audio ambient bed. Closes with a gold title
// card showing the kingdom name.
//
// ROBUSTNESS: headless/CI Chrome usually has NO speech voices and may not expose
// speechSynthesis at all. Narration is therefore BEST-EFFORT and never blocks —
// scene advancement is driven by a max-duration timer, so the cutscene always
// progresses and finishes even with zero voices and no audio.

// Logical panel size; everything is drawn at this resolution then scaled to fit
// the real GAME_W x GAME_H canvas (which keeps the art crisp at any aspect).
const PANEL_W = 1200;
const PANEL_H = 675;

// ---------------------------------------------------------------------------
// NarratorVoice — a tiny, fully defensive wrapper around the Web Speech API.
// Picks a deep English voice if one exists, speaks a line, and reports when the
// utterance ends. EVERY call is feature-detected + try/catch wrapped so it can
// never throw or block, no matter how broken / absent the platform's TTS is.
// ---------------------------------------------------------------------------
class NarratorVoice {
  private synth: SpeechSynthesis | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  private current: SpeechSynthesisUtterance | null = null;
  available = false;

  constructor() {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis) {
        this.synth = window.speechSynthesis;
        this.available = true;
        this.pickVoice();
        // Voices often load asynchronously; refresh the pick when they arrive.
        try {
          this.synth.addEventListener('voiceschanged', () => this.pickVoice());
        } catch (e) { /* some engines don't support the event */ }
      }
    } catch (e) {
      this.synth = null;
      this.available = false;
    }
  }

  private pickVoice() {
    if (!this.synth) return;
    let voices: SpeechSynthesisVoice[] = [];
    try { voices = this.synth.getVoices() || []; } catch (e) { voices = []; }
    if (!voices.length) return; // headless Chrome: stays null, that's fine
    const score = (v: SpeechSynthesisVoice): number => {
      const n = (v.name || '').toLowerCase();
      const lang = (v.lang || '').toLowerCase();
      if (n.includes('daniel')) return 100;          // macOS deep UK male
      if (n.includes('david')) return 95;            // Windows male
      if (n.includes('alex')) return 90;             // macOS male
      if (n.includes('google uk english male')) return 88;
      if (lang.startsWith('en-gb') && n.includes('male')) return 80;
      if (lang.startsWith('en-gb')) return 60;
      if (lang.startsWith('en')) return 40;
      return 0;
    };
    let best: SpeechSynthesisVoice | null = null, bestScore = -1;
    for (const v of voices) { const s = score(v); if (s > bestScore) { bestScore = s; best = v; } }
    if (best && bestScore > 0) this.voice = best;
  }

  // Speak a line. onEnd fires when the utterance finishes OR immediately if
  // speech is unavailable, so the caller can treat "ended" uniformly. The
  // caller MUST NOT rely on this for timing — a max-duration timer is the real
  // driver; this is just an early "voice done" signal.
  speak(text: string, onEnd?: () => void) {
    if (!this.synth || !this.available) { if (onEnd) onEnd(); return; }
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) u.voice = this.voice;
      u.rate = 0.85;
      u.pitch = 0.9;
      u.volume = 0.8;
      u.lang = (this.voice && this.voice.lang) || 'en-GB';
      let done = false;
      const finish = () => { if (done) return; done = true; if (onEnd) onEnd(); };
      u.onend = finish;
      u.onerror = finish; // treat errors as "ended" — never stall
      this.current = u;
      this.synth.speak(u);
    } catch (e) {
      // Any failure → behave as if narration ended immediately.
      if (onEnd) onEnd();
    }
  }

  cancel() {
    this.current = null;
    if (!this.synth) return;
    try { this.synth.cancel(); } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// CutsceneAudio — minimal, fully defensive Web Audio ambient beds. Builds its
// own AudioContext (so it never fights the game's SoundEngine) and exposes a
// per-scene bed plus a global stop. Never throws if Web Audio is unavailable.
// ---------------------------------------------------------------------------
class CutsceneAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private nodes: Array<{ stop: () => void }> = [];

  constructor() {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AC) {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) { /* needs gesture */ } }
      }
    } catch (e) { this.ctx = null; this.master = null; }
  }

  resume() { try { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); } catch (e) {} }

  // A sustained drone of one or more detuned oscillators with a slow LFO wobble.
  private drone(freqs: number[], vol: number, type: OscillatorType = 'sine', wobble = 0) {
    if (!this.ctx || !this.master) return;
    try {
      const g = this.ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(vol, this.ctx.currentTime, 1.2);
      g.connect(this.master);
      const oscs: OscillatorNode[] = [];
      let lfo: OscillatorNode | null = null, lfoGain: GainNode | null = null;
      for (const f of freqs) {
        const o = this.ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.connect(g);
        o.start();
        oscs.push(o);
      }
      if (wobble > 0 && oscs.length) {
        lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.15;
        lfoGain = this.ctx.createGain(); lfoGain.gain.value = wobble;
        lfo.connect(lfoGain); lfoGain.connect(oscs[0].frequency); lfo.start();
      }
      this.nodes.push({
        stop: () => {
          try {
            g.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.4);
            const ctx = this.ctx!;
            setTimeout(() => { try { oscs.forEach(o => o.stop()); if (lfo) lfo.stop(); } catch (e) {} }, 700);
            void ctx;
          } catch (e) {}
        },
      });
    } catch (e) { /* ignore */ }
  }

  // Looping filtered-noise wind bed.
  private wind(vol: number, filterFreq: number) {
    if (!this.ctx || !this.master) return;
    try {
      const n = Math.floor(this.ctx.sampleRate * 2);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const filt = this.ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = filterFreq;
      const g = this.ctx.createGain(); g.gain.value = 0;
      g.gain.setTargetAtTime(vol, this.ctx.currentTime, 1.2);
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.1;
      const lfoGain = this.ctx.createGain(); lfoGain.gain.value = filterFreq * 0.5;
      lfo.connect(lfoGain); lfoGain.connect(filt.frequency); lfo.start();
      src.connect(filt).connect(g).connect(this.master);
      src.start();
      this.nodes.push({
        stop: () => {
          try {
            g.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.4);
            setTimeout(() => { try { src.stop(); lfo.stop(); } catch (e) {} }, 700);
          } catch (e) {}
        },
      });
    } catch (e) { /* ignore */ }
  }

  // A slow repeating soft percussion pulse (war drum) for the conflict scenes.
  private pulse(freq: number, periodMs: number, vol: number) {
    if (!this.ctx || !this.master) return;
    try {
      const tick = () => {
        if (!this.ctx || !this.master) return;
        const t0 = this.ctx.currentTime;
        const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
        o.connect(g).connect(this.master);
        o.start(t0); o.stop(t0 + 0.55);
      };
      const id = setInterval(tick, periodMs);
      tick();
      this.nodes.push({ stop: () => { try { clearInterval(id); } catch (e) {} } });
    } catch (e) { /* ignore */ }
  }

  // Pick a bed by scene index (0-based). Beds are intentionally quiet.
  startBed(index: number) {
    this.resume();
    switch (index) {
      case 0: this.drone([110, 165, 220], 0.10, 'sine', 2); break;        // Golden Age — warm major drone
      case 1: this.drone([73.4, 87.3], 0.09, 'triangle', 0); this.pulse(55, 1400, 0.06); break; // Betrayal — low tension + slow heartbeat
      case 2: this.drone([82.4, 98], 0.07, 'sawtooth', 1); this.pulse(60, 700, 0.08); break;   // War — dissonant + war drums
      case 3: this.wind(0.10, 320); this.drone([55, 58], 0.06, 'sine', 1); break;              // Ruins — wind + deep hollow
      case 4: this.drone([98, 130.8, 196], 0.08, 'sine', 1.5); break;                          // Present — cool suspended
      case 5: this.drone([130.8, 196, 261.6], 0.09, 'triangle', 1); break;                     // Arrival — hopeful rising
      case 6: this.drone([130.8, 164.8, 196, 261.6], 0.09, 'sine', 1); this.wind(0.05, 500); break; // Call — resolved warm chord + soft wind
      default: this.drone([146.8, 220, 293.7], 0.10, 'sine', 0); break;                        // Title card — bright gold chord
    }
  }

  stopBed() {
    const old = this.nodes; this.nodes = [];
    for (const n of old) { try { n.stop(); } catch (e) {} }
  }

  destroy() {
    this.stopBed();
    try { if (this.ctx) { const c = this.ctx; this.ctx = null; setTimeout(() => { try { c.close(); } catch (e) {} }, 900); } } catch (e) {}
  }
}

// ---------------------------------------------------------------------------
// Scene definitions.
// ---------------------------------------------------------------------------
interface CutData { kingdomName?: string; onComplete?: () => void; }

const SCENES: Array<{ title: string; line: string }> = [
  { title: 'THE GOLDEN AGE', line: 'Two hundred years past, the Ancient Empire stood unbroken. One throne. One law. One people.' },
  { title: 'THE BETRAYAL', line: 'Until the night three generals chose ambition over loyalty.' },
  { title: 'THE WAR', line: 'They tore the empire apart. Every kingdom fell. Every city burned.' },
  { title: 'THE RUINS', line: 'The source of the empire’s power was sealed away. Hidden beneath the ruins of what was lost.' },
  { title: 'THE PRESENT', line: 'Now three kingdoms rise from the ashes. Each with their eye on what was lost.' },
  { title: 'YOUR ARRIVAL', line: 'And you. Starting with nothing. A ruined village. A handful of people. A choice about what kind of ruler to become.' },
  { title: 'THE CALL', line: 'The continent remembers what it lost. It is waiting to see what rises in its place. What will you build?' },
];

const SCENE_DURATION = 6000; // max ms per scene; advance on narration end OR this
const TITLE_HOLD = 2000;

export class IntroCutsceneScene extends Phaser.Scene {
  // Loose typing throughout — matches the rest of this codebase's scenes.
  [key: string]: any;

  sceneIndex = 0;

  private narrator!: NarratorVoice;
  private audio!: CutsceneAudio;
  private kingdomName = 'Your Kingdom';
  private onComplete: (() => void) | null = null;

  private root!: Phaser.GameObjects.Container;   // scaled art root (PANEL_W x PANEL_H)
  private panelLayer!: Phaser.GameObjects.Container; // current panel's drawables (child of root)
  private uiLayer!: Phaser.GameObjects.Container; // overlay UI (title, narration, skip) — screen space
  private narrText!: Phaser.GameObjects.Text;
  private titleText!: Phaser.GameObjects.Text;
  private fadeRect!: Phaser.GameObjects.Rectangle;

  private advanceTimer: Phaser.Time.TimerEvent | null = null;
  private typeTimer: Phaser.Time.TimerEvent | null = null;
  private finished = false;
  private transitioning = false;

  constructor() { super('IntroCutsceneScene'); }

  init(data: CutData) {
    this.sceneIndex = 0;
    this.finished = false;
    this.transitioning = false;
    this.kingdomName = (data && data.kingdomName && String(data.kingdomName).trim()) || 'Your Kingdom';
    this.onComplete = (data && data.onComplete) || null;
  }

  create() {
    this.narrator = new NarratorVoice();
    this.audio = new CutsceneAudio();

    // Black backdrop covering the whole canvas.
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 1).setOrigin(0, 0).setDepth(0);

    // Art root: drawn in logical PANEL_W x PANEL_H, scaled+centered to the canvas.
    const scale = Math.min(GAME_W / PANEL_W, GAME_H / PANEL_H);
    this.root = this.add.container((GAME_W - PANEL_W * scale) / 2, (GAME_H - PANEL_H * scale) / 2).setDepth(1);
    this.root.setScale(scale);
    this.panelLayer = this.add.container(0, 0);
    this.root.add(this.panelLayer);

    // Overlay UI in screen space (so text stays sharp / readable).
    this.uiLayer = this.add.container(0, 0).setDepth(20);

    // Letterbox-feel narration backdrop strip + text near the bottom.
    const strip = this.add.rectangle(0, GAME_H - 150, GAME_W, 150, 0x000000, 0.55).setOrigin(0, 0);
    this.uiLayer.add(strip);
    this.narrText = this.add.text(GAME_W / 2, GAME_H - 82, '', {
      fontFamily: 'serif', fontSize: '26px', color: '#f3e6c4', align: 'center',
      wordWrap: { width: GAME_W - 220 }, lineSpacing: 6,
    }).setOrigin(0.5).setShadow(0, 2, '#000000', 6, false, true);
    this.uiLayer.add(this.narrText);

    // Per-scene title (top-left, carved gold).
    this.titleText = this.add.text(70, 56, '', {
      fontFamily: 'serif', fontSize: '34px', color: '#e8c66a', fontStyle: 'bold', stroke: '#1a1206', strokeThickness: 6,
    }).setOrigin(0, 0.5);
    this.titleText.setShadow(0, 2, '#6b4a16', 4, false, true);
    this.uiLayer.add(this.titleText);

    // Skip-entire-cutscene button (bottom-right).
    this.makeSkipButton();

    // Top fade rectangle used for between-scene crossfades + final fade-out.
    this.fadeRect = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 1).setOrigin(0, 0).setDepth(30);

    // Input: Space or a click anywhere advances the current scene early.
    this.input.keyboard?.on('keydown-SPACE', () => this.advanceEarly());
    this.input.keyboard?.on('keydown-ESC', () => this.skipAll());
    // Background click receiver (low depth so the Skip button still wins).
    const clickCatcher = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.001)
      .setOrigin(0, 0).setDepth(10).setInteractive();
    clickCatcher.on('pointerdown', () => this.advanceEarly());
    // First gesture also unlocks audio if it was suspended.
    clickCatcher.on('pointerdown', () => { try { this.audio.resume(); } catch (e) {} });

    // Clean everything up no matter how the scene goes away.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());

    // Kick off the first scene with a short fade-in.
    this.cameras.main.fadeIn(400, 0, 0, 0);
    this.showScene(0);
  }

  // -------------------------------------------------------------------------
  // Scene flow
  // -------------------------------------------------------------------------
  private showScene(index: number) {
    if (this.finished) return;
    this.transitioning = false;
    this.sceneIndex = index;

    // Clear the previous panel art.
    this.panelLayer.removeAll(true);

    // Draw the new panel.
    this.drawPanel(index);

    // Fade the cover rect away to reveal the new panel.
    this.fadeRect.setAlpha(1);
    this.tweens.add({ targets: this.fadeRect, alpha: 0, duration: 450, ease: 'Sine.easeOut' });

    // Title + typed narration.
    const def = SCENES[index];
    this.titleText.setText(def.title).setAlpha(0);
    this.tweens.add({ targets: this.titleText, alpha: 1, duration: 600 });
    this.startTyping(def.line);

    // Audio bed for this scene.
    try { this.audio.stopBed(); this.audio.startBed(index); } catch (e) {}

    // Best-effort narration (never blocks). If the voice ends before the max
    // timer, we advance early — but the timer guarantees progress regardless.
    let narrationEnded = false;
    try {
      this.narrator.speak(def.line, () => {
        narrationEnded = true;
        // Give the viewer a beat to read after the voice stops.
        if (!this.finished && !this.transitioning) {
          this.scheduleAdvance(1200);
        }
      });
    } catch (e) { /* never throws */ }
    void narrationEnded;

    // MAX-DURATION TIMER — the real driver. Advances after SCENE_DURATION even
    // with zero voices / no narration callback ever firing.
    this.scheduleAdvance(SCENE_DURATION);
  }

  // (Re)schedule the advance timer. We keep only the EARLIEST pending advance so
  // a narration-end can pull the transition in, but the max timer still applies.
  private scheduleAdvance(delay: number) {
    if (this.finished || this.transitioning) return;
    const fireAt = this.time.now + delay;
    if (this.advanceTimer) {
      // Keep whichever fires sooner.
      const existing = this.advanceTimer.getRemaining ? this.time.now + this.advanceTimer.getRemaining() : Infinity;
      if (fireAt >= existing) return;
      this.advanceTimer.remove(false);
      this.advanceTimer = null;
    }
    this.advanceTimer = this.time.delayedCall(delay, () => this.nextScene());
  }

  // Player pressed Space / clicked — jump to the next scene right away.
  private advanceEarly() {
    if (this.finished || this.transitioning) return;
    this.nextScene();
  }

  private nextScene() {
    if (this.finished || this.transitioning) return;
    this.transitioning = true;
    if (this.advanceTimer) { this.advanceTimer.remove(false); this.advanceTimer = null; }
    if (this.typeTimer) { this.typeTimer.remove(false); this.typeTimer = null; }
    try { this.narrator.cancel(); } catch (e) {}

    const next = this.sceneIndex + 1;
    // Cover with the fade rect, then either show the next panel or the title card.
    this.tweens.add({
      targets: this.fadeRect, alpha: 1, duration: 400, ease: 'Sine.easeIn',
      onComplete: () => {
        if (next >= SCENES.length) this.showTitleCard();
        else this.showScene(next);
      },
    });
  }

  // -------------------------------------------------------------------------
  // Typed narration (word-by-word).
  // -------------------------------------------------------------------------
  private startTyping(line: string) {
    if (this.typeTimer) { this.typeTimer.remove(false); this.typeTimer = null; }
    const words = line.split(' ');
    this.narrText.setText('');
    let i = 0;
    // ~120ms per word feels read-along and finishes well under SCENE_DURATION.
    this.typeTimer = this.time.addEvent({
      delay: 120,
      repeat: words.length - 1,
      callback: () => {
        i++;
        this.narrText.setText(words.slice(0, i).join(' '));
      },
    });
  }

  // -------------------------------------------------------------------------
  // Title card: kingdom name letter-by-letter in gold, hold, subtitle, fade out.
  // -------------------------------------------------------------------------
  private showTitleCard() {
    if (this.finished) return;
    this.transitioning = true;
    this.sceneIndex = SCENES.length;

    this.panelLayer.removeAll(true);
    this.narrText.setText('');
    this.titleText.setText('');
    try { this.audio.stopBed(); this.audio.startBed(99); } catch (e) {}

    // Dark warm backdrop with a faint central glow.
    const bg = this.add.graphics();
    bg.fillStyle(0x0a0805, 1); bg.fillRect(0, 0, PANEL_W, PANEL_H);
    const glow = this.add.graphics();
    glow.fillStyle(0xffcf6a, 0.05);
    for (let r = 360; r > 0; r -= 12) { glow.fillStyle(0xffcf6a, 0.012); glow.fillCircle(PANEL_W / 2, PANEL_H / 2, r); }
    this.panelLayer.add([bg, glow]);

    // Reveal the panel.
    this.tweens.add({ targets: this.fadeRect, alpha: 0, duration: 500, ease: 'Sine.easeOut' });

    const name = this.kingdomName.toUpperCase();
    const nameText = this.add.text(GAME_W / 2, GAME_H / 2 - 20, '', {
      fontFamily: 'serif', fontSize: '72px', color: '#e8c66a', fontStyle: 'bold', stroke: '#1a1206', strokeThickness: 10,
    }).setOrigin(0.5).setDepth(21);
    nameText.setShadow(0, 3, '#6b4a16', 6, false, true);
    this.uiLayer.add(nameText);

    const subtitle = this.add.text(GAME_W / 2, GAME_H / 2 + 56, '', {
      fontFamily: 'monospace', fontSize: '22px', color: '#cbb787', letterSpacing: 4,
    } as any).setOrigin(0.5).setDepth(21).setAlpha(0);
    this.uiLayer.add(subtitle);

    // Letter-by-letter reveal of the name.
    let li = 0;
    const letterTimer = this.time.addEvent({
      delay: 110,
      repeat: name.length - 1,
      callback: () => { li++; nameText.setText(name.slice(0, li)); },
    });
    // Track so cleanup can kill it on skip.
    this._titleTimer = letterTimer;

    const totalNameMs = name.length * 110;
    // Subtitle after the name finishes.
    this.time.delayedCall(totalNameMs + 200, () => {
      subtitle.setText('Your story begins.');
      this.tweens.add({ targets: subtitle, alpha: 1, duration: 600 });
    });

    // Hold, then fade to black and finish.
    this.time.delayedCall(totalNameMs + 200 + TITLE_HOLD, () => {
      this.tweens.add({
        targets: this.fadeRect, alpha: 1, duration: 700, ease: 'Sine.easeIn',
        onComplete: () => this.finish(),
      });
      this.tweens.add({ targets: [nameText, subtitle], alpha: 0, duration: 600 });
    });
  }

  // -------------------------------------------------------------------------
  // Skip button (skips the entire cutscene).
  // -------------------------------------------------------------------------
  private makeSkipButton() {
    const w = 110, h = 40, x = GAME_W - w - 24, y = GAME_H - h - 22;
    const cont = this.add.container(x + w / 2, y + h / 2).setDepth(25);
    const bg = this.add.rectangle(0, 0, w, h, 0x1a140c, 0.85).setStrokeStyle(2, 0xc9a14a, 0.85);
    const t = this.add.text(0, 0, 'Skip ▶', { fontFamily: 'serif', fontSize: '18px', color: '#f0e6d0', fontStyle: 'bold' }).setOrigin(0.5);
    cont.add([bg, t]);
    bg.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains, { useHandCursor: true } as any);
    bg.on('pointerover', () => { bg.setFillStyle(0x2a2114, 0.95); t.setColor('#ffe9b0'); });
    bg.on('pointerout', () => { bg.setFillStyle(0x1a140c, 0.85); t.setColor('#f0e6d0'); });
    // stopPropagation so a skip-click doesn't also count as an "advance" click.
    bg.on('pointerdown', (_p: any, _lx: any, _ly: any, ev: any) => { if (ev && ev.stopPropagation) ev.stopPropagation(); this.skipAll(); });
    this.uiLayer.add(cont);
  }

  // Skip the whole cutscene: stop everything and finish normally.
  skipAll() {
    if (this.finished) return;
    this.transitioning = true;
    if (this.advanceTimer) { this.advanceTimer.remove(false); this.advanceTimer = null; }
    if (this.typeTimer) { this.typeTimer.remove(false); this.typeTimer = null; }
    if (this._titleTimer) { this._titleTimer.remove(false); this._titleTimer = null; }
    try { this.narrator.cancel(); } catch (e) {}
    try { this.audio.stopBed(); } catch (e) {}
    // Brief fade so the cut isn't jarring.
    this.tweens.add({
      targets: this.fadeRect, alpha: 1, duration: 250, ease: 'Sine.easeIn',
      onComplete: () => this.finish(),
    });
  }

  // -------------------------------------------------------------------------
  // Finish: set the seen-flag, run the callback, stop this scene.
  // -------------------------------------------------------------------------
  private finish() {
    if (this.finished) return;
    this.finished = true;
    try { localStorage.setItem('kingdom_intro_seen', 'true'); } catch (e) {}
    const cb = this.onComplete; this.onComplete = null;
    // cleanup runs via the SHUTDOWN handler when we stop the scene.
    this.scene.stop();
    if (cb) { try { cb(); } catch (e) { console.error('[IntroCutscene] onComplete failed', e); } }
  }

  // Tear down all timers, narration, and audio. Safe to call multiple times.
  private cleanup() {
    if (this.advanceTimer) { try { this.advanceTimer.remove(false); } catch (e) {} this.advanceTimer = null; }
    if (this.typeTimer) { try { this.typeTimer.remove(false); } catch (e) {} this.typeTimer = null; }
    if (this._titleTimer) { try { this._titleTimer.remove(false); } catch (e) {} this._titleTimer = null; }
    try { if (this.narrator) this.narrator.cancel(); } catch (e) {}
    try { if (this.audio) this.audio.destroy(); } catch (e) {}
  }

  // =========================================================================
  // PROCEDURAL PANEL ART — warm Northgard palette, drawn into panelLayer at
  // PANEL_W x PANEL_H. Each panel is a small composition of Graphics shapes.
  // =========================================================================
  private drawPanel(index: number) {
    const g = this.add.graphics();
    this.panelLayer.add(g);
    switch (index) {
      case 0: this.panelGoldenAge(g); break;
      case 1: this.panelBetrayal(g); break;
      case 2: this.panelWar(g); break;
      case 3: this.panelRuins(g); break;
      case 4: this.panelPresent(g); break;
      case 5: this.panelArrival(g); break;
      case 6: this.panelCall(g); break;
      default: this.panelGoldenAge(g); break;
    }
  }

  // Helper: vertical gradient sky as stacked rects.
  private sky(g: Phaser.GameObjects.Graphics, top: number[], bottom: number[], bands = 24) {
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const r = Math.round(top[0] + (bottom[0] - top[0]) * t);
      const gg = Math.round(top[1] + (bottom[1] - top[1]) * t);
      const b = Math.round(top[2] + (bottom[2] - top[2]) * t);
      g.fillStyle(Phaser.Display.Color.GetColor(r, gg, b), 1);
      g.fillRect(0, Math.floor(i * (PANEL_H / bands)), PANEL_W, Math.ceil(PANEL_H / bands) + 1);
    }
  }

  private vignette(g: Phaser.GameObjects.Graphics) {
    // Dark feathered frame so panels read cinematic.
    for (let i = 0; i < 60; i++) {
      const a = 0.012;
      g.fillStyle(0x000000, a);
      g.fillRect(0, 0, PANEL_W, i * 2);
      g.fillRect(0, PANEL_H - i * 2, PANEL_W, i * 2);
      g.fillRect(0, 0, i * 2, PANEL_H);
      g.fillRect(PANEL_W - i * 2, 0, i * 2, PANEL_H);
    }
  }

  // Small reusable isometric building block (warm lit top, shaded sides).
  private isoBlock(g: Phaser.GameObjects.Graphics, cx: number, cy: number, w: number, h: number, top: number, body: number, shade: number) {
    const hw = w / 2, hh = w / 4;
    // top diamond
    g.fillStyle(top, 1);
    g.beginPath(); g.moveTo(cx, cy - hh); g.lineTo(cx + hw, cy); g.lineTo(cx, cy + hh); g.lineTo(cx - hw, cy); g.closePath(); g.fillPath();
    // left face
    g.fillStyle(body, 1);
    g.beginPath(); g.moveTo(cx - hw, cy); g.lineTo(cx, cy + hh); g.lineTo(cx, cy + hh + h); g.lineTo(cx - hw, cy + h); g.closePath(); g.fillPath();
    // right face
    g.fillStyle(shade, 1);
    g.beginPath(); g.moveTo(cx + hw, cy); g.lineTo(cx, cy + hh); g.lineTo(cx, cy + hh + h); g.lineTo(cx + hw, cy + h); g.closePath(); g.fillPath();
  }

  // 1 — THE GOLDEN AGE: a magnificent golden isometric city at its peak.
  private panelGoldenAge(g: Phaser.GameObjects.Graphics) {
    this.sky(g, [60, 36, 60], [240, 180, 90]); // dusk purple to gold horizon
    // Sun-glow on the horizon.
    g.fillStyle(0xffe7a0, 0.5); g.fillCircle(PANEL_W / 2, PANEL_H * 0.62, 130);
    g.fillStyle(0xfff3cf, 0.35); g.fillCircle(PANEL_W / 2, PANEL_H * 0.62, 80);
    // Rolling golden ground.
    g.fillStyle(0x8a6a2e, 1); g.fillRect(0, PANEL_H * 0.6, PANEL_W, PANEL_H * 0.4);
    g.fillStyle(0xa07c36, 0.6); g.fillEllipse(PANEL_W / 2, PANEL_H * 0.62, PANEL_W * 1.2, 120);
    // City: clustered iso blocks rising toward a tall central palace/spire.
    const baseY = PANEL_H * 0.6;
    const golds = [0xf2cf72, 0xe0b85a, 0xcaa24a];
    for (let row = 0; row < 5; row++) {
      const n = 9 - row;
      for (let i = 0; i < n; i++) {
        const cx = PANEL_W / 2 + (i - (n - 1) / 2) * 70 + (row % 2) * 20;
        const cy = baseY + row * 26 - 10;
        const hh = 40 + Math.abs((n - 1) / 2 - i) * -4 + Math.random() * 20;
        const top = golds[(i + row) % 3];
        this.isoBlock(g, cx, cy, 56, hh, top, 0xb8923f, 0x8a6c2c);
      }
    }
    // Central palace spire with gold roof.
    const px = PANEL_W / 2, py = baseY - 40;
    this.isoBlock(g, px, py, 80, 150, 0xf6dd86, 0xcaa84e, 0x9a7c36);
    g.fillStyle(0xffe9a8, 1);
    g.beginPath(); g.moveTo(px, py - 130); g.lineTo(px + 44, py - 20); g.lineTo(px - 44, py - 20); g.closePath(); g.fillPath();
    g.fillStyle(0xfff3cf, 1); g.fillCircle(px, py - 134, 8); // golden finial
    // Warm sparkle dots over the city (windows lit).
    for (let i = 0; i < 60; i++) {
      g.fillStyle(0xfff0bf, 0.7);
      g.fillCircle(PANEL_W / 2 + (Math.random() - 0.5) * 600, baseY + Math.random() * 120 - 20, 1.6);
    }
    this.vignette(g);
  }

  // 2 — THE BETRAYAL: a dark feast hall, long table, three shadowed generals.
  private panelBetrayal(g: Phaser.GameObjects.Graphics) {
    this.sky(g, [10, 8, 14], [26, 18, 16]);
    // Hall walls — stone pillars receding.
    g.fillStyle(0x16110e, 1); g.fillRect(0, 0, PANEL_W, PANEL_H);
    for (let i = 0; i < 5; i++) {
      const x = 120 + i * 240;
      g.fillStyle(0x241a14, 1); g.fillRect(x, 60, 40, PANEL_H - 200);
      g.fillStyle(0x2e2218, 1); g.fillRect(x, 60, 14, PANEL_H - 200);
    }
    // Floor.
    g.fillStyle(0x120d0a, 1); g.fillRect(0, PANEL_H - 150, PANEL_W, 150);
    // Long table (perspective trapezoid) down the centre.
    g.fillStyle(0x3a2a1c, 1);
    g.beginPath();
    g.moveTo(PANEL_W / 2 - 90, PANEL_H * 0.42);
    g.lineTo(PANEL_W / 2 + 90, PANEL_H * 0.42);
    g.lineTo(PANEL_W / 2 + 340, PANEL_H - 90);
    g.lineTo(PANEL_W / 2 - 340, PANEL_H - 90);
    g.closePath(); g.fillPath();
    g.fillStyle(0x4a3626, 1);
    g.beginPath();
    g.moveTo(PANEL_W / 2 - 90, PANEL_H * 0.42);
    g.lineTo(PANEL_W / 2 + 90, PANEL_H * 0.42);
    g.lineTo(PANEL_W / 2 + 96, PANEL_H * 0.45);
    g.lineTo(PANEL_W / 2 - 96, PANEL_H * 0.45);
    g.closePath(); g.fillPath();
    // Guttering candle on the table — small flame + pooled glow.
    const candX = PANEL_W / 2, candY = PANEL_H * 0.5;
    g.fillStyle(0xffb347, 0.18); g.fillCircle(candX, candY, 150);
    g.fillStyle(0xffd98a, 0.22); g.fillCircle(candX, candY, 80);
    g.fillStyle(0xe8e0d0, 1); g.fillRect(candX - 4, candY - 6, 8, 30);   // candle stick
    g.fillStyle(0xffcf6a, 1); g.fillEllipse(candX, candY - 14, 8, 18);   // flame
    g.fillStyle(0xfff3cf, 1); g.fillEllipse(candX, candY - 16, 3, 9);
    // Tipped cup beside the candle (spilled — a dark stain).
    g.fillStyle(0x2a1c12, 0.8); g.fillEllipse(candX + 90, candY + 30, 70, 26); // wine stain
    g.fillStyle(0x9a7c3a, 1); g.fillEllipse(candX + 70, candY + 18, 26, 12);   // cup mouth (tipped)
    g.fillStyle(0x6a5226, 1); g.fillEllipse(candX + 92, candY + 26, 22, 10);
    // Three shadowed generals seated along the far side (silhouettes).
    const gens = [PANEL_W / 2 - 150, PANEL_W / 2, PANEL_W / 2 + 150];
    for (const gx of gens) {
      g.fillStyle(0x000000, 0.92);
      g.fillEllipse(gx, PANEL_H * 0.36, 60, 90);          // hooded body
      g.fillCircle(gx, PANEL_H * 0.30, 26);                // head
      g.fillStyle(0x140d08, 1); g.fillTriangle(gx - 30, PANEL_H * 0.30, gx + 30, PANEL_H * 0.30, gx, PANEL_H * 0.20); // hood point
    }
    // Faint red glints where eyes would be (menace).
    for (const gx of gens) { g.fillStyle(0xb83a2a, 0.8); g.fillCircle(gx - 8, PANEL_H * 0.29, 2); g.fillCircle(gx + 8, PANEL_H * 0.29, 2); }
    this.vignette(g);
  }

  // 3 — THE WAR: a parchment continent map, red conflict spreading, cities gray.
  private panelWar(g: Phaser.GameObjects.Graphics) {
    // Parchment background.
    g.fillStyle(0xd8c39a, 1); g.fillRect(0, 0, PANEL_W, PANEL_H);
    g.fillStyle(0xc7ad7e, 0.5); g.fillEllipse(PANEL_W / 2, PANEL_H / 2, PANEL_W * 1.1, PANEL_H);
    // Aged edges.
    g.fillStyle(0x8a6f44, 0.25);
    for (let i = 0; i < 40; i++) g.fillCircle(Math.random() * PANEL_W, Math.random() * PANEL_H, Math.random() * 30);
    // A continent outline (organic blob).
    g.fillStyle(0xb6a071, 1);
    g.beginPath();
    const cx = PANEL_W / 2, cy = PANEL_H / 2;
    const pts = 14;
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const rad = 240 + Math.sin(a * 3) * 60 + Math.cos(a * 5) * 40;
      const x = cx + Math.cos(a) * rad * 1.4, y = cy + Math.sin(a) * rad * 0.8;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.fillPath();
    // Coastline ink line.
    g.lineStyle(3, 0x5a4628, 0.7);
    g.beginPath();
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const rad = 240 + Math.sin(a * 3) * 60 + Math.cos(a * 5) * 40;
      const x = cx + Math.cos(a) * rad * 1.4, y = cy + Math.sin(a) * rad * 0.8;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.strokePath();
    // Cities (small dots) — most going gray (burned).
    const cities: Array<[number, number]> = [];
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 260;
      cities.push([cx + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r * 0.7]);
    }
    for (const [x, y] of cities) {
      g.fillStyle(0x5a5550, 1); g.fillCircle(x, y, 5); // gray ruined city
      g.lineStyle(1, 0x3a3530, 0.8); g.strokeCircle(x, y, 7);
    }
    // Three conflict origins with red spreading rings + fire glyphs.
    const origins: Array<[number, number]> = [[cx - 220, cy - 40], [cx + 60, cy - 150], [cx + 200, cy + 110]];
    for (const [ox, oy] of origins) {
      for (let r = 30; r <= 150; r += 30) { g.lineStyle(3, 0xb83a2a, 0.4 - r / 500); g.strokeCircle(ox, oy, r); }
      g.fillStyle(0xc24a2a, 0.85); g.fillCircle(ox, oy, 10);
      g.fillStyle(0xffb347, 0.9); g.fillCircle(ox, oy, 4);
      // little jagged flames
      g.fillStyle(0xd9542a, 0.8);
      g.fillTriangle(ox - 8, oy + 6, ox, oy - 14, ox + 8, oy + 6);
    }
    // Red conflict lines tearing between origins.
    g.lineStyle(4, 0xb83a2a, 0.55);
    g.beginPath(); g.moveTo(origins[0][0], origins[0][1]); g.lineTo(origins[1][0], origins[1][1]); g.lineTo(origins[2][0], origins[2][1]); g.lineTo(origins[0][0], origins[0][1]); g.strokePath();
    this.vignette(g);
  }

  // 4 — THE RUINS: ruined wasteland, broken pillars, fog, amber vault glow.
  private panelRuins(g: Phaser.GameObjects.Graphics) {
    this.sky(g, [22, 22, 30], [44, 40, 40]);
    // Ground.
    g.fillStyle(0x2a2622, 1); g.fillRect(0, PANEL_H * 0.55, PANEL_W, PANEL_H * 0.45);
    g.fillStyle(0x332e28, 0.7); g.fillEllipse(PANEL_W / 2, PANEL_H * 0.58, PANEL_W * 1.2, 120);
    // Broken pillars at varying heights (snapped tops).
    const pillars = [120, 300, 520, 760, 980, 1100];
    for (let i = 0; i < pillars.length; i++) {
      const x = pillars[i];
      const h = 120 + (i % 3) * 70 + ((i * 53) % 60);
      const top = PANEL_H * 0.6 - h;
      g.fillStyle(0x4a443c, 1); g.fillRect(x, top, 44, h);
      g.fillStyle(0x5a534a, 1); g.fillRect(x, top, 14, h);     // lit edge
      g.fillStyle(0x383229, 1); g.fillRect(x + 30, top, 14, h); // shaded edge
      // snapped jagged top
      g.fillStyle(0x2a2622, 1);
      g.fillTriangle(x, top, x + 22, top - 10, x + 44, top + 6);
      // rubble at base
      g.fillStyle(0x3a352d, 1); g.fillEllipse(x + 22, PANEL_H * 0.6, 60, 18);
    }
    // Cracks underground glowing faint amber (the sealed vault).
    const vx = PANEL_W / 2, vy = PANEL_H * 0.82;
    g.fillStyle(0xffb347, 0.10); g.fillEllipse(vx, vy, 420, 140);
    g.fillStyle(0xffc864, 0.18); g.fillEllipse(vx, vy, 240, 80);
    g.lineStyle(4, 0xffcf6a, 0.7);
    // jagged crack lines radiating from the glow
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI + (i / 5) * Math.PI;
      let px = vx, py = vy;
      g.beginPath(); g.moveTo(px, py);
      for (let s = 0; s < 4; s++) { px += Math.cos(a) * 40 + (Math.random() - 0.5) * 30; py += Math.sin(a) * 18 - 12; g.lineTo(px, py); }
      g.strokePath();
    }
    g.fillStyle(0xfff0c0, 0.9); g.fillCircle(vx, vy, 6);
    // Fog: pale horizontal bands.
    for (let i = 0; i < 5; i++) { g.fillStyle(0x9aa0a8, 0.05); g.fillEllipse(Math.random() * PANEL_W, PANEL_H * 0.5 + i * 30, PANEL_W * 0.9, 40); }
    this.vignette(g);
  }

  // 5 — THE PRESENT: night continent; three faction lights + pulsing player dot.
  private panelPresent(g: Phaser.GameObjects.Graphics) {
    this.sky(g, [8, 10, 22], [16, 14, 28]);
    // Stars.
    for (let i = 0; i < 120; i++) { g.fillStyle(0xcfd8ff, Math.random() * 0.7 + 0.2); g.fillCircle(Math.random() * PANEL_W, Math.random() * PANEL_H * 0.6, Math.random() * 1.4); }
    // Continent silhouette (dark landmass).
    g.fillStyle(0x12161f, 1);
    g.beginPath();
    const cx = PANEL_W / 2, cy = PANEL_H * 0.62;
    const pts = 16;
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const rad = 230 + Math.sin(a * 4) * 50 + Math.cos(a * 2) * 60;
      const x = cx + Math.cos(a) * rad * 1.5, y = cy + Math.sin(a) * rad * 0.6;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.fillPath();
    g.lineStyle(2, 0x2a3550, 0.6);
    g.beginPath();
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const rad = 230 + Math.sin(a * 4) * 50 + Math.cos(a * 2) * 60;
      const x = cx + Math.cos(a) * rad * 1.5, y = cy + Math.sin(a) * rad * 0.6;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.strokePath();
    // Faction lights: red west, purple NE, yellow SE.
    const lights: Array<[number, number, number]> = [
      [cx - 300, cy + 10, 0xc0392b],   // red west
      [cx + 230, cy - 110, 0x8e44ad],  // purple NE
      [cx + 250, cy + 120, 0xe6c34a],  // yellow SE
    ];
    for (const [x, y, col] of lights) {
      g.fillStyle(col, 0.22); g.fillCircle(x, y, 60);
      g.fillStyle(col, 0.5); g.fillCircle(x, y, 24);
      g.fillStyle(col, 1); g.fillCircle(x, y, 8);
    }
    // Pulsing white player dot in the centre (the pulse is a tween below).
    g.fillStyle(0xffffff, 0.18); g.fillCircle(cx, cy, 50);
    g.fillStyle(0xffffff, 0.5); g.fillCircle(cx, cy, 20);
    const playerDot = this.add.circle(cx, cy, 9, 0xffffff, 1);
    this.panelLayer.add(playerDot);
    this.tweens.add({ targets: playerDot, scale: { from: 1, to: 2.2 }, alpha: { from: 0.9, to: 0.1 }, duration: 1400, repeat: -1, ease: 'Sine.easeOut' });
    this.vignette(g);
  }

  // 6 — YOUR ARRIVAL: ground-level ruined village, settlers, glowing figure, dawn.
  private panelArrival(g: Phaser.GameObjects.Graphics) {
    this.sky(g, [60, 50, 70], [255, 200, 120]); // dawn: violet to warm amber
    // Rising sun.
    g.fillStyle(0xffe7a0, 0.6); g.fillCircle(PANEL_W * 0.7, PANEL_H * 0.5, 110);
    g.fillStyle(0xfff3cf, 0.45); g.fillCircle(PANEL_W * 0.7, PANEL_H * 0.5, 60);
    // Ground.
    g.fillStyle(0x4a3b28, 1); g.fillRect(0, PANEL_H * 0.6, PANEL_W, PANEL_H * 0.4);
    g.fillStyle(0x5a4830, 0.6); g.fillEllipse(PANEL_W / 2, PANEL_H * 0.64, PANEL_W * 1.2, 100);
    // Ruined village: a couple of broken/half-built huts.
    const huts: Array<[number, number, number]> = [[230, PANEL_H * 0.6, 1], [430, PANEL_H * 0.62, 0.8], [900, PANEL_H * 0.6, 0.9]];
    for (const [hx, hy, s] of huts) {
      g.fillStyle(0x6a4f33, 1); g.fillRect(hx - 40 * s, hy - 60 * s, 80 * s, 60 * s);        // wall
      g.fillStyle(0x7a5c3c, 1); g.fillRect(hx - 40 * s, hy - 60 * s, 20 * s, 60 * s);        // lit edge
      g.fillStyle(0x3a2c1c, 1); g.fillRect(hx - 6 * s, hy - 30 * s, 16 * s, 30 * s);          // doorway
      // broken thatch roof (partial)
      g.fillStyle(0x8a6a3a, 1); g.fillTriangle(hx - 50 * s, hy - 60 * s, hx + 10 * s, hy - 100 * s, hx + 50 * s, hy - 60 * s);
    }
    // Settlers (small silhouettes) gathered, plus one taller glowing figure.
    const folk = [560, 600, 640, 680];
    for (const fx of folk) {
      g.fillStyle(0x241a12, 1); g.fillEllipse(fx, PANEL_H * 0.66, 14, 30); g.fillCircle(fx, PANEL_H * 0.62, 8);
    }
    // The leader: taller, with a warm aura.
    const lx = PANEL_W / 2 + 20, ly = PANEL_H * 0.66;
    g.fillStyle(0xffd98a, 0.22); g.fillCircle(lx, ly - 30, 60);
    g.fillStyle(0xffe9b0, 0.35); g.fillCircle(lx, ly - 30, 34);
    g.fillStyle(0x2a1f14, 1); g.fillEllipse(lx, ly - 6, 18, 46); g.fillCircle(lx, ly - 36, 11);
    g.fillStyle(0xffcf6a, 0.5); g.fillEllipse(lx, ly - 6, 18, 46); // rim light on figure
    // Birds rising into the dawn.
    g.lineStyle(2, 0x241a12, 0.8);
    for (let i = 0; i < 7; i++) {
      const bx = 600 + i * 60 + (i % 2) * 20, by = PANEL_H * 0.22 - i * 8;
      g.beginPath(); g.moveTo(bx - 8, by + 4); g.lineTo(bx, by); g.lineTo(bx + 8, by + 4); g.strokePath();
    }
    this.vignette(g);
  }

  // 7 — THE CALL: wide aerial — tiny warm village light, wilderness, distant
  // kingdom lights, faint vault glow, stars fading to dawn.
  private panelCall(g: Phaser.GameObjects.Graphics) {
    this.sky(g, [16, 18, 34], [120, 90, 90]); // night fading to pre-dawn at horizon
    // Fading stars in the upper sky.
    for (let i = 0; i < 90; i++) { g.fillStyle(0xcfd8ff, Math.random() * 0.5 + 0.1); g.fillCircle(Math.random() * PANEL_W, Math.random() * PANEL_H * 0.4, Math.random() * 1.2); }
    // Dawn band at horizon.
    g.fillStyle(0xffb86a, 0.18); g.fillRect(0, PANEL_H * 0.4, PANEL_W, PANEL_H * 0.16);
    // Aerial wilderness terrain — dark rolling hills as overlapping ellipses.
    const greens = [0x1c2a1c, 0x223322, 0x182418];
    for (let i = 0; i < 26; i++) {
      g.fillStyle(greens[i % 3], 1);
      g.fillEllipse(Math.random() * PANEL_W, PANEL_H * 0.55 + Math.random() * PANEL_H * 0.45, 180 + Math.random() * 160, 90 + Math.random() * 70);
    }
    // A faint river winding through.
    g.lineStyle(10, 0x2a3c52, 0.6);
    g.beginPath(); g.moveTo(120, PANEL_H * 0.6);
    g.lineTo(360, PANEL_H * 0.7); g.lineTo(620, PANEL_H * 0.66); g.lineTo(900, PANEL_H * 0.78); g.lineTo(1150, PANEL_H * 0.74);
    g.strokePath();
    // Distant faint kingdom lights near the edges.
    const distant: Array<[number, number, number]> = [[150, PANEL_H * 0.5, 0xc0392b], [1050, PANEL_H * 0.46, 0x8e44ad], [1080, PANEL_H * 0.7, 0xe6c34a]];
    for (const [x, y, col] of distant) { g.fillStyle(col, 0.18); g.fillCircle(x, y, 22); g.fillStyle(col, 0.6); g.fillCircle(x, y, 4); }
    // Barely-perceptible vault glow somewhere off-centre.
    g.fillStyle(0xffb347, 0.06); g.fillEllipse(PANEL_W * 0.4, PANEL_H * 0.85, 200, 70);
    g.fillStyle(0xffc864, 0.10); g.fillCircle(PANEL_W * 0.4, PANEL_H * 0.85, 5);
    // The tiny warm player village light, centred — the heart of the frame.
    const vx = PANEL_W / 2, vy = PANEL_H * 0.66;
    g.fillStyle(0xffcf6a, 0.20); g.fillCircle(vx, vy, 46);
    g.fillStyle(0xffe9b0, 0.5); g.fillCircle(vx, vy, 18);
    g.fillStyle(0xfff3cf, 1); g.fillCircle(vx, vy, 6);
    // A gentle pulse on the village light.
    const villageGlow = this.add.circle(vx, vy, 14, 0xffd98a, 0.5);
    this.panelLayer.add(villageGlow);
    this.tweens.add({ targets: villageGlow, scale: { from: 1, to: 2 }, alpha: { from: 0.5, to: 0.05 }, duration: 2000, repeat: -1, ease: 'Sine.easeOut' });
    this.vignette(g);
  }
}
