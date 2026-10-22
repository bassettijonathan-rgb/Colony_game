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
