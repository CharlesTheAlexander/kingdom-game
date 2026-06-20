# Kingdom Game — Economy Balance Report
*Generated from live quantitative simulation (Polish session, Phase 6).*

## Method

Two automated runs were driven through the real game via `window.__game`, at an
accelerated game clock (`gameSpeed = 120`), sampling exact resource totals at
each in-game day boundary. Production is accumulator-based, so resource numbers
are accurate at high speed. **Combat/wave numbers at high speed are NOT reliable**
(the AI's build + wave timers also accelerate, inflating wave sizes), so combat
conclusions below are drawn from the code, not the sped-up run.

- **Sim A — Idle baseline:** 3 starting workers, **no buildings built**. Measures
  the pure freelance-gathering economy.
- **Sim B — Scripted build-up:** auto-builds 3 Houses → Lumberyard → Farm → Mine
  → Barracks as soon as affordable, staffs them, and trains up to 5 warriors.

Both runs reach day 8, where the Yellow Kingdom's first attack pauses the world
(its army at gs120 is inflated to ~24 units — a speed artifact; the real first
wave is `2 × barracksCount × countMul` ≈ a handful of units).

---

## Sim A — Idle economy (no buildings), per game-day

| Day | Wood | Stone | Food | Gold |
|----:|-----:|------:|-----:|-----:|
| 1 |   86 |   22 |   60 |  172 |
| 2 |  212 |   80 |   64 |  756 |
| 3 |  341 |  140 |   68 | 1356 |
| 4 |  473 |  200 |   72 | 1956 |
| 5 |  611 |  258 |   72 | 2556 |
| 6 |  746 |  280 |  140 | 3156 |
| 7 |  878 |  340 |  144 | 3756 |
| 8 | 1010 |  400 |  148 | 4356 |

**Idle rates (3 workers):** Wood ≈ **130/day**, Stone ≈ **60/day**, Food ≈ **4–14/day**
(lumpy — depends which node is nearest), Gold ≈ **600/day** (Castle, flat 2/sec).

## Sim B — Scripted build-up, per game-day

| Day | Wood | Stone | Food | Gold | Bld | Soldiers |
|----:|-----:|------:|-----:|-----:|----:|---------:|
| 1 |   20 |   20 |   68 |  172 | 2 | 0 |
| 2 |   74 |   74 |  347 |  526 | 7 | 5 |
| 3 |  263 |  224 |  657 | 1126 | 7 | 5 |
| 4 |  509 |  330 |  967 | 1726 | 7 | 5 |
| 5 |  737 |  450 | 1277 | 2326 | 7 | 5 |
| 6 |  995 |  558 | 1587 | 2926 | 7 | 5 |
| 8 | 1349 |  828 | 2202 | 4092 | 7 | 1 |

With a staffed Farm/Lumberyard/Mine, every resource climbs faster than idle —
food in particular goes from a trickle (~4/day idle) to a flood (~300/day with a
3-worker Farm). The full build (7 buildings + 5 warriors) is affordable by **day 2**.

---

## Answers to the eight questions

1. **Days to first House (30 wood):** Day 1 — idle wood passes 30 within the first day.
2. **Days to first Lumberyard (40 wood):** Day 1.
3. **Days to first Barracks (80 gold + 40 wood):** Day 1 — gold/wood both clear it almost immediately.
4. **Days to first Warrior (30 gold + 5 food):** Day 1, once a Barracks exists.
5. **Idle stone income:** ≈ **60 stone/day** from 3 freelancing workers.
6. **Is stone impossible early?** **No.** The old critique does not reproduce —
   idle workers freelance-gather stone at ~60/day and a Mine (50 stone) is
   affordable by day 2. (Freelancing + the extra near-castle nodes added in the
   prior session keep stone flowing.)
7. **Food at day 10 with 5 warriors:** 5 warriors eat **10 food/day** (2 each).
   Idle food income is only ~4–14/day, so **without a Farm food trends down** and
   hits a crisis in ~6 days from the 60 starting buffer. **With one staffed Farm**
   (~300 food/day) food is a non-issue — a comfortable surplus (Sim B reaches
   2000+ food). Food is therefore the one resource that *requires* a building once
   you field an army — which is the intended design.
8. **First bottleneck — gold vs wood vs stone:** **None are scarce.** Gold is
   massively *oversupplied* (600/day from the Castle vs. early costs of 30–150),
   wood is plentiful (130/day), stone is adequate (60/day). The only thing that
   ever goes negative is **food**, and only if you skip the Farm.

---

## Progression gates (tier costs vs. income)

| Tier | Cost | Affordable from idle income by |
|---|---|---|
| Medium Village | 150g + 100w | Day 1–2 |
| Large Village | 250g + 150w + 50s | Day 2 |
| Small Town | 400g + 200w + 150s | Day 3 |
| Medium Town | 600g + 250w + 200s | Day 4 |
| Large Town | 900g + 300w + 350s + 50fe | Day 6 |
| Small Castle | 1200g + 400w + 500s + 100fe | (iron-gated) |
| Large Castle | 2500g + 600s + 300fe | (iron-gated) |

No stage costs are wildly out of proportion to income on wood/stone/gold. The
real late-stage gate is **iron**, which only comes from expeditions/raids — that
is the intended pacing lever, not a bug.

---

## Balance changes applied

| Change | Before | After | Why |
|---|---|---|---|
| Castle gold rate | 2.0 /sec (600/day) | **1.5 /sec (450/day)** | Gold was 4–20× early costs and ballooned to 4 000+ by day 8 with nothing to spend it on. 1.5/s keeps training/upgrades comfortable while making gold slightly less trivial. Low-risk: gold remains non-binding at either rate. |

## Issues hypothesised in the brief that the data did NOT confirm

- **"Stone is impossible early"** — refuted; ~60 stone/day idle.
- **"Food crisis hits too fast"** — only if you field an army before a Farm; a
  single staffed Farm fully solves it. Working as intended.
- **"Gold bottleneck too severe"** — the opposite is true (gold oversupply).

These hypothesised fixes (add stone nodes, cut Mine cost, increase food income,
add a gold node) were therefore **not** applied — they would push an already
generous economy further toward trivial.

## Recommendations for future tuning (not changed this session)

1. **Idle abundance undercuts the worker-allocation pillar.** Freelancers already
   supply wood/stone/food generously, so staffing production buildings is rarely
   *necessary* early. Consider reducing freelance yields (e.g. wood 3→2, food 4→3
   per trip) so that assigning workers to buildings becomes the meaningful upgrade
   the design intends. Deferred because it changes early pacing and warrants its
   own playtest.
2. **Give gold more early sinks** (cheaper-but-frequent purchases, mercenary
   recruitment, repair costs) rather than only trimming supply.
3. **Smooth idle food** (it is lumpy because freelancers chase the nearest node);
   a small dedicated "first food node" guarantee near the castle would steady the
   pre-Farm period.
