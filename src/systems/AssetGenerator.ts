// AssetGenerator.ts — procedural, asset-pack-free art.
//
// Every sprite/tile in the game is drawn here at runtime with Phaser Graphics and
// baked into a texture via generateTexture(). We generate INTO the texture keys
// the game already uses ("reskin in place"), so the isometric projection, the
// terrain Blitter atlas, the building auto-scale (origin 0.5,1.0) and the unit
// animation spritesheets all keep working untouched — only the pixels change.
//
// Geometry note: the iso projection uses HW=32, HH=16, and each terrain Bob is a
// 64x64 frame placed at tileTopLeft. tileCenter = tileTopLeft + (32,16), so a
// tile's diamond TOP face is centred at texture pixel (32,16):
//     top (32,0) · right (64,16) · bottom (32,32) · left (0,16)
// with darker "wall" side faces below it for the stacked-floor depth illusion.

// ---- colour helpers --------------------------------------------------------
function scale(color: number, f: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((color >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((color >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((color & 255) * f)));
  return (r << 16) | (g << 8) | b;
}
const darken = (c: number, frac: number) => scale(c, 1 - frac);
const lighten = (c: number, frac: number) => scale(c, 1 + frac);

// Linear blend between two packed RGB colours (t in 0..1).
function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

// Northgard warm light/shadow constants (light source = top-left).
const WARM_LIGHT = 0xfff5e0;
const WARM_SHADOW = 0x2a1f0f;

// Top-face diamond outline (for fills) and a slightly inset version (for detail).
const TOP = [{ x: 32, y: 0 }, { x: 64, y: 16 }, { x: 32, y: 32 }, { x: 0, y: 16 }];
// Is (x,y) inside the top diamond (optionally inset) — keeps detail off the faces.
function inTop(x: number, y: number, inset = 0.9): boolean {
  return Math.abs(x - 32) / 32 + Math.abs(y - 16) / 16 <= inset;
}

// Seedable PRNG so each variant index gets a stable-but-distinct texture layout.
function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Scatter n dots of radius r inside the top face.
function dots(g: any, color: number, n: number, r: number, alpha = 1) {
  g.fillStyle(color, alpha);
  let placed = 0, guard = 0;
  while (placed < n && guard++ < 200) {
    const x = 4 + Math.random() * 56, y = 2 + Math.random() * 28;
    if (!inTop(x, y, 0.82)) continue;
    g.fillCircle(x, y, r);
    placed++;
  }
}

// Scatter n dots using a supplied PRNG so layouts are deterministic per variant.
function dotsR(g: any, R: () => number, color: number, n: number, r: number, alpha = 1, inset = 0.82) {
  g.fillStyle(color, alpha);
  let placed = 0, guard = 0;
  while (placed < n && guard++ < 300) {
    const x = 4 + R() * 56, y = 2 + R() * 28;
    if (!inTop(x, y, inset)) continue;
    g.fillCircle(x, y, r);
    placed++;
  }
}

// Warm diagonal gradient across the top face: lit toward the top-left corner,
// shaded toward the bottom-right, built from stacked translucent diamond bands.
function gradientTop(g: any, base: number, lit = 0.22, shade = 0.18, bands = 6) {
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    const k = 32 * t;                              // band offset toward centre
    // Lit wedge sweeping in from the top-left edge.
    g.fillStyle(mix(lighten(base, lit), base, t), 0.45);
    g.fillPoints([{ x: 0 + k, y: 16 }, { x: 32, y: 0 + k * 0.5 }, { x: 32, y: 16 }], true);
    g.fillPoints([{ x: 0 + k, y: 16 }, { x: 32, y: 32 - k * 0.5 }, { x: 32, y: 16 }], true);
    // Shaded wedge sweeping in from the bottom-right edge.
    g.fillStyle(mix(darken(base, shade), base, t), 0.45);
    g.fillPoints([{ x: 64 - k, y: 16 }, { x: 32, y: 0 + k * 0.5 }, { x: 32, y: 16 }], true);
    g.fillPoints([{ x: 64 - k, y: 16 }, { x: 32, y: 32 - k * 0.5 }, { x: 32, y: 16 }], true);
  }
}

// Soft warm centre crown + cool bottom-right ambient occlusion. Call AFTER detail
// so it unifies the tile into a slightly domed, painted top face.
function topShading(g: any, base: number) {
  g.fillStyle(mix(WARM_LIGHT, lighten(base, 0.2), 0.5), 0.22);
  g.fillEllipse(28, 14, 30, 15);
  g.fillStyle(mix(WARM_LIGHT, lighten(base, 0.3), 0.4), 0.16);
  g.fillEllipse(26, 13, 16, 8);
  // Cool AO hugging the lower-right rim.
  g.fillStyle(mix(WARM_SHADOW, base, 0.5), 0.18);
  g.fillPoints([{ x: 64, y: 16 }, { x: 32, y: 32 }, { x: 38, y: 18 }], true);
}

// Soft outer-rim treatment so adjacent same-biome tiles read seamlessly: a faint
// warm highlight on the lit edges and a feathered base line on the lower edges,
// instead of a hard outline.
function rimFade(g: any, base: number) {
  g.lineStyle(1.5, mix(base, WARM_LIGHT, 0.32), 0.28);
  g.beginPath(); g.moveTo(1, 16); g.lineTo(32, 1); g.lineTo(63, 16); g.strokePath();
  g.lineStyle(2, base, 0.5);
  g.beginPath(); g.moveTo(2, 16); g.lineTo(32, 31); g.lineTo(62, 16); g.strokePath();
}

// ---- core tile builder -----------------------------------------------------
// base = top colour; detail(g, R) draws biome texture on the top face using the
// supplied seeded PRNG R (so variants differ deterministically).
function makeTile(scene: any, key: string, base: number, detail?: (g: any, R: () => number) => void, seed = 0) {
  if (scene.textures.exists(key)) return; // generate once; textures persist across scene.restart
  const R = rng(seed || (key.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0)));
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  const D = 16; // side-face depth (matches the HH row step so faces tile cleanly)
  // Side faces first (top face overlaps their upper edge). Warm-shaded so the
  // stacked-floor "walls" sit in cool shadow against the lit top.
  g.fillStyle(mix(darken(base, 0.34), WARM_SHADOW, 0.18), 1);
  g.fillPoints([{ x: 0, y: 16 }, { x: 32, y: 32 }, { x: 32, y: 32 + D }, { x: 0, y: 16 + D }], true);
  g.fillStyle(mix(darken(base, 0.22), WARM_SHADOW, 0.1), 1);
  g.fillPoints([{ x: 32, y: 32 }, { x: 64, y: 16 }, { x: 64, y: 16 + D }, { x: 32, y: 32 + D }], true);
  // Faint vertical strata streaks on the side faces.
  g.lineStyle(1, darken(base, 0.42), 0.35);
  for (const sx of [10, 22, 44, 56]) { g.beginPath(); g.moveTo(sx, 22); g.lineTo(sx, 22 + D); g.strokePath(); }
  // Top face: solid base, then warm diagonal gradient.
  g.fillStyle(base, 1);
  g.fillPoints(TOP, true);
  gradientTop(g, base);
  if (detail) detail(g, R);
  topShading(g, base);
  rimFade(g, base);
  g.generateTexture(key, 64, 64);
  g.destroy();
}

// ---- terrain decoration helpers --------------------------------------------
// Each draws biome-specific surface detail on the top face. They take the shared
// graphics object and a seeded PRNG so variants are deterministic and distinct.

// A clump of upright grass blades fanning from a base point.
function grassBlade(g: any, x: number, y: number, color: number, h: number, R: () => number) {
  g.lineStyle(1, color, 0.85);
  for (let b = 0; b < 3; b++) {
    const dx = (b - 1) * 1.6 + (R() - 0.5) * 1.2;
    g.beginPath(); g.moveTo(x + (b - 1) * 1.2, y); g.lineTo(x + dx, y - h - R() * 2); g.strokePath();
  }
}

// Grass: warm green base + many small darker/lighter blade clusters + the odd
// flower or mushroom on flowered/variant tiles.
function decoGrass(g: any, R: () => number, base: number, opt: { flowers?: boolean; mushrooms?: boolean } = {}) {
  // Mottled patches of lighter/darker grass.
  dotsR(g, R, mix(base, WARM_LIGHT, 0.18), 5, 2.4, 0.22);
  dotsR(g, R, darken(base, 0.2), 5, 2.2, 0.22);
  // Blade clusters.
  const dark = darken(base, 0.28), lite = lighten(base, 0.3);
  for (let i = 0; i < 9; i++) {
    const x = 8 + R() * 48, y = 6 + R() * 22;
    if (!inTop(x, y, 0.78)) continue;
    grassBlade(g, x, y, R() < 0.5 ? dark : lite, 2.5 + R() * 2, R);
  }
  if (opt.flowers) {
    for (let i = 0; i < 3; i++) {
      const x = 12 + R() * 40, y = 8 + R() * 16;
      if (!inTop(x, y, 0.7)) continue;
      const petal = R() < 0.5 ? 0xf2ede0 : 0xe6b8d8;
      g.fillStyle(petal, 1); g.fillCircle(x, y, 1.6);
      g.fillStyle(0xe8c84a, 1); g.fillCircle(x, y, 0.8);
    }
  }
  if (opt.mushrooms) {
    for (let i = 0; i < 2; i++) {
      const x = 16 + R() * 32, y = 12 + R() * 12;
      if (!inTop(x, y, 0.65)) continue;
      g.fillStyle(0xe8e0d0, 1); g.fillRect(x - 0.5, y, 1.4, 2.5);          // stalk
      g.fillStyle(0xa8442e, 1); g.fillEllipse(x, y, 3.2, 1.8);            // red cap
      g.fillStyle(0xf2ede0, 1); g.fillCircle(x - 0.8, y - 0.2, 0.4); g.fillCircle(x + 0.9, y, 0.4); // spots
    }
  }
}

// Forest floor: dark earthy base + moss patches, fallen leaves, twigs/roots.
function decoForest(g: any, R: () => number, base: number) {
  // Moss in lighter greens, soil shadows in darker.
  dotsR(g, R, mix(base, 0x3a6a28, 0.6), 4, 3.0, 0.28);
  dotsR(g, R, darken(base, 0.4), 4, 2.6, 0.28);
  // Roots / twigs (short brown strokes).
  g.lineStyle(1.4, 0x4a3018, 0.7);
  for (let i = 0; i < 3; i++) {
    const x = 10 + R() * 40, y = 8 + R() * 18;
    if (!inTop(x, y, 0.72)) continue;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() * 8 - 4), y + (R() * 4 - 2)); g.strokePath();
  }
  // Fallen leaves — small warm ellipses, occasional gold.
  const leaf = [0x6b4423, 0x8a5a2a, 0xa8702a, 0xb8842e];
  for (let i = 0; i < 8; i++) {
    const x = 8 + R() * 48, y = 4 + R() * 24;
    if (!inTop(x, y, 0.78)) continue;
    g.fillStyle(leaf[(R() * leaf.length) | 0], 0.92);
    g.fillEllipse(x, y, 2.2 + R() * 1.2, 1.3);
  }
  // A few moss-green specks for life.
  dotsR(g, R, 0x5a8a3a, 3, 1.0, 0.7);
}

// Mountain/stone: cobblestone polygon paving + mortar seams + cracks + lichen.
function decoStone(g: any, R: () => number, base: number, opt: { cracks?: boolean; boulders?: boolean } = {}) {
  // Cobblestone cells: irregular quads tiled across the diamond, each shaded.
  for (let gy = 2; gy < 30; gy += 6) {
    for (let gx = 6; gx < 58; gx += 8) {
      const cx = gx + (R() - 0.5) * 3, cy = gy + (R() - 0.5) * 2.5;
      if (!inTop(cx, cy, 0.72)) continue;
      const w = 4.5 + R() * 2, h = 2.6 + R() * 1.4;
      const tone = mix(base, R() < 0.5 ? WARM_LIGHT : WARM_SHADOW, 0.12 + R() * 0.12);
      g.fillStyle(tone, 0.9);
      g.fillPoints([
        { x: cx - w, y: cy }, { x: cx - w * 0.4, y: cy - h }, { x: cx + w * 0.6, y: cy - h * 0.7 },
        { x: cx + w, y: cy + h * 0.3 }, { x: cx, y: cy + h },
      ], true);
      // Lit top edge of each cobble.
      g.lineStyle(0.8, lighten(tone, 0.25), 0.5);
      g.beginPath(); g.moveTo(cx - w, cy); g.lineTo(cx - w * 0.4, cy - h); g.strokePath();
    }
  }
  if (opt.cracks) {
    g.lineStyle(1, darken(base, 0.45), 0.7);
    for (let i = 0; i < 2; i++) {
      let x = 12 + R() * 16, y = 6 + R() * 6;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 3; s++) { x += 6 + R() * 6; y += R() * 6 - 1; if (inTop(x, y, 0.7)) g.lineTo(x, y); }
      g.strokePath();
    }
  }
  if (opt.boulders) {
    g.fillStyle(darken(base, 0.16), 1); g.fillEllipse(26, 15, 13, 7); g.fillEllipse(40, 12, 9, 5);
    g.fillStyle(mix(lighten(base, 0.22), WARM_LIGHT, 0.3), 0.7); g.fillEllipse(23, 13, 6, 2.6);
  }
  // Lichen + pebbles.
  dotsR(g, R, 0x8a9a5a, 3, 1.2, 0.55);
  dotsR(g, R, lighten(base, 0.18), 4, 0.9, 0.6);
}

// Water: deep base + lighter inner pool, ripple lines, drifting light reflections
// and a foam-touched edge. off shifts ripple phase between the 3 variants.
function decoWater(g: any, R: () => number, base: number, off: number) {
  const lite = lighten(base, 0.2), hi = 0x6abaff;
  // Lighter inner pool (depth illusion).
  g.fillStyle(lite, 0.45); g.fillPoints([{ x: 32, y: 4 }, { x: 56, y: 16 }, { x: 32, y: 28 }, { x: 8, y: 16 }], true);
  g.fillStyle(mix(lite, hi, 0.3), 0.3); g.fillPoints([{ x: 32, y: 8 }, { x: 48, y: 16 }, { x: 32, y: 24 }, { x: 16, y: 16 }], true);
  // Ripple lines — gentle parallel diamonds, phase-shifted by off.
  g.lineStyle(1.3, mix(lite, hi, 0.5), 0.6);
  for (const yy of [9 + off, 15 + off, 21 + off]) {
    const y = ((yy - 4) % 22) + 6;
    g.beginPath(); g.moveTo(12, y); g.lineTo(26, y - 1.5); g.strokePath();
    g.beginPath(); g.moveTo(34, y + 2); g.lineTo(52, y + 0.5); g.strokePath();
  }
  // Drifting bright light reflections (sun glints).
  g.fillStyle(mix(hi, WARM_LIGHT, 0.4), 0.55);
  for (let i = 0; i < 3; i++) {
    const x = 14 + ((off * 3 + i * 18) % 38), y = 10 + ((off * 2 + i * 7) % 14);
    if (!inTop(x, y, 0.6)) continue;
    g.fillEllipse(x, y, 2.6, 1.0);
  }
  // Foam edge along the upper rim.
  g.fillStyle(0xdfeefb, 0.4);
  g.fillPoints([{ x: 0, y: 16 }, { x: 32, y: 0 }, { x: 32, y: 2.5 }, { x: 4, y: 16 }], true);
}

// Sand: warm dune base + wind ripple lines + scattered pebbles + grain mottle.
function decoSand(g: any, R: () => number, base: number) {
  dotsR(g, R, mix(base, WARM_LIGHT, 0.2), 6, 2.2, 0.24);
  dotsR(g, R, darken(base, 0.14), 5, 2.0, 0.24);
  // Wind ripples — long shallow curves following the iso flow.
  g.lineStyle(1, darken(base, 0.18), 0.5);
  for (let i = 0; i < 4; i++) {
    const y = 8 + i * 4 + (R() * 2 - 1);
    g.beginPath(); g.moveTo(8 + R() * 4, y + 1.5); g.lineTo(32, y); g.lineTo(56 - R() * 4, y + 1.5); g.strokePath();
  }
  // Pebbles.
  dotsR(g, R, 0x9a8050, 4, 1.1, 0.8);
  dotsR(g, R, lighten(base, 0.22), 4, 0.8, 0.7);
}

// Snow: cool-warm white base + soft bumps + frozen blue cracks + sparkles.
function decoSnow(g: any, R: () => number, base: number) {
  // Soft bumps (drifts) — alternating warm-lit and cool-shaded.
  for (let i = 0; i < 5; i++) {
    const x = 10 + R() * 44, y = 6 + R() * 20;
    if (!inTop(x, y, 0.7)) continue;
    g.fillStyle(mix(base, WARM_LIGHT, 0.6), 0.5); g.fillEllipse(x, y, 5, 2.6);
    g.fillStyle(mix(base, 0x9aa8c8, 0.5), 0.3); g.fillEllipse(x + 1.5, y + 1.5, 4, 2.0);
  }
  // Frozen cracks (pale blue).
  g.lineStyle(1, 0xaecbe8, 0.6);
  let x = 14 + R() * 12, y = 8 + R() * 6;
  g.beginPath(); g.moveTo(x, y);
  for (let s = 0; s < 4; s++) { x += 6 + R() * 5; y += R() * 5 - 1; if (inTop(x, y, 0.7)) g.lineTo(x, y); }
  g.strokePath();
  // Sparkles.
  g.fillStyle(0xffffff, 0.9);
  for (let i = 0; i < 5; i++) { const sx = 8 + R() * 48, sy = 4 + R() * 24; if (inTop(sx, sy, 0.7)) g.fillCircle(sx, sy, 0.7); }
}

// Swamp: murky green-brown base + dark water patches + lily pads + reeds.
function decoSwamp(g: any, R: () => number, base: number) {
  // Murky patches (darker pools + lighter algae scum).
  dotsR(g, R, darken(base, 0.32), 4, 3.4, 0.4);
  dotsR(g, R, mix(base, 0x6a8a3a, 0.5), 4, 2.6, 0.35);
  // Lily pads — flat green discs with a notch and a tiny flower.
  for (let i = 0; i < 3; i++) {
    const x = 14 + R() * 36, y = 8 + R() * 16;
    if (!inTop(x, y, 0.65)) continue;
    g.fillStyle(0x4a7a3a, 0.95); g.fillEllipse(x, y, 4, 2.2);
    g.fillStyle(lighten(0x4a7a3a, 0.2), 0.7); g.fillEllipse(x - 0.8, y - 0.4, 2, 1.1);
    if (R() < 0.5) { g.fillStyle(0xe8d8e8, 1); g.fillCircle(x + 1, y - 0.5, 0.9); }
  }
  // Reeds poking up.
  g.lineStyle(1, 0x6a6a2a, 0.7);
  for (let i = 0; i < 3; i++) {
    const x = 12 + R() * 40, y = 18 + R() * 8;
    if (!inTop(x, y, 0.7)) continue;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 2, y - 5 - R() * 3); g.strokePath();
  }
  // Bubbles / specks.
  dotsR(g, R, 0x2a3a1a, 4, 0.8, 0.6);
}

// ---- PHASE 1: terrain ------------------------------------------------------
// Richly re-textured terrain: every tile gets a warm gradient base, biome surface
// detail, a lit-centre / shaded-edge dome and a feathered rim. All original
// iso_* keys, the 64x64 frame and the (32,16)-centred diamond geometry are kept so
// the isometric Blitter atlas keeps working untouched.
export function generateTerrain(scene: any) {
  // ---- Grass: warm bright base + two darker variant + a flowered/mushroom one.
  const GRASS = 0x4a7c3f, GRASS_D = 0x3d6b34;
  makeTile(scene, 'iso_grass', GRASS, (g, R) => decoGrass(g, R, GRASS), 11);
  makeTile(scene, 'iso_grass2', GRASS_D, (g, R) => decoGrass(g, R, GRASS_D), 22);
  makeTile(scene, 'iso_grass3', GRASS, (g, R) => decoGrass(g, R, GRASS, { flowers: true, mushrooms: true }), 33);

  // ---- Water: deep #2a5a8a base; 3 phase-shifted shimmer variants (river/sea
  // reads as moving water — the scene assigns these randomly per tile).
  const WATER = 0x2a5a8a;
  makeTile(scene, 'iso_water', WATER, (g, R) => decoWater(g, R, WATER, 0), 101);
  makeTile(scene, 'iso_water2', WATER, (g, R) => decoWater(g, R, WATER, 4), 102);
  makeTile(scene, 'iso_water3', WATER, (g, R) => decoWater(g, R, WATER, 8), 103);

  // ---- Rocky boulder tile (warm stone, cobbles + boulders + lichen).
  const ROCK = 0x8a7a6a;
  makeTile(scene, 'iso_rock', ROCK, (g, R) => decoStone(g, R, ROCK, { boulders: true }), 201);

  // ---- Mountain rock (cooler dark stone, cobbles + cracks).
  const MTN = 0x6a6258;
  makeTile(scene, 'iso_mtn', MTN, (g, R) => decoStone(g, R, MTN, { cracks: true }), 202);

  // ---- Forest floor (dark earth + moss, leaves, roots). 8 deterministic variants.
  const FOREST = 0x244012;
  for (let i = 1; i <= 8; i++) makeTile(scene, `iso_forest${i}`, FOREST, (g, R) => decoForest(g, R, FOREST), 300 + i);

  // ---- Extra standalone tiles (generated + available; not in the current roll).
  const DIRT = 0x6b4423;
  makeTile(scene, 'iso_dirt', DIRT, (g, R) => {
    dotsR(g, R, darken(DIRT, 0.2), 5, 2.2, 0.26); dotsR(g, R, lighten(DIRT, 0.18), 4, 1.6, 0.26);
    g.lineStyle(1, lighten(DIRT, 0.22), 0.45); for (const y of [12, 18]) { g.beginPath(); g.moveTo(12, y); g.lineTo(28, y - 2); g.strokePath(); g.beginPath(); g.moveTo(36, y + 2); g.lineTo(52, y); g.strokePath(); }
    dotsR(g, R, 0x4a3018, 4, 1.0, 0.6); // small stones/clods
  }, 401);
  const PATH = 0x8a7a6a;
  makeTile(scene, 'iso_path', PATH, (g, R) => decoStone(g, R, PATH), 402);
  const SAND = 0xc4a35a;
  makeTile(scene, 'iso_sand', SAND, (g, R) => decoSand(g, R, SAND), 403);
  const SNOW = 0xe8eaf0;
  makeTile(scene, 'iso_snow', SNOW, (g, R) => decoSnow(g, R, SNOW), 404);
  const SWAMP = 0x4a5a32;
  makeTile(scene, 'iso_swamp', SWAMP, (g, R) => decoSwamp(g, R, SWAMP), 405);
}

// ---- building drawing primitives -------------------------------------------
// All buildings are drawn in a 64x64 canvas with the structure's BASE at the
// bottom-centre (≈ x32, y60), because the scene anchors building sprites at
// origin (0.5, 1.0) on the tile's south corner and scales them by footprint
// (×1 / ×1.5 / ×2). Matching the originals' 64px size keeps placement identical.
// Warm Northgard stone/timber palette (not gray — stone leans warm #8a7a6a).
const STONE = 0x8f7f6c, STONE_M = 0x73654f, STONE_D = 0x564a39;
const WOOD = 0x9a6a44, BEAM = 0x4f3018, DOOR = 0x3c2814;
const THATCH = 0xc2a45a, ROOF = 0x6a4a36, GLOW = 0xffcf5a;
// Per-skin override (set by makeBuilding for AI factions). Building draw fns read
// the *_C constants so a single accent can battle-worn / ornate / crude the stone.
let STONE_C = STONE, STONE_MC = STONE_M, STONE_DC = STONE_D, ROOF_C = ROOF, WOOD_C = WOOD;

// Pseudo-3D box: lit top lip + flat front (warm vertical gradient) + dark right
// edge + a faint AO foot where it meets the ground. The Northgard "block".
function box(g: any, x: number, y: number, w: number, h: number, base: number) {
  // body with a top-to-bottom warm shade so walls feel rounded/lit from above
  g.fillStyle(base, 1); g.fillRect(x, y, w, h);
  g.fillStyle(mix(base, WARM_SHADOW, 0.22), 0.5); g.fillRect(x, y + h * 0.55, w, h * 0.45);
  g.fillStyle(darken(base, 0.3), 1); g.fillRect(x + w - 3, y, 3, h);              // right shadow face
  g.fillStyle(mix(lighten(base, 0.22), WARM_LIGHT, 0.3), 1); g.fillRect(x, y, w, 2); // lit top lip
  g.fillStyle(mix(WARM_SHADOW, base, 0.4), 0.3); g.fillRect(x, y + h - 2, w, 2);  // base AO
}
// Mortar courses + a couple of cracks across a wall rect — stone texture.
function masonry(g: any, x: number, y: number, w: number, h: number, base: number, step = 5) {
  g.lineStyle(1, darken(base, 0.34), 0.55);
  let row = 0;
  for (let cy = y + step; cy < y + h - 1; cy += step) { g.beginPath(); g.moveTo(x, cy); g.lineTo(x + w - 3, cy); g.strokePath(); row++; }
  // staggered vertical seams
  g.lineStyle(1, darken(base, 0.3), 0.4);
  row = 0;
  for (let cy = y; cy < y + h - 2; cy += step) {
    const off = (row % 2) * (step * 0.9);
    for (let cx = x + 2 + off; cx < x + w - 3; cx += step * 1.8) { g.beginPath(); g.moveTo(cx, cy + 1); g.lineTo(cx, Math.min(y + h - 1, cy + step)); g.strokePath(); }
    row++;
  }
  // a faint lit highlight on a few stones (top-left light)
  g.fillStyle(mix(lighten(base, 0.2), WARM_LIGHT, 0.4), 0.18); g.fillRect(x + 1, y + 1, w * 0.4, step * 0.7);
}
// Wood-grain streaks + a knot on a timber rect.
function grain(g: any, x: number, y: number, w: number, h: number, base: number) {
  g.lineStyle(1, darken(base, 0.28), 0.4);
  for (let cy = y + 2; cy < y + h - 1; cy += 3) { g.beginPath(); g.moveTo(x + 1, cy); g.lineTo(x + w - 4, cy + (((cy / 3) | 0) % 2 ? 0.6 : -0.6)); g.strokePath(); }
  g.fillStyle(darken(base, 0.4), 0.6); g.fillCircle(x + w * 0.6, y + h * 0.45, 1); // knot
}
// A pitched gable roof (filled triangle) with a lit left slope, shaded right
// slope, ridge line and an eave shadow under it. apexY above baseY.
function gableRoof(g: any, lx: number, rx: number, baseY: number, apexX: number, apexY: number, base: number) {
  g.fillStyle(base, 1); g.fillTriangle(lx, baseY, rx, baseY, apexX, apexY);
  g.fillStyle(lighten(base, 0.2), 1); g.fillTriangle(lx, baseY, apexX, apexY, apexX, baseY); // lit left
  g.fillStyle(darken(base, 0.26), 1); g.fillTriangle(rx, baseY, apexX, apexY, apexX, baseY); // shaded right
  g.lineStyle(1, lighten(base, 0.35), 0.7); g.beginPath(); g.moveTo(apexX, apexY); g.lineTo((lx + apexX) / 2, (baseY + apexY) / 2); g.strokePath(); // ridge highlight
  g.fillStyle(WARM_SHADOW, 0.3); g.fillRect(lx, baseY, rx - lx, 1.5); // eave shadow
}
// Overlapping thatch roof: warm straw triangle, then rows of darker scalloped
// strokes for the bundled-reed texture, plus a lit top edge.
function thatchRoof(g: any, lx: number, rx: number, baseY: number, apexX: number, apexY: number) {
  g.fillStyle(THATCH, 1); g.fillTriangle(lx, baseY, rx, baseY, apexX, apexY);
  g.fillStyle(lighten(THATCH, 0.16), 1); g.fillTriangle(lx, baseY, apexX, apexY, apexX, baseY);
  g.fillStyle(darken(THATCH, 0.22), 1); g.fillTriangle(rx, baseY, apexX, apexY, apexX, baseY);
  const rows = 4;
  for (let i = 1; i <= rows; i++) {
    const t = i / (rows + 1), yy = apexY + (baseY - apexY) * t;
    const halfw = (rx - lx) * 0.5 * t;
    g.lineStyle(1.4, darken(THATCH, 0.18 + 0.04 * i), 0.6);
    g.beginPath();
    for (let sx = apexX - halfw; sx < apexX + halfw; sx += 4) { g.moveTo(sx, yy); g.lineTo(sx + 2, yy + 1.6); }
    g.strokePath();
  }
  g.lineStyle(1.2, mix(lighten(THATCH, 0.3), WARM_LIGHT, 0.4), 0.8); // lit ridge
  g.beginPath(); g.moveTo(apexX, apexY); g.lineTo(apexX - (apexX - lx) * 0.4, apexY + (baseY - apexY) * 0.4); g.strokePath();
}
// A lit leaded window: dark glass, warm inner glow, muntin cross, stone lintel.
function window2(g: any, x: number, y: number, w: number, h: number, lit = true) {
  g.fillStyle(0x1a1622, 1); g.fillRect(x, y, w, h);
  if (lit) { g.fillStyle(GLOW, 0.85); g.fillRect(x + 1, y + 1, w - 2, h - 2); g.fillStyle(lighten(GLOW, 0.2), 0.6); g.fillRect(x + 1, y + 1, w - 2, (h - 2) * 0.45); }
  g.lineStyle(1, mix(0x2a2030, BEAM, 0.5), 0.9);
  g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h); g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); g.strokePath(); // muntins
  g.fillStyle(STONE_C, 1); g.fillRect(x - 1, y - 1.5, w + 2, 1.5); // lintel
}
// An arched (round-top) window with optional warm glow.
function archWindow(g: any, x: number, y: number, w: number, h: number, lit = true) {
  const cx = x + w / 2, r = w / 2;
  g.fillStyle(0x18141f, 1); g.fillRect(x, y, w, h); g.fillCircle(cx, y, r);
  if (lit) { g.fillStyle(GLOW, 0.7); g.fillRect(x + 1, y + 1, w - 2, h - 2); g.fillCircle(cx, y, r - 1); g.fillStyle(lighten(GLOW, 0.25), 0.5); g.fillRect(x + 1, y, w - 2, h * 0.4); }
  g.lineStyle(1, mix(STONE_DC, BEAM, 0.4), 0.8); g.beginPath(); g.moveTo(cx, y - r + 1); g.lineTo(cx, y + h); g.strokePath();
}
// Crenellations along the top edge of a tower/wall, each merlon shaded for depth.
function merlons(g: any, x: number, y: number, w: number, color: number) {
  for (let cx = x; cx < x + w - 2; cx += 6) {
    g.fillStyle(color, 1); g.fillRect(cx, y, 4, 4);
    g.fillStyle(lighten(color, 0.18), 1); g.fillRect(cx, y, 4, 1.2);
    g.fillStyle(darken(color, 0.3), 1); g.fillRect(cx + 3, y, 1, 4);
  }
}
// A heraldic banner hanging from a crossbar: pole, finial, cloth with a fold
// highlight, a swallow-tail notch and a centre device.
function banner(g: any, x: number, y: number, h: number, accent: number) {
  g.fillStyle(0x5a3a1e, 1); g.fillRect(x - 0.5, y - 2, 1.5, h + 4);              // pole
  g.fillStyle(0xc9a84c, 1); g.fillCircle(x + 0.2, y - 3, 1.4);                  // gold finial
  g.fillStyle(accent, 1); g.fillRect(x - 3, y, 7, h);                          // cloth
  g.fillStyle(lighten(accent, 0.22), 1); g.fillRect(x - 3, y, 2, h);           // lit fold
  g.fillStyle(darken(accent, 0.3), 1); g.fillRect(x + 2, y, 2, h);             // shaded fold
  g.fillStyle(mix(WARM_SHADOW, accent, 0.3), 1); g.fillTriangle(x - 3, y + h, x + 4, y + h, x + 0.5, y + h - 4); // swallow tail
  g.fillStyle(0xe8d28a, 0.9); g.fillCircle(x + 0.5, y + h * 0.4, 1.3);         // device
}
// A small triangular pennant flag on a pole (simpler than a banner).
function flag(g: any, x: number, y: number, h: number, accent: number) {
  g.fillStyle(0x5a3a1e, 1); g.fillRect(x, y, 1.5, h + 2);                       // pole
  g.fillStyle(0xc9a84c, 1); g.fillCircle(x + 0.7, y - 0.5, 1.2);               // finial
  g.fillStyle(accent, 1); g.fillTriangle(x + 1.5, y, x + 1.5, y + 7, x + 13, y + 3.5);
  g.fillStyle(lighten(accent, 0.2), 1); g.fillTriangle(x + 1.5, y, x + 1.5, y + 3, x + 8, y + 2); // lit
}
// Ground contact shadow (soft warm-dark ellipse the building sits in).
function shadow(g: any, cx = 32, cy = 60, rw = 24) {
  g.fillStyle(0x000000, 0.22); g.fillEllipse(cx, cy, rw, 8);
  g.fillStyle(0x000000, 0.16); g.fillEllipse(cx, cy - 1, rw * 0.7, 5);
}
// Ambient-occlusion foot: a feathered warm-dark band where a wall meets ground.
function aoFoot(g: any, x: number, y: number, w: number) {
  g.fillStyle(WARM_SHADOW, 0.28); g.fillEllipse(x + w / 2, y, w * 0.55, 3.5);
}
// A five-point star (Graphics) for prestige emblems.
function star(g: any, cx: number, cy: number, r: number, color = 0xc9a84c) {
  g.fillStyle(color, 1); g.beginPath();
  for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 4 * Math.PI / 5; (k === 0 ? g.moveTo : g.lineTo).call(g, cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  g.closePath(); g.fill();
}
// Soft warm glow halo (baked lived-in light spilling from a window/forge).
function glowHalo(g: any, cx: number, cy: number, r: number, color = GLOW, a = 0.22) {
  g.fillStyle(color, a); g.fillCircle(cx, cy, r);
  g.fillStyle(color, a * 0.7); g.fillCircle(cx, cy, r * 0.6);
}

// Draw one building texture (accent-coloured) under `key`. opt.skin selects an
// AI faction stone/wood/roof treatment so the same shapes read distinctly.
type Skin = { stone: number; stoneM: number; stoneD: number; roof: number; wood: number };
function makeBuilding(scene: any, key: string, draw: (g: any, A: number) => void, accent = 0x2a4a9b, skin?: Skin) {
  if (scene.textures.exists(key)) return;
  // install per-skin palette (default = player warm stone)
  STONE_C = skin ? skin.stone : STONE; STONE_MC = skin ? skin.stoneM : STONE_M;
  STONE_DC = skin ? skin.stoneD : STONE_D; ROOF_C = skin ? skin.roof : ROOF; WOOD_C = skin ? skin.wood : WOOD;
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  shadow(g);
  draw(g, accent);
  g.generateTexture(key, 64, 64);
  g.destroy();
  STONE_C = STONE; STONE_MC = STONE_M; STONE_DC = STONE_D; ROOF_C = ROOF; WOOD_C = WOOD; // reset
}

// Each draw fn (g, A=accent). Base sits near y60, centred on x32. Draw fns read
// STONE_C/STONE_MC/STONE_DC/ROOF_C/WOOD_C so AI factions get distinct stone.
const BUILD: Record<string, (g: any, A: number) => void> = {
  // Half-timbered cottage: stone footing, timber-framed plaster wall, steep
  // thatch roof, leaded lit window, plank door, smoking-stub chimney.
  house: (g, A) => {
    aoFoot(g, 22, 58, 20);
    box(g, 22, 44, 20, 14, STONE_C); masonry(g, 22, 44, 20, 14, STONE_C, 4); // stone footing
    box(g, 23, 30, 18, 16, 0xd8c7a4);                                  // plaster wall
    g.fillStyle(BEAM, 1);                                              // timber frame (posts/braces)
    g.fillRect(23, 30, 1.5, 16); g.fillRect(39.5, 30, 1.5, 16); g.fillRect(31, 30, 1.5, 16);
    g.fillRect(23, 30, 18, 1.5); g.fillRect(23, 37, 18, 1.2);
    g.lineStyle(1.4, BEAM, 1); g.beginPath(); g.moveTo(24, 37); g.lineTo(30, 31); g.moveTo(41, 37); g.lineTo(33, 31); g.strokePath(); // diagonal braces
    thatchRoof(g, 18, 46, 31, 32, 14);                                // overhanging thatch
    g.fillStyle(DOOR, 1); g.fillRect(33, 39, 6, 7); g.fillStyle(lighten(DOOR, 0.2), 1); g.fillRect(33, 39, 1.2, 7); g.fillStyle(GLOW, 1); g.fillCircle(38, 42.5, 0.7); // door + handle
    window2(g, 24.5, 33, 5, 5, true);                                 // leaded lit window
    box(g, 35, 11, 4, 8, STONE_DC); g.fillStyle(darken(STONE_DC, 0.3), 1); g.fillRect(35, 11, 4, 1.5); // chimney
    glowHalo(g, 27, 35.5, 6, GLOW, 0.14);
  },
  // Open A-frame logging shed: rough timber posts + ridge, sloped shake roof,
  // a stacked log pile with visible end-grain rings, a saw blade and chips.
  lumberyard: (g, A) => {
    aoFoot(g, 16, 58, 36);
    g.fillStyle(BEAM, 1); for (const bx of [18, 44]) { g.fillRect(bx, 26, 2.5, 32); g.fillStyle(darken(BEAM, 0.3), 1); g.fillRect(bx + 1.8, 26, 0.7, 32); g.fillStyle(BEAM, 1); } // corner posts
    gableRoof(g, 14, 50, 26, 32, 14, darken(WOOD_C, 0.12));           // shake roof
    g.fillStyle(BEAM, 1); g.fillRect(20, 48, 24, 2);                  // cross brace
    // log pile with end-grain
    for (let i = 0; i < 3; i++) {
      const ly = 54 - i * 5, off = (i % 2) * 3;
      g.fillStyle(0x8b5e3c, 1); g.fillEllipse(28 + off, ly, 17, 5);
      g.fillStyle(0xcaa066, 1); g.fillCircle(20 + off, ly, 2.4); g.fillStyle(0x9a7038, 1); g.fillCircle(20 + off, ly, 1.4); g.fillCircle(20 + off, ly, 0.5); // rings
      g.fillStyle(0xcaa066, 1); g.fillCircle(36 + off, ly, 2.4); g.fillStyle(0x9a7038, 1); g.fillCircle(36 + off, ly, 1.3);
    }
    g.fillStyle(0xc8ccd2, 1); g.fillCircle(45, 44, 5); g.fillStyle(0xe6e9ee, 1); g.fillCircle(43.5, 42.5, 1.6); // saw blade + glint
    g.lineStyle(1, STONE_DC, 1); for (let k = 0; k < 8; k++) { const a = k / 8 * 6.28; g.beginPath(); g.moveTo(45, 44); g.lineTo(45 + Math.cos(a) * 5, 44 + Math.sin(a) * 5); g.strokePath(); } // teeth
    g.fillStyle(STONE_D, 1); g.fillCircle(45, 44, 1.6);
    g.fillStyle(0xe8d8b8, 0.7); for (const [x, y] of [[40, 56], [50, 55], [22, 57]]) { g.fillRect(x, y, 2, 1); } // wood chips
  },
  // Mine: stone portal arch into pitch-black tunnel, hewn support timbers, ore
  // cart on rails, a glint of ore inside, scattered rubble + pick leaning.
  mine: (g, A) => {
    aoFoot(g, 18, 58, 28);
    box(g, 18, 32, 28, 26, STONE_MC); masonry(g, 18, 32, 28, 26, STONE_MC, 5); // entrance block
    g.fillStyle(STONE_C, 1); g.fillTriangle(22, 36, 42, 36, 32, 28); g.fillStyle(lighten(STONE_C, 0.18), 1); g.fillTriangle(22, 36, 32, 28, 32, 36); // arch keystone face
    g.fillStyle(0x070709, 1); g.fillRect(25, 40, 14, 18); g.fillTriangle(25, 40, 39, 40, 32, 33);  // tunnel void
    g.fillStyle(0x161018, 0.8); g.fillEllipse(32, 50, 6, 9);          // depth gradient
    g.fillStyle(BEAM, 1); g.fillRect(23.5, 36, 2.5, 22); g.fillRect(38, 36, 2.5, 22); g.fillRect(23.5, 35, 17, 2.5); // support frame
    g.fillStyle(darken(BEAM, 0.3), 1); g.fillRect(25.2, 36, 0.8, 22);
    g.fillStyle(GLOW, 0.6); g.fillCircle(30, 44, 1.4);               // faint lantern in shaft
    // ore cart on rails
    g.fillStyle(STONE_DC, 1); g.fillRect(40, 50, 9, 6); g.fillStyle(darken(STONE_DC, 0.3), 1); g.fillRect(40, 54, 9, 2);
    g.fillStyle(0x7a8a9a, 1); g.fillCircle(43, 54, 1); g.fillCircle(47, 54, 1); g.fillRect(42, 50, 5, 1.5); // ore lumps + wheels
    g.fillStyle(0x55504a, 1); g.fillRect(38, 57, 16, 1); // rail
    g.fillStyle(darken(STONE_C, 0.2), 0.85); for (const [x, y, r] of [[16, 56, 1.6], [52, 55, 1.4], [20, 57, 1.2]] as any[]) g.fillCircle(x, y, r); // rubble
  },
  // Windmill farm: tapered round stone tower on a base, conical cap, four
  // lattice sails crossing the face, grain sacks + a tilled furrow at the foot.
  farm: (g, A) => {
    aoFoot(g, 22, 58, 22);
    g.fillStyle(0x9a7a4a, 1); g.fillRect(26, 53, 14, 5); g.lineStyle(1, darken(0x9a7a4a, 0.3), 0.7); for (let fx = 27; fx < 40; fx += 3) { g.beginPath(); g.moveTo(fx, 53); g.lineTo(fx, 58); g.strokePath(); } // tilled furrows
    // tapered tower
    g.fillStyle(STONE_C, 1); g.fillPoints([{ x: 24, y: 54 }, { x: 40, y: 54 }, { x: 37, y: 24 }, { x: 27, y: 24 }], true);
    g.fillStyle(mix(STONE_C, WARM_SHADOW, 0.28), 0.5); g.fillPoints([{ x: 35, y: 54 }, { x: 40, y: 54 }, { x: 37, y: 24 }], true); // shaded right
    g.fillStyle(mix(lighten(STONE_C, 0.2), WARM_LIGHT, 0.3), 0.5); g.fillPoints([{ x: 24, y: 54 }, { x: 28, y: 54 }, { x: 27, y: 24 }], true); // lit left
    masonry(g, 27, 26, 10, 28, STONE_C, 5);
    g.fillStyle(ROOF_C, 1); g.fillTriangle(25, 24, 39, 24, 32, 13); g.fillStyle(lighten(ROOF_C, 0.18), 1); g.fillTriangle(25, 24, 32, 13, 32, 24); // conical cap
    window2(g, 30, 38, 4, 5, true);                                   // small lit window
    const hx = 32, hy = 28;
    g.lineStyle(2.4, 0x6b4a28, 1); g.fillStyle(0xeae0c8, 1);
    for (const a of [-0.4, Math.PI / 2 - 0.4, Math.PI - 0.4, -Math.PI / 2 - 0.4]) { // four lattice sails
      const ex = hx + Math.cos(a) * 15, ey = hy + Math.sin(a) * 15;
      g.beginPath(); g.moveTo(hx, hy); g.lineTo(ex, ey); g.strokePath();
      const px = Math.cos(a + Math.PI / 2), py = Math.sin(a + Math.PI / 2);
      g.fillStyle(0xeae0c8, 1); g.fillTriangle(hx + Math.cos(a) * 5, hy + Math.sin(a) * 5, ex + px * 2.5, ey + py * 2.5, ex - px * 0.5, ey - py * 0.5); // canvas vane
    }
    g.fillStyle(STONE_DC, 1); g.fillCircle(hx, hy, 2.6); g.fillStyle(lighten(STONE_DC, 0.2), 1); g.fillCircle(hx - 0.6, hy - 0.6, 1); // hub
    g.fillStyle(0xc9a86a, 1); g.fillEllipse(22, 55, 4, 4); g.fillEllipse(43, 55, 3.6, 4); g.fillStyle(darken(0xc9a86a, 0.2), 1); g.fillEllipse(22, 56.5, 4, 1.5); // grain sacks
  },
  // Fortified war hall: long stone keep with battlements + corner watchtower,
  // banded reinforced door, shield + crossed-swords trophy, weapon rack, banner.
  barracks: (g, A) => {
    aoFoot(g, 16, 58, 38);
    box(g, 16, 30, 30, 28, STONE_MC); masonry(g, 16, 30, 30, 28, STONE_MC, 5); // hall
    merlons(g, 16, 26, 30, STONE_C);
    box(g, 44, 22, 11, 36, STONE_DC); masonry(g, 44, 22, 11, 36, STONE_DC, 5); merlons(g, 44, 18, 11, STONE_MC); // corner watchtower
    g.fillStyle(0x161018, 1); g.fillRect(48, 30, 2, 6); g.fillRect(48, 40, 2, 6); // tower slits
    g.fillStyle(DOOR, 1); g.fillRect(26, 44, 11, 14); g.fillTriangle(26, 44, 37, 44, 31.5, 39); // arched double door
    g.fillStyle(0x6b6b64, 1); g.fillRect(26, 48, 11, 1.5); g.fillRect(26, 53, 11, 1.5); g.fillStyle(BEAM, 1); g.fillRect(31, 44, 1, 14); // iron bands + seam
    window2(g, 19, 35, 4, 5, true); window2(g, 38, 35, 4, 5, true);   // lit windows
    g.fillStyle(A, 1); g.beginPath(); g.moveTo(28, 30); g.lineTo(34, 30); g.lineTo(34, 35); g.lineTo(31, 38); g.lineTo(28, 35); g.closePath(); g.fill(); // crest shield
    g.lineStyle(1.4, 0xd2d6dc, 1); g.beginPath(); g.moveTo(29, 31.5); g.lineTo(33, 35.5); g.moveTo(33, 31.5); g.lineTo(29, 35.5); g.strokePath(); // crossed swords
    banner(g, 21, 14, 12, A);
  },
  // Round defensive tower: tapered masonry shaft, battlemented crown, arrow
  // slits, a lit window slot and a pennant.
  tower: (g, A) => {
    aoFoot(g, 20, 58, 24);
    g.fillStyle(STONE_MC, 1); g.fillPoints([{ x: 20, y: 56 }, { x: 44, y: 56 }, { x: 40, y: 22 }, { x: 24, y: 22 }], true); // tapered body
    g.fillStyle(mix(STONE_MC, WARM_SHADOW, 0.3), 0.5); g.fillPoints([{ x: 38, y: 56 }, { x: 44, y: 56 }, { x: 40, y: 22 }], true); // shaded
    g.fillStyle(mix(lighten(STONE_MC, 0.22), WARM_LIGHT, 0.3), 0.5); g.fillPoints([{ x: 20, y: 56 }, { x: 26, y: 56 }, { x: 24, y: 22 }], true); // lit
    masonry(g, 24, 24, 16, 32, STONE_MC, 5);
    box(g, 22, 18, 20, 6, STONE_C);                                   // overhanging parapet
    merlons(g, 21, 14, 22, STONE_DC);
    g.fillStyle(0x161018, 1); g.fillRect(30, 30, 4, 9); g.fillTriangle(30, 30, 34, 30, 32, 27); // arrow slit (arched)
    window2(g, 29, 42, 5, 5, true);                                   // lit window
    glowHalo(g, 31.5, 44.5, 5, GLOW, 0.12);
    flag(g, 32, 4, 8, A);
  },
  // Tall slender watchtower: stone shaft, timber lookout deck w/ railing, peaked
  // roof, a beacon brazier glowing and a spotter slit. (Eye icon floats above.)
  watchtower: (g, A) => {
    aoFoot(g, 24, 58, 20);
    g.fillStyle(STONE_MC, 1); g.fillPoints([{ x: 25, y: 58 }, { x: 39, y: 58 }, { x: 37, y: 22 }, { x: 27, y: 22 }], true);
    g.fillStyle(mix(STONE_MC, WARM_SHADOW, 0.3), 0.5); g.fillPoints([{ x: 34, y: 58 }, { x: 39, y: 58 }, { x: 37, y: 22 }], true);
    masonry(g, 27, 24, 10, 34, STONE_MC, 5);
    g.fillStyle(0x161018, 1); g.fillRect(31, 38, 2, 7); g.fillRect(30, 48, 4, 3); // slit + window
    g.fillStyle(BEAM, 1); g.fillRect(21, 18, 22, 5); g.fillStyle(darken(BEAM, 0.25), 1); g.fillRect(21, 21.5, 22, 1.5); // platform + underside
    g.lineStyle(1.5, 0x6b4a28, 1); g.strokeRect(22, 13, 20, 6); for (const rx of [27, 32, 37]) { g.beginPath(); g.moveTo(rx, 13); g.lineTo(rx, 18); g.strokePath(); } // railing posts
    gableRoof(g, 20, 44, 13, 32, 4, darken(WOOD_C, 0.1));             // peaked lookout roof
    g.fillStyle(0xff8a2a, 1); g.fillCircle(24, 14, 2.4); g.fillStyle(0xffd24a, 1); g.fillCircle(24, 13.5, 1.3); glowHalo(g, 24, 14, 5, 0xffa030, 0.2); // beacon brazier
    g.fillStyle(0x3a2a1a, 1); g.fillRect(22.5, 14, 3, 5);
  },
  // Forge: stone smithy with a wide-open glowing forge mouth, anvil with hammer,
  // a tall chimney with baked smoke, quench barrel and tongs. Warm fire spill.
  blacksmith: (g, A) => {
    aoFoot(g, 16, 58, 30);
    box(g, 16, 32, 28, 26, STONE_MC); masonry(g, 16, 32, 28, 26, STONE_MC, 5);
    gableRoof(g, 13, 47, 32, 30, 23, ROOF_C);
    g.fillStyle(0x0e0a08, 1); g.fillRect(20, 40, 18, 18); g.fillTriangle(20, 40, 38, 40, 29, 35); // forge opening (arched)
    glowHalo(g, 28, 50, 12, 0xff8a1a, 0.3);                           // fire spill into room
    g.fillStyle(0xff7a1a, 1); g.fillCircle(26, 51, 6); g.fillStyle(0xffb13a, 1); g.fillCircle(26, 51, 3.6); g.fillStyle(0xffe6a0, 1); g.fillCircle(25, 50, 1.6); // forge coals
    g.fillStyle(0x2a2a2e, 1); g.fillRect(31, 50, 8, 2.5); g.fillRect(33.5, 50, 2.5, 7); g.fillStyle(lighten(0x2a2a2e, 0.3), 1); g.fillRect(31, 50, 8, 0.8); // anvil
    g.fillStyle(BEAM, 1); g.fillRect(36, 46, 1, 5); g.fillStyle(0x6b6b64, 1); g.fillRect(35, 45, 3, 2); // hammer on anvil
    box(g, 38, 22, 7, 14, STONE_DC); g.fillStyle(darken(STONE_DC, 0.3), 1); g.fillRect(38, 22, 7, 2); g.fillStyle(0xff6a1a, 0.5); g.fillRect(40, 23, 3, 2); // chimney + ember mouth
    g.fillStyle(0x9a948c, 0.45); g.fillCircle(42, 18, 3.4); g.fillCircle(45, 13, 2.8); g.fillStyle(0xb4aea4, 0.35); g.fillCircle(40, 14, 2.4); // baked smoke
    g.fillStyle(0x6b4a28, 1); g.fillEllipse(50, 53, 6, 6); g.fillStyle(0x3a6a8a, 1); g.fillEllipse(50, 51, 4.5, 2.2); // quench barrel w/ water
  },
  // Market: timber stall under a striped awning, a goods-laden counter (bread,
  // fruit, pots), hanging scales, barrels. (Coin icon floats above.)
  market: (g, A) => {
    aoFoot(g, 16, 58, 32);
    g.fillStyle(BEAM, 1); g.fillRect(17, 30, 2.5, 28); g.fillRect(44, 30, 2.5, 28); // posts
    g.fillStyle(0x8b5e3c, 1); g.fillRect(18, 40, 27, 18); g.fillStyle(lighten(0x8b5e3c, 0.18), 1); g.fillRect(18, 40, 27, 2); g.fillStyle(darken(0x8b5e3c, 0.25), 1); g.fillRect(18, 56, 27, 2); // counter
    g.lineStyle(1, darken(0x8b5e3c, 0.3), 0.5); for (let px = 21; px < 45; px += 5) { g.beginPath(); g.moveTo(px, 42); g.lineTo(px, 56); g.strokePath(); } // planks
    // scalloped striped awning
    for (let i = 0; i < 6; i++) { g.fillStyle(i % 2 ? 0xf2ece0 : A, 1); g.fillRect(15 + i * 5.6, 30, 5.6, 9); g.fillStyle(i % 2 ? 0xf2ece0 : A, 1); g.fillTriangle(15 + i * 5.6, 39, 15 + (i + 1) * 5.6, 39, 15 + i * 5.6 + 2.8, 42); }
    g.fillStyle(mix(A, WARM_SHADOW, 0.3), 0.4); g.fillRect(15, 36, 33.6, 3); // awning underside shade
    // goods on counter
    g.fillStyle(0xc98a4a, 1); g.fillEllipse(23, 44, 3.5, 2.2); g.fillEllipse(27, 44, 3, 2); // bread loaves
    g.fillStyle(0xc0402a, 1); g.fillCircle(33, 43, 1.6); g.fillCircle(36, 43, 1.6); g.fillStyle(0x6aaa3a, 1); g.fillCircle(34.5, 45, 1.5); // fruit
    g.fillStyle(0x7a5a3a, 1); g.fillEllipse(41, 44, 3, 3); g.fillStyle(darken(0x7a5a3a, 0.2), 1); g.fillEllipse(41, 45, 3, 1.4); // pot
    g.lineStyle(1, 0xc9a84c, 1); g.beginPath(); g.moveTo(38, 30); g.lineTo(38, 36); g.strokePath(); g.fillStyle(0xc9a84c, 1); g.fillEllipse(36, 37, 2.2, 1); g.fillEllipse(40, 37, 2.2, 1); // hanging scales
  },
  // Library: tall stone scriptorium, three arched windows w/ warm candlelight,
  // shelved book spines visible, a rose/oculus window, stepped entrance.
  library: (g, A) => {
    aoFoot(g, 16, 58, 32);
    box(g, 16, 28, 30, 30, STONE_C); masonry(g, 16, 28, 30, 30, STONE_C, 5);
    g.fillStyle(ROOF_C, 1); g.fillRect(14, 24, 34, 5); g.fillStyle(lighten(ROOF_C, 0.15), 1); g.fillRect(14, 24, 34, 1.5); // cornice
    archWindow(g, 19, 36, 6, 9, true); archWindow(g, 37, 36, 6, 9, true); // tall arched windows lit
    // central shelf alcove with book spines
    g.fillStyle(0x241c2c, 1); g.fillRect(28, 34, 8, 14); g.fillTriangle(28, 34, 36, 34, 32, 30);
    for (let i = 0; i < 4; i++) { g.fillStyle([0x9a3a3a, 0x3a7a9a, 0xc9a84c, 0x6a9a4a][i], 1); g.fillRect(28.5 + i * 1.9, 38, 1.6, 9); }
    g.fillStyle(GLOW, 0.8); g.fillCircle(32, 46, 1.6); glowHalo(g, 32, 42, 7, GLOW, 0.12); // candle glow
    g.fillStyle(0xc9a84c, 1); g.fillCircle(32, 22, 3); g.fillStyle(0x241c2c, 1); g.fillCircle(32, 22, 1.6); g.lineStyle(0.8, 0xc9a84c, 1); for (let k = 0; k < 6; k++) { const a = k / 6 * 6.28; g.beginPath(); g.moveTo(32, 22); g.lineTo(32 + Math.cos(a) * 3, 22 + Math.sin(a) * 3); g.strokePath(); } // oculus
    g.fillStyle(DOOR, 1); g.fillRect(29, 50, 6, 8); g.lineStyle(1, 0xc9a84c, 0.8); g.strokeRect(29, 50, 6, 8);
    g.fillStyle(STONE_MC, 1); g.fillRect(26, 56, 12, 1.5); g.fillRect(24, 58, 16, 1.5); // steps
    flag(g, 21, 16, 7, A);
  },
  // Tavern: warm timber inn, jettied upper storey, glowing windows + door,
  // overhanging eaves, a hanging mug sign, ale barrels stacked outside.
  tavern: (g, A) => {
    aoFoot(g, 14, 58, 36);
    box(g, 16, 40, 30, 18, WOOD_C); grain(g, 16, 40, 30, 18, WOOD_C);  // ground storey
    box(g, 14, 30, 34, 12, lighten(WOOD_C, 0.08));                     // jettied upper storey (overhang)
    g.fillStyle(darken(WOOD_C, 0.3), 0.5); g.fillRect(16, 40, 30, 1.5); // jetty underside shadow
    g.fillStyle(BEAM, 1); for (const bx of [16, 30, 44]) g.fillRect(bx, 30, 1.5, 12); g.fillRect(14, 30, 34, 1.5);
    gableRoof(g, 11, 51, 30, 32, 21, ROOF_C);
    window2(g, 19, 44, 6, 6, true); window2(g, 37, 44, 6, 6, true);    // glowing windows
    window2(g, 18, 33, 5, 5, true); window2(g, 41, 33, 5, 5, true);    // upper windows
    g.fillStyle(DOOR, 1); g.fillRect(28, 47, 7, 11); g.fillStyle(GLOW, 0.5); g.fillRect(28.5, 47, 6, 2); g.fillStyle(lighten(DOOR, 0.2), 1); g.fillRect(28, 47, 1, 11); // half-open glowing door
    glowHalo(g, 22, 47, 8, GLOW, 0.16); glowHalo(g, 40, 47, 8, GLOW, 0.16);
    // hanging mug sign on a bracket
    g.fillStyle(BEAM, 1); g.fillRect(46, 36, 6, 1.4); g.fillRect(50.5, 36, 1.2, 4);
    g.fillStyle(0xd8b06a, 1); g.fillRect(48.5, 40, 4.5, 5); g.fillStyle(lighten(0xd8b06a, 0.2), 1); g.fillRect(53, 40.5, 1.5, 3.5); g.fillStyle(0xf2ece0, 1); g.fillRect(48.5, 40, 4.5, 1.2); // mug + foam
    g.fillStyle(0x7a5a3a, 1); g.fillEllipse(49, 54, 5, 5); g.fillEllipse(53, 52, 4, 4); g.lineStyle(1, darken(0x7a5a3a, 0.3), 0.7); g.strokeCircle(49, 54, 4.4); // barrels
  },
  // Defensive wall segment: battlemented stone curtain wall with banded courses,
  // arrow loops and an AO foot. (Infrastructure — no banner.)
  wall: (g, A) => {
    aoFoot(g, 12, 56, 40);
    box(g, 12, 36, 40, 20, STONE_MC); masonry(g, 12, 36, 40, 20, STONE_MC, 5);
    merlons(g, 12, 32, 40, STONE_C);
    g.fillStyle(0x161018, 1); g.fillRect(20, 42, 2, 6); g.fillRect(31, 42, 2, 6); g.fillRect(42, 42, 2, 6); // arrow loops
    g.fillStyle(mix(lighten(STONE_MC, 0.2), WARM_LIGHT, 0.3), 0.3); g.fillRect(12, 36, 40, 2); // lit top band
  },
  // Siege workshop: heavy timber-framed open shed, sloped shake roof, a built
  // catapult (frame, throwing arm, wheels, stone payload), sawhorse, banner.
  siegeworkshop: (g, A) => {
    aoFoot(g, 14, 58, 38);
    g.fillStyle(BEAM, 1); for (const bx of [16, 46] as any[]) g.fillRect(bx, 34, 3, 24); // heavy posts
    box(g, 18, 38, 28, 20, mix(WOOD_C, STONE_MC, 0.3)); grain(g, 18, 38, 28, 20, mix(WOOD_C, STONE_MC, 0.3)); // back wall
    gableRoof(g, 12, 52, 34, 32, 23, darken(WOOD_C, 0.12));
    g.fillStyle(BEAM, 1); g.fillRect(16, 32, 32, 2.5);               // ridge beam
    // catapult
    g.fillStyle(0x6b4a28, 1); g.fillRect(23, 49, 18, 4); g.fillStyle(darken(0x6b4a28, 0.3), 1); g.fillRect(23, 52, 18, 1.5); // base frame
    g.fillStyle(0x3a2a1a, 1); g.fillCircle(26, 55, 3); g.fillStyle(0x55504a, 1); g.fillCircle(26, 55, 1); g.fillStyle(0x3a2a1a, 1); g.fillCircle(38, 55, 3); g.fillStyle(0x55504a, 1); g.fillCircle(38, 55, 1); // wheels
    g.lineStyle(3.5, 0x5c3a1e, 1); g.beginPath(); g.moveTo(25, 51); g.lineTo(40, 38); g.strokePath(); // throwing arm
    g.fillStyle(0x6b4a28, 1); g.fillTriangle(30, 49, 30, 44, 34, 49); // tension brace
    g.fillStyle(0x9aa0a6, 1); g.fillCircle(40, 36, 3.2); g.fillStyle(darken(0x9aa0a6, 0.3), 1); g.fillCircle(41, 37, 1.6); // stone payload
    banner(g, 19, 16, 11, A);
  },
  // Hall of Heroes: classical memorial temple — fluted pillars flank a gold
  // pediment, crossed-swords relief over a niche with an eternal flame, broad
  // steps, torches, twin honour banners, a gold star at the apex.
  hallofheroes: (g, A) => {
    aoFoot(g, 12, 58, 40);
    box(g, 12, 28, 40, 30, STONE_C); masonry(g, 14, 30, 36, 28, STONE_C, 5);
    g.fillStyle(STONE_MC, 1); g.fillRect(10, 22, 44, 7); g.fillStyle(lighten(STONE_MC, 0.15), 1); g.fillRect(10, 22, 44, 1.5); // entablature
    g.fillStyle(0xc9a84c, 1); g.fillTriangle(10, 22, 32, 11, 54, 22); g.fillStyle(lighten(0xc9a84c, 0.2), 1); g.fillTriangle(10, 22, 32, 11, 32, 22); g.fillStyle(darken(0xc9a84c, 0.2), 1); g.fillTriangle(54, 22, 32, 11, 32, 22); // gold pediment lit/shade
    for (const px of [19, 45]) { // fluted pillars
      g.fillStyle(0xe6dcc6, 1); g.fillRect(px - 2.5, 30, 6, 26);
      g.lineStyle(0.8, darken(0xe6dcc6, 0.2), 0.6); for (const fx of [px - 1.5, px, px + 1.5]) { g.beginPath(); g.moveTo(fx, 31); g.lineTo(fx, 55); g.strokePath(); }
      g.fillStyle(darken(0xe6dcc6, 0.22), 1); g.fillRect(px + 2.5, 30, 1, 26); // shaded edge
      g.fillStyle(STONE_C, 1); g.fillRect(px - 3.5, 28, 8, 2.5); g.fillRect(px - 3.5, 55.5, 8, 2.5); // capital + base
    }
    g.fillStyle(0x18141f, 1); g.fillRect(28, 34, 8, 14); g.fillTriangle(28, 34, 36, 34, 32, 30); // niche
    g.lineStyle(1.5, 0xd2d6dc, 1); g.beginPath(); g.moveTo(28, 33); g.lineTo(36, 41); g.moveTo(36, 33); g.lineTo(28, 41); g.strokePath(); // crossed-swords relief
    g.fillStyle(0xff8a2a, 1); g.fillEllipse(32, 46, 2.4, 4); g.fillStyle(0xffd24a, 1); g.fillEllipse(32, 46, 1.3, 2.6); glowHalo(g, 32, 45, 6, 0xffa030, 0.22); // eternal flame
    g.fillStyle(STONE_MC, 1); g.fillRect(24, 56, 16, 1.5); g.fillRect(21, 58, 22, 1.5); // steps
    g.fillStyle(0xff8a2a, 1); g.fillCircle(15, 38, 2); g.fillCircle(49, 38, 2); g.fillStyle(0xffd24a, 1); g.fillCircle(15, 37.5, 1); g.fillCircle(49, 37.5, 1); // torches
    banner(g, 13, 14, 9, A); banner(g, 51, 14, 9, A);
    star(g, 32, 16, 4.5);
  },
  // Grand Hall: cathedral-scale keep — twin battlemented corner towers w/ conical
  // roofs, central nave w/ gold pediment, three tall lit arched windows, rose
  // window/crown relief, ornate banded doors, four banners.
  grandhall: (g, A) => {
    aoFoot(g, 6, 58, 52);
    box(g, 6, 24, 9, 34, STONE_MC); masonry(g, 6, 24, 9, 34, STONE_MC, 5); merlons(g, 6, 20, 9, STONE_C); // left tower
    g.fillStyle(ROOF_C, 1); g.fillTriangle(5, 20, 16, 20, 10.5, 12); g.fillStyle(lighten(ROOF_C, 0.18), 1); g.fillTriangle(5, 20, 10.5, 12, 10.5, 20); // conical cap
    box(g, 49, 24, 9, 34, STONE_MC); masonry(g, 49, 24, 9, 34, STONE_MC, 5); merlons(g, 49, 20, 9, STONE_C); // right tower
    g.fillStyle(ROOF_C, 1); g.fillTriangle(48, 20, 59, 20, 53.5, 12); g.fillStyle(darken(ROOF_C, 0.2), 1); g.fillTriangle(59, 20, 53.5, 12, 53.5, 20);
    box(g, 14, 24, 36, 34, STONE_C); masonry(g, 16, 26, 32, 30, STONE_C, 5); // nave
    g.fillStyle(STONE_MC, 1); g.fillRect(12, 19, 40, 6); // entablature
    g.fillStyle(0xc9a84c, 1); g.fillTriangle(12, 19, 32, 8, 52, 19); g.fillStyle(lighten(0xc9a84c, 0.2), 1); g.fillTriangle(12, 19, 32, 8, 32, 19); g.fillStyle(darken(0xc9a84c, 0.2), 1); g.fillTriangle(52, 19, 32, 8, 32, 19); // pediment
    for (const wx of [18, 30, 42]) archWindow(g, wx, 32, 4.5, 12, true); // three tall lit windows
    for (const wx of [18, 30, 42]) glowHalo(g, wx + 2.2, 38, 5, GLOW, 0.1);
    g.fillStyle(0xc9a84c, 1); g.fillCircle(32, 14, 3); g.fillStyle(0x241c2c, 1); g.fillCircle(32, 14, 1.5); for (let k = 0; k < 8; k++) { const a = k / 8 * 6.28; g.fillStyle(0xc9a84c, 1); g.fillRect(32 + Math.cos(a) * 4 - 0.6, 14 + Math.sin(a) * 4 - 0.6, 1.2, 1.2); } // crown/rose relief
    g.fillStyle(DOOR, 1); g.fillRect(27, 46, 10, 12); g.fillTriangle(27, 46, 37, 46, 32, 41); // ornate arched doors
    g.fillStyle(0xc9a84c, 1); g.fillRect(31.4, 41, 1.2, 17); g.lineStyle(1, 0xc9a84c, 0.9); g.strokeRect(27, 46, 10, 12); g.fillStyle(0x6b6b64, 1); g.fillRect(27, 50, 10, 1); g.fillRect(27, 54, 10, 1); // bands
    banner(g, 9, 13, 8, A); banner(g, 23, 9, 9, A); banner(g, 41, 9, 9, A); banner(g, 55, 13, 8, A);
  },
  // Treasury: squat ironclad vault — heavy battlemented stone block, a riveted
  // round vault door with spoked wheel, barred windows, a gold-coin crest.
  treasury: (g, A) => {
    aoFoot(g, 16, 58, 32);
    box(g, 16, 30, 32, 28, STONE_C); masonry(g, 16, 30, 32, 28, STONE_C, 5);
    merlons(g, 16, 26, 32, STONE_DC);
    g.fillStyle(0x2e2e34, 1); g.fillCircle(32, 46, 9.5); g.fillStyle(0x3c3c44, 1); g.fillCircle(32, 46, 8); // vault door
    g.lineStyle(2, 0xb8bcc2, 1); g.strokeCircle(32, 46, 9.5);
    g.fillStyle(0xb8bcc2, 1); for (let a = 0; a < 8; a++) g.fillCircle(32 + Math.cos(a / 8 * 6.28) * 6.8, 46 + Math.sin(a / 8 * 6.28) * 6.8, 1.1); // rivets
    g.lineStyle(2, 0x8a8e94, 1); for (let a = 0; a < 6; a++) { g.beginPath(); g.moveTo(32, 46); g.lineTo(32 + Math.cos(a / 6 * 6.28) * 6, 46 + Math.sin(a / 6 * 6.28) * 6); g.strokePath(); } // spoked wheel
    g.fillStyle(0xc9a84c, 1); g.fillCircle(32, 46, 1.8); // brass hub
    g.fillStyle(0xc9a84c, 1); g.fillCircle(32, 21, 3.4); g.fillStyle(0xe8d28a, 1); g.fillCircle(31, 20, 1.4); g.fillStyle(STONE_DC, 1); g.fillRect(31.3, 23, 1.4, 4); // coin crest
    g.fillStyle(0x161018, 1); g.fillRect(20, 35, 4, 7); g.fillRect(40, 35, 4, 7); // barred windows
    g.lineStyle(1, 0x9aa0a6, 1); for (const wx of [20, 40]) { g.beginPath(); g.moveTo(wx + 1.3, 35); g.lineTo(wx + 1.3, 42); g.moveTo(wx + 2.7, 35); g.lineTo(wx + 2.7, 42); g.strokePath(); }
    g.fillStyle(GLOW, 0.18); g.fillRect(20.5, 36, 3, 2); g.fillRect(40.5, 36, 3, 2);
  },
  // Mason's Lodge: open timber workshop — tool rack of chisels/hammers, a worked
  // ashlar block on a workbench, a low stone wall under construction, scaffolding.
  masonslodge: (g, A) => {
    aoFoot(g, 16, 58, 34);
    g.fillStyle(BEAM, 1); for (const bx of [18, 46] as any[]) g.fillRect(bx, 36, 2.5, 22); // posts
    box(g, 20, 40, 24, 18, WOOD_C); grain(g, 20, 40, 24, 18, WOOD_C); // back wall
    gableRoof(g, 14, 50, 36, 32, 26, darken(WOOD_C, 0.12));
    g.fillStyle(BEAM, 1); g.fillRect(20, 40, 18, 2);                  // tool rack rail
    g.fillStyle(0x9aa0a6, 1); for (const tx of [22, 26, 30, 34]) g.fillRect(tx, 42, 1.4, 6); g.fillStyle(BEAM, 1); for (const tx of [22, 26, 30, 34]) g.fillRect(tx - 0.3, 47, 2, 2); // chisels/hammer heads
    g.fillStyle(BEAM, 1); g.fillRect(20, 52, 16, 3); g.fillStyle(darken(BEAM, 0.3), 1); g.fillRect(20, 54.5, 16, 1.5); // workbench
    box(g, 24, 46, 8, 7, STONE_C); masonry(g, 24, 46, 8, 7, STONE_C, 3); // worked ashlar block
    g.fillStyle(0xe8d8b8, 0.6); g.fillRect(22, 55, 12, 1); // stone dust
    // low wall course under construction
    g.fillStyle(STONE_MC, 1); for (let bx = 38; bx < 48; bx += 4) { g.fillRect(bx, 52, 3.4, 3); g.fillRect(bx + 2, 55, 3.4, 3); }
    g.lineStyle(1.5, 0x6b4a28, 1); g.beginPath(); g.moveTo(46, 38); g.lineTo(52, 56); g.moveTo(52, 38); g.lineTo(46, 56); g.moveTo(46, 47); g.lineTo(52, 47); g.strokePath(); // scaffolding
    g.fillStyle(0x9aa0a6, 1); g.fillRect(30, 32, 6, 2); g.fillRect(32, 28, 2, 6); // hammer emblem on gable
  },
  // Spy Guild: deliberately plain dark stone house, shadowed roof, mostly black
  // void windows with a single watchful lit one, an off-centre concealed door,
  // a raven on the eave. Cold and secretive — no banner.
  intelligence: (g, A) => {
    aoFoot(g, 18, 58, 28);
    box(g, 18, 32, 28, 26, mix(STONE_MC, WARM_SHADOW, 0.25)); masonry(g, 18, 32, 28, 26, mix(STONE_MC, WARM_SHADOW, 0.25), 5);
    gableRoof(g, 15, 49, 32, 32, 23, darken(ROOF_C, 0.3));
    g.fillStyle(0x070709, 1); g.fillRect(22, 39, 5, 6); g.fillRect(31, 39, 5, 6); g.fillRect(40, 39, 4, 6); // dark void windows
    g.fillStyle(GLOW, 0.85); g.fillRect(41, 40, 2, 2.5); glowHalo(g, 42, 41, 4, GLOW, 0.1); // one watchful candle
    g.fillStyle(0x100c12, 1); g.fillRect(28, 48, 6, 10); g.fillStyle(GLOW, 0.25); g.fillRect(28.5, 48, 1, 9); // concealed door, sliver of light
    // raven on the eave
    g.fillStyle(0x0c0c10, 1); g.fillEllipse(42, 30, 4, 2.4); g.fillCircle(45, 29, 1.6); g.fillTriangle(46, 29, 49, 28, 46.5, 30); g.fillRect(41, 27, 2, 3); g.fillTriangle(38, 30, 42, 28, 42, 31); // body/head/beak/legs/wing
    g.fillStyle(0xc0402a, 1); g.fillCircle(45.4, 28.6, 0.4); // red eye
  },
  // Guildhall: prosperous timber-framed civic hall — exposed framing, jettied
  // upper floor, many warm lit windows, twin chimneys, a hanging guild shield.
  guildhall: (g, A) => {
    aoFoot(g, 14, 58, 36);
    box(g, 16, 38, 32, 20, 0xcdb98e);                                  // ground plaster
    g.fillStyle(BEAM, 1); for (const bx of [16, 26, 36, 46.5]) g.fillRect(bx, 38, 1.6, 20); g.fillRect(16, 38, 32, 1.6); g.fillRect(16, 47, 32, 1.4); // framing
    box(g, 14, 30, 36, 9, 0xd6c39a); g.fillStyle(darken(0xcdb98e, 0.3), 0.5); g.fillRect(16, 38, 32, 1.5); // jettied upper floor
    g.fillStyle(BEAM, 1); for (const bx of [14, 26, 38, 49]) g.fillRect(bx, 30, 1.6, 9); g.fillRect(14, 30, 36, 1.6);
    gableRoof(g, 11, 53, 30, 32, 22, ROOF_C);
    window2(g, 19, 41, 6, 6, true); window2(g, 38, 41, 6, 6, true);    // busy lit ground windows
    window2(g, 18, 32, 5, 5, true); window2(g, 30, 32, 5, 5, true); window2(g, 41, 32, 5, 5, true); // upper windows
    glowHalo(g, 22, 44, 7, GLOW, 0.12); glowHalo(g, 41, 44, 7, GLOW, 0.12);
    g.fillStyle(DOOR, 1); g.fillRect(29, 49, 6, 9); g.fillStyle(lighten(DOOR, 0.2), 1); g.fillRect(29, 49, 1, 9);
    box(g, 18, 22, 4.5, 10, STONE_DC); box(g, 41, 22, 4.5, 10, STONE_DC); g.fillStyle(darken(STONE_DC, 0.3), 1); g.fillRect(18, 22, 4.5, 1.5); g.fillRect(41, 22, 4.5, 1.5); // chimneys
    // hanging guild shield
    g.fillStyle(BEAM, 1); g.fillRect(31.2, 38, 1.6, 3);
    g.fillStyle(A, 1); g.beginPath(); g.moveTo(28, 41); g.lineTo(36, 41); g.lineTo(36, 45); g.lineTo(32, 48); g.lineTo(28, 45); g.closePath(); g.fill();
    g.fillStyle(lighten(A, 0.2), 1); g.fillTriangle(28, 41, 32, 41, 30, 45); // lit half
    g.lineStyle(1, 0xe8d28a, 1); g.beginPath(); g.moveTo(30, 42.5); g.lineTo(34, 46); g.moveTo(34, 42.5); g.lineTo(30, 46); g.strokePath(); // crossed tools
  },
  // Manor: refined noble residence — symmetrical stone facade, hipped slate
  // roof w/ dormers, pointed arched windows with gold tracery, a balustrade,
  // carved gold-framed doorway, crown finial, weather vane.
  manor: (g, A) => {
    aoFoot(g, 14, 58, 36);
    box(g, 16, 32, 32, 26, STONE_C); masonry(g, 18, 34, 28, 24, STONE_C, 5);
    gableRoof(g, 13, 51, 32, 32, 19, ROOF_C);
    g.fillStyle(ROOF_C, 1); g.fillTriangle(22, 27, 30, 27, 26, 22); g.fillTriangle(34, 27, 42, 27, 38, 22); // dormers
    g.fillStyle(GLOW, 0.6); g.fillRect(24.5, 25, 3, 2); g.fillRect(36.5, 25, 3, 2);
    for (const wx of [21, 37] as any[]) { archWindow(g, wx, 40, 6, 8, true); g.fillStyle(0xc9a84c, 1); g.fillRect(wx - 1, 48.5, 8, 1.4); } // arched windows + gold sill
    g.fillStyle(STONE_DC, 1); g.fillRect(22, 38, 20, 1.4); for (let rx = 22; rx < 42; rx += 2.5) g.fillRect(rx, 36, 1, 3); // balustrade
    g.fillStyle(DOOR, 1); g.fillRect(29, 47, 7, 11); g.fillTriangle(29, 47, 36, 47, 32.5, 43); g.lineStyle(1.2, 0xc9a84c, 1); g.strokeRect(29, 47, 7, 11); g.fillStyle(0xc9a84c, 1); g.fillRect(32, 43, 1, 15); // carved gold doorway
    g.fillStyle(0xc9a84c, 1); g.fillRect(30, 25, 8, 2); g.fillTriangle(30, 25, 32, 20, 34, 25); g.fillTriangle(34, 25, 36, 20, 38, 25); g.fillStyle(0xe8d28a, 1); g.fillCircle(32, 21, 0.8); g.fillCircle(36, 21, 0.8); // crown finial
    g.fillStyle(0x5a3a1e, 1); g.fillRect(31.5, 11, 1, 9); g.fillStyle(0xc9a84c, 1); g.fillTriangle(32, 11, 38, 13, 32, 15); g.fillCircle(32, 11, 1); // weather vane
  },
  // Levee: wide low stone embankment — reinforced dark base, sloped batter face,
  // blue water-marks, iron tie-brackets. Pure infrastructure (no banner).
  levee: (g, A) => {
    aoFoot(g, 6, 56, 52);
    g.fillStyle(STONE_MC, 1); g.fillPoints([{ x: 8, y: 44 }, { x: 56, y: 44 }, { x: 53, y: 56 }, { x: 11, y: 56 }], true); // battered face
    masonry(g, 10, 44, 44, 11, STONE_MC, 4);
    g.fillStyle(STONE_DC, 1); g.fillRect(8, 52, 48, 4); g.fillStyle(darken(STONE_DC, 0.25), 1); g.fillRect(8, 55, 48, 1); // reinforced base
    g.lineStyle(1, 0x4a7bd5, 0.55); g.beginPath(); g.moveTo(9, 49); g.lineTo(55, 49); g.moveTo(9, 51.5); g.lineTo(55, 51.5); g.strokePath(); // water marks
    g.fillStyle(0x5a8ad5, 0.18); g.fillRect(8, 51, 48, 5); // damp tideline
    g.fillStyle(0x55585e, 1); for (const ix of [18, 32, 46]) { g.fillRect(ix, 45, 2, 10); g.fillStyle(0x6b7280, 1); g.fillRect(ix, 45, 0.8, 10); g.fillStyle(0x55585e, 1); } // iron tie-brackets
    g.fillStyle(mix(lighten(STONE_MC, 0.2), WARM_LIGHT, 0.3), 0.3); g.fillRect(8, 44, 48, 1.5); // lit crest
  },
};

// Castle — three stages of a Northgard stronghold, grander each tier:
//   1 (village)  : modest keep, two short flanking towers, one banner.
//   2 (town)     : taller towers w/ conical roofs, wall wings, gatehouse arch,
//                  guard window glow, two banners.
//   3 (castle)   : massive keep + battlemented curtain, portcullis, gold-trimmed
//                  great banner, lit windows, gilt details, four banners.
function drawCastle(g: any, A: number, stage: 1 | 2 | 3) {
  const gold = 0xc9a84c;
  aoFoot(g, 6, 58, 52);
  const th = stage === 1 ? 30 : stage === 2 ? 35 : 40;        // flanking tower height
  const ty = 58 - th;
  // ---- Curtain wall wings (town+) behind the towers.
  if (stage >= 2) {
    box(g, 2, 46, 12, 12, STONE_DC); masonry(g, 2, 46, 12, 12, STONE_DC, 4); merlons(g, 2, 42, 12, STONE_MC);
    box(g, 50, 46, 12, 12, STONE_DC); masonry(g, 50, 46, 12, 12, STONE_DC, 4); merlons(g, 50, 42, 12, STONE_MC);
  }
  // ---- Flanking towers.
  for (const tx of [10, 41]) {
    box(g, tx, ty, 13, th, STONE_MC); masonry(g, tx, ty, 13, th, STONE_MC, 5); merlons(g, tx, ty - 2, 13, STONE_C);
    if (stage >= 2) { // conical roofs from town up
      g.fillStyle(ROOF_C, 1); g.fillTriangle(tx - 1, ty - 1, tx + 14, ty - 1, tx + 6.5, ty - 11);
      g.fillStyle(lighten(ROOF_C, 0.18), 1); g.fillTriangle(tx - 1, ty - 1, tx + 6.5, ty - 11, tx + 6.5, ty - 1);
      g.fillStyle(darken(ROOF_C, 0.22), 1); g.fillTriangle(tx + 14, ty - 1, tx + 6.5, ty - 11, tx + 6.5, ty - 1);
      g.fillStyle(gold, 1); g.fillCircle(tx + 6.5, ty - 11, 1.2); // finial
    } else {
      g.fillStyle(ROOF_C, 1); g.fillTriangle(tx - 1, ty, tx + 14, ty, tx + 6.5, ty - 7);
    }
    g.fillStyle(0x161018, 1); g.fillRect(tx + 5, ty + th * 0.45, 3, 6); // arrow slit
  }
  // Lit guard windows in towers (town+).
  if (stage >= 2) { window2(g, 13, ty + 6, 4, 5, true); window2(g, 44, ty + 6, 4, 5, true); }
  // ---- Central keep / gatehouse.
  const kw = stage === 3 ? 24 : 20, kx = 32 - kw / 2;
  box(g, kx, 28, kw, 30, stage === 3 ? STONE_C : STONE_MC); masonry(g, kx, 28, kw, 30, stage === 3 ? STONE_C : STONE_MC, 5);
  merlons(g, kx, 24, kw, STONE_DC);
  if (stage === 3) { // raised inner tower on the great keep
    box(g, 27, 18, 10, 12, STONE_C); merlons(g, 27, 14, 10, STONE_DC);
    g.fillStyle(ROOF_C, 1); g.fillTriangle(26, 14, 38, 14, 32, 6); g.fillStyle(lighten(ROOF_C, 0.18), 1); g.fillTriangle(26, 14, 32, 6, 32, 14);
    window2(g, 30, 20, 4, 5, true);
  }
  // ---- Gatehouse arch + door / portcullis.
  g.fillStyle(DOOR, 1); g.fillRect(28, 42, 8, 16); g.fillTriangle(28, 42, 36, 42, 32, 36);
  g.fillStyle(STONE_C, 1); g.fillTriangle(28, 42, 36, 42, 32, 37); g.fillStyle(lighten(STONE_C, 0.18), 1); g.fillTriangle(28, 42, 32, 37, 32, 42); // arch voussoirs
  g.fillStyle(DOOR, 1); g.fillRect(29, 43, 6, 15);
  if (stage >= 3) { g.lineStyle(1, mix(gold, 0x8a8e94, 0.4), 0.95); for (const lx of [29.5, 32, 34.5]) { g.beginPath(); g.moveTo(lx, 40); g.lineTo(lx, 58); g.strokePath(); } g.beginPath(); g.moveTo(29, 46); g.lineTo(35, 46); g.moveTo(29, 51); g.lineTo(35, 51); g.strokePath(); } // portcullis grid
  // ---- Keep windows.
  if (stage >= 2) { window2(g, 25, 34, 4, 5, true); window2(g, 35, 34, 4, 5, true); }
  else { g.fillStyle(0x161018, 1); g.fillRect(30, 34, 4, 6); }
  // ---- Banners — one (village), two (town), four + gold great-banner (castle).
  banner(g, 16, ty - 11, 8, A);
  if (stage >= 2) banner(g, 47, ty - 11, 8, A);
  if (stage >= 3) {
    banner(g, 5, 42, 8, A); banner(g, 59, 42, 8, A);
    // gold-trimmed great banner on the central spire
    g.fillStyle(gold, 1); g.fillRect(29, 4, 6, 1.5);
    g.fillStyle(A, 1); g.fillRect(29, 5.5, 6, 9); g.fillStyle(lighten(A, 0.2), 1); g.fillRect(29, 5.5, 2, 9);
    g.fillStyle(gold, 1); g.fillRect(29, 14.5, 6, 1.5); star(g, 32, 10, 2.6, 0xe8d28a);
  }
}

// ---- PHASE 2: player buildings ---------------------------------------------
export function generateBuildings(scene: any, accent = 0x1a3a8b) {
  for (const key of Object.keys(BUILD)) makeBuilding(scene, key, BUILD[key], accent);
  makeBuilding(scene, 'castle', (g, A) => drawCastle(g, A, 1), accent);
  makeBuilding(scene, 'castle_town', (g, A) => drawCastle(g, A, 2), accent);
  makeBuilding(scene, 'castle_castle', (g, A) => drawCastle(g, A, 3), accent);
}

// ---- PHASE 3: AI faction buildings -----------------------------------------
// Same silhouettes, but each faction gets a distinct stone/roof SKIN + accent so
// they read instantly apart from the player and each other:
//   RED    — darker, battle-worn cold stone; blood-red banners.
//   PURPLE — pale ornate stone + violet roofs; a faint magical (violet) accent.
//   YELLOW — cruder, mismatched sandy/brown stone; more, brighter flags.
// A faint post-pass adds the per-faction flavour (magic glow / extra flags).
const SKIN_RED: Skin = { stone: 0x6e5f54, stoneM: 0x554a40, stoneD: 0x3c352e, roof: 0x4a342a, wood: 0x7a5238 };
const SKIN_PURPLE: Skin = { stone: 0x9a8fa0, stoneM: 0x7d7088, stoneD: 0x5c5168, roof: 0x4a3a64, wood: 0x8a6a64 };
const SKIN_YELLOW: Skin = { stone: 0xa89a6a, stoneM: 0x8a7a48, stoneD: 0x665634, roof: 0x7a5a2a, wood: 0x9a7438 };

const AI_FACTIONS = [
  { accent: 0x9b1f1f, skin: SKIN_RED, flavour: 'red' as const, keys: { castle: 'enemy_castle', barracks: 'ai_barracks', tower: 'ai_tower', house: 'ai_house' } },
  { accent: 0x6a3ac0, skin: SKIN_PURPLE, flavour: 'purple' as const, keys: { castle: 'purple_castle', barracks: 'purple_barracks', tower: 'purple_tower', house: 'purple_house' } },
  { accent: 0xd4b020, skin: SKIN_YELLOW, flavour: 'yellow' as const, keys: { castle: 'yellow_castle', barracks: 'yellow_barracks', tower: 'yellow_tower', house: 'yellow_house' } },
];

// Wrap a building draw fn with a faction flavour overlay drawn on top.
function flavoured(draw: (g: any, A: number) => void, flavour: 'red' | 'purple' | 'yellow'): (g: any, A: number) => void {
  return (g, A) => {
    draw(g, A);
    if (flavour === 'red') {
      // soot / battle damage: dark smears + a scorch and a few cracks
      g.fillStyle(0x1a140e, 0.22); g.fillEllipse(24, 40, 10, 7); g.fillEllipse(42, 46, 7, 5);
      g.lineStyle(1, 0x1a140e, 0.5); g.beginPath(); g.moveTo(20, 36); g.lineTo(24, 44); g.lineTo(22, 50); g.strokePath();
    } else if (flavour === 'purple') {
      // faint arcane glow: violet rune wisps + sparkles
      g.fillStyle(0xb070ff, 0.12); g.fillCircle(32, 40, 14);
      g.fillStyle(0xc99aff, 0.85); for (const [x, y] of [[20, 30], [44, 28], [32, 22], [26, 44], [40, 46]] as any[]) g.fillCircle(x, y, 0.9);
      g.lineStyle(1, 0xb070ff, 0.45); g.strokeCircle(32, 40, 6);
    } else {
      // crude/mismatched + an extra ragged flag
      g.fillStyle(0x3a2c18, 0.18); g.fillRect(30, 34, 14, 22); // mud-patched wall
      flag(g, 46, 22, 7, A); flag(g, 14, 26, 6, darken(A, 0.2));
    }
  };
}

export function generateAIBuildings(scene: any) {
  for (const f of AI_FACTIONS) {
    makeBuilding(scene, f.keys.castle, flavoured((g, A) => drawCastle(g, A, 3), f.flavour), f.accent, f.skin); // AI seats render as full castles
    makeBuilding(scene, f.keys.barracks, flavoured(BUILD.barracks, f.flavour), f.accent, f.skin);
    makeBuilding(scene, f.keys.tower, flavoured(BUILD.tower, f.flavour), f.accent, f.skin);
    makeBuilding(scene, f.keys.house, flavoured(BUILD.house, f.flavour), f.accent, f.skin);
  }
}

// ---- unit spritesheet helpers ----------------------------------------------
// Units are 192x192 frames (the engine scales them by 36/192) so animation +
// scale math stays identical. We build a wide canvas, draw each frame, and add
// numeric sub-frames so generateFrameNumbers(key,{start,end}) keeps working.
const css = (n: number) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');
function fillRect2(ctx: any, x: number, y: number, w: number, h: number, c: number) { ctx.fillStyle = css(c); ctx.fillRect(x, y, w, h); }
function disc(ctx: any, x: number, y: number, r: number, c: number) { ctx.fillStyle = css(c); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

function spriteSheet(scene: any, key: string, frames: number, draw: (ctx: any, t: number, i: number) => void) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, frames * 192, 192);
  const ctx = tex.getContext();
  for (let i = 0; i < frames; i++) {
    ctx.save(); ctx.translate(i * 192, 0);
    draw(ctx, frames > 1 ? i / (frames - 1) : 0, i);
    ctx.restore();
    tex.add(i, 0, i * 192, 0, 192, 192);
  }
  tex.refresh();
}

// A humanoid centred at x=96, feet ~y150. opts drive pose + gear.
function figure(ctx: any, P: any, o: any = {}) {
  const cx = 96, gY = 150, bob = o.bob || 0, lean = o.lean || 0, lp = o.legPhase || 0;
  // Legs + boots (lp spreads them for the run cycle).
  fillRect2(ctx, cx - 9 + lp * 7, gY - 30 + bob, 8, 30, P.legs);
  fillRect2(ctx, cx + 1 - lp * 7, gY - 30 + bob, 8, 30, P.legs);
  fillRect2(ctx, cx - 10 + lp * 7, gY - 4 + bob, 10, 5, 0x241a10);
  fillRect2(ctx, cx + 0 - lp * 7, gY - 4 + bob, 10, 5, 0x241a10);
  // Cape (champion/knight) behind body.
  if (o.cape) { ctx.fillStyle = css(o.cape); ctx.beginPath(); ctx.moveTo(cx - 14 + lean, 74 + bob); ctx.lineTo(cx + 14 + lean, 74 + bob); ctx.lineTo(cx + 20 + lean, 128 + bob); ctx.lineTo(cx - 20 + lean, 128 + bob); ctx.closePath(); ctx.fill(); }
  // Torso.
  fillRect2(ctx, cx - 18 + lean, 72 + bob, 36, 50, P.tunic);
  fillRect2(ctx, cx - 18 + lean, 112 + bob, 36, 10, P.tunicDark);
  if (P.trim) fillRect2(ctx, cx - 18 + lean, 84 + bob, 36, 3, P.trim);
  // Head + face.
  disc(ctx, cx + lean, 56 + bob, 16, P.skin);
  disc(ctx, cx - 5 + lean, 55 + bob, 2, 0x20140c);
  disc(ctx, cx + 5 + lean, 55 + bob, 2, o.glowEyes ? 0x66ccff : 0x20140c);
  // Headgear.
  if (o.helmet) { ctx.fillStyle = css(P.helmet); ctx.beginPath(); ctx.arc(cx + lean, 54 + bob, 17, Math.PI, 0); ctx.fill(); ctx.fillRect(cx - 17 + lean, 52 + bob, 34, 4); if (o.visor) fillRect2(ctx, cx - 12 + lean, 54 + bob, 24, 4, 0x14202c); }
  if (o.hood) { ctx.fillStyle = css(P.hood); ctx.beginPath(); ctx.arc(cx + lean, 52 + bob, 18, Math.PI * 1.04, -Math.PI * 0.04); ctx.fill(); ctx.fillRect(cx - 18 + lean, 50 + bob, 36, 6); }
  if (o.ears) { ctx.fillStyle = css(P.skin); ctx.beginPath(); ctx.moveTo(cx - 14 + lean, 50 + bob); ctx.lineTo(cx - 28 + lean, 40 + bob); ctx.lineTo(cx - 12 + lean, 56 + bob); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(cx + 14 + lean, 50 + bob); ctx.lineTo(cx + 28 + lean, 40 + bob); ctx.lineTo(cx + 12 + lean, 56 + bob); ctx.closePath(); ctx.fill(); }
  // Shield on the left arm. (Assets V2) round=small buckler for cheaper units.
  if (o.shield && o.round) { disc(ctx, cx - 20 + lean, 92 + bob, 9, P.shield); ctx.strokeStyle = css(darken(P.shield, 0.3)); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx - 20 + lean, 92 + bob, 9, 0, Math.PI * 2); ctx.stroke(); disc(ctx, cx - 20 + lean, 92 + bob, 2, 0xcfcfcf); }
  else if (o.shield) { ctx.fillStyle = css(P.shield); ctx.beginPath(); ctx.moveTo(cx - 28 + lean, 80 + bob); ctx.lineTo(cx - 14 + lean, 80 + bob); ctx.lineTo(cx - 14 + lean, 100 + bob); ctx.lineTo(cx - 21 + lean, 108 + bob); ctx.lineTo(cx - 28 + lean, 100 + bob); ctx.closePath(); ctx.fill(); if (o.cross) fillRect2(ctx, cx - 22 + lean, 84 + bob, 2, 18, 0xe8c84a); }
  // Weapon arm (ang in radians from shoulder, 0 = straight down toward +x).
  const sx = cx + 16 + lean, sy = 84 + bob, ang = o.armAng != null ? o.armAng : Math.PI * 0.5;
  fillRect2(ctx, cx + 12 + lean, 76 + bob, 7, 26, P.tunic); // upper arm stub
  const hx = sx + Math.cos(ang) * 22, hy = sy + Math.sin(ang) * 22;
  ctx.strokeStyle = css(P.skin); ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
  drawWeapon(ctx, o.weapon, hx, hy, ang, P, o);
}

function drawWeapon(ctx: any, w: string, hx: number, hy: number, ang: number, P: any, o: any) {
  if (!w) return;
  const ex = hx + Math.cos(ang), ey = hy + Math.sin(ang);
  if (w === 'sword' || w === 'bigsword') {
    const len = w === 'bigsword' ? 46 : 32; const a = ang - Math.PI * 0.5; // blade points "up" from hand
    ctx.strokeStyle = css(0xd2d6dc); ctx.lineWidth = w === 'bigsword' ? 6 : 4; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(a) * len, hy + Math.sin(a) * len); ctx.stroke();
    ctx.strokeStyle = css(0x6b4a28); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(hx - Math.cos(a) * 5, hy - Math.sin(a) * 5); ctx.lineTo(hx + Math.cos(a) * 5, hy + Math.sin(a) * 5); ctx.stroke();
  } else if (w === 'axe') {
    ctx.strokeStyle = css(0x6b4a28); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(hx, hy + 10); ctx.lineTo(hx, hy - 22); ctx.stroke();
    ctx.fillStyle = css(0xb8bcc2); ctx.beginPath(); ctx.moveTo(hx, hy - 22); ctx.lineTo(hx + 12, hy - 18); ctx.lineTo(hx + 10, hy - 6); ctx.lineTo(hx, hy - 12); ctx.closePath(); ctx.fill();
  } else if (w === 'pickaxe') {
    ctx.strokeStyle = css(0x6b4a28); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(hx, hy + 10); ctx.lineTo(hx, hy - 22); ctx.stroke();
    ctx.strokeStyle = css(0x9aa0a6); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(hx - 12, hy - 18); ctx.quadraticCurveTo(hx, hy - 26, hx + 12, hy - 18); ctx.stroke();
  } else if (w === 'bow') {
    const pull = o.pull || 0; // 0..1 string draw
    ctx.strokeStyle = css(0x8b5e3c); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(hx, hy, 22, ang - 1.1, ang + 1.1); ctx.stroke();
    const t1x = hx + Math.cos(ang - 1.1) * 22, t1y = hy + Math.sin(ang - 1.1) * 22, t2x = hx + Math.cos(ang + 1.1) * 22, t2y = hy + Math.sin(ang + 1.1) * 22;
    const mx = hx - Math.cos(ang) * (6 - pull * 10), my = hy - Math.sin(ang) * (6 - pull * 10);
    ctx.strokeStyle = '#eee'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(t1x, t1y); ctx.lineTo(mx, my); ctx.lineTo(t2x, t2y); ctx.stroke();
    ctx.strokeStyle = css(0xeae0c8); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + Math.cos(ang) * 22, my + Math.sin(ang) * 22); ctx.stroke();
  } else if (w === 'staff') {
    ctx.strokeStyle = css(0x8b5e3c); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(hx, hy + 14); ctx.lineTo(hx, hy - 30); ctx.stroke();
    if (o.healGlow) disc(ctx, hx, hy - 32, 4 + o.healGlow * 6, 0xfff2a8);
    if (o.magic) { ctx.globalAlpha = 0.5; disc(ctx, hx, hy - 32, 7, o.magic); ctx.globalAlpha = 1; disc(ctx, hx, hy - 32, 3.5, o.magic); } // (Assets V2) shaman magic
  } else if (w === 'spear') {
    // (Assets V2) Long thin shaft with a small triangular tip — pike reach.
    const a = ang - Math.PI * 0.5, len = 54;
    const ex = hx + Math.cos(a) * len, ey = hy + Math.sin(a) * len, bx = hx - Math.cos(a) * 12, by = hy - Math.sin(a) * 12;
    ctx.strokeStyle = css(0x8b5e3c); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
    const px = Math.cos(a + Math.PI / 2), py = Math.sin(a + Math.PI / 2);
    ctx.fillStyle = css(0xd2d6dc); ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(a) * 9 + px * 4, ey - Math.sin(a) * 9 + py * 4); ctx.lineTo(ex - Math.cos(a) * 9 - px * 4, ey - Math.sin(a) * 9 - py * 4); ctx.closePath(); ctx.fill();
  } else if (w === 'club') {
    const a = ang - Math.PI * 0.5;
    ctx.strokeStyle = css(0x6b4a28); ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(a) * 20, hy + Math.sin(a) * 20); ctx.stroke();
    disc(ctx, hx + Math.cos(a) * 22, hy + Math.sin(a) * 22, 6, 0x5c3a1e);
  }
  // Carried resource (pawns) drawn over the shoulder.
  if (o.carry) { const c = o.carry === 'wood' ? 0x8b5e3c : o.carry === 'gold' ? 0xe8c84a : 0xc0504a; fillRect2(ctx, 96 - 6, 64 + (o.bob || 0), 12, 8, c); }
}

// Per-state pose generators ---------------------------------------------------
const PAL: Record<string, any> = {
  warriorB: { tunic: 0x2a4a9b, tunicDark: 0x1a306b, legs: 0x3a2a1a, skin: 0xe2b78c, helmet: 0x7a8088, shield: 0x2a4a9b },
  warriorR: { tunic: 0x9b2a2a, tunicDark: 0x6b1a1a, legs: 0x3a2a1a, skin: 0xe2b78c, helmet: 0x5a4040, shield: 0x9b2a2a },
  warriorY: { tunic: 0xb39a2a, tunicDark: 0x7a661a, legs: 0x4a3a1a, skin: 0xe2b78c, helmet: 0x6a5a30, shield: 0xb39a2a },
  warriorP: { tunic: 0x6a3aa0, tunicDark: 0x44206b, legs: 0x3a2a1a, skin: 0xe2b78c, helmet: 0x5a4a78, shield: 0x6a3aa0 },
  archer: { tunic: 0x3a6a3a, tunicDark: 0x244a24, legs: 0x4a3a22, skin: 0xe2b78c, hood: 0x2f5a2f },
  archerR: { tunic: 0x7a3030, tunicDark: 0x521e1e, legs: 0x4a3a22, skin: 0xe2b78c, hood: 0x6a2424 },
  monk: { tunic: 0x6b4a2a, tunicDark: 0x4a3018, legs: 0x4a3018, skin: 0xe2b78c, hood: 0x5c3e1e },
  pawn: { tunic: 0x7a5a3a, tunicDark: 0x523c24, legs: 0x4a3624, skin: 0xe2b78c },
  goblin: { tunic: 0x3a5a24, tunicDark: 0x24401a, legs: 0x2a3a18, skin: 0x4a7a2a, hood: 0x2a401a },
  // (Assets V2) Spearman — lighter/cheaper blue armour than the warrior.
  spearman: { tunic: 0x3a6ab0, tunicDark: 0x274a86, legs: 0x3a2a1a, skin: 0xe2b78c, helmet: 0x9aa6b2, shield: 0x3a6ab0 },
  // (Assets V2) Goblin shaman — dark robes, sickly green skin.
  goblinShaman: { tunic: 0x223018, tunicDark: 0x161f0f, legs: 0x1c2812, skin: 0x5a8a3a, hood: 0x182410 },
  // (Assets V2) Goblin warlord — bigger, mismatched brown/gray war-gear.
  goblinWarlord: { tunic: 0x4a3a26, tunicDark: 0x2e2416, legs: 0x2a2418, skin: 0x4a7a2a, helmet: 0x6b6b64, shield: 0x5c4a2e },
};

function idlePose(t: number) { return { bob: Math.round(Math.sin(t * Math.PI * 2) * 1.5) }; }
function runPose(t: number) { return { legPhase: Math.sin(t * Math.PI * 2), bob: -Math.abs(Math.round(Math.cos(t * Math.PI * 2) * 2)), lean: 2 }; }

// Generate the standard 4-state set (idle/run/attack/attack2) for a warrior-type.
function warriorSheets(scene: any, P: any, keys: { idle: string; run: string; atk?: string; atk2?: string }, gear: any = {}) {
  spriteSheet(scene, keys.idle, 8, (ctx, t) => figure(ctx, P, { ...gear, ...idlePose(t), weapon: gear.weapon || 'sword', armAng: Math.PI * 0.5 }));
  spriteSheet(scene, keys.run, 6, (ctx, t) => figure(ctx, P, { ...gear, ...runPose(t), weapon: gear.weapon || 'sword', armAng: Math.PI * 0.55 }));
  if (keys.atk) spriteSheet(scene, keys.atk, 4, (ctx, t) => figure(ctx, P, { ...gear, weapon: gear.weapon || 'sword', armAng: Math.PI * (0.95 - t * 0.7) })); // wind up -> swing
  if (keys.atk2) spriteSheet(scene, keys.atk2, 4, (ctx, t) => figure(ctx, P, { ...gear, weapon: gear.weapon || 'sword', armAng: Math.PI * (0.25 + t * 0.3) })); // follow through
}

// ---- PHASE 4: player units -------------------------------------------------
export function generateUnits(scene: any) {
  // Warrior (blue) — sword + shield + helmet.
  warriorSheets(scene, PAL.warriorB, { idle: 'blue_warrior_idle', run: 'blue_warrior_run', atk: 'blue_warrior_attack', atk2: 'blue_warrior_attack2' }, { helmet: true, shield: true });
  // Knight (BattleScene 'blue_lancer') — heavier, caped, big sword.
  spriteSheet(scene, 'blue_lancer', 8, (ctx, t) => figure(ctx, PAL.warriorB, { helmet: true, visor: true, shield: true, cross: true, cape: 0x2a4a9b, weapon: 'bigsword', ...idlePose(t), armAng: Math.PI * 0.5 }));

  // Archer (blue) — bow + green hood, no shield.
  spriteSheet(scene, 'blue_archer_idle', 6, (ctx, t) => figure(ctx, PAL.archer, { hood: true, weapon: 'bow', ...idlePose(t), armAng: 0 }));
  spriteSheet(scene, 'blue_archer_run', 4, (ctx, t) => figure(ctx, PAL.archer, { hood: true, weapon: 'bow', ...runPose(t), armAng: 0.2 }));
  spriteSheet(scene, 'blue_archer_shoot', 8, (ctx, t) => figure(ctx, PAL.archer, { hood: true, weapon: 'bow', armAng: 0, pull: t < 0.7 ? t / 0.7 : 0 })); // draw then release

  // Monk — robe + hood + staff, no weapon dmg.
  spriteSheet(scene, 'monk_idle', 6, (ctx, t) => figure(ctx, PAL.monk, { hood: true, weapon: 'staff', ...idlePose(t), armAng: Math.PI * 0.5 }));
  spriteSheet(scene, 'monk_run', 4, (ctx, t) => figure(ctx, PAL.monk, { hood: true, weapon: 'staff', ...runPose(t), armAng: Math.PI * 0.55 }));
  spriteSheet(scene, 'monk_heal', 11, (ctx, t) => figure(ctx, PAL.monk, { hood: true, weapon: 'staff', armAng: Math.PI * 0.2, healGlow: Math.sin(t * Math.PI) }));
  // Heal effect — 11-frame one-shot: a rising green-gold glow + sparkles.
  spriteSheet(scene, 'heal_effect', 11, (ctx, t) => {
    ctx.globalAlpha = 0.6 * (1 - t * 0.7); disc(ctx, 96, 110 - t * 40, 22 + t * 14, 0x9be88a);
    ctx.globalAlpha = 0.9 * (1 - t); disc(ctx, 96, 110 - t * 40, 8, 0xfff2a8);
    ctx.globalAlpha = 1;
  });

  // Pawn / worker — peasant; run variants carry resources / hold tools; interact
  // variants are the chopping / mining poses.
  spriteSheet(scene, 'pawn_idle', 8, (ctx, t) => figure(ctx, PAL.pawn, { ...idlePose(t), armAng: Math.PI * 0.5 }));
  spriteSheet(scene, 'pawn_run', 6, (ctx, t) => figure(ctx, PAL.pawn, { ...runPose(t), armAng: Math.PI * 0.55 }));
  for (const [key, carry] of [['pawn_run_wood', 'wood'], ['pawn_run_gold', 'gold'], ['pawn_run_meat', 'meat']] as any[]) {
    spriteSheet(scene, key, 6, (ctx, t) => figure(ctx, PAL.pawn, { ...runPose(t), carry, armAng: Math.PI * 0.55 }));
  }
  spriteSheet(scene, 'pawn_run_axe', 6, (ctx, t) => figure(ctx, PAL.pawn, { ...runPose(t), weapon: 'axe', armAng: Math.PI * 0.55 }));
  spriteSheet(scene, 'pawn_run_pickaxe', 6, (ctx, t) => figure(ctx, PAL.pawn, { ...runPose(t), weapon: 'pickaxe', armAng: Math.PI * 0.55 }));
  spriteSheet(scene, 'pawn_interact_axe', 6, (ctx, t) => figure(ctx, PAL.pawn, { weapon: 'axe', armAng: Math.PI * (0.9 - Math.abs(Math.sin(t * Math.PI)) * 0.6), lean: 4 }));
  spriteSheet(scene, 'pawn_interact_pickaxe', 6, (ctx, t) => figure(ctx, PAL.pawn, { weapon: 'pickaxe', armAng: Math.PI * (0.9 - Math.abs(Math.sin(t * Math.PI)) * 0.6), lean: 4 }));
}

// A four-legged beast (wolf / boar) centred at x=96, feet ~y150.
function beastFig(ctx: any, t: number, kind: 'wolf' | 'boar') {
  const cx = 96, gY = 148, step = Math.sin(t * Math.PI * 2) * 4;
  const body = kind === 'wolf' ? 0x55555c : 0x6b4a2a;
  const belly = kind === 'wolf' ? 0x7a7a82 : 0x8a6238;
  // legs
  ctx.fillStyle = css(0x2a2a2e);
  for (const [lx, ph] of [[-22, 1], [-8, -1], [8, 1], [22, -1]] as any[]) { ctx.fillRect(cx + lx, gY - 18, 6, 18 + ph * step); }
  // body (elongated)
  ctx.fillStyle = css(body); ctx.beginPath(); ctx.ellipse(cx, gY - 30, kind === 'wolf' ? 34 : 30, kind === 'wolf' ? 16 : 18, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = css(belly); ctx.beginPath(); ctx.ellipse(cx, gY - 22, kind === 'wolf' ? 26 : 22, 7, 0, 0, Math.PI * 2); ctx.fill();
  // head (front = +x)
  const hx = cx + (kind === 'wolf' ? 32 : 30), hy = gY - (kind === 'wolf' ? 38 : 34);
  disc(ctx, hx, hy, kind === 'wolf' ? 13 : 15, body);
  if (kind === 'wolf') { ctx.fillStyle = css(body); ctx.beginPath(); ctx.moveTo(hx + 6, hy - 12); ctx.lineTo(hx + 12, hy - 22); ctx.lineTo(hx + 14, hy - 10); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(hx - 4, hy - 12); ctx.lineTo(hx - 2, hy - 22); ctx.lineTo(hx + 4, hy - 12); ctx.closePath(); ctx.fill(); disc(ctx, hx + 12, hy + 2, 4, belly); } // ears + snout
  else { disc(ctx, hx + 12, hy + 2, 6, belly); ctx.fillStyle = '#eee'; ctx.fillRect(hx + 14, hy + 4, 4, 2); ctx.fillRect(hx + 14, hy - 2, 4, 2); } // boar snout + tusks
  disc(ctx, hx + (kind === 'wolf' ? 4 : 6), hy - 2, 1.8, kind === 'wolf' ? 0xffd24a : 0x20140c); // eye
  // tail
  ctx.strokeStyle = css(body); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx - 32, gY - 32); ctx.lineTo(cx - 42, gY - 38 + step); ctx.stroke();
}

// ---- PHASE 5: enemy + wildlife units ---------------------------------------
export function generateEnemyUnits(scene: any) {
  warriorSheets(scene, PAL.warriorR, { idle: 'warrior_idle', run: 'red_warrior_run', atk: 'red_warrior_attack', atk2: 'red_warrior_attack2' }, { helmet: true, shield: true });
  warriorSheets(scene, PAL.warriorY, { idle: 'yellow_warrior_idle', run: 'yellow_warrior_run', atk: 'yellow_warrior_attack', atk2: 'yellow_warrior_attack2' }, { helmet: true, shield: true });
  warriorSheets(scene, PAL.warriorP, { idle: 'purple_warrior_idle', run: 'purple_warrior_run', atk: 'purple_warrior_attack', atk2: 'purple_warrior_attack2' }, { helmet: true, shield: true });
  // Goblins — green, ragged, club, oversized ears, hunched (lean).
  warriorSheets(scene, PAL.goblin, { idle: 'goblin_idle', run: 'goblin_run', atk: 'goblin_attack', atk2: 'goblin_attack2' }, { weapon: 'club', ears: true, lean: 3 });
  // Red archer.
  spriteSheet(scene, 'red_archer_idle', 6, (ctx, t) => figure(ctx, PAL.archerR, { hood: true, weapon: 'bow', ...idlePose(t), armAng: 0 }));
  spriteSheet(scene, 'red_archer_shoot', 8, (ctx, t) => figure(ctx, PAL.archerR, { hood: true, weapon: 'bow', armAng: 0, pull: t < 0.7 ? t / 0.7 : 0 }));
  // Wildlife.
  spriteSheet(scene, 'wolf_idle', 6, (ctx, t) => beastFig(ctx, t, 'wolf'));
  spriteSheet(scene, 'boar_idle', 6, (ctx, t) => beastFig(ctx, t, 'boar'));
}

// ---- Assets V2: new units + wildlife ---------------------------------------
// Two horn points rising off a helmet (goblin warlord). Head sits ~y56.
function horns(ctx: any) {
  const cx = 96; ctx.fillStyle = css(0x9aa0a6);
  ctx.beginPath(); ctx.moveTo(cx - 12, 46); ctx.lineTo(cx - 20, 30); ctx.lineTo(cx - 6, 44); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx + 12, 46); ctx.lineTo(cx + 20, 30); ctx.lineTo(cx + 6, 44); ctx.closePath(); ctx.fill();
}

// A mounted lancer: a brown horse with a seated warrior and a forward lance.
// Centred at x=96, hooves ~y150 (matches the humanoid figure baseline).
function cavalryFig(ctx: any, bob: number, gait: number, thrust = 0) {
  const cx = 96, gY = 150, body = 0x8b5e3c, dark = 0x5c3d1e, sway = gait * 4;
  // legs (4 stubs, alternating with gait)
  ctx.fillStyle = css(dark);
  for (const [lx, ph] of [[-28, 1], [-16, -1], [16, 1], [28, -1]] as any[]) ctx.fillRect(cx + lx, gY - 24, 6, 24 + ph * sway);
  // barrel body + belly
  ctx.fillStyle = css(body); ctx.beginPath(); ctx.ellipse(cx, gY - 36, 40, 17, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = css(dark); ctx.beginPath(); ctx.ellipse(cx, gY - 29, 32, 8, 0, 0, Math.PI * 2); ctx.fill();
  // neck + head (front = +x)
  ctx.fillStyle = css(body); ctx.beginPath(); ctx.moveTo(cx + 30, gY - 46); ctx.lineTo(cx + 46, gY - 68); ctx.lineTo(cx + 54, gY - 62); ctx.lineTo(cx + 40, gY - 40); ctx.closePath(); ctx.fill();
  disc(ctx, cx + 52, gY - 66, 7, body);
  ctx.fillStyle = css(0x20140c); ctx.fillRect(cx + 56, gY - 68, 2, 2); // eye
  // mane + tail
  ctx.strokeStyle = css(dark); ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(cx + 34, gY - 56); ctx.lineTo(cx + 30, gY - 44); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 38, gY - 46); ctx.lineTo(cx - 50, gY - 30 + sway); ctx.stroke();
  // rider (seated warrior torso + head + helm)
  const ry = gY - 62 + bob;
  ctx.fillStyle = css(PAL.warriorB.tunic); ctx.fillRect(cx - 12, ry, 22, 26);
  ctx.fillStyle = css(PAL.warriorB.tunicDark); ctx.fillRect(cx - 12, ry + 20, 22, 6);
  disc(ctx, cx - 1, ry - 8, 12, PAL.warriorB.skin);
  ctx.fillStyle = css(PAL.warriorB.helmet); ctx.beginPath(); ctx.arc(cx - 1, ry - 9, 13, Math.PI, 0); ctx.fill(); ctx.fillRect(cx - 14, ry - 11, 26, 3);
  // lance extending forward over the horse's head
  const lx0 = cx + 6, ly0 = ry + 4, lx1 = cx + 70 + thrust * 14, ly1 = ry - 6;
  ctx.strokeStyle = css(0x8b5e3c); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(lx0 - 18, ly0 + 6); ctx.lineTo(lx1, ly1); ctx.stroke();
  ctx.fillStyle = css(0xd2d6dc); ctx.beginPath(); ctx.moveTo(lx1, ly1); ctx.lineTo(lx1 - 10, ly1 - 4); ctx.lineTo(lx1 - 10, ly1 + 4); ctx.closePath(); ctx.fill();
}

// A slim grazing deer (128x128 frame, hooves ~y100). Head angled down to graze.
function deerFig(ctx: any, t: number) {
  const cx = 60, gY = 102, b = Math.sin(t * Math.PI * 2) * 1.5, body = 0x9a6a44, dark = 0x6b4423;
  ctx.fillStyle = css(dark);
  for (const lx of [-20, -10, 8, 18]) ctx.fillRect(cx + lx, gY - 18, 3.5, 18);
  ctx.fillStyle = css(body); ctx.beginPath(); ctx.ellipse(cx, gY - 24 + b, 24, 10, 0, 0, Math.PI * 2); ctx.fill();
  // lowered head + neck (front +x)
  ctx.fillStyle = css(body); ctx.beginPath(); ctx.moveTo(cx + 20, gY - 26 + b); ctx.lineTo(cx + 32, gY - 8 + b); ctx.lineTo(cx + 37, gY - 12 + b); ctx.lineTo(cx + 25, gY - 28 + b); ctx.closePath(); ctx.fill();
  disc(ctx, cx + 35, gY - 12 + b, 5, body);
  ctx.strokeStyle = css(dark); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx + 35, gY - 16 + b); ctx.lineTo(cx + 31, gY - 25 + b); ctx.moveTo(cx + 37, gY - 16 + b); ctx.lineTo(cx + 41, gY - 25 + b); ctx.stroke();
  ctx.fillStyle = css(0x20140c); ctx.fillRect(cx + 36, gY - 13 + b, 1.5, 1.5);
  ctx.fillStyle = '#efe9dc'; ctx.fillRect(cx - 24, gY - 26 + b, 3, 5); // white tail
}

// A massive dragon (160x120 frame), wings spread, fire glow under the maw.
function dragonFig(ctx: any) {
  const cx = 80, cy = 58;
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(cx, 108, 58, 12, 0, 0, Math.PI * 2); ctx.fill(); // ground shadow
  // wings (two large triangles up & back)
  ctx.fillStyle = css(0x401018); ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx - 70, cy - 44); ctx.lineTo(cx - 30, cy + 14); ctx.closePath(); ctx.fill();
  ctx.fillStyle = css(0x521820); ctx.beginPath(); ctx.moveTo(cx + 6, cy); ctx.lineTo(cx + 70, cy - 44); ctx.lineTo(cx + 30, cy + 14); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = css(0x2a0a10); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx - 50, cy - 30); ctx.moveTo(cx + 6, cy); ctx.lineTo(cx + 50, cy - 30); ctx.stroke();
  // body (irregular dark-red polygon)
  ctx.fillStyle = css(0x6a1c22); ctx.beginPath(); ctx.moveTo(cx - 18, cy - 4); ctx.lineTo(cx + 18, cy - 6); ctx.lineTo(cx + 30, cy + 18); ctx.lineTo(cx, cy + 34); ctx.lineTo(cx - 28, cy + 16); ctx.closePath(); ctx.fill();
  ctx.fillStyle = css(0x4a1218); ctx.beginPath(); ctx.moveTo(cx, cy + 6); ctx.lineTo(cx + 14, cy + 20); ctx.lineTo(cx, cy + 30); ctx.lineTo(cx - 12, cy + 20); ctx.closePath(); ctx.fill(); // belly scales
  // tail
  ctx.strokeStyle = css(0x6a1c22); ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(cx - 20, cy + 18); ctx.quadraticCurveTo(cx - 50, cy + 40, cx - 64, cy + 20); ctx.stroke();
  ctx.fillStyle = css(0x521820); ctx.beginPath(); ctx.moveTo(cx - 64, cy + 20); ctx.lineTo(cx - 76, cy + 14); ctx.lineTo(cx - 70, cy + 28); ctx.closePath(); ctx.fill();
  // neck + angular horned head (front +x)
  ctx.fillStyle = css(0x6a1c22); ctx.beginPath(); ctx.moveTo(cx + 12, cy - 4); ctx.lineTo(cx + 40, cy - 22); ctx.lineTo(cx + 50, cy - 14); ctx.lineTo(cx + 22, cy + 6); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx + 44, cy - 24); ctx.lineTo(cx + 64, cy - 18); ctx.lineTo(cx + 58, cy - 6); ctx.lineTo(cx + 44, cy - 10); ctx.closePath(); ctx.fill(); // jaw
  ctx.fillStyle = css(0x3a0e12); ctx.beginPath(); ctx.moveTo(cx + 46, cy - 24); ctx.lineTo(cx + 42, cy - 36); ctx.lineTo(cx + 52, cy - 26); ctx.closePath(); ctx.fill(); // horn
  disc(ctx, cx + 52, cy - 16, 2.4, 0xff7a1a); disc(ctx, cx + 52, cy - 16, 1.2, 0xffe24a); // glowing eye
  // fire glow under the maw
  ctx.globalAlpha = 0.85; disc(ctx, cx + 64, cy - 4, 6, 0xff7a1a); ctx.globalAlpha = 1; disc(ctx, cx + 64, cy - 4, 3, 0xffd24a);
}

export function generateV2Units(scene: any) {
  // Spearman — warrior with a long pike + small round buckler, lighter armour.
  warriorSheets(scene, PAL.spearman, { idle: 'spearman_idle', run: 'spearman_run', atk: 'spearman_attack', atk2: 'spearman_attack2' }, { helmet: true, shield: true, round: true, weapon: 'spear' });
  // Cavalry — mounted lancer (idle bob, run gait, attack thrust).
  spriteSheet(scene, 'cavalry_idle', 8, (ctx, t) => cavalryFig(ctx, idlePose(t).bob, 0));
  spriteSheet(scene, 'cavalry_run', 6, (ctx, t) => cavalryFig(ctx, 0, Math.sin(t * Math.PI * 2)));
  spriteSheet(scene, 'cavalry_attack', 4, (ctx, t) => cavalryFig(ctx, 0, 0.4, t));
  // Goblin shaman — robed, hooded, staff with a purple magical glow.
  spriteSheet(scene, 'goblin_shaman', 6, (ctx, t) => figure(ctx, PAL.goblinShaman, { hood: true, ears: true, weapon: 'staff', magic: 0xb060ff, ...idlePose(t), armAng: Math.PI * 0.5 }));
  spriteSheet(scene, 'goblin_shaman_run', 6, (ctx, t) => figure(ctx, PAL.goblinShaman, { hood: true, ears: true, weapon: 'staff', magic: 0xb060ff, ...runPose(t), armAng: Math.PI * 0.55 }));
  // Goblin warlord — bigger, horned helm, oversized cleaver.
  spriteSheet(scene, 'goblin_warlord', 6, (ctx, t) => { figure(ctx, PAL.goblinWarlord, { helmet: true, ears: true, weapon: 'bigsword', ...idlePose(t), armAng: Math.PI * 0.5 }); horns(ctx); });
  spriteSheet(scene, 'goblin_warlord_run', 6, (ctx, t) => { figure(ctx, PAL.goblinWarlord, { helmet: true, ears: true, weapon: 'bigsword', ...runPose(t), armAng: Math.PI * 0.55 }); horns(ctx); });
  // Deer — peaceful grazer (128px frame like the boar).
  objSheet(scene, 'deer_idle', 6, 128, 128, (ctx, t) => deerFig(ctx, t));
  // Dragon — single huge frame, spawned over the kingdom during the disaster.
  objSheet(scene, 'dragon', 1, 160, 120, (ctx) => dragonFig(ctx));
}

// ---- world-object helpers --------------------------------------------------
// Object spritesheet with custom frame size + numeric frames.
function objSheet(scene: any, key: string, frames: number, fw: number, fh: number, draw: (ctx: any, t: number, i: number) => void) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, frames * fw, fh);
  const ctx = tex.getContext();
  for (let i = 0; i < frames; i++) { ctx.save(); ctx.translate(i * fw, 0); draw(ctx, frames > 1 ? i / (frames - 1) : 0, i); ctx.restore(); tex.add(i, 0, i * fw, 0, fw, fh); }
  tex.refresh();
}
// Reskin a single-image texture key, keeping its native pixel size so the
// existing node scale/oy values still position it correctly.
function reskinImage(scene: any, key: string, fallbackW: number, fallbackH: number, draw: (ctx: any, w: number, h: number) => void) {
  if (scene.textures.exists(key)) return; // generate once; persists across restarts
  const tex = scene.textures.createCanvas(key, fallbackW, fallbackH);
  const w = fallbackW, h = fallbackH;
  draw(tex.getContext(), w, h);
  tex.refresh();
}

// ---- PHASE 6: world objects ------------------------------------------------
export function generateWorldObjects(scene: any) {
  // Oak (tree1) — round canopy. 128x256 frame, trunk base at bottom-centre.
  objSheet(scene, 'tree1', 1, 128, 256, (ctx) => {
    fillRect2(ctx, 56, 150, 16, 102, 0x5c3a1e); fillRect2(ctx, 52, 232, 24, 20, 0x4a2e16); // trunk
    for (const [x, y, r, c] of [[64, 110, 46, 0x1f5a22], [40, 130, 34, 0x1a4a1c], [88, 130, 34, 0x1a4a1c], [64, 80, 36, 0x256a28]] as any[]) disc(ctx, x, y, r, c);
    disc(ctx, 50, 92, 16, 0x2f7a30); // highlight
  });
  // Pine (tree2) — three triangle layers. 128x256.
  objSheet(scene, 'tree2', 1, 128, 256, (ctx) => {
    fillRect2(ctx, 58, 180, 12, 72, 0x5c3a1e);
    const tri = (cy: number, w: number, c: number) => { ctx.fillStyle = css(c); ctx.beginPath(); ctx.moveTo(64, cy - 60); ctx.lineTo(64 + w, cy); ctx.lineTo(64 - w, cy); ctx.closePath(); ctx.fill(); };
    tri(190, 50, 0x18441a); tri(140, 44, 0x1d5020); tri(96, 36, 0x236526);
  });
  // Sheep (food node) — 128x128, 6 frames with a gentle graze bob.
  objSheet(scene, 'sheep_idle', 6, 128, 128, (ctx, t) => {
    const b = Math.sin(t * Math.PI * 2) * 2;
    fillRect2(ctx, 50, 96 + b, 6, 16, 0x2a2a2a); fillRect2(ctx, 74, 96 + b, 6, 16, 0x2a2a2a); // legs
    for (const [x, y] of [[64, 78], [48, 82], [80, 82], [56, 70], [72, 70]] as any[]) disc(ctx, x, y + b, 16, 0xf0eee6); // fluffy body
    disc(ctx, 88, 84 + b, 9, 0x2a2a2a); // head
  });
  // Gold deposit (gold node).
  reskinImage(scene, 'gold_stone', 96, 96, (ctx, w, h) => {
    const cx = w / 2, by = h * 0.82;
    ctx.fillStyle = css(0x6f6f68); ctx.beginPath(); ctx.ellipse(cx, by, w * 0.4, h * 0.26, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = css(0xe8c84a); ctx.lineWidth = Math.max(2, w * 0.04);
    ctx.beginPath(); ctx.moveTo(cx - w * 0.25, by); ctx.lineTo(cx - w * 0.05, by - h * 0.12); ctx.moveTo(cx + w * 0.05, by - h * 0.05); ctx.lineTo(cx + w * 0.22, by - h * 0.16); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillRect(cx - w * 0.18, by - h * 0.12, 3, 3); // glint
  });
  // Stone rocks (rock1-4) — gray boulders with a light face + crack.
  for (const k of ['rock1', 'rock2', 'rock3', 'rock4']) reskinImage(scene, k, 64, 56, (ctx, w, h) => {
    const cx = w / 2, by = h * 0.82;
    ctx.fillStyle = css(0x7d7d74); ctx.beginPath(); ctx.moveTo(cx - w * 0.4, by); ctx.lineTo(cx - w * 0.22, by - h * 0.42); ctx.lineTo(cx + w * 0.12, by - h * 0.5); ctx.lineTo(cx + w * 0.4, by - h * 0.18); ctx.lineTo(cx + w * 0.34, by); ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(0x95958c); ctx.beginPath(); ctx.moveTo(cx - w * 0.22, by - h * 0.42); ctx.lineTo(cx + w * 0.12, by - h * 0.5); ctx.lineTo(cx - w * 0.02, by - h * 0.28); ctx.closePath(); ctx.fill(); // light face
    ctx.strokeStyle = css(0x55554f); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, by - h * 0.4); ctx.lineTo(cx + w * 0.06, by - h * 0.16); ctx.stroke();
  });
  // Siege engine (catapult) — used by world Troops + BattleScene siege units.
  objSheet(scene, 'siege_unit', 1, 192, 192, (ctx) => {
    const cx = 96, gy = 140;
    ctx.fillStyle = css(0x5c3a1e); ctx.fillRect(cx - 34, gy - 16, 68, 14);     // frame
    ctx.strokeStyle = css(0x6b4a28); ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(cx - 26, gy - 16); ctx.lineTo(cx + 18, gy - 64); ctx.stroke(); // throwing arm
    ctx.fillStyle = css(0x9aa0a6); ctx.beginPath(); ctx.arc(cx + 20, gy - 66, 11, 0, Math.PI * 2); ctx.fill(); // boulder
    ctx.fillStyle = css(0x2a2a2e); ctx.beginPath(); ctx.arc(cx - 24, gy, 14, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(cx + 24, gy, 14, 0, Math.PI * 2); ctx.fill(); // wheels
    ctx.fillStyle = css(0x6b4a28); ctx.fillRect(cx - 38, gy - 30, 8, 30); ctx.fillRect(cx + 30, gy - 30, 8, 30); // supports
  });
  // Iron deposit (Phase 6 of the completion plan uses this) — rust-veined rock.
  reskinImage(scene, 'iron_node', 80, 72, (ctx, w, h) => {
    const cx = w / 2, by = h * 0.82;
    ctx.fillStyle = css(0x55555c); ctx.beginPath(); ctx.ellipse(cx, by - h * 0.18, w * 0.4, h * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = css(0xb5651d); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx - w * 0.22, by - h * 0.1); ctx.lineTo(cx + w * 0.05, by - h * 0.3); ctx.moveTo(cx - w * 0.02, by - h * 0.08); ctx.lineTo(cx + w * 0.2, by - h * 0.26); ctx.stroke();
  });
}

// ---- PHASE 7: UI elements --------------------------------------------------
// The HUD panels/buttons/bars are already drawn as clean Phaser Graphics shapes,
// so the only texture-based UI is the resource icons. We reskin those crisply.
// (planks / cutStone icons added here too for the manufacturing chains.)
export function generateUI(scene: any) {
  reskinImage(scene, 'icon_wood', 32, 32, (ctx, w, h) => {
    ctx.fillStyle = css(0x8b5e3c); ctx.fillRect(w * 0.15, h * 0.4, w * 0.7, h * 0.28);
    ctx.fillStyle = css(0xc89a5a); ctx.beginPath(); ctx.ellipse(w * 0.85, h * 0.54, w * 0.09, h * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = css(0x6b4423); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(w * 0.85, h * 0.54, w * 0.05, 0, Math.PI * 2); ctx.stroke();
  });
  reskinImage(scene, 'icon_gold', 32, 32, (ctx, w, h) => {
    disc(ctx, w / 2, h / 2, w * 0.4, 0xe8c84a); ctx.strokeStyle = css(0xb5912a); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.4, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = css(0xfff2a8); ctx.fillRect(w * 0.42, h * 0.28, 3, h * 0.44);
  });
  reskinImage(scene, 'icon_food', 32, 32, (ctx, w, h) => {
    disc(ctx, w / 2, h * 0.56, w * 0.34, 0xc0392b); disc(ctx, w * 0.62, h * 0.56, w * 0.28, 0xd14336);
    ctx.fillStyle = css(0x3a7a2a); ctx.beginPath(); ctx.ellipse(w * 0.56, h * 0.26, w * 0.1, h * 0.06, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = css(0x5c3a18); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w / 2, h * 0.3); ctx.lineTo(w / 2, h * 0.2); ctx.stroke();
  });
  // Manufacturing-chain icons (Completion Phase 2 uses these).
  objSheet(scene, 'icon_planks', 1, 32, 32, (ctx) => { for (const y of [10, 16, 22]) { fillRect2(ctx, 5, y, 22, 4, 0xc89a5a); fillRect2(ctx, 5, y, 22, 1, 0xe0c088); } });
  objSheet(scene, 'icon_cutstone', 1, 32, 32, (ctx) => { fillRect2(ctx, 6, 8, 20, 16, 0x9a9a90); fillRect2(ctx, 6, 8, 20, 3, 0xb6b6ac); ctx.strokeStyle = css(0x6f6f68); ctx.lineWidth = 1; ctx.strokeRect(6, 8, 20, 16); ctx.beginPath(); ctx.moveTo(16, 8); ctx.lineTo(16, 24); ctx.stroke(); });
}

// ---- PHASE 8: particle FX + full replacement -------------------------------
// Explosion (192px, 8 one-shot frames) and dust (64px, 8 frames) replace the
// last pack art so every pack image load can be removed from preload().
export function generateFX(scene: any) {
  objSheet(scene, 'explosion', 8, 192, 192, (ctx, t) => {
    const r = 20 + t * 70; ctx.globalAlpha = 1 - t;
    disc(ctx, 96, 96, r, 0xff7a1a); ctx.globalAlpha = (1 - t) * 0.8; disc(ctx, 96, 96, r * 0.6, 0xffd24a); ctx.globalAlpha = (1 - t) * 0.6; disc(ctx, 96, 96, r * 0.3, 0xfff2c8);
    ctx.globalAlpha = 1;
  });
  objSheet(scene, 'dust', 8, 64, 64, (ctx, t) => {
    ctx.globalAlpha = 0.6 * (1 - t); for (const [dx, dy] of [[0, 0], [-10, 4], [10, 2], [-4, -8]] as any[]) disc(ctx, 32 + dx, 40 + dy - t * 8, 6 + t * 8, 0xc9bfa8);
    ctx.globalAlpha = 1;
  });
}

// Belt-and-suspenders: if any texture key is ever missing at use time, register
// a neutral placeholder so the game never shows the engine's missing-texture box.
export function installFallback(scene: any) {
  scene.load.on('loaderror', (file: any) => {
    const key = file && file.key; if (!key || scene.textures.exists(key)) return;
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0x39455a, 1); g.fillRect(0, 0, 48, 48); g.lineStyle(2, 0x8a93a6, 1); g.strokeRect(1, 1, 46, 46);
    g.generateTexture(key, 48, 48); g.destroy();
  });
}

// ---- V2: leader portraits (80x80) ------------------------------------------
// Three distinct drawn faces, keyed portrait_<faction>, for the diplomacy panel,
// council hall, battle header and messenger letters.
export function generatePortraits(scene: any) {
  const face = (key: string, draw: (ctx: any) => void) => objSheet(scene, key, 1, 80, 80, (ctx) => {
    ctx.fillStyle = '#1a1f28'; ctx.fillRect(0, 0, 80, 80);
    ctx.fillStyle = '#2a3242'; ctx.fillRect(2, 2, 76, 76);
    draw(ctx);
    ctx.strokeStyle = '#c9a14a'; ctx.lineWidth = 2; ctx.strokeRect(2, 2, 76, 76);
  });
  // Valdris — scarred, gray beard, heavy helm, stern.
  face('portrait_red', (ctx) => {
    ctx.fillStyle = '#d8b48c'; ctx.beginPath(); ctx.arc(40, 42, 22, 0, Math.PI * 2); ctx.fill(); // face
    ctx.fillStyle = '#9aa0a6'; ctx.fillRect(16, 14, 48, 14); ctx.beginPath(); ctx.arc(40, 20, 24, Math.PI, 0); ctx.fill(); // helm
    ctx.fillStyle = '#7a8088'; ctx.fillRect(38, 14, 4, 20); // nasal guard
    ctx.fillStyle = '#cfcfcf'; ctx.fillRect(24, 52, 32, 14); ctx.beginPath(); ctx.arc(40, 52, 16, 0, Math.PI); ctx.fill(); // beard
    ctx.strokeStyle = '#b04a3a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(50, 30); ctx.lineTo(56, 46); ctx.stroke(); // scar
    ctx.fillStyle = '#20140c'; ctx.fillRect(30, 40, 4, 3); ctx.fillRect(46, 40, 4, 3); // eyes (stern)
    ctx.fillStyle = '#7a8088'; ctx.fillRect(12, 64, 56, 16); // armored shoulders
  });
  // Elowen — sharp features, elegant, knowing smile.
  face('portrait_purple', (ctx) => {
    ctx.fillStyle = '#e6c2a0'; ctx.beginPath(); ctx.arc(40, 40, 21, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5a2a6a'; ctx.beginPath(); ctx.arc(40, 30, 24, Math.PI, 0); ctx.fill(); ctx.fillRect(16, 30, 12, 30); ctx.fillRect(52, 30, 12, 30); // hair
    ctx.fillStyle = '#20140c'; ctx.beginPath(); ctx.ellipse(31, 40, 3, 2, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(49, 40, 3, 2, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#a06050'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(40, 46, 8, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); // smile
    ctx.fillStyle = '#8e44ad'; ctx.fillRect(10, 64, 60, 16); ctx.fillStyle = '#c9a14a'; ctx.fillRect(36, 60, 8, 8); // gown + jewel
  });
  // Krag — huge frame, crude helm, broken nose, wild eyes.
  face('portrait_yellow', (ctx) => {
    ctx.fillStyle = '#cdbf8a'; ctx.beginPath(); ctx.arc(40, 42, 25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6a5a30'; ctx.fillRect(12, 10, 56, 16); // crude iron band
    ctx.fillStyle = '#fff'; ctx.fillRect(28, 38, 6, 5); ctx.fillRect(46, 38, 6, 5); // wild wide eyes
    ctx.fillStyle = '#c0392b'; ctx.fillRect(30, 39, 2, 2); ctx.fillRect(48, 39, 2, 2);
    ctx.fillStyle = '#a07050'; ctx.beginPath(); ctx.moveTo(40, 44); ctx.lineTo(36, 52); ctx.lineTo(44, 52); ctx.closePath(); ctx.fill(); // broken nose
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(28, 58, 24, 8); // jaw/teeth grimace
    ctx.fillStyle = '#fff'; for (let x = 30; x < 50; x += 5) ctx.fillRect(x, 58, 2, 4);
    ctx.fillStyle = '#6a5a30'; ctx.fillRect(8, 66, 64, 14);
  });
}

// ---- V2 Phase 3: hero portraits (80x80) ------------------------------------
export function generateHeroPortraits(scene: any) {
  const face = (key: string, skin: number, hair: number, accent: number, draw?: (ctx: any) => void) => objSheet(scene, key, 1, 80, 80, (ctx) => {
    ctx.fillStyle = '#1a1f28'; ctx.fillRect(0, 0, 80, 80); ctx.fillStyle = '#2a3242'; ctx.fillRect(2, 2, 76, 76);
    ctx.fillStyle = css(accent); ctx.fillRect(8, 62, 64, 18); // shoulders
    ctx.fillStyle = css(skin); ctx.beginPath(); ctx.arc(40, 40, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css(hair); ctx.beginPath(); ctx.arc(40, 30, 24, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#20140c'; ctx.fillRect(31, 39, 4, 3); ctx.fillRect(46, 39, 4, 3);
    if (draw) draw(ctx);
    ctx.strokeStyle = '#c9a14a'; ctx.lineWidth = 2; ctx.strokeRect(2, 2, 76, 76);
  });
  face('hero_aldric', 0xd8b48c, 0x9aa0a6, 0x7a8088, (ctx) => { ctx.fillStyle = '#cfcfcf'; ctx.fillRect(26, 50, 28, 12); }); // gray beard, armor
  face('hero_maren', 0xe6c2a0, 0xeae0c8, 0xeef0f4, (ctx) => { ctx.fillStyle = 'rgba(255,242,168,0.6)'; ctx.beginPath(); ctx.arc(40, 58, 10, 0, Math.PI * 2); ctx.fill(); }); // healing light
  face('hero_caelan', 0xe0b890, 0x3a2a1a, 0x6a3aa0, (ctx) => { ctx.fillStyle = '#c9a84c'; ctx.beginPath(); ctx.arc(58, 50, 4, 0, Math.PI * 2); ctx.fill(); }); // coin
  face('hero_mira', 0xd8b48c, 0x2f5a2f, 0x3a6a3a, (ctx) => { ctx.fillStyle = '#2f5a2f'; ctx.beginPath(); ctx.arc(40, 26, 26, Math.PI * 1.05, -Math.PI * 0.05); ctx.fill(); }); // green hood
  face('hero_tomas', 0xe0c4a0, 0xeef0f4, 0x5a5a6a, (ctx) => { ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.5; ctx.strokeRect(28, 36, 10, 8); ctx.strokeRect(42, 36, 10, 8); }); // spectacles
  face('hero_ravel', 0xcda884, 0x3a2a1a, 0xd6c04a, (ctx) => { ctx.strokeStyle = '#a04a3a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(48, 30); ctx.lineTo(54, 46); ctx.stroke(); }); // scar, yellow armor
}

// Master entry — generates the entire game's art. Call once at scene create().
export function generateAll(scene: any) {
  generatePortraits(scene);
  generateHeroPortraits(scene);
  generateTerrain(scene);
  generateBuildings(scene);
  generateAIBuildings(scene);
  generateUnits(scene);
  generateEnemyUnits(scene);
  generateV2Units(scene); // (Assets V2) cavalry, spearman, goblin shaman/warlord, deer, dragon
  generateWorldObjects(scene);
  generateUI(scene);
  generateFX(scene);
}
