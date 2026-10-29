import { CONFIG } from './config.js?v=20261029b';

// Constantes de tiempo
export const ONE_MONTH_MS = (CONFIG.ACTIVE_DAYS_THRESHOLD || 30) * 24 * 60 * 60 * 1000;
export const MAX_LIVE_DURATION_SEC = 14400; // 4 horas máximo antes de considerar partida colgada/expirada

// Cache en memoria para evitar peticiones redundantes
const profileCache = new Map();
const profileInFlight = new Map();
const matchesCache = new Map();
const matchesInFlight = new Map();

// Inicializamos el cache de perfiles desde localStorage si existe
loadProfilesCacheFromStorage();

/**
 * Carga perfiles guardados en localStorage para mostrar datos instantáneamente
 */
function loadProfilesCacheFromStorage() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY_PROFILES_CACHE);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if ( parsed && typeof parsed === 'object') {
      Object.values(parsed).forEach(prof => {
        if (prof && prof.profileId) {
          profileCache.set(Number(prof.profileId), prof);
        }
      });
    }
  } catch (e) {
    console.warn('No se pudo leer cache de perfiles:', e);
  }
}

/**
 * Persiste el cache de perfiles livianos en localStorage
 */
function saveProfilesCacheToStorage() {
  try {
    const obj = {};
    profileCache.forEach((prof, id) => {
      if (prof && prof.profileId) {
        obj[id] = {
          profileId: prof.profileId,
          name: prof.name,
          country: prof.country || '',
          games: prof.games,
          drops: prof.drops,
          clan: prof.clan || '',
          leaderboards: Array.isArray(prof.leaderboards) ? prof.leaderboards : [],
          hasFullLeaderboards: Boolean(prof.hasFullLeaderboards),
          updatedAtMs: prof.updatedAtMs || Date.now()
        };
      }
    });
    localStorage.setItem(CONFIG.STORAGE_KEY_PROFILES_CACHE, JSON.stringify(obj));
  } catch (e) {
    console.warn('No se pudo guardar cache de perfiles:', e);
  }
}

/**
 * Petición fetch con reintento automático ante rate-limit (429/403) o errores temporales (5xx)
 */
async function fetchWithRetry(url, retries = 2, baseDelayMs = 550) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if ((res.status === 429 || res.status === 403 || res.status >= 500) && attempt < retries) {
        await new Promise(r => setTimeout(r, baseDelayMs * (attempt + 1)));
        continue;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, baseDelayMs * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Normaliza el nombre de una civilización para que coincida con el nombre de archivo PNG en /assets
 */
export function getCivIconUrl(civName) {
  if (!civName) return 'assets/icons/logo-128.png';
  const clean = civName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (clean === 'inca') return 'assets/incas.png';
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
 * Obtiene el perfil liviano del jugador (?exclude=ratings reduce el peso de ~150KB a ~3KB)
 */
export async function fetchProfile(profileId, forceRefresh = false) {
  const cached = profileCache.get(profileId);
  if (!forceRefresh && cached && cached.hasFullLeaderboards) {
    return cached;
  }
  if (profileInFlight.has(profileId)) {
    return profileInFlight.get(profileId);
  }

  const reqPromise = (async () => {
    try {
      const res = await fetchWithRetry(`${CONFIG.API_BASE_URL}/profiles/${profileId}?exclude=ratings`);
      const data = await res.json();
      if (data && data.profileId) {
        data.hasFullLeaderboards = true;
        data.updatedAtMs = Date.now();
        profileCache.set(profileId, data);
        saveProfilesCacheToStorage();
      }
      return data;
    } catch (err) {
      console.error(`Error al obtener perfil ${profileId}:`, err);
      return profileCache.get(profileId) || null;
    } finally {
      profileInFlight.delete(profileId);
    }
  })();

  profileInFlight.set(profileId, reqPromise);
  return reqPromise;
}

/**
 * Determina si una partida cruda está realmente en curso (excluye terminadas, abandonadas y expiradas > 4h)
 */
function isRawMatchTrulyOngoing(m, nowSec = Date.now() / 1000) {
  if (!m || m.finished || m.abandoned) return false;
  if (!m.started) return false;
  const startedSec = new Date(m.started).getTime() / 1000;
  if (isNaN(startedSec)) return false;
  return (nowSec - startedSec) < MAX_LIVE_DURATION_SEC;
}

/**
 * Obtiene en una sola consulta todas las partidas en curso (live) de la lista activa de jugadores
 */
export async function fetchGroupLiveMatches(playerIds) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) return [];
  try {
    const idsParam = playerIds.join(',');
    const res = await fetchWithRetry(`${CONFIG.API_BASE_URL}/matches?per_page=50&profile_ids=${idsParam}`, 1);
    const data = await res.json();
    const rawMatches = data.matches || [];
    const nowSec = Date.now() / 1000;

    return rawMatches
      .filter(m => isRawMatchTrulyOngoing(m, nowSec))
      .map(m => {
        let groupPid = null;
        if (Array.isArray(m.teams)) {
          for (const t of m.teams) {
            for (const p of (t.players || [])) {
              if (playerIds.includes(p.profileId)) {
                groupPid = p.profileId;
                break;
              }
            }
            if (groupPid) break;
          }
        }
        return mapMatch(m, groupPid);
      });
  } catch (err) {
    console.error('Error al obtener partidas en vivo del grupo:', err);
    return [];
  }
}

/**
 * Carga inicial ultrarrápida en lote (4 peticiones simultáneas para todo el grupo):
 * - /leaderboards/rm_1v1 (todos los activos de 1v1 en 1 llamada)
 * - /leaderboards/rm_team (todos los activos de Team en 1 llamada)
 * - /profiles (nombres y banderas de los 27 jugadores en 1 llamada)
 * - /matches (partidas en vivo y últimas 50 partidas del grupo en 1 llamada)
 */
export async function fetchGroupBootstrap(playerIds, forceRefresh = false) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) {
    return { liveMatches: [], initial1v1: [], initialTeam: [], missingProfileIds: [] };
  }

  // Sembramos nombres por defecto para cualquier jugador que aún no esté en cache
  CONFIG.DEFAULT_PLAYERS.forEach(dp => {
    if (!profileCache.has(dp.id)) {
      profileCache.set(dp.id, {
        profileId: dp.id,
        name: dp.name,
        country: 'ar',
        leaderboards: [],
        hasFullLeaderboards: false
      });
    }
  });

  const idsParam = playerIds.join(',');
  const nowSec = Date.now() / 1000;

  const [lb1v1Res, lbTeamRes, basicProfilesRes, groupMatchesRes] = await Promise.all([
    fetchWithRetry(`${CONFIG.API_BASE_URL}/leaderboards/rm_1v1?per_page=100&profile_ids=${idsParam}`, 1)
      .then(r => r.json())
      .catch(e => { console.warn('Error batch lb 1v1:', e); return { players: [] }; }),
    fetchWithRetry(`${CONFIG.API_BASE_URL}/leaderboards/rm_team?per_page=100&profile_ids=${idsParam}`, 1)
      .then(r => r.json())
      .catch(e => { console.warn('Error batch lb team:', e); return { players: [] }; }),
    fetchWithRetry(`${CONFIG.API_BASE_URL}/profiles?per_page=100&profile_ids=${idsParam}`, 1)
      .then(r => r.json())
      .catch(e => { console.warn('Error batch profiles:', e); return { profiles: [] }; }),
    fetchWithRetry(`${CONFIG.API_BASE_URL}/matches?per_page=50&profile_ids=${idsParam}`, 1)
      .then(r => r.json())
      .catch(e => { console.warn('Error batch matches:', e); return { matches: [] }; })
  ]);

  // 1. Actualizamos datos básicos (nombre, país) de todos los jugadores
  (basicProfilesRes.profiles || []).forEach(bp => {
    if (!bp || !bp.profileId) return;
    const existing = profileCache.get(bp.profileId) || { profileId: bp.profileId, leaderboards: [] };
    existing.name = bp.name || existing.name || `Jugador #${bp.profileId}`;
    existing.country = bp.country || existing.country || '';
    existing.games = bp.games ?? existing.games;
    existing.drops = bp.drops ?? existing.drops;
    existing.clan = bp.clan ?? existing.clan;
    profileCache.set(bp.profileId, existing);
  });

  // Helper para fusionar un registro de leaderboard dentro del perfil en cache
  function upsertLeaderboardEntry(profileId, leaderboardId, lbEntry) {
    const existing = profileCache.get(profileId) || { profileId, name: lbEntry.name, country: lbEntry.country || '', leaderboards: [] };
    if (lbEntry.name) existing.name = lbEntry.name;
    if (lbEntry.country) existing.country = lbEntry.country;
    if (!Array.isArray(existing.leaderboards)) existing.leaderboards = [];

    const idx = existing.leaderboards.findIndex(l => l.leaderboardId === leaderboardId);
    const mergedEntry = {
      ...(idx !== -1 ? existing.leaderboards[idx] : {}),
      ...lbEntry,
      leaderboardId
    };
    if (idx !== -1) {
      existing.leaderboards[idx] = mergedEntry;
    } else {
      existing.leaderboards.push(mergedEntry);
    }
    profileCache.set(profileId, existing);
  }

  const lb1v1Set = new Set();
  (lb1v1Res.players || []).forEach(p => {
    if (!p || !p.profileId) return;
    lb1v1Set.add(p.profileId);
    upsertLeaderboardEntry(p.profileId, CONFIG.LEADERBOARDS.RM_1V1, p);
  });

  const lbTeamSet = new Set();
  (lbTeamRes.players || []).forEach(p => {
    if (!p || !p.profileId) return;
    lbTeamSet.add(p.profileId);
    upsertLeaderboardEntry(p.profileId, CONFIG.LEADERBOARDS.RM_TEAM, p);
  });

  // 2. Procesamos las últimas 50 partidas grupales (para detectar partidas en vivo y actividad reciente)
  const rawMatches = groupMatchesRes.matches || [];
  const liveMatches = rawMatches
    .filter(m => isRawMatchTrulyOngoing(m, nowSec))
    .map(m => {
      let groupPid = null;
      if (Array.isArray(m.teams)) {
        for (const t of m.teams) {
          for (const p of (t.players || [])) {
            if (playerIds.includes(p.profileId)) {
              groupPid = p.profileId;
              break;
            }
          }
          if (groupPid) break;
        }
      }
      return mapMatch(m, groupPid);
    });

  // También actualizamos lastMatchTime si alguna partida reciente grupal es más nueva que el leaderboard
  rawMatches.forEach(m => {
    if (!m || !m.started || !m.leaderboardId || !Array.isArray(m.teams)) return;
    const lbId = m.leaderboardId;
    if (lbId !== CONFIG.LEADERBOARDS.RM_1V1 && lbId !== CONFIG.LEADERBOARDS.RM_TEAM) return;
    m.teams.forEach(t => {
      (t.players || []).forEach(p => {
        if (!p || !playerIds.includes(p.profileId)) return;
        const prof = profileCache.get(p.profileId);
        if (!prof) return;
        if (!Array.isArray(prof.leaderboards)) prof.leaderboards = [];
        let lbObj = prof.leaderboards.find(l => l.leaderboardId === lbId);
        const matchTimeMs = new Date(m.started).getTime();
        const prevTimeMs = lbObj?.lastMatchTime ? new Date(lbObj.lastMatchTime).getTime() : 0;
        const newRating = p.rating ? p.rating + (p.ratingDiff || 0) : null;
        if (!lbObj) {
          lbObj = {
            leaderboardId: lbId,
            rating: newRating || 0,
            maxRating: newRating || 0,
            lastMatchTime: m.started,
            streak: 0
          };
          prof.leaderboards.push(lbObj);
        } else if (matchTimeMs > prevTimeMs) {
          lbObj.lastMatchTime = m.started;
          if (newRating && m.finished) {
            lbObj.rating = newRating;
            if (!lbObj.maxRating || newRating > lbObj.maxRating) lbObj.maxRating = newRating;
          }
        }
      });
    });
  });

  saveProfilesCacheToStorage();

  // 3. Identificamos qué jugadores no estuvieron en ambos leaderboards activos y aún necesitan su perfil completo
  const missingProfileIds = playerIds.filter(id => {
    const inBothActive = lb1v1Set.has(id) && lbTeamSet.has(id);
    if (inBothActive) return false;
    const cached = profileCache.get(id);
    if (!forceRefresh && cached && cached.hasFullLeaderboards) return false;
    return true;
  });

  // 4. Armamos las listas iniciales para renderizar de inmediato
  const initial1v1 = playerIds.map(id => {
    const prof = profileCache.get(id);
    const cacheKey = `${id}_${CONFIG.LEADERBOARDS.RM_1V1}_20`;
    const cachedMatches = !forceRefresh && matchesCache.has(cacheKey) ? matchesCache.get(cacheKey) : [];
    return buildPlayerStatsFromProfileAndMatches(
      prof,
      CONFIG.LEADERBOARDS.RM_1V1,
      cachedMatches,
      !forceRefresh && matchesCache.has(cacheKey)
    );
  }).filter(Boolean);

  const initialTeam = playerIds.map(id => {
    const prof = profileCache.get(id);
    const cacheKey = `${id}_${CONFIG.LEADERBOARDS.RM_TEAM}_20`;
    const cachedMatches = !forceRefresh && matchesCache.has(cacheKey) ? matchesCache.get(cacheKey) : [];
    return buildPlayerStatsFromProfileAndMatches(
      prof,
      CONFIG.LEADERBOARDS.RM_TEAM,
      cachedMatches,
      !forceRefresh && matchesCache.has(cacheKey)
    );
  }).filter(Boolean);

  return {
    liveMatches,
    initial1v1,
    initialTeam,
    missingProfileIds
  };
}

/**
 * Obtiene el historial de partidas del jugador (con deduplicación de peticiones en vuelo)
 */
export async function fetchMatches(profileId, leaderboardId = 'rm_1v1', count = 20, forceRefresh = false) {
  const cacheKey = `${profileId}_${leaderboardId}_${count}`;
  if (!forceRefresh && matchesCache.has(cacheKey)) {
    return matchesCache.get(cacheKey);
  }
  if (matchesInFlight.has(cacheKey)) {
    return matchesInFlight.get(cacheKey);
  }

  const reqPromise = (async () => {
    try {
      const res = await fetchWithRetry(
        `${CONFIG.API_BASE_URL}/matches?per_page=${count}&profile_ids=${profileId}&leaderboard_ids=${leaderboardId}`
      );
      const data = await res.json();
      const rawMatches = data.matches || [];

      const simplified = rawMatches.map(m => mapMatch(m, profileId));
      matchesCache.set(cacheKey, simplified);
      return simplified;
    } catch (err) {
      console.error(`Error al obtener partidas ${profileId} (${leaderboardId}):`, err);
      return matchesCache.get(cacheKey) || [];
    } finally {
      matchesInFlight.delete(cacheKey);
    }
  })();

  matchesInFlight.set(cacheKey, reqPromise);
  return reqPromise;
}

/**
 * Mapea una partida cruda a un formato fácil de usar.
 * Contempla el parámetro `abandoned` de la API y un límite de 4 horas para no dejar partidas colgadas como LIVE.
 */
function mapMatch(m, targetProfileId) {
  const started = m.started ? new Date(m.started).getTime() / 1000 : null;
  const finished = m.finished ? new Date(m.finished).getTime() / 1000 : null;
  const nowSec = Date.now() / 1000;
  const isTimedOut = !finished && started && (nowSec - started) >= MAX_LIVE_DURATION_SEC;
  const isAbandoned = Boolean(m.abandoned) || Boolean(isTimedOut);
  const isOngoing = !finished && !isAbandoned && Boolean(started);
  const status = isOngoing ? 'ongoing' : (isAbandoned ? 'abandoned' : 'complete');

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
  const teammates = targetPlayer
    ? allPlayers.filter(p => p.team === targetPlayer.team && p.profileId !== targetProfileId)
    : [];
  const opponents = targetPlayer
    ? allPlayers.filter(p => p.team !== targetPlayer.team)
    : allPlayers.filter(p => p.profileId !== targetProfileId);

  return {
    matchId: m.matchId,
    status,
    abandoned: isAbandoned,
    started,
    finished,
    duration: finished && started ? (finished - started) : (started ? Math.floor(nowSec - started) : 0),
    mapName: m.mapName || 'Unknown Map',
    mapImageUrl: m.mapImageUrl || (m.map ? `https://backend.cdn.aoe2companion.com/public/aoe2/de/maps/${m.map}.png` : ''),
    gameMode: m.gameModeName || 'RM',
    leaderboardId: m.leaderboardId,
    player: targetPlayer,
    teammates,
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
 * Construye el objeto de estadísticas de un jugador para un leaderboard a partir de su perfil y sus partidas
 */
export function buildPlayerStatsFromProfileAndMatches(profile, leaderboardId = 'rm_1v1', matches = [], matchesLoaded = false) {
  if (!profile) return null;

  const profileId = profile.profileId;
  const lbData = profile.leaderboards?.find(l => l.leaderboardId === leaderboardId);
  const ratingHistoryObj = profile.ratings?.find(r => r.leaderboardId === leaderboardId);
  const ratingHistory = ratingHistoryObj?.ratings || [];

  const completedMatches = matches.filter(m => m.status === 'complete' && m.player && typeof m.player.won === 'boolean');
  const matchPostRatings = completedMatches
    .filter(m => typeof m.player?.rating === 'number')
    .map(m => m.player.rating + (m.player.ratingDiff || 0));

  const currentElo = lbData?.rating ?? matchPostRatings[0] ?? (ratingHistory[0]?.rating ?? 0);
  const maxElo = lbData?.maxRating ?? (
    matchPostRatings.length > 0
      ? Math.max(currentElo, ...matchPostRatings)
      : (ratingHistory.length > 0 ? Math.max(...ratingHistory.map(r => r.rating)) : currentElo)
  );

  // Promedio de elo últimas 20 partidas (desde matches o ratingHistory)
  const recentRatings = matchPostRatings.length > 0
    ? matchPostRatings.slice(0, 20)
    : ratingHistory.slice(0, 20).map(r => r.rating);
  const averageEloLast20 = recentRatings.length > 0
    ? Math.round(recentRatings.reduce((a, b) => a + b, 0) / recentRatings.length)
    : currentElo;

  // Racha de victorias o derrotas en las partidas recientes y puntos ganados/perdidos en esa racha
  let streak = 0;
  let streakEloChange = 0;
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
  } else if (typeof lbData?.streak === 'number') {
    streak = lbData.streak;
  }

  // Fecha y timestamp de última partida en este leaderboard
  const lbLastMatchMs = lbData?.lastMatchTime ? new Date(lbData.lastMatchTime).getTime() : 0;
  const matchStartedMs = matches[0]?.started ? matches[0].started * 1000 : 0;
  const ratingLastMs = ratingHistory[0]?.date ? new Date(ratingHistory[0].date).getTime() : 0;
  const lastMatchTimestamp = Math.max(
    !isNaN(lbLastMatchMs) ? lbLastMatchMs : 0,
    !isNaN(matchStartedMs) ? matchStartedMs : 0,
    !isNaN(ratingLastMs) ? ratingLastMs : 0
  );

  const lastMatchDate = lastMatchTimestamp > 0
    ? formatDateDDMMYYYY(new Date(lastMatchTimestamp).toISOString())
    : 'Sin registro';

  const overallLastMatchTimestamp = Math.max(getProfileOverallLastMatchTimestamp(profile), lastMatchTimestamp);
  const overallLastMatchDate = overallLastMatchTimestamp > 0
    ? formatDateDDMMYYYY(new Date(overallLastMatchTimestamp).toISOString())
    : 'Sin registro';

  // Delta total de Elo reciente (suma de ratingDiff)
  const totalEloChange = completedMatches
    .reduce((acc, m) => acc + (m.player?.ratingDiff || 0), 0);

  // ¿Está jugando ahora mismo en una partida válida (no abandonada ni expirada)?
  const isPlayingNow = matches.length > 0 && matches[0].status === 'ongoing';
  const ongoingMatch = isPlayingNow ? matches[0] : null;

  // ¿Jugó en el último mes (últimos 30 días) en este modo?
  const isActiveLastMonth = Boolean(
    isPlayingNow ||
    (lastMatchTimestamp > 0 && (Date.now() - lastMatchTimestamp) <= ONE_MONTH_MS)
  );

  return {
    profileId,
    name: profile.name || `Jugador #${profileId}`,
    country: profile.country || '',
    leaderboardId,
    currentElo,
    maxElo,
    averageEloLast20,
    streak,
    streakEloChange,
    lastMatchDate,
    lastMatchTimestamp,
    overallLastMatchDate,
    overallLastMatchTimestamp,
    isActiveLastMonth,
    totalEloChange,
    isPlayingNow,
    ongoingMatch,
    matches,
    matchesLoaded,
    profile
  };
}

/**
 * Procesa todos los datos del jugador para una solapa (1v1 o Team).
 * Si el jugador está inactivo en el último mes (> 30 días sin jugar ese modo) y no se fuerza `forceFetchMatches`,
 * evita pedir el endpoint `/matches` para acelerar la carga inicial.
 */
export async function getPlayerStats(profileId, leaderboardId = 'rm_1v1', forceRefresh = false, forceFetchMatches = false) {
  const profile = await fetchProfile(profileId, forceRefresh);
  if (!profile) return null;

  const lbData = profile.leaderboards?.find(l => l.leaderboardId === leaderboardId);
  const lbLastMatchMs = lbData?.lastMatchTime ? new Date(lbData.lastMatchTime).getTime() : 0;
  const activeInMonth = !isNaN(lbLastMatchMs) && lbLastMatchMs > 0 && (Date.now() - lbLastMatchMs) <= ONE_MONTH_MS;

  const shouldFetchMatches = activeInMonth || forceFetchMatches;
  const matches = shouldFetchMatches
    ? await fetchMatches(profileId, leaderboardId, 20, forceRefresh)
    : [];

  return buildPlayerStatsFromProfileAndMatches(profile, leaderboardId, matches, shouldFetchMatches);
}
