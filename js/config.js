// Configuración inicial del Dashboard
export const CONFIG = {
  API_BASE_URL: 'https://data.aoe2companion.com/api',
  // Lista de IDs predeterminados del grupo (10 jugadores)
  DEFAULT_PLAYER_IDS: [
    945834,   // Pinheads | Marty
    577933,   // kick.com/PabloG6
    1195043,  // Dexter
    2793448,  // ElQueManejaLaCombi
    239211,   // Knolte
    3081045,  // peke
    2755496,  // Sharkusa
    5358370,  // ram0ff
    1736387,  // LANDON
    2906269   // Cucurreu
  ],
  STORAGE_KEY_PLAYERS: 'aoe2_dashboard_player_ids',
  POLL_INTERVAL_MS: 30000, // 30 segundos para refresco de partidas en vivo
  LEADERBOARDS: {
    RM_1V1: 'rm_1v1',
    RM_TEAM: 'rm_team'
  }
};
