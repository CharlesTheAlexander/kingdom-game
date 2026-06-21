# Kingdom Game — V2 Integration Report

**Date:** 2026-06-21
**Build:** `npm run build` clean · `tsc --noEmit` clean · 0 console errors / 0 warnings across all headless playthroughs.

This report documents the V2 core-feature expansion: 13 new gameplay systems built
across 13 phases, each committed and headless-verified in isolation, then verified
together in a full integration playthrough (Phase 14).

---

## The 13 systems

| # | Phase | System | Key file(s) | What it adds |
|---|-------|--------|-------------|--------------|
| 1 | Named Faction Leaders | `FactionLeaders` | `systems/FactionLeaders.ts` | Each AI kingdom has a named ruler (Valdris, Elowen, Krag) with personality, dialogue on diplomacy/war/trade, leader-death chaos, and relationship hooks (Elowen's intel gifts, Krag's respect). Portraits shown in the diplomacy panel. |
| 2 | Great Council Hall | `CouncilScene` | `scenes/CouncilScene.ts` | A dedicated hall scene: leaders seated, sealed-letter proposals, deliberation, voting and resolution, reusing the GreatCouncil proposal logic. |
| 3 | Hero System | `Heroes` | `systems/Heroes.ts` | Six named heroes with backstories, XP/levels, passives & actives, army assignment, battle mods, the Hall of Heroes building, and fallen-hero morale. |
| 4 | Veterancy + new units | `BattleScene`, `Troops`, `ArmyManager` | combat files | Unit veterancy (green→elite, persisted via army battle history), Cavalry (charge, anti-archer) and Spearmen (anti-cavalry), and a rock-paper-scissors counter system with on-field arrows. |
| 5 | Commander in Battle | `BattleScene` | combat | The King/Queen fights as a powerful Commander unit with a trait-based ability (Battle Cry / Honorable Duel / Rally), a presence buff, and an army-wide morale collapse if slain. |
| 6 | Building Aging + Disasters | `Maintenance` | `systems/Maintenance.ts` | Buildings deteriorate (Perfect→Ruined) and lose output; Mason's Lodge maintains and repairs; disasters: Fire (spreads/destroys, dousable), Plague, Flood, and a late-game Dragon (slain by champion or Siege Workshop). |
| 7 | Royal Court + Advisors | `RoyalCourt` | `systems/RoyalCourt.ts` | A court of advisors (Marshal, Chancellor, Spymaster, +High Priest with a Grand Hall) with loyalty, weekly counsel you can Heed or Ignore, and defection to rivals when neglected. |
| 8 | Royal Marriages + Succession | `Succession` | `systems/Succession.ts` | A named heir (trait shaped by upbringing), royal marriage (60+ relations, 500g → permanent alliance + research boost), and succession on the ruler's death (coronation, or a crisis with no heir). |
| 9 | Espionage Network | `Espionage` | `systems/Espionage.ts` | A Spy Guild trains spies (80g/2d) for five covert missions: Gather Intel, Sabotage, Incite Revolt, Assassinate, Plant Rumors — each with success odds and consequences. |
| 10 | Ecosystem + Goblin Fortress | `Wildlife`, `GoblinCamps` | extended | A deer/wolf predator–prey loop (herd grows wolves; over-hunting depletes until the Conservation research), and goblin camps that grow Camp→Large→Fortress, sending larger raids with shamans. |
| 11 | Narrative Arc + 4th win | `Narrative`, `WinConditions` | `systems/Narrative.ts` | One-time story beats for the Conquest/Diplomacy/Legacy paths, ruin fragments, and a secret fourth path — "The Truth" — that unlocks a 4th win condition: restore the old empire at ruinous cost. |
| 12 | Weather Gameplay Effects | `Weather` | `systems/Weather.ts` | Winter (army −30%, food +30%, frozen rivers), Drought (farms −50%, trade +20%), and Storms (movement halted) — real modifiers, not just visuals. |
| 13 | Population Classes | `PopulationClasses` | `systems/PopulationClasses.ts` | Peasants/Craftsmen/Merchants/Nobles emerge from buildings, each with needs (unrest if ignored) and bonuses (noble governance, merchant tariffs, crafted goods). |

---

## Integration verification (Phase 14)

A single headless playthrough exercised every system together:

- **Setup:** 14 buildings placed (all V2 buildings + core economy/military).
- **60 in-game days** advanced through the real `onNewDay()` path — maintenance,
  court, succession, espionage, ecosystem, goblin growth, narrative, weather, and
  population classes all ticking. Result: 4 advisors (High Priest joined via the
  Grand Hall), a living heir, an active herd, rotating weather, and all four
  population classes present.
- **Interactions:** a royal marriage (→ permanent alliance), a spy intel mission,
  and heeding an advisor (loyalty rose) — all succeeded.
- **Battle:** launched with a Warlord Commander, veteran Cavalry (charge), and
  Spearmen vs. a mixed enemy army; counters, veterancy stars, and the commander
  ability all active.
- **Full save → load** roundtrip: day, buildings, marriage, court, and ecosystem
  state all restored correctly.

**Result: 0 console errors, 0 warnings, clean TypeScript build.**

## Constraints honoured

- Building anchor/placement math untouched.
- Save system *extended* (new `capture` fields + `sect()` restores per system), not rewritten.
- `types.ts` and existing V1 systems left intact; all new systems are additive.

## Persistence

Every stateful system serializes through `SaveManager`: `leaders`, `heroes`,
`maintenance`, `court`, `succession`, `espionage`, `wildlife`, `goblinCamps`,
`narrative`, and `weather` (population classes are derived, so they need no save).
