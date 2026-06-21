// Roads.ts (Completion Phase 5) — player-built roads between points.
// Roads speed up army movement (4 tiles/hr vs 3 plains / 1.5 forest) and caravan
// delivery, show on the continent view, and auto-establish a caravan route when
// they connect two owned settlements. Cost: 5 wood per road tile.
export class Roads {
  scene: any;
  tiles: Set<string>;
  gfx: any;
  [key: string]: any;

  constructor(scene: any) {
    this.scene = scene;
    this.tiles = new Set<string>();
    this.gfx = scene.add.graphics().setDepth(-9); // just above the terrain Blitter
  }

  key(c: number, r: number) { return c + ',' + r; }
  has(c: number, r: number) { return this.tiles.has(this.key(Math.round(c), Math.round(r))); }

  // Bresenham line of tiles between two points.
  line(c0: number, r0: number, c1: number, r1: number) {
    const pts: any[] = []; let x0 = c0, y0 = r0;
    const dx = Math.abs(c1 - c0), dy = Math.abs(r1 - r0), sx = c0 < c1 ? 1 : -1, sy = r0 < r1 ? 1 : -1;
    let err = dx - dy;
    for (let i = 0; i < 600; i++) { pts.push({ c: x0, r: y0 }); if (x0 === c1 && y0 === r1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x0 += sx; } if (e2 < dx) { err += dx; y0 += sy; } }
    return pts;
  }
  previewCost(c0: number, r0: number, c1: number, r1: number) { return this.line(c0, r0, c1, r1).filter((t) => !this.has(t.c, t.r)).length * 5; }

  buildPath(c0: number, r0: number, c1: number, r1: number) {
    const s = this.scene;
    const fresh = this.line(c0, r0, c1, r1).filter((t) => !this.has(t.c, t.r));
    if (!fresh.length) { s.showToast && s.showToast('Road already there'); return false; }
    const cost = fresh.length * 5;
    if (s.resources.wood < cost) { s.showToast && s.showToast(`Need ${cost} wood for ${fresh.length} road tiles`); return false; }
    s.resources.wood -= cost;
    for (const t of fresh) this.tiles.add(this.key(t.c, t.r));
    this.redraw();
    s.showToast && s.showToast(`Road built — ${fresh.length} tiles (${cost} wood)`);
    s.logEvent && s.logEvent(`Built a road (${fresh.length} tiles)`, 'info');
    this.tryAutoCaravan(c0, r0, c1, r1);
    return true;
  }

  redraw() {
    const s = this.scene, g = this.gfx; g.clear();
    g.fillStyle(0x8a7a52, 0.9);
    for (const k of this.tiles) { const [c, r] = k.split(',').map(Number); const p = s.tileCenter(c, r); g.fillEllipse(p.x, p.y + 8, 32, 17); }
    g.fillStyle(0x9c8a60, 0.7);
    for (const k of this.tiles) { const [c, r] = k.split(',').map(Number); const p = s.tileCenter(c, r); g.fillEllipse(p.x, p.y + 6, 18, 9); }
  }

  // If the road's endpoints sit on two different owned sites, open a caravan route.
  tryAutoCaravan(c0: number, r0: number, c1: number, r1: number) {
    const s = this.scene; if (!s.caravans || !s.caravans.sites) return;
    const sites = s.caravans.sites();
    const near = (c: number, r: number) => sites.find((st: any) => Math.abs(st.col - c) <= 3 && Math.abs(st.row - r) <= 3);
    const a = near(c0, r0), b = near(c1, r1);
    if (a && b && a.name !== b.name && s.caravans.canEstablish && s.caravans.canEstablish()) {
      const exists = (s.caravans.routes || []).some((rt: any) => rt.from && rt.from.name === a.name);
      if (!exists) { s.caravans.establish(a, b); s.showToast && s.showToast(`Road link → caravan route ${a.name}→${b.name}`); }
    }
  }

  serialize() { return [...this.tiles]; }
  restore(d: any) { if (!d) return; this.tiles = new Set(d); this.redraw(); }
}
