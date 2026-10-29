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
 * y excluye los que el usuario haya destildado / deshabilitado.
 */
export function getActivePlayerIds() {
  const allIds = getAllConfiguredPlayerIds();
  const disabledIds = getDisabledPlayerIds();
  return allIds.filter(id => !disabledIds.includes(id));
}

/**
 * Obtiene todos los IDs conocidos (por defecto + agregados por el usuario)
 */
export function getAllConfiguredPlayerIds() {
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
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Aseguramos que los nuevos default estén presentes también
        const merged = [...new Set([...CONFIG.DEFAULT_PLAYER_IDS, ...parsed])];
        return merged;
      }
    } catch (e) {
      console.warn('Error leyendo localStorage:', e);
    }
  }

  return [...CONFIG.DEFAULT_PLAYER_IDS];
}

/**
 * Obtiene los IDs que el usuario destildó para ocultar
 */
export function getDisabledPlayerIds() {
  const stored = localStorage.getItem(CONFIG.STORAGE_KEY_DISABLED);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      console.warn('Error leyendo disabled IDs:', e);
    }
  }
  return [];
}

/**
 * Guarda los IDs deshabilitados (destildados)
 */
export function saveDisabledPlayerIds(disabledIds) {
  localStorage.setItem(CONFIG.STORAGE_KEY_DISABLED, JSON.stringify(disabledIds));
}

/**
 * Guarda todos los IDs en localStorage
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
  const opponents = targetPlayer
    ? allPlayers.filter(p => p.team !== targetPlayer.team)
    : allPlayers.filter(p => p.profileId !== targetProfileId);

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
 * Formatea un timestamp (en segundos) o string ISO a formato dd/mm/yyyy
 */
export function formatDateDDMMYYYY(val) {
  if (!val) return 'Sin registro';
  const d = typeof val === 'number' ? new Date(val * 1000) : new Date(val);
  if (isNaN(d.getTime())) return 'Sin registro';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Obtiene el timestamp (en ms) de la última partida registrada de un perfil (en cualquier modo)
 */
export function getProfileOverallLastMatchTimestamp(profile) {
  if (!profile) return 0;
  let latestMs = 0;
  if (Array.isArray(profile.leaderboards)) {
    profile.leaderboards.forEach(lb => {
      if (lb.lastMatchTime) {
        const ms = new Date(lb.lastMatchTime).getTime();
        if (!isNaN(ms) && ms > latestMs) latestMs = ms;
      }
    });
  }
  if (latestMs === 0 && Array.isArray(profile.ratings)) {
    profile.ratings.forEach(rGroup => {
      if (Array.isArray(rGroup.ratings) && rGroup.ratings[0]?.date) {
        const ms = new Date(rGroup.ratings[0].date).getTime();
        if (!isNaN(ms) && ms > latestMs) latestMs = ms;
      }
    });
  }
  return latestMs;
}

/**
 * Obtiene la fecha de la última partida registrada de un perfil (en cualquier modo)
 */
export function getProfileOverallLastMatchDate(profile) {
  const latestMs = getProfileOverallLastMatchTimestamp(profile);
  return latestMs > 0 ? formatDateDDMMYYYY(new Date(latestMs).toISOString()) : 'Sin registro';
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

  // Racha de victorias o derrotas en las partidas recientes y puntos ganados/perdidos en esa racha
  let streak = 0;
  let streakEloChange = 0;
  const completedMatches = matches.filter(m => m.status !== 'ongoing' && m.player && typeof m.player.won === 'boolean');
  if (completedMatches.length > 0) {
    const firstWon = completedMatches[0].player.won;
    for (const match of completedMatches) {
      if (match.player && match.player.won === firstWon) {
        streak += firstWon ? 1 : -1;
        streakEloChange += (match.player.ratingDiff || 0);
      } else {
        break;
      }
    }
  }

  // Fallback para puntos de la racha desde el historial de ratings si algún match no trajo ratingDiff
  if (streak !== 0 && streakEloChange === 0 && ratingHistory.length >= Math.abs(streak)) {
    streakEloChange = ratingHistory
      .slice(0, Math.abs(streak))
      .reduce((acc, r) => acc + (r.ratingDiff || 0), 0);
  }

  // Fecha de última partida en este leaderboard
  const lastMatchRaw = matches[0]?.started || lbData?.lastMatchTime || ratingHistory[0]?.date || null;
  const lastMatchDate = formatDateDDMMYYYY(lastMatchRaw);
  const matchStartedMs = matches[0]?.started ? matches[0].started * 1000 : 0;
  const overallLastMatchTimestamp = Math.max(getProfileOverallLastMatchTimestamp(profile), matchStartedMs);
  const overallLastMatchDate = overallLastMatchTimestamp > 0
    ? formatDateDDMMYYYY(new Date(overallLastMatchTimestamp).toISOString())
    : 'Sin registro';

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
    streakEloChange,
    lastMatchDate,
    overallLastMatchDate,
    overallLastMatchTimestamp,
    totalEloChange,
    isPlayingNow,
    ongoingMatch,
    matches,
    profile
  };
}
