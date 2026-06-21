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

// ---- unit spritesheet helpers ----------------------------------------------
// Units are 192x192 frames (the engine scales them by 36/192) so animation +
// scale math stays identical. We build a wide canvas, draw each frame, and add
// numeric sub-frames so generateFrameNumbers(key,{start,end}) keeps working.
const css = (n: number) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');
function fillRect2(ctx: any, x: number, y: number, w: number, h: number, c: number) { ctx.fillStyle = css(c); ctx.fillRect(x, y, w, h); }
function disc(ctx: any, x: number, y: number, r: number, c: number) { ctx.fillStyle = css(c); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

function spriteSheet(scene: any, key: string, frames: number, draw: (ctx: any, t: number, i: number) => void) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
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
  // Shield on the left arm.
  if (o.shield) { ctx.fillStyle = css(P.shield); ctx.beginPath(); ctx.moveTo(cx - 28 + lean, 80 + bob); ctx.lineTo(cx - 14 + lean, 80 + bob); ctx.lineTo(cx - 14 + lean, 100 + bob); ctx.lineTo(cx - 21 + lean, 108 + bob); ctx.lineTo(cx - 28 + lean, 100 + bob); ctx.closePath(); ctx.fill(); if (o.cross) fillRect2(ctx, cx - 22 + lean, 84 + bob, 2, 18, 0xe8c84a); }
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
  // Heal effect sprite (single frame glow).
  spriteSheet(scene, 'heal_effect', 1, (ctx) => { disc(ctx, 96, 96, 26, 0xfff2a8); ctx.globalAlpha = 0.5; disc(ctx, 96, 96, 40, 0xffffff); ctx.globalAlpha = 1; });

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

// ---- world-object helpers --------------------------------------------------
// Object spritesheet with custom frame size + numeric frames.
function objSheet(scene: any, key: string, frames: number, fw: number, fh: number, draw: (ctx: any, t: number, i: number) => void) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, frames * fw, fh);
  const ctx = tex.getContext();
  for (let i = 0; i < frames; i++) { ctx.save(); ctx.translate(i * fw, 0); draw(ctx, frames > 1 ? i / (frames - 1) : 0, i); ctx.restore(); tex.add(i, 0, i * fw, 0, fw, fh); }
  tex.refresh();
}
// Reskin a single-image texture key, keeping its native pixel size so the
// existing node scale/oy values still position it correctly.
function reskinImage(scene: any, key: string, fallbackW: number, fallbackH: number, draw: (ctx: any, w: number, h: number) => void) {
  let w = fallbackW, h = fallbackH;
  if (scene.textures.exists(key)) { const src: any = scene.textures.get(key).getSourceImage(); if (src && src.width) { w = src.width; h = src.height; } scene.textures.remove(key); }
  const tex = scene.textures.createCanvas(key, w, h);
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
  // Iron deposit (Phase 6 of the completion plan uses this) — rust-veined rock.
  reskinImage(scene, 'iron_node', 80, 72, (ctx, w, h) => {
    const cx = w / 2, by = h * 0.82;
    ctx.fillStyle = css(0x55555c); ctx.beginPath(); ctx.ellipse(cx, by - h * 0.18, w * 0.4, h * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = css(0xb5651d); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx - w * 0.22, by - h * 0.1); ctx.lineTo(cx + w * 0.05, by - h * 0.3); ctx.moveTo(cx - w * 0.02, by - h * 0.08); ctx.lineTo(cx + w * 0.2, by - h * 0.26); ctx.stroke();
  });
}

// Master entry — phases are added here as they are built.
export function generateAll(scene: any) {
  generateTerrain(scene);
  generateBuildings(scene);
  generateAIBuildings(scene);
  generateUnits(scene);
  generateEnemyUnits(scene);
  generateWorldObjects(scene);
}
