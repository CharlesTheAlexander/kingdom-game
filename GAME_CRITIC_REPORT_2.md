# Kingdom Game — Critic Report #2
*Second brutal pass, after the UI overhaul + polish + balance work. Played
headless across three windows: first impression, days 1–15, and a late-game /
high-resource state. Every screen below was checked for console errors — there
were **none** anywhere.*

## Headline

The game is in a genuinely different place from Critic Report #1. **Every CRITICAL
and HIGH item from that report is resolved:** the resource bar is consistent
icon+value chips, the tutorial is staged and accurate, the BattleScene has a real
terrain battlefield with dense formations and proper morale UI, diplomacy bars
have a neutral tick + color zones + effect previews, the expedition overlap/clip
is gone, reused-sprite buildings carry floating identity icons, the openers are
bottom-panel tabs, placement auto-exits, and costs show icon+number. On top of
that this session added unit animations, procedural sound, a full day/night
cycle, seasonal weather, and an economy rebalance.

So this report is necessarily about **smaller things** — there is no longer a
broken or embarrassing screen. Findings are graded CRITICAL / HIGH / MEDIUM / LOW.

---

## What was checked and looks correct

- **Animations:** warriors play a full Attack1→Attack2 swing in melee, archers
  shoot, monks cast/heal, pawns walk to nodes with the matching tool (axe/pickaxe)
  and chop/mine in place. Verified live in world combat and inside the BattleScene
  — no T-posing, no stuck frames, no flicker.
- **BattleScene:** terrain battlefield, dense ranks, floating damage numbers,
  morale bars updating, command bar — reads as a real battle now.
- **Day/night:** smooth dawn→day→dusk→night, arcing sun, stars + moon at night,
  flickering torches on every building. Looks great.
- **Weather:** snow (with roof caps) in Winter, diagonal rain in Spring/Autumn.
- **Late game / big numbers:** 125k / 48k / 250k all abbreviate cleanly in the
  bar; many clustered buildings + a Castle-tier sprite render without overflow.
- **Console:** zero errors on fresh load, during combat, at night, in winter, in
  the BattleScene, and over multi-second idle runs.

---

## Findings

### CRITICAL
None. Nothing is broken or blocks the core experience.

### HIGH
None. No glitchy animation, no overflow, no console error, no regression from the
Step 1/2 changes was found.

### MEDIUM (worth fixing now)

1. **The opening is dim/gloomy.** A new game starts at `dayTimer = 0`, i.e. exactly
   at **dawn** — the screen carries the warm-but-dark dawn overlay (~32% darken) —
   and because day 1 is Early Spring it is also **raining**. The very first
   impression is a dim, rainy, golden-dark world. The design wants a *warm,
   inviting* first look; a brightly-lit mid-morning start would land far better.
   → Fix: start the clock a little into the day (bright daylight).

2. **Day-1 wolf alarm undercuts the peaceful opening.** `spawnInitial()` spawns a
   wolf pack on load, which fires the "⚠ Wolves spotted prowling the northern
   forest" banner (and now a growl SFX once audio unlocks) within the first
   seconds. Critic #1 specifically praised the calm opening; an immediate threat
   banner works against the onboarding moment.
   → Fix: suppress the warning/SFX for the initial spawn (wolves still exist, they
   just don't announce themselves before the player has done anything).

### LOW (documented, not blocking)

3. **Weather is screen-space, not geographic.** Snow/rain fall over the whole
   viewport rather than only "mountains + settlement." A reasonable simplification
   for a screen-space particle effect, but not literally what the brief described.
4. **Gold is still non-binding early** even after the 2→1.5 trim (~450/day vs.
   early costs of 30–150). Documented in BALANCE_REPORT.md as a known,
   intentionally-light economy; recommend adding gold *sinks* rather than further
   cutting supply.
5. **Visual density at scale.** With many buildings clustered, the floating
   identity icons + torches + snow caps get busy. Readable, but a denser late-game
   base could use a way to fade icons when zoomed out.
6. **Sound quality is unverifiable headless.** Everything is wired and error-free,
   and the context unlocks on first gesture, but whether the procedural tones are
   *pleasant vs. harsh* needs a human ear — flagging as untested, not as a defect.

### LOW (design, pre-existing — from Critic #1, only partially addressed)

7. **The BattleScene still auto-yanks the army at 10+ units.** The battle now
   *looks* great, but Critic #1's deeper point — that being teleported into a
   separate autobattle removes agency at the climax — remains true by design. The
   first Yellow attack (day 8) can pull an under-prepared player into a full
   battle. Not changed this session (it's a design decision, not a bug), but worth
   revisiting if battles are meant to feel commanded rather than watched.

---

## Verdict

Post-overhaul the game reads as a real, finished-feeling game rather than a
prototype. There is **no critical or high-severity issue** to fix — the Step 1/2
changes introduced no regressions, no console errors, and no new overflow. The two
MEDIUM items (dim opening, day-1 wolf alarm) are quick onboarding-feel fixes and
are addressed in the next step.
