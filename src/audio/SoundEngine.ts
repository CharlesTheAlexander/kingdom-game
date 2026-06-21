// SoundEngine.js — (Polish Phase 2) fully procedural sound effects via the Web
// Audio API. No audio files: every sound is synthesised from oscillators and
// filtered noise, so it ships with zero assets and works everywhere.
//
// A single shared instance (exported `sfx`) is used by every scene/system so
// there is one AudioContext and one master volume. Call sfx.unlock() from a user
// gesture (browsers start the context suspended), then sfx.play('<event>').

const NOTE = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25, E5: 659.25, G5: 783.99 };

// Per-category mix levels (UI quiet, combat punchy, fanfares loud).
const UI = 0.3, COMBAT = 0.5, WORLD = 0.4, BIG = 0.7;

class SoundEngine {
  ctx: AudioContext | null;
  master: GainNode | null;
  volume: number;
  muted: boolean;
  _ambients: Record<string, { stop: () => void }>;
  _last?: Record<string, number>;

  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.6;     // 0..1 user volume
    this.muted = false;
    this._ambients = {};   // name -> { stop() }
  }

  _ensure(): boolean {
    if (this.ctx) return true;
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
    return true;
  }

  // Call from a user gesture to satisfy the browser autoplay policy.
  unlock() {
    if (!this._ensure()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _applyMaster() {
    if (!this.master) return;
    const v = this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }
  setVolume(v: number) { this.volume = Math.max(0, Math.min(1, v)); this._applyMaster(); }
  toggleMute(): boolean { this.muted = !this.muted; this._applyMaster(); return this.muted; }

  // --- synthesis primitives ------------------------------------------------

  // A single oscillator note with a fast-attack / exponential-decay envelope.
  tone(freq: number, dur: number, { type = 'sine', vol = 0.3, when = 0, slideTo = null, attack = 0.005 }: any = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // A burst of filtered white noise (for clangs, whooshes, drums, growls).
  noise(dur: number, { vol = 0.3, when = 0, type = 'highpass', freq = 1000, sweepTo = null }: any = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const n = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t0);
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  arp(freqs: number[], noteDur: number, { type = 'triangle', vol = 0.3, gap = null }: any = {}) {
    const step = gap || noteDur * 0.6;
    freqs.forEach((f, i) => this.tone(f, noteDur, { type, vol, when: i * step }));
  }

  // --- event dispatcher ----------------------------------------------------

  play(event: string) {
    if (!this.ctx || this.muted) return;
    switch (event) {
      // UI (0.3)
      case 'ui_click': case 'button_click': this.tone(800, 0.05, { vol: UI }); break;
      case 'building_select': case 'unit_select': this.tone(600, 0.09, { vol: UI }); break;
      case 'unit_command': this.tone(520, 0.05, { vol: UI }); break;
      case 'building_placed': case 'building_place':
        this.tone(150, 0.12, { type: 'sine', vol: 0.45 });
        this.noise(0.08, { vol: 0.25, type: 'lowpass', freq: 400 });
        break;
      case 'upgrade_complete': this.arp([NOTE.C4, NOTE.E4, NOTE.G4], 0.16, { vol: UI, gap: 0.09 }); break;
      case 'tier_upgrade': this.arp([NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5], 0.5, { type: 'sawtooth', vol: BIG, gap: 0.07 }); break;
      case 'unit_trained': this.arp([NOTE.E4, NOTE.A4], 0.12, { vol: UI, gap: 0.07 }); break;
      case 'expedition_return': this.arp([NOTE.G4, NOTE.C5], 0.16, { vol: WORLD, gap: 0.09 }); break;

      // Combat (0.5)
      case 'sword_hit':
        this.tone(400, 0.08, { type: 'sawtooth', vol: COMBAT, slideTo: 200 });
        this.noise(0.06, { vol: 0.35, type: 'highpass', freq: 2200 });
        break;
      case 'arrow_shoot': this.noise(0.07, { vol: COMBAT, type: 'bandpass', freq: 3000, sweepTo: 600 }); break;
      case 'soldier_dies': case 'unit_death': this.tone(160, 0.12, { type: 'sine', vol: COMBAT, slideTo: 60 }); break;
      case 'enemy_dies': this.tone(200, 0.1, { type: 'square', vol: 0.4, slideTo: 80 }); break;
      case 'battle_start':
        this.tone(80, 0.2, { type: 'sine', vol: 0.6 });
        this.noise(0.2, { vol: 0.2, type: 'lowpass', freq: 200 });
        break;
      case 'victory': this.arp([NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5, NOTE.E5], 0.3, { type: 'triangle', vol: BIG, gap: 0.12 }); break;
      case 'defeat': this.arp([NOTE.G4, NOTE.E4, NOTE.D4, NOTE.C4, 220], 0.3, { type: 'sawtooth', vol: BIG, gap: 0.12 }); break;

      // World (0.4)
      case 'resource_collected': case 'resource_collect': this.tone(1000, 0.06, { vol: 0.35 }); break;
      case 'day_start':
        this.tone(440, 0.25, { type: 'sine', vol: WORLD });
        this.tone(880, 0.25, { type: 'sine', vol: 0.15 });
        break;
      case 'enemy_attack_warning': case 'wave_start': this.tone(120, 0.4, { type: 'sawtooth', vol: 0.45, slideTo: 90 }); break;
      case 'wolf_spawn':
        this.tone(90, 0.3, { type: 'sawtooth', vol: 0.35, slideTo: 60 });
        this.noise(0.3, { vol: 0.2, type: 'lowpass', freq: 300 });
        break;
      case 'goblin_raid': for (let i = 0; i < 4; i++) this.noise(0.05, { vol: 0.35, type: 'bandpass', freq: 500, when: i * 0.06 }); break;
      case 'building_destroyed':
        this.tone(120, 0.25, { type: 'sine', vol: 0.5, slideTo: 40 });
        this.noise(0.25, { vol: 0.35, type: 'lowpass', freq: 600 });
        break;

      // (V2 Phase 4, improvement #8) Sounds for the new systems.
      case 'council_chord': // Great Council entry — a grand sustained organ chord.
        this.tone(NOTE.C4, 0.9, { type: 'triangle', vol: 0.45 });
        this.tone(NOTE.E4, 0.9, { type: 'triangle', vol: 0.3 });
        this.tone(NOTE.G4, 0.9, { type: 'triangle', vol: 0.3 });
        this.tone(NOTE.C5, 0.9, { type: 'sine', vol: 0.2, when: 0.05 });
        break;
      case 'hero_join': // a bright rising fanfare
        this.arp([NOTE.G4, NOTE.C5, NOTE.E5, NOTE.G5], 0.18, { type: 'triangle', vol: BIG, gap: 0.08 });
        break;
      case 'hero_death': // a somber descending tone
        this.arp([NOTE.E4, NOTE.C4, 220, 174.61], 0.34, { type: 'sine', vol: 0.5, gap: 0.16 });
        break;
      case 'dragon_roar': // a massive low growl
        this.tone(70, 0.7, { type: 'sawtooth', vol: 0.6, slideTo: 38 });
        this.noise(0.7, { vol: 0.4, type: 'lowpass', freq: 220 });
        break;
      case 'cavalry_charge': // thundering hooves
        for (let i = 0; i < 8; i++) this.noise(0.06, { vol: 0.3, type: 'lowpass', freq: 180, when: i * 0.08 });
        this.tone(90, 0.5, { type: 'sine', vol: 0.3, slideTo: 70 });
        break;
      case 'battle_cry': // a rallying shout
        this.tone(220, 0.3, { type: 'sawtooth', vol: 0.5, slideTo: 360 });
        this.noise(0.3, { vol: 0.25, type: 'bandpass', freq: 900 });
        break;
      case 'spy_mission': // subtle intrigue
        this.tone(660, 0.1, { type: 'sine', vol: 0.22 });
        this.tone(440, 0.16, { type: 'sine', vol: 0.2, when: 0.12 });
        break;
      case 'building_fire': // a crackle
        for (let i = 0; i < 5; i++) this.noise(0.04, { vol: 0.22, type: 'highpass', freq: 2600, when: i * 0.05 });
        break;
      default: break;
    }
  }

  // Like play(), but ignores repeats of the same event within `ms` so a clash of
  // many units doesn't stack into a roar.
  playThrottled(event: string, ms = 110) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime * 1000;
    this._last = this._last || {};
    if (this._last[event] && now - this._last[event] < ms) return;
    this._last[event] = now;
    this.play(event);
  }

  // --- looping ambient beds (Phase 4 weather) ------------------------------

  startAmbient(name: string, kind: string, vol = 0.1) {
    if (!this.ctx || this._ambients[name]) return;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(vol, this.ctx.currentTime, 2); // gentle fade-in (Audit FIX 7: per-ambient volume)
    g.connect(this.master);
    let node: any;
    if (kind === 'wind') {
      // Low-passed brown-ish noise with a slow wandering filter = wind.
      const n = Math.floor(this.ctx.sampleRate * 2);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const filt = this.ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 500;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.08;
      const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 250;
      lfo.connect(lfoGain).connect(filt.frequency); lfo.start();
      src.connect(filt).connect(g); src.start();
      node = { src, lfo };
    } else { // rain
      const n = Math.floor(this.ctx.sampleRate * 1.5);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const filt = this.ctx.createBiquadFilter(); filt.type = 'highpass'; filt.frequency.value = 1800;
      src.connect(filt).connect(g); src.start();
      node = { src };
    }
    this._ambients[name] = {
      stop: () => {
        g.gain.setTargetAtTime(0, this.ctx.currentTime, 1.2);
        setTimeout(() => { try { node.src.stop(); if (node.lfo) node.lfo.stop(); } catch (e) {} }, 2000);
      },
    };
  }

  stopAmbient(name: string) {
    const a = this._ambients[name];
    if (a) { a.stop(); delete this._ambients[name]; }
  }
}

export const sfx = new SoundEngine();
