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

// ---- building drawing primitives -------------------------------------------
// All buildings are drawn in a 64x64 canvas with the structure's BASE at the
// bottom-centre (≈ x32, y60), because the scene anchors building sprites at
// origin (0.5, 1.0) on the tile's south corner and scales them by footprint
// (×1 / ×1.5 / ×2). Matching the originals' 64px size keeps placement identical.
const STONE = 0x8a8a82, STONE_M = 0x6f6f68, STONE_D = 0x52524c;
const WOOD = 0x9a6a44, BEAM = 0x5c3a1e, DOOR = 0x4a3018;
const THATCH = 0xc2a45a, ROOF = 0x46464e, GLOW = 0xffcf5a;

// Pseudo-3D box: flat front + darker right edge + lighter top lip.
function box(g: any, x: number, y: number, w: number, h: number, base: number) {
  g.fillStyle(base, 1); g.fillRect(x, y, w, h);
  g.fillStyle(darken(base, 0.24), 1); g.fillRect(x + w - 3, y, 3, h);
  g.fillStyle(lighten(base, 0.16), 1); g.fillRect(x, y, w, 2);
}
// Crenellations along the top edge of a tower/wall.
function merlons(g: any, x: number, y: number, w: number, color: number) {
  g.fillStyle(color, 1);
  for (let cx = x; cx < x + w - 2; cx += 6) g.fillRect(cx, y, 4, 4);
}
function flag(g: any, x: number, y: number, h: number, accent: number) {
  g.fillStyle(0x6b4a28, 1); g.fillRect(x, y, 1.5, h);                 // pole
  g.fillStyle(accent, 1); g.fillTriangle(x + 1.5, y, x + 1.5, y + 7, x + 13, y + 3.5); // pennant
}
function shadow(g: any, cx = 32, cy = 60, rw = 24) { g.fillStyle(0x000000, 0.25); g.fillEllipse(cx, cy, rw, 8); }

// Draw one building texture (accent-coloured) under `key`.
function makeBuilding(scene: any, key: string, draw: (g: any, A: number) => void, accent = 0x1a3a8b) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  shadow(g);
  draw(g, accent);
  g.generateTexture(key, 64, 64);
  g.destroy();
}

// Each draw fn (g, A=accent). Base sits near y60, centred on x32.
const BUILD: Record<string, (g: any, A: number) => void> = {
  house: (g, A) => {
    box(g, 22, 44, 20, 14, STONE);                       // stone foundation
    box(g, 23, 30, 18, 16, WOOD);                        // timber wall
    g.fillStyle(BEAM, 1); for (const bx of [26, 32, 38]) g.fillRect(bx, 30, 1.5, 16); // beams
    g.fillStyle(THATCH, 1); g.fillTriangle(20, 30, 44, 30, 32, 15);   // thatch roof
    g.fillStyle(darken(THATCH, 0.2), 1); g.fillTriangle(32, 15, 44, 30, 38, 30);
    g.fillStyle(DOOR, 1); g.fillRect(29, 40, 6, 8);                   // door
    g.fillStyle(0x2a2a30, 1); g.fillRect(24, 34, 3, 3); g.fillRect(37, 34, 3, 3); // windows
    g.fillStyle(STONE_D, 1); g.fillRect(36, 12, 4, 7);               // chimney
  },
  lumberyard: (g, A) => {
    g.fillStyle(BEAM, 1); for (const bx of [20, 42]) g.fillRect(bx, 26, 2, 32);   // corner posts
    g.fillStyle(BEAM, 1); g.fillRect(20, 24, 24, 2);                              // top beam
    g.fillStyle(darken(WOOD, 0.1), 1); g.fillTriangle(16, 24, 48, 24, 32, 14);   // sloped roof
    for (let i = 0; i < 3; i++) { g.fillStyle(0x8b5e3c, 1); g.fillEllipse(26, 52 - i * 5, 16, 5); g.fillStyle(0xc89a5a, 1); g.fillCircle(18, 52 - i * 5, 2.2); } // log pile
    g.fillStyle(0xbfbfb2, 1); g.fillCircle(42, 46, 5); g.fillStyle(STONE_D, 1); g.fillCircle(42, 46, 2); // saw blade
  },
  mine: (g, A) => {
    box(g, 18, 32, 28, 26, STONE_M);                     // stone entrance block
    g.fillStyle(0x0a0a0c, 1); g.fillRect(26, 40, 12, 18); g.fillStyle(0x0a0a0c, 1); g.fillTriangle(26, 40, 38, 40, 32, 33); // tunnel
    g.fillStyle(BEAM, 1); g.fillRect(24, 36, 2, 22); g.fillRect(38, 36, 2, 22);  // support timbers
    g.fillStyle(0x6f6f68, 1); g.fillRect(40, 52, 8, 5); g.fillStyle(STONE_D, 1); g.fillCircle(41, 57, 1.5); g.fillCircle(47, 57, 1.5); // cart
    g.fillStyle(STONE_D, 0.8); for (const [x, y] of [[16, 56], [50, 55], [20, 57]]) g.fillCircle(x, y, 1.6); // rubble
  },
  farm: (g, A) => {
    box(g, 22, 42, 20, 16, STONE);                       // stone base
    const hx = 32, hy = 30;
    g.lineStyle(3, 0xeae0c8, 1);                         // 4 windmill sails
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) { g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + Math.cos(a) * 16, hy + Math.sin(a) * 16); g.strokePath(); }
    g.fillStyle(STONE_D, 1); g.fillCircle(hx, hy, 3);    // hub
    g.fillStyle(0xc9a86a, 1); g.fillRect(24, 52, 5, 5); g.fillRect(35, 52, 5, 5); // grain sacks
  },
  barracks: (g, A) => {
    box(g, 16, 32, 32, 26, STONE_M);                     // big stone hall
    g.fillStyle(ROOF, 1); g.fillTriangle(14, 32, 50, 32, 32, 20);    // roof
    g.fillStyle(DOOR, 1); g.fillRect(27, 46, 10, 12);    // double door
    g.fillStyle(BEAM, 1); g.fillRect(32, 46, 1, 12);
    box(g, 44, 24, 9, 34, STONE_D);                      // corner watchtower
    merlons(g, 44, 22, 9, STONE);
    g.lineStyle(1.5, 0xcfcfcf, 1); g.beginPath(); g.moveTo(20, 38); g.lineTo(26, 44); g.moveTo(26, 38); g.lineTo(20, 44); g.strokePath(); // crossed swords
    flag(g, 31, 12, 8, A);                               // faction banner
  },
  tower: (g, A) => {
    g.fillStyle(STONE_M, 1); g.fillTriangle(18, 56, 46, 56, 40, 24); g.fillTriangle(18, 56, 40, 24, 24, 24); // tapered body
    box(g, 24, 22, 16, 10, STONE);
    merlons(g, 23, 18, 18, STONE_D);
    g.fillStyle(0x2a2a30, 1); g.fillRect(30, 34, 4, 8); g.fillRect(31, 46, 2, 6); // arrow slits
    flag(g, 32, 6, 8, A);
  },
  watchtower: (g, A) => {
    g.fillStyle(STONE_M, 1); g.fillTriangle(22, 58, 42, 58, 38, 20); g.fillTriangle(22, 58, 38, 20, 26, 20); // tall thin tower
    box(g, 20, 14, 24, 8, BEAM);                         // platform
    g.lineStyle(1.5, 0x6b4a28, 1); g.strokeRect(20, 10, 24, 6);      // railing
    g.fillStyle(STONE_D, 1); g.fillRect(33, 4, 12, 3);  // telescope
    g.fillStyle(GLOW, 1); g.fillCircle(21, 12, 1.6); g.fillCircle(43, 12, 1.6); // torches
  },
  blacksmith: (g, A) => {
    box(g, 18, 34, 28, 24, STONE_M);
    g.fillStyle(0x14100c, 1); g.fillRect(22, 42, 16, 16);            // open front
    g.fillStyle(0xff7a1a, 0.9); g.fillCircle(30, 52, 5); g.fillStyle(0xffd24a, 0.9); g.fillCircle(30, 52, 2.5); // forge glow
    g.fillStyle(STONE_D, 1); g.fillRect(36, 50, 6, 2); g.fillRect(38, 50, 2, 6);     // anvil
    box(g, 40, 26, 6, 10, STONE_D);                      // chimney
    g.fillStyle(0xb0b0b0, 0.5); g.fillCircle(43, 22, 3); g.fillCircle(46, 17, 2.4);  // smoke
  },
  market: (g, A) => {
    g.fillStyle(0x8b5e3c, 1); g.fillRect(18, 40, 28, 18);            // counter/stall
    for (let i = 0; i < 6; i++) { g.fillStyle(i % 2 ? 0xf0f0f0 : A, 1); g.fillRect(16 + i * 5.5, 24, 5.5, 8); } // striped awning
    g.fillStyle(BEAM, 1); g.fillRect(18, 32, 2, 26); g.fillRect(44, 32, 2, 26);      // posts
    g.fillStyle(0x8b5e3c, 1); g.fillEllipse(24, 44, 7, 5); g.fillStyle(0xc9a86a, 1); g.fillRect(33, 40, 5, 5); // goods
    g.fillStyle(GLOW, 1); g.fillCircle(38, 46, 2.4); g.fillStyle(STONE_D, 1); g.fillRect(37.4, 44, 1.2, 5);    // coin sign
  },
  library: (g, A) => {
    box(g, 18, 30, 28, 28, STONE);
    g.fillStyle(0x2a2436, 1); g.fillRect(24, 36, 16, 16); g.fillTriangle(24, 36, 40, 36, 32, 28);  // arched window
    for (let i = 0; i < 4; i++) { g.fillStyle([0x9a3a3a, 0x3a7a9a, 0xc9a84c, 0x6a9a4a][i], 1); g.fillRect(26 + i * 3.4, 38, 3, 12); } // book spines
    g.fillStyle(GLOW, 0.8); g.fillCircle(36, 46, 2);                 // candle glow
    g.fillStyle(DOOR, 1); g.fillRect(29, 50, 6, 8);
    g.fillStyle(STONE_M, 1); g.fillRect(24, 56, 16, 2);             // steps
    flag(g, 31, 14, 7, A);
  },
  tavern: (g, A) => {
    box(g, 16, 34, 32, 24, WOOD);
    g.fillStyle(ROOF, 1); g.fillTriangle(14, 34, 50, 34, 32, 22);
    g.fillStyle(GLOW, 0.9); g.fillRect(20, 40, 6, 6); g.fillRect(38, 40, 6, 6);      // warm windows
    g.fillStyle(DOOR, 1); g.fillRect(29, 46, 6, 12);
    g.fillStyle(0x8b5e3c, 1); g.fillEllipse(50, 52, 8, 6); g.fillEllipse(50, 46, 7, 5); // barrels
    g.fillStyle(0xd8b06a, 1); g.fillCircle(40, 28, 3); g.lineStyle(1, 0xd8b06a, 1); g.strokeRect(43, 26, 2, 4); // mug sign
  },
  wall: (g, A) => {
    box(g, 14, 38, 36, 18, STONE_M);
    merlons(g, 14, 34, 36, STONE);
    g.lineStyle(1, STONE_D, 0.8); g.beginPath(); g.moveTo(14, 46); g.lineTo(50, 46); g.moveTo(26, 38); g.lineTo(26, 56); g.moveTo(38, 38); g.lineTo(38, 56); g.strokePath(); // block seams
  },
};

// Castle stages share a builder, growing with the tier.
function drawCastle(g: any, A: number, stage: 1 | 2 | 3) {
  const gold = 0xc9a84c;
  // Towers (wider/taller as the castle grows).
  const th = stage === 1 ? 30 : stage === 2 ? 34 : 38;
  box(g, 10, 58 - th, 13, th, STONE_M); merlons(g, 10, 56 - th, 13, STONE);
  box(g, 41, 58 - th, 13, th, STONE_M); merlons(g, 41, 56 - th, 13, STONE);
  // Central gatehouse.
  box(g, 22, 30, 20, 28, stage === 3 ? STONE : STONE_M);
  merlons(g, 22, 26, 20, STONE_D);
  // Gate / portcullis.
  g.fillStyle(DOOR, 1); g.fillRect(28, 44, 8, 14); g.fillTriangle(28, 44, 36, 44, 32, 38);
  if (stage >= 3) { g.lineStyle(1, gold, 0.9); for (const lx of [29.5, 32, 34.5]) { g.beginPath(); g.moveTo(lx, 40); g.lineTo(lx, 58); g.strokePath(); } } // portcullis bars
  // Roof caps on towers.
  g.fillStyle(ROOF, 1); g.fillTriangle(10, 58 - th, 23, 58 - th, 16.5, 50 - th); g.fillTriangle(41, 58 - th, 54, 58 - th, 47.5, 50 - th);
  // Windows.
  g.fillStyle(0x2a2a30, 1); g.fillRect(15, 44, 3, 5); g.fillRect(46, 44, 3, 5); g.fillRect(30, 34, 4, 5);
  // Wall wings appear at town+, full stone at castle.
  if (stage >= 2) { box(g, 4, 48, 8, 10, STONE_D); box(g, 52, 48, 8, 10, STONE_D); }
  // Flags — one (village), two (town), gold-trimmed banner (castle).
  flag(g, 16, 58 - th - 9, 8, A);
  if (stage >= 2) flag(g, 47, 58 - th - 9, 8, A);
  if (stage >= 3) { g.fillStyle(gold, 1); g.fillRect(30, 18, 4, 1); g.fillStyle(A, 1); g.fillRect(30, 19, 4, 7); g.fillStyle(gold, 1); g.fillRect(30, 26, 4, 1); }
}

// ---- PHASE 2: player buildings ---------------------------------------------
export function generateBuildings(scene: any, accent = 0x1a3a8b) {
  for (const key of Object.keys(BUILD)) makeBuilding(scene, key, BUILD[key], accent);
  makeBuilding(scene, 'castle', (g, A) => drawCastle(g, A, 1), accent);
  makeBuilding(scene, 'castle_town', (g, A) => drawCastle(g, A, 2), accent);
  makeBuilding(scene, 'castle_castle', (g, A) => drawCastle(g, A, 3), accent);
}

// ---- PHASE 3: AI faction buildings -----------------------------------------
// Same shapes, faction-accented flags/banners (Red / Purple / Yellow). Reuses
// the player builders so there are no full redraws.
const AI_FACTIONS = [
  { accent: 0x8b1a1a, keys: { castle: 'enemy_castle', barracks: 'ai_barracks', tower: 'ai_tower', house: 'ai_house' } },
  { accent: 0x4a1a8b, keys: { castle: 'purple_castle', barracks: 'purple_barracks', tower: 'purple_tower', house: 'purple_house' } },
  { accent: 0x8b7a1a, keys: { castle: 'yellow_castle', barracks: 'yellow_barracks', tower: 'yellow_tower', house: 'yellow_house' } },
];
export function generateAIBuildings(scene: any) {
  for (const f of AI_FACTIONS) {
    makeBuilding(scene, f.keys.castle, (g, A) => drawCastle(g, A, 3), f.accent); // AI seats render as full castles
    makeBuilding(scene, f.keys.barracks, BUILD.barracks, f.accent);
    makeBuilding(scene, f.keys.tower, BUILD.tower, f.accent);
    makeBuilding(scene, f.keys.house, BUILD.house, f.accent);
  }
}

// Master entry — phases are added here as they are built.
export function generateAll(scene: any) {
  generateTerrain(scene);
  generateBuildings(scene);
  generateAIBuildings(scene);
}
