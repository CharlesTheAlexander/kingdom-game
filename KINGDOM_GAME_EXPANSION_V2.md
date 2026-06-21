# KINGDOM GAME — EXPANSION DOCUMENT V2

*Written after completing the prototype. Everything that exists is now the foundation, not the ceiling.* *The question this document answers: what does the REAL version of this game look like?*

---

## THE SHIFT IN THINKING

Version 1 asked: "can we build these systems?" Version 2 asks: "what should these systems actually FEEL like?"

The prototype proved the architecture works. Now every system gets reimagined as if budget, time, and scope were unlimited. Some of these are 2-week builds. Some are 2-month builds. All of them are worth dreaming toward.

The core principle: **every system should have a moment that makes the player put the game down and say "that was incredible."**

---

## SECTION 1: THE GREAT COUNCIL — REIMAGINED

*Charles's example. Currently: a panel with 4 buttons. Final version:*

### The Hall of Kings

When the Great Council is called, the game transitions to a dedicated **Council Scene** — a fully rendered isometric great hall, viewed from an elevated angle that gives it depth and grandeur.

**The Hall:**

- A massive stone hall with vaulted ceilings, torch-lit pillars, a long banquet table, and a raised dais where the player's throne sits  
- Each attending faction has a **representative** — a unique character seated at the table, rendered in their faction colors  
- The hall itself reflects the player's settlement tier: Small Castle: rough stone hall with wooden benches Large Castle: marble floors, tapestries, stained glass windows  
- Atmospheric: dust motes in light shafts, torch flicker, distant crowd noise

**The Session:**

- Enters with a dramatic zoom-in from the world map  
- Each faction representative "speaks" (text box with their portrait, voice lines as text, personality reflected in their words) Aggressive faction: "We did not come here to talk. Name your enemy." Diplomatic faction: "Let us find an arrangement that benefits all."  
- Proposals are presented as scrolls that unfurl on the table  
- Voting: each faction icon shows agree/disagree with animation  
- The decision moment: a dramatic pause, then result announced

**Characters at the Table:** Each AI faction has a named ruler with a personality:

- Red Kingdom: General Valdris — scarred warrior, values strength  
- Purple Kingdom: Countess Elowen — calculating, values trade  
- Yellow Kingdom: Warlord Krag — impulsive, values conquest These characters appear in world events, send messengers, react to player choices.

**Post-Council:**

- If player wins a proposal: faction representatives bow/applaud  
- If player is crowned High King: cutscene of all factions kneeling  
- Grand Hall building unlocks with a visual of it being constructed

---

## SECTION 2: THE LIVING WORLD

*Currently: a 200x200 map with biomes and events. Final version:*

### A Continent With History

**The World Has a Past:** Before the player arrives, something happened. The ruins aren't random — they tell a story. The ancient civilization that built them fell for a reason. Discovering all 6 ruins reveals fragments of this story.

Full narrative arc:

- The Sunken Citadel: "Here fell the last emperor of the old world"  
- The Forge of Ages: "Here they made weapons that could kill gods"  
- The Iron Throne: "Here the betrayal happened"  
- Collecting all fragments unlocks a final ruin: The Truth A 7th hidden ruin that reveals the full history Reward: a legendary artifact tied to the old empire's power

**The World Reacts:** Every major player action ripples outward:

- Destroy a faction's castle: their refugees flee across the continent (visible as a migrating group on the map)  
- Build a Grand Hall: other factions send delegations to see it (small groups approach your territory)  
- Achieve a win condition: world events reference your legend "Merchants speak of the kingdom that united the continent"

**Weather Systems:** Not just visual seasons — weather affects gameplay:

- Harsh winter: army movement \-30%, food consumption \+30%, rivers freeze (armies can cross river tiles in winter)  
- Drought (summer event): farms \-50%, gold trade \+20% (scarcity makes resources valuable)  
- Storm: prevents army movement for 1-2 days, fleet (future) cannot sail  
- Fog of war on continent view: actual fog that hides army movements during misty mornings

**Ecosystems:** Wildlife isn't just a threat — it's a system:

- Wolf packs grow if deer population grows (wolves eat deer)  
- Deer graze in cleared forest areas  
- Overhunting depletes food nodes permanently until "Conservation" research is unlocked  
- Goblin camps expand if left alone too long: small camp → large camp → goblin fortress Goblin fortress sends larger raids and trains goblin shamans

---

## SECTION 3: CHARACTERS AND HEROES

*Currently: anonymous units. Final version:*

### Named Heroes

**Hero Units:** As the game progresses, named heroes can join your kingdom. Each hero is a unique unit with:

- A name and brief backstory  
- Special abilities (passive and active)  
- Leveling system (gains XP from battles)  
- Equipment slots (weapons and armor found in ruins or crafted)  
- Personality that affects events (brave hero refuses to retreat, cautious hero warns you before risky battles)

**How Heroes Arrive:**

- World events: "A wandering knight seeks worthy service"  
- Ruin exploration: legendary soldier found frozen in time  
- Battle reward: enemy general surrenders and joins you  
- Great Council: faction gifts you their champion

**Hero Examples:** Aldric the Unbroken — warrior hero Passive: nearby warriors \+15% morale Active: "Last Stand" — if army is routing, Aldric stops it, morale restored to 40, costs 30 HP Equipment: can equip legendary swords found in ruins

Sister Maren — monk hero Passive: all monks \+50% heal rate Active: "Field Hospital" — after battle, heals 25% of fallen soldiers (they return instead of dying)

The Merchant Prince — economy hero Passive: all market trades \+25% better Active: "Trade Deal" — instantly establish a trade route with any faction, regardless of current relations

**Hero Death:** Heroes can die in battle if HP reaches 0\. Hero death: dramatic moment — world event fires, kingdom morale \-20, notifications log records the moment. "Aldric the Unbroken fell defending the northern pass on Day 47." Their grave becomes a landmark on the map.

**The Hero Hall:** Build a "Hall of Heroes" building (Castle tier). Displays all living and fallen heroes. Fallen heroes inspire living ones: \+5 morale in battle for each fallen hero remembered there.

---

## SECTION 4: THE BATTLE SYSTEM — FULLY REALIZED

*Currently: formations \+ terrain \+ morale. Final version:*

### Wars That Feel Like History

**Pre-Battle Intelligence:** Before a battle, if you have espionage research:

- See enemy army composition, morale, supply level  
- Choose which battlefield (if intercepting vs defending)  
- "Send scouts" 1 day before battle: reveals enemy formation plan

**The Battlefield:**

- Much larger than current implementation  
- Distinct terrain zones that matter strategically: High ground: visible, defensible, archers devastating from here Forest flanks: hidden approach, units invisible until they emerge River ford: bottleneck, 2 units wide, defender huge advantage Ruins: provides cover, blocks arrows, flanking opportunities  
- Weather affects battlefield: Rain: archers \-50% effectiveness, melee unchanged Fog: units become visible only when adjacent Snow: all movement \-30%, cavalry unusable

**Unit Veterancy:** Units gain experience from surviving battles:

- Green (0 battles): baseline stats  
- Trained (1-2 battles): \+10% stats  
- Veteran (3-5 battles): \+25% stats, special formation ability  
- Elite (6+ battles): \+50% stats, never routes, inspires nearby units Veteran units have visual distinction: different shield patterns, battle-worn armor, scars

**Army Composition Matters:** Rock-paper-scissors style counters:

- Cavalry (new unit) counter archers  
- Spearmen (new unit) counter cavalry  
- Archers counter infantry  
- Monks counter morale loss  
- Siege units counter walls and fortifications  
- Knights counter everything but are expensive

**The Commander:** Your King/Queen enters battles personally as a Commander unit:

- High HP, strong stats  
- Special abilities based on chosen trait Warlord King: "Battle Cry" — all units \+30% for 20 seconds Diplomat Queen: "Honorable Duel" — challenge enemy commander to single combat (removes their commander bonus)  
- If Commander dies in battle: massive morale collapse  
- Adds huge risk/reward to aggressive play

**Siege Battles:** When attacking a walled settlement:

- Dedicated siege phase before main battle  
- Catapults attack walls, archers on walls shoot back  
- Wall sections have individual HP, fall dramatically  
- Once breached: battle transitions to normal mode but now inside the settlement's streets (different battlefield layout — tight, urban)

**Naval Combat (future system foundation):** Build Docks (river/coast settlements unlock this) Ships carry armies across water faster Naval battles when fleets meet

---

## SECTION 5: KINGDOM SIMULATION DEPTH

*Currently: buildings produce resources, workers assigned. Final version:*

### A Living Kingdom

**Individual Citizens:** Your population isn't just a number — citizens have:

- Professions (farmer, miner, soldier, merchant, scholar)  
- Happiness based on their specific needs  
- Movement: you can see them walking between buildings  
- Names (procedurally generated, shown on hover)  
- "Notable citizens" emerge: the best farmer, the bravest soldier These become candidates for hero status

**Building Aging:** Buildings deteriorate over time without maintenance:

- Every 20 days: buildings lose 1 condition level  
- Condition levels: Perfect → Good → Weathered → Damaged → Ruined  
- Weathered: \-10% production  
- Damaged: \-30% production, workers refuse to work there  
- Ruined: no production, becomes rubble pile  
- New building type: Mason's Lodge — maintains nearby buildings "Your Lumberyard is deteriorating — assign a mason" notifications

**Disasters:** Random negative events that require response:

- Fire: a building catches fire, spreads if not stopped "Town Hall is on fire\!" — send workers to extinguish If not stopped in 2 days: building destroyed  
- Plague: spreads through population, reduces workforce Monastery \+ clean water source (aqueduct) prevents spread  
- Flood: river overflows, farms in low areas destroyed Builds toward this over days: "River levels rising"  
- Dragon (rare late game): massive creature attacks settlement Requires a champion hero or siege weapons to defeat Drops legendary loot if killed

**Supply Chains:** Resources don't teleport to the castle — they're physically moved:

- Carts travel between buildings carrying resources  
- You can see the economy in motion  
- Bottleneck: if road is blocked or workers overwhelmed, supply chain slows and production backs up  
- Road damage: enemy raids can destroy road segments

**Population Classes:** As settlement grows, social classes emerge:

- Peasants: farmers, miners, basic workers  
- Craftsmen: skilled workers, need Guildhall  
- Merchants: traders, need Market  
- Nobles: luxury needs, provide governance bonuses  
- Each class has different needs and provides different bonuses  
- Ignoring a class causes unrest specific to that class

---

## SECTION 6: DIPLOMACY — A LIVING POLITICAL WORLD

*Currently: relationship bars \+ treaties. Final version:*

### Courts, Marriages, and Betrayals

**Royal Court:** Your castle has a court of advisors with opinions:

- Military Advisor: pushes for aggressive expansion  
- Trade Advisor: pushes for diplomacy and commerce  
- Spymaster: suggests espionage and manipulation  
- High Priest (if Monastery): suggests religious alliances Each advisor gives a weekly report and suggests actions. Following their advice affects their loyalty. Disloyal advisors may defect to enemy factions.

**Royal Marriages:** Arrange marriages between your heir and faction rulers' children:

- Requires \+60 relations with target faction  
- Costs: 500 gold dowry  
- Effect: permanent peace with that faction shared research bonuses their heir inherits claim to your throne (succession)  
- Visual: wedding ceremony in Great Hall scene  
- Named heir character created

**Succession:** When the King/Queen dies (if commander killed or natural event):

- Heir inherits the throne  
- Heir's traits depend on: parent traits \+ how they were raised (events during the game asked how to raise the heir)  
- If no heir: succession crisis All factions see opportunity, relations destabilize Random noble claims throne (new faction appears temporarily)

**Espionage Network:** Build an Intelligence building (Medium Town+):

- Train spies: cost 80 gold, takes 2 days  
- Spies can be sent to factions with missions: Gather Intel: reveal resources, army size, research Sabotage: destroy one building (50% success, spy lost if fails) Incite Rebellion: reduce faction happiness, may cause revolt Assassinate: target enemy hero (risky, 30% success) Plant Rumors: reduce that faction's relations with another

**Reputation Spreads:** Your reputation has narrative weight:

- High Conqueror rep: bards sing of your battles Random events: "A song about your conquest reaches distant lands" Effect: recruiting mercenaries costs less (they want to serve legends)  
- High Merchant rep: trade caravans route through your territory Effect: passive gold income from passing traders  
- High Destroyer rep: refugees flee ahead of your armies Effect: settlements surrender faster but happiness of conquered population starts lower

---

## SECTION 7: THE NARRATIVE ARC

*Currently: no story. Final version:*

### The Age of Kingdoms

**The Setting:** The continent was once unified under an ancient empire. That empire fell 200 years ago for reasons lost to history. Now the continent is fragmented — your kingdom is one of many trying to fill the power vacuum.

The ruins are what's left of the old empire. The AI factions are different successors to different parts of it. You are either the rightful heir or a new power rising.

**Three Story Paths (tied to win conditions):**

CONQUEST PATH — "The Unifier" Your story: you believe might makes right. Only through conquest can the continent be stabilized. Narrative beats as you conquer each faction:

- Conquering Red: "Valdris's sword is yours now. His soldiers kneel."  
- Conquering Purple: "The Countess's treasury opens to your kingdom."  
- Final conquest: a ceremony scene — the continent bows. End screen: painted mural of your victories. Kingdom renamed "The \[Your Name\] Empire."

DIPLOMACY PATH — "The Peacemaker" Your story: you believe unity through choice is the only lasting peace. Narrative beats as each faction joins willingly:

- First alliance: "Word spreads that a new kind of king has risen."  
- Great Council: the moment the world changes peacefully End screen: the Great Hall with all factions present. Your throne room becomes the heart of a new confederation.

LEGACY PATH — "The Builder" Your story: you believe civilization matters more than conquest. Your kingdom becomes a beacon — people come to you. Narrative beats as population grows and culture develops:

- Population 100: "Your city is spoken of in distant lands."  
- Grand Hall built: "Scholars and artists travel weeks to see it." End screen: a thriving city, your descendants ruling long after you. Named "The Golden Age of \[Kingdom Name\]."

**The Secret Fourth Path — "The Truth"** Discover all 7 ruins, read all fragments. The ancient empire's power was never destroyed — it's sealed beneath the continent's center. A final expedition unlocks it. This reveals a 4th win condition: restore the old empire. Costs everything — nearly bankrupts your kingdom — but the reward is unprecedented power and a unique ending.

---

## SECTION 8: VISUAL IDENTITY — THE REAL GAME

*Currently: programmatic geometric art. Final version:*

### What This Game Should Look Like

**Art Direction:** Warm, hand-crafted, slightly painterly pixel art. Think: Stardew Valley meets Advance Wars meets Into the Breach. The world should look LIVED IN — worn stone, overgrown ruins, firelit windows, weathered wood.

**Priority Asset Wishlist:**

1. Castle evolution (all 9 stages should look dramatically different)  
2. The Great Hall interior (for Council scenes)  
3. Hero portraits (6-8 unique characters, expressive)  
4. Faction leader portraits (for diplomacy panels)  
5. World map terrain (hand-painted biomes)  
6. Battle backgrounds (per terrain type)  
7. Unit sprites (proper animations: idle, walk, attack, death, celebrate)  
8. Building sprites with day/night variants (lit windows at night)

**UI Visual Language:** Every panel should feel like a physical object in the world:

- Diplomacy panel: an unrolled parchment scroll  
- Research tree: carved stone tablet with glowing runes  
- Great Council: the actual hall, not a menu  
- Army panel: a war map with pins and string  
- Resource bar: carved stone ledger

**Atmosphere:** The game world should feel like it has weather, time, and life even when you're not looking. Idle animations everywhere:

- Soldiers patrol castle walls  
- Farmers bend and straighten working fields  
- Smoke drifts from chimneys  
- Birds fly across the sky occasionally  
- Fish jump in rivers

---

## SECTION 9: THE TECHNICAL EVOLUTION

### What The Game Needs To Scale

**Larger World:** 500x500 minimum. 1000x1000 target. Requires: chunked rendering (only render visible area), LOD system (simpler sprites at distance), background simulation (off-screen factions still run)

**Procedural Generation:** Each playthrough generates a unique continent:

- Different biome layouts  
- Unique faction starting positions  
- Randomized ruin placement and history fragments  
- Different neutral settlement names and specialties  
- Seed system: share a seed for identical worlds

**Save System Evolution:**

- Cloud saves (future)  
- Multiple save slots with screenshots  
- Autosave every 3 days (more frequent)  
- "Iron mode": one save slot, permadeath on kingdom loss

**Multiplayer Foundation:** The architecture already supports it conceptually. Each player is a faction. The AI factions still exist for single-player feel. Async multiplayer first (take turns, like a board game) Real-time multiplayer later.

---

## SECTION 10: PRIORITY ROADMAP V2

If this game becomes something serious, build in this order:

**TIER 1 — Makes the existing game feel complete:**

1. Named faction leaders with personalities and portraits  
2. Hero units system  
3. Great Council as a rendered hall scene  
4. Building aging and maintenance  
5. Veteran unit system

**TIER 2 — Dramatically expands the world:** 6\. Narrative arc with 4 story paths 7\. Royal marriages and succession 8\. Espionage network 9\. Ecosystem and disaster systems 10\. Procedural world generation

**TIER 3 — Technical scale:** 11\. 500x500+ world with chunked rendering 12\. Naval combat foundations 13\. Proper pixel art asset commission 14\. Async multiplayer

**TIER 4 — The real game:** 15\. Full narrative with voiced text 16\. Console/mobile port consideration 17\. Steam release preparation

---

## THE ONE-SENTENCE PITCH

*"Build a kingdom from a ruined village, forge alliances or conquer rivals, uncover the secrets of a fallen empire, and write your name into history — in a world that keeps changing whether you're watching or not."*

---

*This document is the vision. The prototype proved it's buildable.* *Every system in V1 is the seed of something in V2.* *The question is no longer "can we build this" — it's "how good can we make it."*  
