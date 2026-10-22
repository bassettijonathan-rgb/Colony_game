// The numbers the whole game agrees on.
export const MAP = 600;              // the surface is MAP x MAP tiles, one tile about two metres
export const CH = 32;                // chunk size in tiles: the unit of painting, pathfinding and coarse simulation
export const NCH = Math.ceil(MAP / CH);
export const TPS = 30;               // simulation ticks per real second at normal speed
export const DAY_TICKS = 12 * 60 * TPS; // a day lasts 12 minutes at normal speed
export const YEAR_DAYS = 80, SEASON_DAYS = 20;
export const SPEEDS = [0, 1, 3, 6];  // pause, normal, fast, fastest
export const SEASONS = ['Thaw', 'Long light', 'Storm', 'Deep cold'];

// terrain
export const T = { MEADOW: 0, DIRT: 1, SAND: 2, SHALLOW: 3, DEEP: 4, ROCK: 5, SCREE: 6, MARSH: 7, FOREST: 8, SCORCH: 9 };
export const T_NAME = ['Meadow', 'Bare soil', 'Sand', 'Shallow water', 'Deep water', 'Rock', 'Scree', 'Marsh', 'Woodland', 'Scorched ground'];
// cost of crossing a tile, tenths of a normal step; 0 means impassable
export const T_COST = [10, 9, 13, 26, 0, 0, 14, 19, 12, 10];
export const isWater = t => t === T.SHALLOW || t === T.DEEP;
export const HOUR = DAY_TICKS / 24;  // ticks in a game hour
export const DUSK = 19.3, DAWN = 5.6; // the light the colony works by

// what a person is doing, as the renderer needs to know it
export const ACT = { BED: 0, WALK: 1, HOME: 2, SURVEY: 3, TOBED: 4, INSIDE: 5, IDLE: 6, CARRY: 7, BUILD: 8, EAT: 9, ALONE: 10, PLANT: 11, WAKE: 12 };
export const ACT_NAME = ['Asleep in a bedroll', 'Walking', 'Walking back to camp', 'Surveying', 'Going to bed', 'In the shelter', 'Taking it easy at camp', 'Carrying a module from the lander', 'Building the shelter', 'Eating by the fire', 'Sitting alone, away from everyone', 'Planting a sensor stake', 'Waking in a new body'];

// crews
export const SHIFTS = [{ name: 'Short', a: 8, b: 16 }, { name: 'Day', a: 7, b: 18 }, { name: 'Long', a: 6, b: 20 }];
export const WORKS = { shelter: 'Shelter', survey: 'Survey', rest: 'Rest' };
export const RULES = { dark: 'Back at camp by dark', pairs: 'Nobody walks alone', rest: 'Stop when exhausted' };
export const SKILLS = ['building', 'engineering', 'fieldcraft', 'medicine', 'botany', 'cooking', 'leadership', 'teaching'];
export const SKILL_NAME = { building: 'Building', engineering: 'Engineering', fieldcraft: 'Fieldcraft', medicine: 'Medicine', botany: 'Botany', cooking: 'Cooking', leadership: 'Leadership', teaching: 'Teaching' };
