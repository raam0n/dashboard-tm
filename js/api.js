import { CONFIG } from './config.js?v=20261110c';

// Constantes de tiempo
export const ONE_MONTH_MS = (CONFIG.ACTIVE_DAYS_THRESHOLD || 30) * 24 * 60 * 60 * 1000;
export const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_LIVE_DURATION_SEC = 14400; // 4 horas máximo antes de considerar partida colgada/expirada

// Caches unificados en memoria (y persistidos en localStorage) para reciclar datos entre todas las solapas
const profileCache = new Map();
const profileInFlight = new Map();
const matchesCache = new Map();
const matchesInFlight = new Map();

// Pool central transversal de partidas crudas (matchId -> rawMatch)
const unifiedRawMatchesMap = new Map();
let matchesCacheUpdatedAtMs = 0;

// Estado de paginación grupal por leaderboard ('rm_1v1' | 'rm_team')
const groupLeaderboardPagination = new Map();
const groupPaginationInFlight = new Map();

// Registro de jugadores cuyas últimas 10 partidas ya fueron completadas individualmente (key: `${profileId}_${lbId}` -> timestampMs)
const playerTopUpTimestampMap = new Map();
const playerTopUpInFlight = new Map();

// Caché de estadísticas condensadas por jugador y modo (`/profiles/{id}/stats/all`)
const playerStatsAllCache = new Map();
const playerStatsAllInFlight = new Map();

// Cola ligera para espaciar peticiones secundarias y evitar bloqueos 429/403
let lastRequestTimeMs = 0;
const MIN_REQUEST_GAP_MS = 220;

// Inicializamos los caches desde localStorage al arrancar
loadProfilesCacheFromStorage();
loadMatchesCacheFromStorage();
loadStatsAllCacheFromStorage();

/**
 * Carga perfiles guardados en localStorage para mostrar datos instantáneamente
 */
function loadProfilesCacheFromStorage() {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY_PROFILES_CACHE);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
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
 * Persiste el cache de perfiles livianos (incluyendo stats condensadas si existen) en localStorage
 */
function saveProfilesCacheToStorage() {
  try {
    if (typeof localStorage === 'undefined') return;
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
          stats: Array.isArray(prof.stats) ? prof.stats : undefined,
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
 * Carga el pool unificado de partidas desde localStorage
 */
function loadMatchesCacheFromStorage() {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY_MATCHES_CACHE);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.matches)) {
      matchesCacheUpdatedAtMs = Number(parsed.updatedAtMs) || 0;
      parsed.matches.forEach(m => {
        if (m && m.matchId) {
          unifiedRawMatchesMap.set(Number(m.matchId), m);
        }
      });
      if (parsed.pagination && typeof parsed.pagination === 'object') {
        Object.entries(parsed.pagination).forEach(([lbId, state]) => {
          groupLeaderboardPagination.set(lbId, state);
        });
      }
      if (parsed.topUpTimestamps && typeof parsed.topUpTimestamps === 'object') {
        Object.entries(parsed.topUpTimestamps).forEach(([key, ts]) => {
          playerTopUpTimestampMap.set(key, Number(ts) || 0);
        });
      }
    }
  } catch (e) {
    console.warn('No se pudo leer cache de partidas:', e);
  }
}

/**
 * Persiste las partidas más recientes del pool unificado en localStorage (compactadas para ahorrar espacio)
 * y garantiza preservar siempre al menos las últimas 12 partidas de cada jugador por modo para que nunca se corten los 10 rombos.
 */
function saveMatchesCacheToStorage() {
  try {
    if (typeof localStorage === 'undefined') return;
    const allSorted = Array.from(unifiedRawMatchesMap.values())
      .sort((a, b) => new Date(b.started || 0).getTime() - new Date(a.started || 0).getTime());

    const keptMatchIds = new Set();
    const playerModeCounts = new Map();
    const trackedSet = new Set(CONFIG.DEFAULT_PLAYERS.map(p => p.id));

    const retainedMatches = [];
    for (let i = 0; i < allSorted.length; i++) {
      const m = allSorted[i];
      if (!m || !m.matchId) continue;

      let shouldKeep = i < 900;
      const lbId = m.leaderboardId;

      if (Array.isArray(m.teams) && (lbId === CONFIG.LEADERBOARDS.RM_1V1 || lbId === CONFIG.LEADERBOARDS.RM_TEAM)) {
        for (const t of m.teams) {
          for (const p of (t.players || [])) {
            if (p && p.profileId && (trackedSet.has(p.profileId) || profileCache.has(p.profileId))) {
              const cKey = `${p.profileId}_${lbId}`;
              const prevCount = playerModeCounts.get(cKey) || 0;
              if (prevCount < 12) {
                shouldKeep = true;
              }
              playerModeCounts.set(cKey, prevCount + 1);
            }
          }
        }
      }

      if (shouldKeep && !keptMatchIds.has(m.matchId)) {
        keptMatchIds.add(m.matchId);
        retainedMatches.push({
          matchId: m.matchId,
          started: m.started,
          finished: m.finished,
          abandoned: m.abandoned,
          leaderboardId: m.leaderboardId,
          leaderboardName: m.leaderboardName,
          gameModeName: m.gameModeName,
          map: m.map,
          mapName: m.mapName,
          mapImageUrl: m.mapImageUrl,
          server: m.server,
          teams: Array.isArray(m.teams) ? m.teams.map(t => ({
            teamId: t.teamId,
            players: Array.isArray(t.players) ? t.players.map(p => ({
              profileId: p.profileId,
              name: p.name,
              country: p.country,
              civ: p.civ,
              civName: p.civName,
              rating: p.rating,
              ratingDiff: p.ratingDiff,
              won: p.won,
              colorHex: p.colorHex
            })) : []
          })) : []
        });
      }
    }

    const paginationObj = {};
    groupLeaderboardPagination.forEach((val, key) => {
      paginationObj[key] = val;
    });

    const topUpObj = {};
    playerTopUpTimestampMap.forEach((val, key) => {
      topUpObj[key] = val;
    });

    localStorage.setItem(CONFIG.STORAGE_KEY_MATCHES_CACHE, JSON.stringify({
      updatedAtMs: matchesCacheUpdatedAtMs || Date.now(),
      pagination: paginationObj,
      topUpTimestamps: topUpObj,
      matches: retainedMatches
    }));
  } catch (e) {
    console.warn('No se pudo guardar cache de partidas en localStorage:', e);
  }
}

/**
 * Carga el cache de estadísticas condensadas (`/stats/all`) desde localStorage
 */
function loadStatsAllCacheFromStorage() {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY_STATS_ALL_CACHE);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      Object.entries(parsed).forEach(([key, val]) => {
        if (val && val.durations) {
          playerStatsAllCache.set(key, val);
        }
      });
    }
  } catch (e) {
    console.warn('No se pudo leer cache de stats/all:', e);
  }
}

/**
 * Guarda el cache de estadísticas condensadas en localStorage
 */
function saveStatsAllCacheToStorage() {
  try {
    if (typeof localStorage === 'undefined') return;
    const obj = {};
    playerStatsAllCache.forEach((val, key) => {
      obj[key] = val;
    });
    localStorage.setItem(CONFIG.STORAGE_KEY_STATS_ALL_CACHE, JSON.stringify(obj));
  } catch (e) {
    console.warn('No se pudo guardar cache de stats/all:', e);
  }
}

/**
 * Petición fetch con control de ráfaga y reintento ante rate-limit (429/403) o errores temporales (5xx)
 */
async function fetchWithRetry(url, retries = 2, baseDelayMs = 1500, paceRequest = false) {
  if (paceRequest) {
    const now = Date.now();
    const waitMs = Math.max(0, (lastRequestTimeMs + MIN_REQUEST_GAP_MS) - now);
    lastRequestTimeMs = now + waitMs;
    if (waitMs > 0) {
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

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
 * Ingiere un listado de partidas crudas al pool central unificado (`unifiedRawMatchesMap`)
 * y actualiza la información de leaderboards/perfiles de los jugadores involucrados.
 */
export function ingestRawMatches(rawMatches = [], trackedPlayerIds = [], persistToStorage = true) {
  if (!Array.isArray(rawMatches) || rawMatches.length === 0) return;
  const trackedSet = new Set(trackedPlayerIds);

  rawMatches.forEach(m => {
    if (!m || !m.matchId) return;
    const matchId = Number(m.matchId);
    unifiedRawMatchesMap.set(matchId, m);

    if (!m.started || !m.leaderboardId || !Array.isArray(m.teams)) return;
    const lbId = m.leaderboardId;
    if (lbId !== CONFIG.LEADERBOARDS.RM_1V1 && lbId !== CONFIG.LEADERBOARDS.RM_TEAM) return;

    m.teams.forEach(t => {
      (t.players || []).forEach(p => {
        if (!p || !p.profileId) return;
        if (trackedSet.size > 0 && !trackedSet.has(p.profileId)) return;

        const prof = profileCache.get(p.profileId) || {
          profileId: p.profileId,
          name: p.name || `Jugador #${p.profileId}`,
          country: p.country || '',
          leaderboards: []
        };
        if (p.name && (!prof.name || prof.name.startsWith('Jugador #'))) prof.name = p.name;
        if (p.country && !prof.country) prof.country = p.country;
        if (!Array.isArray(prof.leaderboards)) prof.leaderboards = [];

        let lbObj = prof.leaderboards.find(l => l.leaderboardId === lbId);
        const matchTimeMs = new Date(m.started).getTime();
        const prevTimeMs = lbObj?.lastMatchTime ? new Date(lbObj.lastMatchTime).getTime() : 0;
        const newRating = p.rating ? p.rating + (p.ratingDiff || 0) : null;

        if (!lbObj) {
          lbObj = {
            leaderboardId: lbId,
            rating: newRating || p.rating || 0,
            maxRating: newRating || p.rating || 0,
            lastMatchTime: m.started,
            streak: 0
          };
          prof.leaderboards.push(lbObj);
        } else {
          if (matchTimeMs > prevTimeMs) {
            lbObj.lastMatchTime = m.started;
            if (newRating && m.finished) {
              lbObj.rating = newRating;
            }
          }
          if (newRating && (!lbObj.maxRating || newRating > lbObj.maxRating)) {
            lbObj.maxRating = newRating;
          }
        }
        profileCache.set(p.profileId, prof);
      });
    });
  });

  if (persistToStorage) {
    saveMatchesCacheToStorage();
  }
}

/**
 * Obtiene todas las partidas crudas del pool unificado ordenadas por fecha de inicio descendente
 */
export function getAllUnifiedRawMatches() {
  return Array.from(unifiedRawMatchesMap.values()).sort(
    (a, b) => new Date(b.started || 0).getTime() - new Date(a.started || 0).getTime()
  );
}

/**
 * Construye el listado de partidas mapeadas de un jugador para un modo específico
 * reciclando el pool central (`unifiedRawMatchesMap`) + cualquier historial individual en caché.
 */
export function getPlayerMatchesFromUnifiedPool(profileId, leaderboardId = 'rm_1v1') {
  const byMatchId = new Map();

  // 1. Partidas desde el pool grupal unificado
  unifiedRawMatchesMap.forEach(rawMatch => {
    if (!rawMatch || rawMatch.leaderboardId !== leaderboardId || !Array.isArray(rawMatch.teams)) return;
    const participated = rawMatch.teams.some(t =>
      Array.isArray(t.players) && t.players.some(p => p && p.profileId === profileId)
    );
    if (participated) {
      byMatchId.set(Number(rawMatch.matchId), mapMatch(rawMatch, profileId));
    }
  });

  // 2. Partidas individuales si se habían consultado directamente para este jugador
  const directKey = `${profileId}_${leaderboardId}`;
  const directMatches = matchesCache.get(directKey);
  if (Array.isArray(directMatches)) {
    directMatches.forEach(m => {
      if (m && m.matchId && !byMatchId.has(Number(m.matchId))) {
        byMatchId.set(Number(m.matchId), m);
      }
    });
  }

  return Array.from(byMatchId.values()).sort((a, b) => (b.started || 0) - (a.started || 0));
}

/**
 * Obtiene el perfil liviano del jugador (?extend=stats_civ_map&exclude=ratings incluye stats históricas condensadas)
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
      const res = await fetchWithRetry(
        `${CONFIG.API_BASE_URL}/profiles/${profileId}?extend=stats_civ_map&exclude=ratings`,
        1,
        1500,
        true
      );
      const data = await res.json();
      if (data && data.profileId) {
        data.hasFullLeaderboards = true;
        data.updatedAtMs = Date.now();
        profileCache.set(profileId, data);
        saveProfilesCacheToStorage();
      }
      return data;
    } catch (err) {
      console.warn(`Aviso al obtener perfil ${profileId}:`, err.message || err);
      return profileCache.get(profileId) || null;
    } finally {
      profileInFlight.delete(profileId);
    }
  })();

  profileInFlight.set(profileId, reqPromise);
  return reqPromise;
}

/**
 * Obtiene las estadísticas condensadas de civilizaciones y mapas para todas las ventanas de tiempo
 * (`1d`, `1w`, `1m`, `3m`, `1y`, `max`) en 1 sola petición a `/profiles/{id}/stats/all`.
 */
export async function fetchPlayerCondensedStats(profileId, leaderboardId = 'rm_1v1', forceRefresh = false) {
  if (!profileId) return null;
  const cacheKey = `${profileId}_${leaderboardId}`;
  const cached = playerStatsAllCache.get(cacheKey);
  const ttl = CONFIG.STATS_ALL_CACHE_TTL_MS || (15 * 60 * 1000);

  if (!forceRefresh && cached && cached.durations && (Date.now() - (cached.updatedAtMs || 0)) < ttl) {
    return cached.durations;
  }
  if (playerStatsAllInFlight.has(cacheKey)) {
    return playerStatsAllInFlight.get(cacheKey);
  }

  const reqPromise = (async () => {
    try {
      const res = await fetchWithRetry(
        `${CONFIG.API_BASE_URL}/profiles/${profileId}/stats/all?leaderboard_id=${leaderboardId}`,
        1,
        1500,
        true
      );
      const data = await res.json();
      if (data && data.durations) {
        const entry = {
          profileId,
          leaderboardId,
          durations: data.durations,
          updatedAtMs: Date.now()
        };
        playerStatsAllCache.set(cacheKey, entry);
        saveStatsAllCacheToStorage();
        return data.durations;
      }
      return cached?.durations || null;
    } catch (err) {
      console.warn(`Aviso al obtener stats condensadas de ${profileId} (${leaderboardId}):`, err.message || err);
      return cached?.durations || null;
    } finally {
      playerStatsAllInFlight.delete(cacheKey);
    }
  })();

  playerStatsAllInFlight.set(cacheKey, reqPromise);
  return reqPromise;
}

/**
 * Calcula y devuelve las estadísticas de Civilizaciones y Mapas de un jugador para un período:
 * - `period`: `7` (7 días), `30` (30 días), `90` (90 días), o `'max'` (Histórico total).
 * Recicla automáticamente las estadísticas condensadas de `/stats/all`, `profile.stats` y el pool de partidas.
 */
export function getPlayerCivsAndMapsAnalytics(player, leaderboardId = 'rm_1v1', period = 7) {
  if (!player) {
    return { civs: [], maps: [], totalGames: 0, totalWins: 0, totalLosses: 0, winRate: 0, source: 'empty', isComplete: false };
  }

  const profileId = player.profileId;
  const cacheKey = `${profileId}_${leaderboardId}`;
  const condensedEntry = playerStatsAllCache.get(cacheKey);
  const durations = condensedEntry?.durations || null;

  // Mapeo de período a clave de `durations` en `/stats/all`
  const durationKey = period === 'max' ? 'max' : (period === 90 ? '3m' : (period === 30 ? '1m' : '1w'));

  // 1. Intentamos extraer desde las estadísticas condensadas (`/stats/all` o `profile.stats` para 'max')
  let condensedBlock = null;
  if (durations && Array.isArray(durations[durationKey]) && durations[durationKey].length > 0) {
    condensedBlock = durations[durationKey].find(
      s => (s.leaderboardId || s.leaderboard_id) === leaderboardId
    ) || durations[durationKey][0];
  } else if (period === 'max' && Array.isArray(player.profile?.stats)) {
    condensedBlock = player.profile.stats.find(
      s => (s.leaderboardId || s.leaderboard_id) === leaderboardId
    ) || null;
  }

  let condensedResult = null;
  if (condensedBlock && (Array.isArray(condensedBlock.civ) || Array.isArray(condensedBlock.map))) {
    const rawCivs = Array.isArray(condensedBlock.civ) ? condensedBlock.civ : [];
    const rawMaps = Array.isArray(condensedBlock.map) ? condensedBlock.map : [];

    const civs = rawCivs
      .filter(c => c && (c.games || 0) > 0)
      .map(c => {
        const total = Number(c.games) || 0;
        const wins = Number(c.wins) || 0;
        const losses = c.losses != null ? Number(c.losses) : Math.max(0, total - wins);
        return {
          name: c.civName || c.civ_name || c.civ || 'Unknown',
          civKey: c.civ || '',
          total,
          wins,
          losses,
          winRate: total > 0 ? (wins / total) * 100 : 0
        };
      })
      .sort((a, b) => b.total - a.total || b.winRate - a.winRate);

    const maps = rawMaps
      .filter(m => m && (m.games || 0) > 0)
      .map(m => {
        const total = Number(m.games) || 0;
        const wins = Number(m.wins) || 0;
        const losses = m.losses != null ? Number(m.losses) : Math.max(0, total - wins);
        const mapSlug = m.map || '';
        const mapImageUrl = m.mapImageUrl || m.map_image_url || (mapSlug ? `https://backend.cdn.aoe2companion.com/public/aoe2/de/maps/${mapSlug}.png` : '');
        return {
          name: m.mapName || m.map_name || m.map || 'Unknown Map',
          mapImageUrl,
          total,
          wins,
          losses,
          winRate: total > 0 ? (wins / total) * 100 : 0
        };
      })
      .sort((a, b) => b.total - a.total || b.winRate - a.winRate);

    const totalGames = civs.reduce((acc, c) => acc + c.total, 0) || maps.reduce((acc, m) => acc + m.total, 0);
    const totalWins = civs.reduce((acc, c) => acc + c.wins, 0) || maps.reduce((acc, m) => acc + m.wins, 0);
    const totalLosses = Math.max(0, totalGames - totalWins);
    const winRate = totalGames > 0 ? (totalWins / totalGames) * 100 : 0;

    condensedResult = {
      civs,
      maps,
      totalGames,
      totalWins,
      totalLosses,
      winRate,
      source: 'condensed',
      isComplete: true
    };
  }

  // 2. Calculamos también desde el pool unificado de partidas en memoria (`player.matches`)
  const nowSec = Date.now() / 1000;
  const cutoffSec = period === 'max' ? 0 : nowSec - (Number(period) * 24 * 60 * 60);
  const playerMatches = Array.isArray(player.matches) && player.matches.length > 0
    ? player.matches
    : getPlayerMatchesFromUnifiedPool(profileId, leaderboardId);

  const filteredMatches = playerMatches.filter(
    m => m.status === 'complete' && typeof m.player?.won === 'boolean' && m.started && m.started >= cutoffSec
  );

  const civMap = {};
  const mapsMap = {};

  filteredMatches.forEach(m => {
    const civ = m.player?.civ;
    const map = m.mapName;
    const won = m.player?.won;

    if (civ) {
      if (!civMap[civ]) civMap[civ] = { name: civ, total: 0, wins: 0, losses: 0 };
      civMap[civ].total += 1;
      if (won) civMap[civ].wins += 1;
      else civMap[civ].losses += 1;
    }

    if (map) {
      if (!mapsMap[map]) mapsMap[map] = { name: map, mapImageUrl: m.mapImageUrl || '', total: 0, wins: 0, losses: 0 };
      if (!mapsMap[map].mapImageUrl && m.mapImageUrl) mapsMap[map].mapImageUrl = m.mapImageUrl;
      mapsMap[map].total += 1;
      if (won) mapsMap[map].wins += 1;
      else mapsMap[map].losses += 1;
    }
  });

  const matchCivs = Object.values(civMap)
    .map(c => ({ ...c, winRate: (c.wins / c.total) * 100 }))
    .sort((a, b) => b.total - a.total || b.winRate - a.winRate);

  const matchMaps = Object.values(mapsMap)
    .map(m => ({ ...m, winRate: (m.wins / m.total) * 100 }))
    .sort((a, b) => b.total - a.total || b.winRate - a.winRate);

  const matchTotalGames = filteredMatches.length;
  const matchTotalWins = filteredMatches.filter(m => m.player?.won).length;
  const matchTotalLosses = matchTotalGames - matchTotalWins;
  const matchWinRate = matchTotalGames > 0 ? (matchTotalWins / matchTotalGames) * 100 : 0;

  const matchesResult = {
    civs: matchCivs,
    maps: matchMaps,
    totalGames: matchTotalGames,
    totalWins: matchTotalWins,
    totalLosses: matchTotalLosses,
    winRate: matchWinRate,
    source: 'matches',
    isComplete: Boolean(condensedEntry)
  };

  // Para Histórico ('max') priorizamos siempre el condensado si existe; para ventanas de días usamos el que tenga más partidas registradas
  if (condensedResult) {
    if (period === 'max' || condensedResult.totalGames >= matchesResult.totalGames) {
      return condensedResult;
    }
  }

  return matchesResult;
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
 * y recicla todas las partidas devueltas dentro del pool central.
 */
export async function fetchGroupLiveMatches(playerIds) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) return [];
  try {
    const idsParam = playerIds.join(',');
    const res = await fetchWithRetry(`${CONFIG.API_BASE_URL}/matches?per_page=50&profile_ids=${idsParam}`, 1);
    const data = await res.json();
    const rawMatches = data.matches || [];
    const nowSec = Date.now() / 1000;

    // Reciclamos las partidas recibidas para mantener actualizado el pool sin llamadas extra
    ingestRawMatches(rawMatches, playerIds, true);

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
    console.warn('Aviso al obtener partidas en vivo del grupo:', err.message || err);
    return [];
  }
}

/**
 * Registra el estado de paginación de una página de partidas grupales de un leaderboard
 */
function updateGroupPaginationMeta(leaderboardId, page, rawMatches) {
  if (!Array.isArray(rawMatches) || rawMatches.length === 0) {
    const prev = groupLeaderboardPagination.get(leaderboardId) || { maxPage: page, oldestStartedSec: 0 };
    groupLeaderboardPagination.set(leaderboardId, {
      ...prev,
      maxPage: Math.max(prev.maxPage || 1, page),
      exhausted: true,
      updatedAtMs: Date.now()
    });
    return;
  }

  let oldestSec = Infinity;
  rawMatches.forEach(m => {
    if (m && m.started) {
      const sec = new Date(m.started).getTime() / 1000;
      if (!isNaN(sec) && sec < oldestSec) oldestSec = sec;
    }
  });

  const prev = groupLeaderboardPagination.get(leaderboardId);
  const prevOldest = prev?.oldestStartedSec || Infinity;

  groupLeaderboardPagination.set(leaderboardId, {
    maxPage: Math.max(prev?.maxPage || 0, page),
    oldestStartedSec: Math.min(prevOldest, oldestSec),
    exhausted: rawMatches.length < 100,
    updatedAtMs: Date.now()
  });
}

/**
 * Carga inicial ultrarrápida y liviana en lote (solo 5 peticiones grupales en total):
 * - /leaderboards/rm_1v1
 * - /leaderboards/rm_team
 * - /profiles
 * - /matches?leaderboard_ids=rm_1v1&page=1 (100 partidas grupales de 1v1)
 * - /matches?leaderboard_ids=rm_team&page=1 (100 partidas grupales de Team)
 *
 * Recicla las partidas grupales para poblar TODOS los jugadores de 1v1 y Team sin ráfagas individuales.
 */
export async function fetchGroupBootstrap(playerIds, forceRefresh = false) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) {
    return { liveMatches: [], groupMatches: [], initial1v1: [], initialTeam: [], missingProfileIds: [] };
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
  const cacheTtl = CONFIG.MATCHES_CACHE_TTL_MS || (5 * 60 * 1000);
  const hasFreshCache = !forceRefresh &&
    unifiedRawMatchesMap.size > 0 &&
    (Date.now() - matchesCacheUpdatedAtMs) < cacheTtl;

  if (!hasFreshCache) {
    if (forceRefresh) {
      groupLeaderboardPagination.clear();
    }

    const [lb1v1Res, lbTeamRes, basicProfilesRes, matches1v1Res, matchesTeamRes] = await Promise.all([
      fetchWithRetry(`${CONFIG.API_BASE_URL}/leaderboards/rm_1v1?per_page=100&profile_ids=${idsParam}`, 1)
        .then(r => r.json())
        .catch(e => { console.warn('Error batch lb 1v1:', e); return { players: [] }; }),
      fetchWithRetry(`${CONFIG.API_BASE_URL}/leaderboards/rm_team?per_page=100&profile_ids=${idsParam}`, 1)
        .then(r => r.json())
        .catch(e => { console.warn('Error batch lb team:', e); return { players: [] }; }),
      fetchWithRetry(`${CONFIG.API_BASE_URL}/profiles?per_page=100&profile_ids=${idsParam}`, 1)
        .then(r => r.json())
        .catch(e => { console.warn('Error batch profiles:', e); return { profiles: [] }; }),
      fetchWithRetry(`${CONFIG.API_BASE_URL}/matches?per_page=100&profile_ids=${idsParam}&leaderboard_ids=rm_1v1&page=1`, 1)
        .then(r => r.json())
        .catch(e => { console.warn('Error batch matches 1v1:', e); return { matches: [] }; }),
      fetchWithRetry(`${CONFIG.API_BASE_URL}/matches?per_page=100&profile_ids=${idsParam}&leaderboard_ids=rm_team&page=1`, 1)
        .then(r => r.json())
        .catch(e => { console.warn('Error batch matches team:', e); return { matches: [] }; })
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

    (lb1v1Res.players || []).forEach(p => {
      if (p && p.profileId) upsertLeaderboardEntry(p.profileId, CONFIG.LEADERBOARDS.RM_1V1, p);
    });

    (lbTeamRes.players || []).forEach(p => {
      if (p && p.profileId) upsertLeaderboardEntry(p.profileId, CONFIG.LEADERBOARDS.RM_TEAM, p);
    });

    // 2. Ingerimos las partidas grupales de 1v1 y Team en el pool unificado
    const raw1v1 = matches1v1Res.matches || [];
    const rawTeam = matchesTeamRes.matches || [];
    if (raw1v1.length > 0) updateGroupPaginationMeta(CONFIG.LEADERBOARDS.RM_1V1, 1, raw1v1);
    if (rawTeam.length > 0) updateGroupPaginationMeta(CONFIG.LEADERBOARDS.RM_TEAM, 1, rawTeam);

    matchesCacheUpdatedAtMs = Date.now();
    ingestRawMatches([...raw1v1, ...rawTeam], playerIds, true);
    saveProfilesCacheToStorage();
  }

  // 3. Detectamos partidas en curso desde el pool unificado
  const allRawMatches = getAllUnifiedRawMatches();
  const liveMatches = allRawMatches
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

  // 4. Armamos las listas de jugadores para 1v1 y Team reciclando el pool unificado
  const initial1v1 = playerIds.map(id => {
    const prof = profileCache.get(id);
    const playerMatches = getPlayerMatchesFromUnifiedPool(id, CONFIG.LEADERBOARDS.RM_1V1);
    return buildPlayerStatsFromProfileAndMatches(
      prof,
      CONFIG.LEADERBOARDS.RM_1V1,
      playerMatches,
      null
    );
  }).filter(Boolean);

  const initialTeam = playerIds.map(id => {
    const prof = profileCache.get(id);
    const playerMatches = getPlayerMatchesFromUnifiedPool(id, CONFIG.LEADERBOARDS.RM_TEAM);
    return buildPlayerStatsFromProfileAndMatches(
      prof,
      CONFIG.LEADERBOARDS.RM_TEAM,
      playerMatches,
      null
    );
  }).filter(Boolean);

  // 5. Solo pedimos perfil individual si un jugador no tiene NINGÚN dato de leaderboard ni en cache ni por partidas
  const missingProfileIds = playerIds.filter(id => {
    const cached = profileCache.get(id);
    if (!cached) return true;
    if (cached.hasFullLeaderboards) return false;
    const has1v1 = Array.isArray(cached.leaderboards) && cached.leaderboards.some(l => l.leaderboardId === CONFIG.LEADERBOARDS.RM_1V1);
    const hasTeam = Array.isArray(cached.leaderboards) && cached.leaderboards.some(l => l.leaderboardId === CONFIG.LEADERBOARDS.RM_TEAM);
    return !(has1v1 && hasTeam);
  });

  return {
    liveMatches,
    groupMatches: allRawMatches,
    initial1v1,
    initialTeam,
    missingProfileIds
  };
}

/**
 * Trae hasta `targetPages` páginas grupales (ej. páginas 2, 3 y 4 = 300-400 partidas por modo)
 * para cubrir la mayor cantidad posible de rombos de los jugadores en lote antes del relleno individual.
 */
export async function fetchAdditionalGroupMatchPages(playerIds, leaderboardId = 'rm_1v1', targetPages = 4, onPageLoaded = null) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) return;

  const metaCurrent = groupLeaderboardPagination.get(leaderboardId) || { maxPage: 0, oldestStartedSec: Infinity, exhausted: false };
  if (metaCurrent.exhausted || (metaCurrent.maxPage || 0) >= targetPages) {
    return;
  }

  if (groupPaginationInFlight.has(leaderboardId)) {
    return groupPaginationInFlight.get(leaderboardId);
  }

  const idsParam = playerIds.join(',');

  const jobPromise = (async () => {
    try {
      let meta = groupLeaderboardPagination.get(leaderboardId) || { maxPage: 0, oldestStartedSec: Infinity, exhausted: false };
      let nextPage = Math.max(2, (meta.maxPage || 1) + 1);

      while (nextPage <= targetPages && !meta.exhausted) {
        const res = await fetchWithRetry(
          `${CONFIG.API_BASE_URL}/matches?per_page=100&profile_ids=${idsParam}&leaderboard_ids=${leaderboardId}&page=${nextPage}`,
          1,
          1500,
          true
        );
        const data = await res.json();
        const rawMatches = data.matches || [];

        ingestRawMatches(rawMatches, playerIds, true);
        updateGroupPaginationMeta(leaderboardId, nextPage, rawMatches);
        meta = groupLeaderboardPagination.get(leaderboardId);

        if (onPageLoaded) {
          onPageLoaded(nextPage, targetPages);
        }

        if (rawMatches.length < 100) {
          break;
        }

        nextPage += 1;
        await new Promise(r => setTimeout(r, 260));
      }
    } catch (err) {
      console.warn(`Aviso cargando páginas grupales extra (${leaderboardId}):`, err.message || err);
    } finally {
      groupPaginationInFlight.delete(leaderboardId);
    }
  })();

  groupPaginationInFlight.set(leaderboardId, jobPromise);
  return jobPromise;
}

/**
 * Relleno quirúrgico (Alternativa 3): para cualquier jugador activo que tras las 4 páginas grupales
 * siga teniendo menos de 10 partidas en su fila, solicita sus últimas 20 partidas de ese modo
 * y las inyecta directamente en el pool unificado persistente (`localStorage`).
 */
export async function topUpPlayerLastMatches(profileId, leaderboardId = 'rm_1v1', forceRefresh = false) {
  if (!profileId) return [];
  const cacheKey = `${profileId}_${leaderboardId}`;

  if (playerTopUpInFlight.has(cacheKey)) {
    return playerTopUpInFlight.get(cacheKey);
  }

  const existingMatches = getPlayerMatchesFromUnifiedPool(profileId, leaderboardId);
  if (!forceRefresh && existingMatches.length >= 10) {
    playerTopUpTimestampMap.set(cacheKey, Date.now());
    return existingMatches;
  }

  const reqPromise = (async () => {
    try {
      const res = await fetchWithRetry(
        `${CONFIG.API_BASE_URL}/matches?per_page=20&profile_ids=${profileId}&leaderboard_ids=${leaderboardId}&page=1`,
        1,
        1500,
        true
      );
      const data = await res.json();
      const rawMatches = data.matches || [];

      playerTopUpTimestampMap.set(cacheKey, Date.now());
      ingestRawMatches(rawMatches, [profileId], true);
      if (rawMatches.length === 0) {
        saveMatchesCacheToStorage();
      }

      return getPlayerMatchesFromUnifiedPool(profileId, leaderboardId);
    } catch (err) {
      console.warn(`Aviso completando últimas 10 partidas de ${profileId} (${leaderboardId}):`, err.message || err);
      return getPlayerMatchesFromUnifiedPool(profileId, leaderboardId);
    } finally {
      playerTopUpInFlight.delete(cacheKey);
    }
  })();

  playerTopUpInFlight.set(cacheKey, reqPromise);
  return reqPromise;
}

/**
 * Asegura que el pool unificado de partidas grupales cubra la ventana de `days` (7, 30 o 90 días)
 * para un `leaderboardId` dado, paginando en lote (`profile_ids=TODOS`) solo las páginas faltantes.
 * Esto evita hacer 27 peticiones individuales por modo.
 */
export async function ensureGroupMatchesCoverWindow(playerIds, leaderboardId = 'rm_1v1', days = 7, onPageLoaded = null) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) return;

  const targetCutoffSec = (Date.now() / 1000) - (days * 24 * 60 * 60);
  const currentMeta = groupLeaderboardPagination.get(leaderboardId) || { maxPage: 0, oldestStartedSec: Infinity, exhausted: false };

  // Si ya cubrimos la fecha objetivo o no hay más páginas, no hacemos ninguna petición extra
  if (currentMeta.exhausted || (currentMeta.maxPage >= 1 && currentMeta.oldestStartedSec <= targetCutoffSec)) {
    return;
  }

  if (groupPaginationInFlight.has(leaderboardId)) {
    return groupPaginationInFlight.get(leaderboardId);
  }

  // Límite prudente de páginas grupales según la ventana (cada página trae 100 partidas del grupo)
  const maxPagesAllowed = days <= 7 ? 3 : (days <= 30 ? 6 : 10);
  const idsParam = playerIds.join(',');

  const jobPromise = (async () => {
    try {
      let meta = groupLeaderboardPagination.get(leaderboardId) || { maxPage: 0, oldestStartedSec: Infinity, exhausted: false };
      let nextPage = (meta.maxPage || 0) + 1;

      while (nextPage <= maxPagesAllowed && !meta.exhausted && meta.oldestStartedSec > targetCutoffSec) {
        const res = await fetchWithRetry(
          `${CONFIG.API_BASE_URL}/matches?per_page=100&profile_ids=${idsParam}&leaderboard_ids=${leaderboardId}&page=${nextPage}`,
          1,
          1500,
          true
        );
        const data = await res.json();
        const rawMatches = data.matches || [];

        ingestRawMatches(rawMatches, playerIds, true);
        updateGroupPaginationMeta(leaderboardId, nextPage, rawMatches);
        meta = groupLeaderboardPagination.get(leaderboardId);

        if (onPageLoaded) {
          onPageLoaded();
        }

        if (rawMatches.length < 100 || meta.oldestStartedSec <= targetCutoffSec) {
          break;
        }

        nextPage += 1;
        await new Promise(r => setTimeout(r, 380));
      }
    } catch (err) {
      console.warn(`Aviso paginando partidas grupales (${leaderboardId}, ${days}d):`, err.message || err);
    } finally {
      groupPaginationInFlight.delete(leaderboardId);
    }
  })();

  groupPaginationInFlight.set(leaderboardId, jobPromise);
  return jobPromise;
}

/**
 * Obtiene el listado de partidas recientes del grupo completo (reciclando el pool unificado)
 */
export async function fetchGroupRecentMatches(playerIds, count = 100, forceNetwork = false) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) return [];
  if (!forceNetwork && unifiedRawMatchesMap.size > 0) {
    return getAllUnifiedRawMatches();
  }
  try {
    const idsParam = playerIds.join(',');
    const res = await fetchWithRetry(`${CONFIG.API_BASE_URL}/matches?per_page=${count}&profile_ids=${idsParam}`, 1, 1500, true);
    const data = await res.json();
    const rawMatches = data.matches || [];
    ingestRawMatches(rawMatches, playerIds, true);
    return getAllUnifiedRawMatches();
  } catch (err) {
    console.warn('Aviso al obtener partidas recientes del grupo:', err.message || err);
    return getAllUnifiedRawMatches();
  }
}

/**
 * Obtiene el historial de partidas de un jugador puntual (con deduplicación y reciclaje en el pool central)
 */
export async function fetchMatches(profileId, leaderboardId = 'rm_1v1', count = 100, forceRefresh = false) {
  const cacheKey = `${profileId}_${leaderboardId}`;
  if (!forceRefresh && matchesCache.has(cacheKey)) {
    return matchesCache.get(cacheKey);
  }
  if (matchesInFlight.has(cacheKey)) {
    return matchesInFlight.get(cacheKey);
  }

  const reqPromise = (async () => {
    try {
      const res = await fetchWithRetry(
        `${CONFIG.API_BASE_URL}/matches?per_page=${count}&profile_ids=${profileId}&leaderboard_ids=${leaderboardId}`,
        1,
        1500,
        true
      );
      const data = await res.json();
      const rawMatches = data.matches || [];

      // Alimentamos también el pool central unificado
      ingestRawMatches(rawMatches, [profileId], true);

      const simplified = rawMatches.map(m => mapMatch(m, profileId));
      matchesCache.set(cacheKey, simplified);
      return getPlayerMatchesFromUnifiedPool(profileId, leaderboardId);
    } catch (err) {
      console.warn(`Aviso al obtener partidas de ${profileId} (${leaderboardId}):`, err.message || err);
      // Nunca pisamos con [] vacío si ya teníamos partidas en el pool unificado
      return getPlayerMatchesFromUnifiedPool(profileId, leaderboardId);
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
        civ: p.civName || p.civ,
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
export function buildPlayerStatsFromProfileAndMatches(profile, leaderboardId = 'rm_1v1', matches = null, matchesLoaded = null) {
  if (!profile) return null;

  const profileId = profile.profileId;
  const resolvedMatches = Array.isArray(matches)
    ? matches
    : getPlayerMatchesFromUnifiedPool(profileId, leaderboardId);

  const lbData = profile.leaderboards?.find(l => l.leaderboardId === leaderboardId);
  const ratingHistoryObj = profile.ratings?.find(r => r.leaderboardId === leaderboardId);
  const ratingHistory = ratingHistoryObj?.ratings || [];

  const completedMatches = resolvedMatches.filter(m => m.status === 'complete' && m.player && typeof m.player.won === 'boolean');
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
  const matchStartedMs = resolvedMatches[0]?.started ? resolvedMatches[0].started * 1000 : 0;
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
  const isPlayingNow = resolvedMatches.length > 0 && resolvedMatches[0].status === 'ongoing';
  const ongoingMatch = isPlayingNow ? resolvedMatches[0] : null;

  // ¿Jugó en el último mes (últimos 30 días) en este modo?
  const isActiveLastMonth = Boolean(
    isPlayingNow ||
    (lastMatchTimestamp > 0 && (Date.now() - lastMatchTimestamp) <= ONE_MONTH_MS)
  );

  // ¿Jugó en los últimos 3 meses (últimos 90 días) en este modo?
  const isActiveLast3Months = Boolean(
    isPlayingNow ||
    (lastMatchTimestamp > 0 && (Date.now() - lastMatchTimestamp) <= THREE_MONTHS_MS)
  );

  const totalLbGames = typeof lbData?.games === 'number' ? lbData.games : Infinity;
  const topUpTs = playerTopUpTimestampMap.get(`${profileId}_${leaderboardId}`) || 0;
  const hasTopUpCoverage = topUpTs > 0 && topUpTs >= (lastMatchTimestamp || 1);
  const isMatchesLoaded = matchesLoaded === true ||
    resolvedMatches.length >= 10 ||
    resolvedMatches.length >= totalLbGames ||
    hasTopUpCoverage ||
    !isActiveLastMonth;

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
    isActiveLast3Months,
    totalEloChange,
    isPlayingNow,
    ongoingMatch,
    matches: resolvedMatches,
    matchesLoaded: Boolean(isMatchesLoaded),
    profile
  };
}

/**
 * Procesa todos los datos de un jugador puntual (por ej. al abrir su modal o buscar un rival externo).
 */
export async function getPlayerStats(profileId, leaderboardId = 'rm_1v1', forceRefresh = false, forceFetchMatches = false) {
  const profile = await fetchProfile(profileId, forceRefresh);
  if (!profile) return null;

  let matches = getPlayerMatchesFromUnifiedPool(profileId, leaderboardId);
  if (forceRefresh || (forceFetchMatches && matches.length < 15)) {
    matches = await fetchMatches(profileId, leaderboardId, 100, forceRefresh);
  }

  return buildPlayerStatsFromProfileAndMatches(profile, leaderboardId, matches, true);
}
