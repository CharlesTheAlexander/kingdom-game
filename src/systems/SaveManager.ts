// SaveManager.js — (Expansion Phase 1) complete save / load.
//
// Captures the full gameplay state as a JSON snapshot and reconstructs it on
// load. Loading uses a "pending snapshot + scene.restart()" handshake: the
// scene rebuilds from a clean slate (deterministic terrain) and then applySave()
// overwrites the dynamic state. Three slots in localStorage: slot 0 = auto-save.

const KEY = (slot: number) => `kingdom_save_slot_${slot}`;
const VERSION = 1;
let PENDING: any = null; // snapshot waiting to be applied after a scene.restart()

// ---------------------------------------------------------------- capture ----

export function capture(scene: any) {
  const r = scene.resources;
  const data = {
    version: VERSION,
    world: {
      gameDay: scene.gameDay,
      dayTimer: scene.dayTimer,
      tierIndex: scene.tierIndex,
      gamePlayMs: scene.gamePlayMs || 0,
    },
    resources: { wood: r.wood, stone: r.stone, food: r.food, gold: r.gold, iron: r.iron, equipment: r.equipment, planks: r.planks, cutStone: r.cutStone, workersCap: r.workersCap },
    castle: scene.buildings.castle ? { hp: Math.round(scene.buildings.castle.hp), level: scene.buildings.castle.level } : null,
    buildings: scene.buildings.serialize ? scene.buildings.serialize().filter((b) => b.type !== 'castle') : [],
    troops: scene.troops.serialize ? scene.troops.serialize() : [],
    fog: scene.territory && scene.territory.serializeFog ? scene.territory.serializeFog() : null,
    diplomacy: scene.diplomacy && scene.diplomacy.serialize ? scene.diplomacy.serialize() : (scene.diplomacy ? { rel: { ...scene.diplomacy.rel }, nap: { ...scene.diplomacy.nap }, ally: { ...scene.diplomacy.ally } } : null),
    kingdoms: (scene.kingdoms || []).map((k) => ({ key: k.cfg.key, castleAlive: k.castleAlive, castleHp: k.castleHp, barracksCount: k.barracksCount, waveTimer: k.waveTimer, waveNumber: k.waveNumber, startDay: k.startDay, regrouping: k.regrouping, rebuildTimer: k.rebuildTimer })),
    settlements: scene.settlements && scene.settlements.serialize ? scene.settlements.serialize() : [],
    nodes: scene.nodes && scene.nodes.serialize ? scene.nodes.serialize() : [],
    expeditions: scene.expeditions ? scene.expeditions.state : null,
    caravans: scene.caravans ? (scene.caravans.routes || []).map((rt) => ({ from: rt.from && rt.from.name, to: rt.to && rt.to.name, resource: rt.resource, amount: rt.amount, progress: rt.progress, days: rt.days })) : [],
    progress: { artifacts: [...(scene.artifacts || [])], scrolls: scene.scrolls || 0, intelUntilDay: scene.intelUntilDay || 0, buffs: { ...(scene.buffs || {}) } },
    population: scene.population && scene.population.serialize ? scene.population.serialize() : null,
    armies: scene.armyMgr && scene.armyMgr.serialize ? scene.armyMgr.serialize() : [],
    worldEvents: scene.worldEvents && scene.worldEvents.serialize ? scene.worldEvents.serialize() : null,
    king: { kingdom: scene.kingdomName, ruler: scene.rulerName, trait: scene.kingTrait },
    reputation: scene.reputation && scene.reputation.serialize ? scene.reputation.serialize() : null,
    research: scene.research && scene.research.serialize ? scene.research.serialize() : null,
    winConditions: scene.winConditions && scene.winConditions.serialize ? scene.winConditions.serialize() : null,
    banking: scene.banking && scene.banking.serialize ? scene.banking.serialize() : null,
    greatCouncil: scene.greatCouncil && scene.greatCouncil.serialize ? scene.greatCouncil.serialize() : null,
    roads: scene.roads && scene.roads.serialize ? scene.roads.serialize() : null,
    stats: { battlesWon: scene._battlesWon || 0 },
    kingdomStats: scene.stats && scene.stats.serialize ? scene.stats.serialize() : null,
    ruins: scene.ruins && scene.ruins.serialize ? scene.ruins.serialize() : null,
    factions: scene.factions && scene.factions.serialize ? scene.factions.serialize() : null,
    discovery: scene.discovery && scene.discovery.serialize ? scene.discovery.serialize() : null,
    taxIndex: scene.taxIndex != null ? scene.taxIndex : 1,
    flags: { tut: safeParse(localStorage.getItem('kg_tut')) || {}, hints: scene._firedHints ? Object.keys(scene._firedHints) : [] },
    audio: scene.sfx ? { volume: scene.sfx.volume, muted: scene.sfx.muted } : null,
  };
  return data;
}

function safeParse(s: any) { try { return JSON.parse(s); } catch (e) { return null; } }

export function metadataFor(scene: any) {
  const tier = scene.TIERS && scene.TIERS[scene.tierIndex] ? scene.TIERS[scene.tierIndex].name : '—';
  return { day: scene.gameDay, tier, timestamp: Date.now(), playMin: Math.round((scene.gamePlayMs || 0) / 60000) };
}

// ----------------------------------------------------------------- storage ---

export function save(scene: any, slot: number): { ok: boolean; error?: string } {
  try {
    const payload = { meta: metadataFor(scene), data: capture(scene) };
    let str = JSON.stringify(payload);
    // (Spec) base64-wrap large saves; flag so load knows to decode.
    if (str.length > 500000) str = 'B64:' + btoa(unescape(encodeURIComponent(str)));
    localStorage.setItem(KEY(slot), str);
    return { ok: true };
  } catch (e) {
    console.error('[Save] write failed (slot ' + slot + ')', e);
    const quota = e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e)));
    return { ok: false, error: quota ? 'Storage full — delete an old save.' : 'Could not save.' };
  }
}

export function readRaw(slot: number): any {
  const str = localStorage.getItem(KEY(slot));
  if (!str) return null;
  try {
    const json = str.startsWith('B64:') ? decodeURIComponent(escape(atob(str.slice(4)))) : str;
    return JSON.parse(json);
  } catch (e) {
    console.error('[Save] corrupted slot ' + slot, e);
    return { corrupted: true };
  }
}

export function listSlots() {
  const out: any[] = [];
  for (let i = 0; i < 3; i++) {
    const raw = readRaw(i);
    out.push(raw && raw.corrupted ? { slot: i, corrupted: true } : raw ? { slot: i, ...raw.meta } : { slot: i, empty: true });
  }
  return out;
}

export function deleteSlot(slot: number) { try { localStorage.removeItem(KEY(slot)); } catch (e) {} }
export function hasAnySave() { for (let i = 0; i < 3; i++) if (localStorage.getItem(KEY(i))) return true; return false; }

// ----------------------------------------------------------- load handshake --

// Read a slot, stash its snapshot, and restart the scene so it rebuilds clean.
export function requestLoad(scene: any, slot: number): { ok: boolean; error?: string } {
  const raw = readRaw(slot);
  if (!raw || raw.corrupted || !raw.data) return { ok: false, error: raw && raw.corrupted ? 'Save is corrupted.' : 'Empty slot.' };
  PENDING = raw.data;
  try { scene.scene.restart(); return { ok: true }; }
  catch (e) { console.error('[Save] restart failed', e); PENDING = null; return { ok: false, error: 'Load failed.' }; }
}

export function consumePending() { const p = PENDING; PENDING = null; return p; }
export function hasPending() { return !!PENDING; }
export function clearPending() { PENDING = null; }

// (Main menu) Stash a slot's snapshot WITHOUT restarting a scene, so the menu can
// start IsometricScene fresh and have its create() apply the save (Continue/Load).
export function preparePending(slot: number): { ok: boolean; error?: string } {
  const raw = readRaw(slot);
  if (!raw || raw.corrupted || !raw.data) return { ok: false, error: raw && raw.corrupted ? 'Save is corrupted.' : 'Empty slot.' };
  PENDING = raw.data;
  return { ok: true };
}

// ------------------------------------------------------------------ apply ----

// Reconstruct dynamic state onto a freshly-created scene. Each section is
// independently guarded so one failure can't abort the whole load.
export function applySave(scene: any, data: any) {
  if (!data) return;
  const sect = (name: string, fn: () => void) => { try { fn(); } catch (e) { console.error('[Load] section "' + name + '" failed', e); } };

  sect('world', () => {
    scene.gameDay = data.world.gameDay;
    scene.dayTimer = data.world.dayTimer;
    scene.gamePlayMs = data.world.gamePlayMs || 0;
    if (data.world.tierIndex > 0 && scene.restoreTier) scene.restoreTier(data.world.tierIndex);
  });
  sect('resources', () => { Object.assign(scene.resources, data.resources); });
  sect('progress', () => {
    if (data.progress) {
      scene.scrolls = data.progress.scrolls || 0;
      scene.intelUntilDay = data.progress.intelUntilDay || 0;
      scene.artifacts = [...(data.progress.artifacts || [])];
      if (data.progress.buffs) scene.buffs = { ...scene.buffs, ...data.progress.buffs };
    }
  });
  sect('castle', () => { if (data.castle && scene.buildings.castle) { scene.buildings.castle.hp = data.castle.hp; scene.buildings.castle.level = data.castle.level || 1; } });
  sect('buildings', () => {
    for (const bd of data.buildings || []) {
      const b = scene.buildings.place(bd.type, bd.col, bd.row, { ignoreStage: true }); // saved state is authoritative
      if (!b) continue;
      b.level = bd.level || 1;
      b.hp = bd.hp != null ? bd.hp : b.hp;
      b.workers = bd.workers || 0;
      if (bd.recruitCd) b._recruitCd = bd.recruitCd;
      scene.decorateBuilding(b);
    }
    if (scene.buildings.refreshWorkerCap) scene.buildings.refreshWorkerCap();
  });
  sect('troops', () => { if (scene.troops.restore) scene.troops.restore(data.troops); });
  sect('fog', () => { if (scene.territory && scene.territory.restoreFog) scene.territory.restoreFog(data.fog); });
  sect('population', () => { if (data.population && scene.population) { scene.population.restore(data.population); scene.updatePopulationHud && scene.updatePopulationHud(); } });
  sect('armies', () => { if (scene.armyMgr && scene.armyMgr.restore) scene.armyMgr.restore(data.armies); });
  sect('worldEvents', () => { if (scene.worldEvents && scene.worldEvents.restore) scene.worldEvents.restore(data.worldEvents); });
  sect('king', () => {
    if (data.king) {
      scene.kingdomName = data.king.kingdom || scene.kingdomName;
      scene.rulerName = data.king.ruler || scene.rulerName;
      scene.kingTrait = data.king.trait || scene.kingTrait;
      if (scene.kingTrait && scene.applyTraitBonuses) scene.applyTraitBonuses(scene.kingTrait);
    }
    if (data.reputation && scene.reputation) scene.reputation.restore(data.reputation);
    if (scene.updateKingdomTitle) scene.updateKingdomTitle();
  });
  sect('research', () => { if (data.research && scene.research) scene.research.restore(data.research); });
  sect('banking', () => { if (data.banking && scene.banking) scene.banking.restore(data.banking); });
  sect('greatCouncil', () => { if (data.greatCouncil && scene.greatCouncil) scene.greatCouncil.restore(data.greatCouncil); });
  sect('roads', () => { if (data.roads && scene.roads) scene.roads.restore(data.roads); });
  sect('winConditions', () => { if (data.winConditions && scene.winConditions) scene.winConditions.restore(data.winConditions); if (data.stats) scene._battlesWon = data.stats.battlesWon || 0; });
  sect('ruins', () => { if (data.ruins && scene.ruins) scene.ruins.restore(data.ruins); });
  sect('factions', () => { if (data.factions && scene.factions) scene.factions.restore(data.factions); });
  sect('discovery', () => { if (data.discovery && scene.discovery) scene.discovery.restore(data.discovery); });
  sect('tax', () => { if (data.taxIndex != null) { scene.taxIndex = data.taxIndex; scene.applyTax && scene.applyTax(); } });
  sect('kingdomStats', () => { if (data.kingdomStats && scene.stats) scene.stats.restore(data.kingdomStats); });
  sect('diplomacy', () => {
    if (data.diplomacy && scene.diplomacy) {
      if (scene.diplomacy.restore) scene.diplomacy.restore(data.diplomacy);
      else {
        Object.assign(scene.diplomacy.rel, data.diplomacy.rel || {});
        Object.assign(scene.diplomacy.nap, data.diplomacy.nap || {});
        Object.assign(scene.diplomacy.ally, data.diplomacy.ally || {});
      }
    }
  });
  sect('kingdoms', () => {
    for (const kd of data.kingdoms || []) {
      const k = (scene.kingdoms || []).find((x) => x.cfg.key === kd.key);
      if (!k) continue;
      // (barracksCount is a derived getter — don't assign it.)
      k.castleAlive = kd.castleAlive; k.castleHp = kd.castleHp;
      k.waveTimer = kd.waveTimer; k.waveNumber = kd.waveNumber; k.startDay = kd.startDay;
      k.regrouping = kd.regrouping; k.rebuildTimer = kd.rebuildTimer;
    }
  });
  sect('settlements', () => { if (scene.settlements && scene.settlements.restore) scene.settlements.restore(data.settlements); });
  sect('nodes', () => { if (scene.nodes && scene.nodes.applyCounts) scene.nodes.applyCounts(data.nodes); });
  sect('expeditions', () => { if (data.expeditions && scene.expeditions) scene.expeditions.state = data.expeditions; });
  sect('caravans', () => {
    if (scene.caravans && data.caravans && scene.settlements) {
      const byName = (n) => (scene.settlements.list || []).find((s) => s.name === n);
      scene.caravans.routes = data.caravans.map((c) => ({ from: byName(c.from), to: byName(c.to), resource: c.resource, amount: c.amount, progress: c.progress, days: c.days })).filter((c) => c.from && c.to);
    }
  });
  sect('flags', () => {
    if (data.flags) {
      if (data.flags.tut) localStorage.setItem('kg_tut', JSON.stringify(data.flags.tut));
      scene._firedHints = {};
      for (const k of data.flags.hints || []) scene._firedHints[k] = true;
    }
  });
  sect('audio', () => { if (data.audio && scene.sfx) { scene.sfx.setVolume(data.audio.volume); if (scene.sfx.muted !== data.audio.muted) scene.sfx.toggleMute(); scene.drawSoundControl && scene.drawSoundControl(); } });

  // (BUG 5) After a load: clear any pending battle, block battles for 10s, and
  // pause mid-march AI armies for 3 game-days so the player can get oriented.
  sect('loadGrace', () => {
    scene._inBattle = false;
    scene._loadGraceUntil = (scene.time ? scene.time.now : 0) + 10000;
    if (scene.armyMgr) for (const a of scene.armyMgr.aiArmies()) a._resumeDay = (scene.gameDay || 0) + 3;
    // (BUG 5) Stop any lingering BattleScene so a load never lands mid-battle.
    try { if (scene.scene.isActive('BattleScene')) scene.scene.stop('BattleScene'); } catch (e) {}
  });

  if (scene.refreshPanel) scene.refreshPanel();
  if (scene.updateHud) scene.updateHud();
}
