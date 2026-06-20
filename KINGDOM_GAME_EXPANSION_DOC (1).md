# KINGDOM GAME — CREATIVE DIRECTOR EXPANSION DOCUMENT

*Written as hired creative director. Honest assessment \+ full expansion plan.* *This is additive to DESIGN\_DOC.md — read both together.*

---

## HONEST ASSESSMENT OF CURRENT STATE

The game has impressive technical depth but is missing the thing that makes players stay up until 3am: **a reason to care.**

Right now you build a kingdom because the game lets you. You fight because enemies attack. You send expeditions because there's a button. None of it feels personal or driven by narrative tension.

The games you cited do this differently:

- **Kingdoms and Castles:** you care because attacks feel threatening and your village feels like yours  
- **Mount and Blade:** you care because YOUR character has a story, reputation, relationships — the world reacts to YOU specifically  
- **Stardew Valley:** you care because the world has personality, characters have names and opinions, and small things feel meaningful

The fix isn't more features. It's **identity and consequence.** Everything below is built around that principle.

---

## SECTION 1: THE KING (PLAYER IDENTITY)

Right now the player is a cursor. They have no identity in the world.

### The King System

The player is a named King/Queen with personal stats that evolve through play.

**Starting creation (one-time, 60 seconds):**

- Choose a kingdom name (affects NPC dialogue throughout)  
- Choose a ruler name  
- Choose a starting trait (one of 6):  
  - **Warlord:** troops cost 20% less food, army cap \+5  
  - **Merchant:** market trades at better ratios, gold income \+10%  
  - **Builder:** buildings cost 15% less wood, construction time halved  
  - **Diplomat:** start with \+20 relations with all factions  
  - **Explorer:** fog of war reveals 25% faster, expedition returns faster  
  - **Scholar:** unlock research system from the start

**Reputation system:** Your reputation spreads across the continent based on actions.

- Win battles: gain "Conqueror" reputation (+intimidation, AI less likely to attack)  
- Trade frequently: gain "Merchant" reputation (better prices, factions approach you)  
- Help defend others: gain "Protector" reputation (neutral factions offer alliances)  
- Raid and destroy: gain "Destroyer" reputation (factions fear you, some flee, others form coalitions against you)

Reputation is visible as a title under your kingdom name: "The Kingdom of \[Name\] — The Merchants" or "— The Conquerors"

AI factions react to your reputation:

- High Conqueror rep: weaker factions pay tribute without fighting  
- High Merchant rep: passing caravans stop to trade with you  
- High Destroyer rep: all factions ally against you eventually

---

## SECTION 2: THE WORLD (LIVING CONTINENT)

### The continent needs to feel alive, not like a strategy board.

**Named locations everywhere:** Every point of interest has a name and brief history (one sentence).

- "Ironhold Pass — A mountain fortress abandoned after the great plague"  
- "The Wandering Market — A traveling merchant camp that moves each season"  
- "Greywood — An ancient forest said to be haunted. Wolves are unusually large here."

These names appear when you discover locations. They cost nothing technically (just text data) but make the world feel authored, not procedural.

**Dynamic world events (random, ongoing):** Events happen across the continent whether you're involved or not. Pull from a table of \~30 events, fire 1-2 per game week:

World events (you observe these on continent view or get messengers):

- "The Purple Kingdom has conquered Millhaven. Their territory expands."  
- "A harsh winter has hit the eastern mountains. All kingdoms suffer food shortages."  
- "A traveling scholar arrives. Pay 100 gold for a random research unlock."  
- "A plague spreads from the river delta. Farms in that region produce 50% less."  
- "Bandits have raided the mountain pass. Caravans through that route are suspended."  
- "The Yellow Kingdom's king died. They are weakened for 5 days."  
- "A merchant guild has formed. Trade routes across the continent are more profitable."

Events that directly affect you:

- "A deserter from the Red Kingdom arrives offering intel. Accept? (free intel)"  
- "Your soldiers found an abandoned cache in the forest. \+50 iron."  
- "A noble family requests shelter in your kingdom. Accept? (+2 workers, \+loyalty)"  
- "One of your workers claims to have found a hidden vault. Send troops to investigate?"

**Messenger system:** When important events happen, a messenger icon appears near your castle. Click it to read the message. This makes the world feel like it's communicating with you, not just existing around you.

### World Scale

Current map: 200x200 tiles Target map: 500x500 tiles minimum

Why: at 200x200 AI kingdoms are visible from your starting position. The continent should feel genuinely vast. You should be able to play for 30 minutes and still not have explored 20% of it.

What fills the space:

- 20-30 named neutral settlements (vs current 9\)  
- 15-20 goblin camps across the continent  
- 5-8 ancient ruins (explorable, one-time reward)  
- 3-5 wandering factions (merchant caravans, nomadic tribes, pilgrim groups)  
- More biome variety: swamps, volcanic regions, coastal areas, frozen tundra  
- Hidden locations: only revealed by scouting or rumors from messengers

---

## SECTION 3: KINGDOM DEPTH

### Population System

Right now "workers" are an abstraction. Make them feel like people.

**Population:**

- Your kingdom has a population count (not just worker cap)  
- Population grows naturally over time (+1 per 3 days if food is sufficient)  
- Population provides workers, soldiers, and happiness  
- Houses hold 4 people (not just 2 workers)  
- People need: food, shelter (housing), entertainment (Tavern), safety (walls/towers)

**Happiness meter:** A single happiness value 0-100 for your kingdom.

- High happiness (70+): population grows faster, workers produce more (+10%)  
- Low happiness (30-): workers slow down, population stops growing  
- Very low happiness (10-): people leave, population decreases

What affects happiness:

- Food available: \+20 if stockpile \> 100, \-30 if food \= 0  
- Safety: \+10 if no attacks in last 5 days, \-20 if castle took damage  
- Entertainment: \+15 if Tavern built  
- Overcrowding: \-10 if population \> housing capacity  
- Taxes: adjustable slider (high taxes \= more gold, \-happiness)

**Tax system:** Slider in the kingdom panel: Low/Normal/High/Extortionate

- Low: \-30% gold income, \+10 happiness  
- Normal: baseline  
- High: \+30% gold income, \-15 happiness  
- Extortionate: \+60% gold income, \-40 happiness, risk of revolt

**Revolt:** If happiness hits 0 for 3 consecutive days:

- Workers go on strike (no production)  
- Some soldiers defect  
- Message: "Your people have had enough. Restore order or lose your kingdom."  
- Fix by: reducing taxes, building Tavern, winning a battle (pride boost)

### Research System

Build a Library (new building) to unlock a research tree.

**Library:** costs 100 gold \+ 80 wood \+ 40 stone Unlocks one research per 3 game days. Choose from a tree:

MILITARY BRANCH:

- Iron Weapons: warriors \+20% damage  
- Heavy Armor: warriors \+30 HP  
- Cavalry Training: knights \+30% speed  
- Siege Craft: unlocks Siege Workshop  
- Battle Tactics: formations deal \+15% damage in BattleScene

ECONOMY BRANCH:

- Advanced Farming: farms \+50% food production  
- Mining Techniques: mines \+50% stone production  
- Trade Networks: market trade ratios improve  
- Iron Smelting: Blacksmith produces equipment faster  
- Tax Reform: tax happiness penalty reduced by 50%

EXPLORATION BRANCH:

- Cartography: fog of war reveals faster  
- Ranger Training: expedition soldiers suffer 50% fewer casualties  
- Pathfinding: army movement speed on continent \+25%  
- Espionage: can see AI kingdom army composition at any time  
- Diplomatic Channels: start negotiations without positive relations

Show research tree as a visual tree in a new panel. Current research shows a progress bar and days remaining.

### Building Upgrade Depth

Current buildings have 3 levels. Expand to 5 levels with meaningful changes:

**Barracks example:**

- Level 1: trains Warriors, 1 slot  
- Level 2: trains Archers, 2 slots  
- Level 3: trains Monks, 3 slots, \+10% training speed  
- Level 4: unlocks Elite Warriors (veteran troops, \+50% stats), 4 slots  
- Level 5: unlocks legendary unit (Champion — 1 max, massive stats), 5 slots

**Farm example:**

- Level 1: 2 food/sec per worker  
- Level 2: 3 food/sec, can store 200 food on-site  
- Level 3: 4 food/sec, automatically feeds nearby workers (no manual stockpile draw)  
- Level 4: 6 food/sec, generates surplus food that can be exported via caravan  
- Level 5: 8 food/sec, provides small happiness bonus to nearby population

---

## SECTION 4: ARMY AND WARFARE OVERHAUL

### Army-on-Map System (the Bannerlord layer)

This is the most important missing system.

**How it works:** Troops no longer just sit at your castle. You organize them into named Armies that exist as units on the map.

**Creating an army:**

- New button in the military panel: "Form Army"  
- Select which troops to include (drag from available pool)  
- Name the army (optional): "Northern Guard", "Iron Legion"  
- Army appears as a single icon on the isometric map (use a flag/banner sprite — player color with number showing troop count)

**Moving an army:**

- Click the army icon to select it  
- Right-click a destination on the map  
- Army marches there visibly (the icon moves across the terrain)  
- Movement speed depends on terrain (forest \= slow, roads \= fast, mountains \= slowest)  
- Army movement is shown on continent view as a moving dot

**Army visibility:**

- Your armies: always visible to you  
- Enemy armies: visible when within your territory or scouted  
- Unknown enemy armies: show as "?" on continent view until scouted

**What armies do:**

- March to a neutral settlement → attacks garrison → conquest  
- March to AI kingdom territory → triggers war declaration  
- Stationed at your border → deters small raids (goblins avoid territories with armies)  
- Stationed at a conquered settlement → garrison duty (no attacks while army present)

**Battle trigger (revised):** BattleScene triggers when two armies (not just loose units) meet on the map.

- Your army vs enemy army: BattleScene  
- Your army vs neutral garrison: BattleScene if garrison \> 10, skirmish if under  
- Goblin raids vs your army if army is present: auto-repel (no scene)

**Multiple armies:**

- Can have up to 3 armies simultaneously (upgradeable with Large Castle)  
- Each army is independent — can send one to defend, one to conquer, one to escort caravans  
- Armies need food supply: each army draws from your stockpile daily  
- Army too far from supply \= morale penalty in battle

### Battle Scene Overhaul

Current battle scene is flat and lacks agency.

**Camera control:**

- Player can pan across the battlefield during combat  
- Zoom in to watch individual fights, zoom out to see the whole battle

**Unit selection in battle:**

- Click individual units or drag to box-select specific groups  
- Issue commands to selected group only (not whole army)  
- This adds tactical depth: send your archers to high ground, hold your warriors at a chokepoint, flank with knights

**Terrain matters:**

- High ground tiles: units on them deal \+20% damage  
- Forest tiles: units in them have \+30% defense, move slower  
- River crossing: units crossing deal \-30% damage (both hands occupied)  
- Fortified positions: if defending a settlement, defender starts with walls

**Reinforcements:** If you have a second army within 3 map tiles of the battle:

- After 90 seconds of fighting, option appears: "Reinforcements arriving in 30s"  
- Second army marches onto the battlefield from the edge  
- This encourages keeping reserve forces

**Retreat consequences:**

- Retreating army moves on the map, can be pursued  
- Pursuing enemy army can catch retreating army for a second, smaller battle  
- Successful retreat: keep 60% of troops as before  
- Caught while retreating: only keep 30%

### AI Kingdom Depth

AI kingdoms should feel like real rivals, not just attack timers.

**Each AI kingdom has:**

- A personality: Aggressive / Expansionist / Defensive / Mercantile  
- A leader name and title  
- Their own research (they unlock abilities over time)  
- Their own army-on-map (you can see them moving on continent view)  
- Internal events (their king dies, they have a civil war, they expand)

**AI behaviors by personality:**

- Aggressive: builds armies fast, attacks frequently, ignores economy  
- Expansionist: conquers neutral settlements first before attacking you  
- Defensive: builds walls and towers, rarely attacks but is hard to conquer  
- Mercantile: sends trade caravans, accumulates gold, buys mercenaries

**Coalition warfare:** When one faction hits \-80 relationship with multiple kingdoms: Those kingdoms discuss forming a coalition (visible on continent view as a meeting event). If coalition forms, they coordinate attacks within the same day — a real threat requiring diplomatic or military response.

---

## SECTION 5: EXPLORATION AND DISCOVERY

The world should reward exploration with genuine surprises.

### Ancient Ruins

5-8 locations on the map, hidden in fog until discovered.

Each ruin is a one-time encounter:

- Send an expedition party to investigate  
- Takes 2-3 days to explore  
- Returns with one of:  
  - A unique artifact (permanent buff, specific to that ruin's lore)  
  - A research unlock (bypass needing a Library for one tech)  
  - A map revealing a hidden location  
  - A legendary unit that joins your army (1 of 4 unique champions)  
  - Cursed treasure: resources but \-20 happiness for 5 days

Ruin names suggest their history: "The Sunken Citadel", "The Wanderer's Rest", "The Forge of Ages"

### Wandering Factions

Non-kingdom groups that move across the continent.

**Merchant Caravans (neutral):**

- Appear on continent view moving between settlements  
- Can intercept them on the map with an army  
- If friendly reputation: they stop and trade (rare resources)  
- If Destroyer reputation: they avoid your territory entirely  
- Can be raided (get their goods, lose reputation)

**Nomadic Tribes:**

- Wander specific biome regions (desert nomads, forest tribes)  
- Can be befriended: send gifts (resources) → they become allies  
- Allied tribe: provides scouts (reveal fog in their region), occasional military support  
- Hostile tribe: raids resource nodes in their region

**Pilgrim Groups:**

- Walk across the continent toward a specific destination  
- If they pass through your territory: small happiness bonus  
- Build a Monastery: pilgrims stop there, providing a trickle of gold

### The Underworld (Late Game)

Hidden beneath the map, accessible via Ancient Ruins or special research.

Underground region: a separate smaller map layer

- Contains: rare iron deposits, crystal resources (new late-game material)  
- Threats: underground creatures (different from surface wildlife)  
- Accessible by building a mine to sufficient depth (level 5 Mine)  
- Adds a whole new exploration dimension without changing surface gameplay

---

## SECTION 6: ECONOMY EXPANSION

### Resource Chains (manufacturing)

Raw resources → processed goods → advanced products

Current: Wood → build buildings (direct) Expanded:

- Wood → Lumber (at Sawmill) → Ships, Advanced Buildings  
- Iron Ore → Iron Bars (at Blacksmith) → Equipment, Weapons, Tools  
- Stone → Cut Stone (at Stonecutter) → Walls, Castle upgrades  
- Food (Wheat \+ Meat) → Cooked Food (at Kitchen) → better soldier upkeep bonus

This adds depth without complexity — the chain is 1 step longer, not a factory simulator.

### Trade and Markets

**Domestic market:**

- Your population buys and sells goods internally  
- Supply and demand: if you have too much wood, its value drops  
- Rare resources are worth more when scarce

**External trade:**

- AI kingdoms with positive relations offer trade deals  
- "Red Kingdom will buy 50 iron for 200 gold per week"  
- Establishes an automatic trade route (like caravan but to an AI kingdom)  
- Both sides benefit — this is the economic incentive for peace

**Merchant Guild:** Once you have a Market \+ Caravan Post \+ positive reputation: A Merchant Guild NPC appears in your kingdom

- Offers contracts: "Deliver 100 wood to Ironpass within 5 days for 300 gold"  
- Completing contracts raises Merchant reputation and unlocks better contracts  
- Guild eventually offers a "Guild Hall" building that generates passive income

### Banking System (Late Game)

Build a Treasury (new building, Castle tier required)

- Store gold as "reserves" — earns 2% interest per game week  
- Take out "loans" — get immediate gold, repay over time with interest  
- Default on loan — faction relations worsen, loan shark mercenaries attack

---

## SECTION 7: DIPLOMACY EXPANSION

Current diplomacy is a relationship bar with 2 buttons. Expand to a full diplomatic layer.

### Treaties and Agreements

Beyond non-aggression pacts:

**Trade Agreement:** automatic resource exchange, both benefit **Military Alliance:** they send troops if you're attacked (and vice versa) **Vassalage:** weaker kingdom pays you tribute, you protect them **Royal Marriage:** maximum relationship, permanent peace, shared research **Non-Compete Zone:** agree not to expand into a specific region

### Diplomatic Actions

More options than just Tribute and Declare War:

- **Send Ambassador:** opens full diplomatic dialogue  
- **Demand Tribute:** if you're much stronger, demand they pay you  
- **Offer Ceasefire:** stop an ongoing war temporarily  
- **Betray Alliance:** break a treaty for strategic gain (massive rep penalty)  
- **Spread Rumors:** reduce another faction's reputation with everyone else  
- **Request Military Access:** army can cross their territory peacefully

### The Great Council (Very Late Game)

When 3+ factions exist with positive relations: Can call a Great Council — all factions meet to discuss a continent-wide issue.

Council proposals:

- "Declare a common enemy" (all factions coordinate against one)  
- "Establish trade routes" (everyone benefits economically)  
- "End the age of war" (peace treaty, everyone stops attacking for 10 days)

Hosting the Council gives massive reputation boost. Winning a Council vote unlocks a unique building: "The Grand Hall"

---

## SECTION 8: THE ENDGAME

Right now there is no defined endgame. Add three win paths.

### Path 1: Conquest

Control 75% of the continent's settlements. Trigger: a cinematic-style announcement, then a final faction forms to resist you. Defeat them in one final massive battle.

### Path 2: Diplomacy

Achieve Alliance status with all surviving factions simultaneously. Trigger: The Great Council names you High King of the Continent. Much harder than conquest — requires managing relationships with everyone.

### Path 3: Legacy

Reach Large Castle AND complete all 5 branches of the research tree AND have population \> 500 AND happiness \> 80 for 10 consecutive days. Trigger: Your kingdom becomes the cultural center of the continent. Other factions send their children to study in your kingdom. A "legacy score" is calculated and displayed.

### After the endgame:

Don't end the game. Show the win condition, give a score/title, then let the player continue in a "legacy mode" where they try to maintain their dominance against increasing challenges.

---

## SECTION 9: QUALITY OF LIFE

Small things that make the game significantly better to play.

### Save System

Right now losing \= reset. This is brutal.

- Auto-save every 5 game days  
- Manual save: press S or use a save button  
- 3 save slots  
- Load from save: main menu option  
- This alone will make the game 10x more enjoyable

### Speed Controls Improvement

Current: 1x/2x/3x Add: Pause (0x) — lets player think without time pressure Add: Fast-forward to next event (skips to next attack/expedition return)

### Notifications Log

A scrollable log of everything that happened (bottom of screen, toggle):

- "Day 12: Yellow Kingdom attacked. 3 warriors lost."  
- "Day 13: Scout expedition returned with 40 iron."  
- "Day 15: Population reached 50." Player can see history without memorizing everything.

### Kingdom Statistics Panel

A panel showing all-time stats:

- Battles won/lost  
- Resources gathered total  
- Buildings constructed  
- Days survived  
- Population peak  
- Territories controlled

### Hotkeys

Every action should have a keyboard shortcut. Show shortkey hints on all buttons. Common hotkeys:

- B: open build menu  
- E: open expeditions  
- K: open kingdoms/diplomacy  
- M: open market  
- Tab: continent view  
- Space: pause/unpause  
- 1-5: select army groups

---

## IMPLEMENTATION PRIORITY

If I were directing development, this is the order:

**MUST DO FIRST (game-changing impact):**

1. Save system — players are losing progress, this is killing engagement  
2. Army-on-map system — changes how combat feels entirely  
3. Population \+ happiness — makes the kingdom feel alive  
4. Named world events \+ messengers — makes world feel authored

**HIGH IMPACT (do next):** 5\. Research tree 6\. King identity \+ reputation 7\. Battle scene tactical control (select units in battle) 8\. Save/load system (did I mention this? It's critical)

**MEANINGFUL ADDITIONS:** 9\. Ancient ruins exploration 10\. Wandering factions 11\. Diplomacy expansion (treaties, council) 12\. Building upgrade depth (5 levels)

**LATER:** 13\. Resource chains / manufacturing 14\. Banking system 15\. Underground layer 16\. Endgame paths 17\. Coalition warfare

---

## THE ONE THING

If I could only tell you one thing that would improve this game the most:

**Add a save system and add the army-on-map system.**

Right now players lose everything when they close the tab. That single fact limits how invested anyone can get.

And right now combat is something that happens TO you. The army-on-map system makes you the one who decides when and where wars happen.

Those two changes transform this from an impressive technical demo into a game people will actually play for hours.

---

*This document represents a creative director's vision for the game.* *Prioritize based on what makes the game feel most alive, not what's* *technically easiest to build.*  
