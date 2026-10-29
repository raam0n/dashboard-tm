// Configuración inicial del Dashboard
export const CONFIG = {
  API_BASE_URL: 'https://data.aoe2companion.com/api',
  // Lista de jugadores predeterminados del grupo (26 jugadores)
  DEFAULT_PLAYERS: [
    { id: 945834, name: 'Pinheads | Marty' },
    { id: 577933, name: 'kick.com/PabloG6' },
    { id: 1195043, name: 'Dexter' },
    { id: 2793448, name: 'ElQueManejaLaCombi' },
    { id: 239211, name: 'Knolte' },
    { id: 3081045, name: 'peke' },
    { id: 2755496, name: 'Sharkusa' },
    { id: 5358370, name: 'ram0ff' },
    { id: 1736387, name: 'LANDON' },
    { id: 2906269, name: 'Cucurreu' },
    { id: 2294850, name: 'cHELOOO' },
    { id: 2908658, name: 'webber' },
    { id: 583791, name: 'Heisen' },
    { id: 295979, name: 'La Lisandreta' },
    { id: 1752862, name: 'TM Caesar' },
    { id: 2583252, name: 'Gram' },
    { id: 2715643, name: 'TM AndresgP' },
    { id: 2328358, name: 'TM FacuN' },
    { id: 2474407, name: 'TM Napoleón' },
    { id: 881290, name: 'TM Fer0x' },
    { id: 2798370, name: 'TM Minato_07' },
    { id: 2383543, name: 'Clemente' },
    { id: 447722, name: 'Koffler' },
    { id: 2566703, name: 'TM TOGAMI' },
    { id: 1034341, name: 'funke' },
    { id: 1904119, name: 'Vicezz' },
    { id: 2084001, name: 'ram0n' }
  ],
  // Array de solo IDs para compatibilidad
  get DEFAULT_PLAYER_IDS() {
    return this.DEFAULT_PLAYERS.map(p => p.id);
  },
  STORAGE_KEY_PLAYERS: 'aoe2_dashboard_player_ids',
  STORAGE_KEY_DISABLED: 'aoe2_dashboard_disabled_ids',
  POLL_INTERVAL_MS: 30000, // 30 segundos para refresco de partidas en vivo
  LEADERBOARDS: {
    RM_1V1: 'rm_1v1',
    RM_TEAM: 'rm_team'
  }
};
