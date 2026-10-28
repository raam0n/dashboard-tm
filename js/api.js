import { CONFIG } from './config.js';

// Cache para evitar peticiones redundantes
const profileCache = new Map();
const matchesCache = new Map();

/**
 * Normaliza el nombre de una civilización para que coincida con el nombre de archivo PNG en /assets
 */
export function getCivIconUrl(civName) {
  if (!civName) return 'assets/icons/logo-128.png';
  const clean = civName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `assets/${clean}.png`;
}

/**
 * Devuelve la URL de la bandera del país
 */
export function getFlagUrl(countryCode) {
  if (!countryCode) return 'assets/icons/logo-128.png';
  return `https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`;
}

/**
 * Obtiene la lista actual de IDs (de URL, localStorage o lista por defecto)
 */
export function getActivePlayerIds() {
  const urlParams = new URLSearchParams(window.location.search);
  const idsParam = urlParams.get('ids');
  if (idsParam) {
    const parsed = idsParam.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (parsed.length > 0) return parsed;
  }

  const stored = localStorage.getItem(CONFIG.STORAGE_KEY_PLAYERS);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e) {
      console.warn('Error leyendo localStorage:', e);
    }
  }

  return [...CONFIG.DEFAULT_PLAYER_IDS];
}

/**
 * Guarda los IDs en localStorage
 */
export function saveActivePlayerIds(ids) {
  localStorage.setItem(CONFIG.STORAGE_KEY_PLAYERS, JSON.stringify(ids));
}

/**
 * Obtiene el perfil completo del jugador
 */
export async function fetchProfile(profileId, forceRefresh = false) {
  if (!forceRefresh && profileCache.has(profileId)) {
    return profileCache.get(profileId);
  }

  try {
    const res = await fetch(`${CONFIG.API_BASE_URL}/profiles/${profileId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    profileCache.set(profileId, data);
    return data;
  } catch (err) {
    console.error(`Error al obtener perfil ${profileId}:`, err);
    return null;
  }
}

/**
 * Obtiene el historial de partidas del jugador
 */
export async function fetchMatches(profileId, leaderboardId = 'rm_1v1', count = 20, forceRefresh = false) {
  const cacheKey = `${profileId}_${leaderboardId}_${count}`;
  if (!forceRefresh && matchesCache.has(cacheKey)) {
    return matchesCache.get(cacheKey);
  }

  try {
    const res = await fetch(`${CONFIG.API_BASE_URL}/matches?per_page=${count}&profile_ids=${profileId}&leaderboard_ids=${leaderboardId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rawMatches = data.matches || [];

    // Parseamos y simplificamos cada partida
    const simplified = rawMatches.map(m => mapMatch(m, profileId));
    matchesCache.set(cacheKey, simplified);
    return simplified;
  } catch (err) {
    console.error(`Error al obtener partidas ${profileId} (${leaderboardId}):`, err);
    return [];
  }
}

/**
 * Mapea una partida cruda a un formato fácil de usar
 */
function mapMatch(m, targetProfileId) {
  const started = m.started ? new Date(m.started).getTime() / 1000 : null;
  const finished = m.finished ? new Date(m.finished).getTime() / 1000 : null;
  const isOngoing = !finished;

  let allPlayers = [];
  if (Array.isArray(m.teams)) {
    allPlayers = m.teams.flatMap((team, teamIdx) =>
      (team.players || []).map(p => ({
        profileId: p.profileId,
        team: teamIdx + 1,
        name: p.name,
        country: p.country || '',
        civ: p.civName,
        rating: p.rating,
        ratingDiff: p.ratingDiff ?? 0,
        won: p.won,
        colorHex: p.colorHex
      }))
    );
  }

  const targetPlayer = allPlayers.find(p => p.profileId === targetProfileId) || null;
  const opponents = allPlayers.filter(p => p.profileId !== targetProfileId);

  return {
    matchId: m.matchId,
    status: isOngoing ? 'ongoing' : 'complete',
    started,
    finished,
    duration: finished && started ? (finished - started) : (started ? Math.floor(Date.now() / 1000 - started) : 0),
    mapName: m.mapName || 'Unknown Map',
    gameMode: m.gameModeName || 'RM',
    leaderboardId: m.leaderboardId,
    player: targetPlayer,
    opponents,
    allPlayers
  };
}

/**
 * Procesa todos los datos del jugador para una solapa (1v1 o Team)
 */
export async function getPlayerStats(profileId, leaderboardId = 'rm_1v1', forceRefresh = false) {
  const [profile, matches] = await Promise.all([
    fetchProfile(profileId, forceRefresh),
    fetchMatches(profileId, leaderboardId, 20, forceRefresh)
  ]);

  if (!profile) return null;

  const lbData = profile.leaderboards?.find(l => l.leaderboardId === leaderboardId);
  const ratingHistoryObj = profile.ratings?.find(r => r.leaderboardId === leaderboardId);
  const ratingHistory = ratingHistoryObj?.ratings || [];

  const currentElo = lbData?.rating ?? (ratingHistory[0]?.rating ?? 0);
  const maxElo = lbData?.maxRating ?? (ratingHistory.length > 0 ? Math.max(...ratingHistory.map(r => r.rating)) : currentElo);

  // Promedio de elo últimas 20 partidas
  const recentRatings = ratingHistory.slice(0, 20).map(r => r.rating);
  const averageEloLast20 = recentRatings.length > 0
    ? Math.round(recentRatings.reduce((a, b) => a + b, 0) / recentRatings.length)
    : currentElo;

  // Racha de victorias o derrotas en las partidas recientes
  let streak = 0;
  if (matches.length > 0 && matches[0].player?.won !== null) {
    const firstWon = matches[0].player?.won;
    for (const match of matches) {
      if (match.status === 'ongoing') continue;
      if (match.player && match.player.won === firstWon) {
        streak += firstWon ? 1 : -1;
      } else {
        break;
      }
    }
  }

  // Delta total de Elo reciente (suma de ratingDiff)
  const totalEloChange = matches
    .filter(m => m.status !== 'ongoing' && m.player?.ratingDiff)
    .reduce((acc, m) => acc + (m.player?.ratingDiff || 0), 0);

  // ¿Está jugando ahora mismo?
  const isPlayingNow = matches.length > 0 && matches[0].status === 'ongoing';
  const ongoingMatch = isPlayingNow ? matches[0] : null;

  return {
    profileId,
    name: profile.name,
    country: profile.country || '',
    leaderboardId,
    currentElo,
    maxElo,
    averageEloLast20,
    streak,
    totalEloChange,
    isPlayingNow,
    ongoingMatch,
    matches,
    profile
  };
}
