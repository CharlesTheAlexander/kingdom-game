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

// Top-face diamond outline (for fills) and a slightly inset version (for detail).
const TOP = [{ x: 32, y: 0 }, { x: 64, y: 16 }, { x: 32, y: 32 }, { x: 0, y: 16 }];
// Is (x,y) inside the top diamond (optionally inset) — keeps detail off the faces.
function inTop(x: number, y: number, inset = 0.9): boolean {
  return Math.abs(x - 32) / 32 + Math.abs(y - 16) / 16 <= inset;
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

// ---- core tile builder -----------------------------------------------------
// base = top colour; detail(g) draws extra marks on the top face.
function makeTile(scene: any, key: string, base: number, detail?: (g: any) => void) {
  if (scene.textures.exists(key)) scene.textures.remove(key); // allow re-gen on scene.restart
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  const D = 16; // side-face depth (matches the HH row step so faces tile cleanly)
  // Side faces first (top face will overlap their upper edge).
  g.fillStyle(darken(base, 0.30), 1);
  g.fillPoints([{ x: 0, y: 16 }, { x: 32, y: 32 }, { x: 32, y: 32 + D }, { x: 0, y: 16 + D }], true);
  g.fillStyle(darken(base, 0.20), 1);
  g.fillPoints([{ x: 32, y: 32 }, { x: 64, y: 16 }, { x: 64, y: 16 + D }, { x: 32, y: 32 + D }], true);
  // Top face.
  g.fillStyle(base, 1);
  g.fillPoints(TOP, true);
  if (detail) detail(g);
  // Warm top-left edge highlight + faint bottom-right rim for readability.
  g.lineStyle(1, lighten(base, 0.28), 0.55);
  g.beginPath(); g.moveTo(0, 16); g.lineTo(32, 0); g.lineTo(64, 16); g.strokePath();
  g.generateTexture(key, 64, 64);
  g.destroy();
}

// ---- PHASE 1: terrain ------------------------------------------------------
export function generateTerrain(scene: any) {
  // Grass (warm bright base, darker variant, flowered variant).
  makeTile(scene, 'iso_grass', 0x4a7c3f, (g) => dots(g, darken(0x4a7c3f, 0.22), 6, 1.3));
  makeTile(scene, 'iso_grass2', 0x3d6b34, (g) => dots(g, darken(0x3d6b34, 0.2), 4, 1.4));
  makeTile(scene, 'iso_grass3', 0x4a7c3f, (g) => {
    dots(g, darken(0x4a7c3f, 0.22), 3, 1.2);
    // 2-3 tiny flowers (white + yellow centres)
    const fx = [[24, 12], [40, 18], [32, 8]];
    for (const [x, y] of fx) { if (!inTop(x, y)) continue; g.fillStyle(0xf4f0e0, 1); g.fillCircle(x, y, 1.5); g.fillStyle(0xe8c84a, 1); g.fillCircle(x, y, 0.7); }
  });

  // Water (deeper base, lighter top inset, animated-look shimmer stripes). Three
  // variants offset their shimmer so the river/sea reads as moving water.
  const waterTile = (key: string, off: number) => makeTile(scene, key, 0x2a5a8a, (g) => {
    g.fillStyle(lighten(0x2a5a8a, 0.18), 0.5); g.fillPoints([{ x: 32, y: 4 }, { x: 56, y: 16 }, { x: 32, y: 28 }, { x: 8, y: 16 }], true);
    g.lineStyle(1.4, lighten(0x2a5a8a, 0.5), 0.7);
    for (const yy of [10 + off, 18 + off]) { const y = ((yy - 2) % 26) + 4; g.beginPath(); g.moveTo(14, y); g.lineTo(28, y); g.strokePath(); g.beginPath(); g.moveTo(36, y + 3); g.lineTo(50, y + 3); g.strokePath(); }
  });
  waterTile('iso_water', 0); waterTile('iso_water2', 3); waterTile('iso_water3', 6);

  // Rocky boulder tile (stone gray + a couple of boulders).
  makeTile(scene, 'iso_rock', 0x8a8a7a, (g) => {
    g.fillStyle(darken(0x8a8a7a, 0.18), 1); g.fillEllipse(26, 16, 14, 8); g.fillEllipse(40, 13, 10, 6);
    g.fillStyle(lighten(0x8a8a7a, 0.18), 0.8); g.fillEllipse(24, 14, 6, 3);
  });

  // Mountain rock (dark gray + light crack lines).
  makeTile(scene, 'iso_mtn', 0x5a5a4a, (g) => {
    g.lineStyle(1, lighten(0x5a5a4a, 0.4), 0.8);
    g.beginPath(); g.moveTo(18, 12); g.lineTo(30, 18); g.lineTo(26, 24); g.strokePath();
    g.beginPath(); g.moveTo(44, 10); g.lineTo(38, 18); g.strokePath();
  });

  // Forest floor (dark green + scattered fallen leaves). 8 variants for variety;
  // the trees themselves come from world-object sprites (Phase 6) + decorations.
  for (let i = 1; i <= 8; i++) {
    makeTile(scene, `iso_forest${i}`, 0x1a3a0f, (g) => {
      dots(g, darken(0x1a3a0f, 0.3), 2, 1.3);
      const leaves = 3 + (i % 2);
      for (let k = 0; k < leaves; k++) { const x = 8 + Math.random() * 48, y = 4 + Math.random() * 24; if (!inTop(x, y, 0.8)) continue; g.fillStyle(k % 2 ? 0x6b4423 : 0x8a5a2a, 0.9); g.fillCircle(x, y, 1.4); }
    });
  }

  // Extra standalone tiles requested by the spec (generated + available for
  // future use; not wired into the current biome roll).
  makeTile(scene, 'iso_dirt', 0x6b4423, (g) => { g.lineStyle(1, lighten(0x6b4423, 0.25), 0.6); for (const y of [12, 18]) { g.beginPath(); g.moveTo(12, y); g.lineTo(28, y - 2); g.strokePath(); g.beginPath(); g.moveTo(36, y + 2); g.lineTo(52, y); g.strokePath(); } });
  makeTile(scene, 'iso_path', 0x8a8a7a, (g) => { g.fillStyle(lighten(0x8a8a7a, 0.22), 0.5); g.fillPoints([{ x: 32, y: 2 }, { x: 30, y: 16 }, { x: 0, y: 16 }], true); g.fillStyle(darken(0x8a8a7a, 0.22), 0.5); g.fillPoints([{ x: 34, y: 16 }, { x: 64, y: 16 }, { x: 32, y: 32 }], true); });
  makeTile(scene, 'iso_sand', 0xc4a35a, (g) => dots(g, darken(0xc4a35a, 0.16), 7, 1.1));
  makeTile(scene, 'iso_snow', 0xe8e8f0);
}

// Master entry — phases are added here as they are built.
export function generateAll(scene: any) {
  generateTerrain(scene);
}
