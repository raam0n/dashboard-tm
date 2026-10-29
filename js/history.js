import { getCivIconUrl, getFlagUrl, formatDateDDMMYYYY, MAX_LIVE_DURATION_SEC } from './api.js?v=20261029e';
import { CONFIG } from './config.js?v=20261029e';

/**
 * Formatea un timestamp relativo ("Hace 15 min", "Hace 2 h", "Ayer 18:30", etc.)
 */
export function formatTimeAgo(timestampMs) {
  if (!timestampMs || isNaN(timestampMs)) return '-';
  const now = Date.now();
  const diffSec = Math.floor((now - timestampMs) / 1000);
  if (diffSec < 60) return 'Hace instantes';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `Hace ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) {
    const d = new Date(timestampMs);
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `Ayer ${timeStr}`;
  }
  if (diffDays < 7) {
    const d = new Date(timestampMs);
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `Hace ${diffDays}d (${timeStr})`;
  }
  return formatDateDDMMYYYY(new Date(timestampMs).toISOString());
}

/**
 * Formatea la duración en formato mm:ss o hh:mm:ss
 */
function formatDuration(sec) {
  if (!sec || sec <= 0) return '0m 00s';
  const s = Math.floor(sec);
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const secsPad = secs < 10 ? `0${secs}` : secs;
  if (hours > 0) {
    const minsPad = mins < 10 ? `0${mins}` : mins;
    return `${hours}h ${minsPad}m ${secsPad}s`;
  }
  return `${mins}m ${secsPad}s`;
}

/**
 * Mapea una partida cruda de la API para la vista de historial conjunto del grupo
 */
export function mapGroupMatch(m, trackedIdsSet = new Set()) {
  const started = m.started ? new Date(m.started).getTime() / 1000 : null;
  const finished = m.finished ? new Date(m.finished).getTime() / 1000 : null;
  const nowSec = Date.now() / 1000;
  const isTimedOut = !finished && started && (nowSec - started) >= MAX_LIVE_DURATION_SEC;
  const isAbandoned = Boolean(m.abandoned) || Boolean(isTimedOut);
  const isOngoing = !finished && !isAbandoned && Boolean(started);
  const status = isOngoing ? 'ongoing' : (isAbandoned ? 'abandoned' : 'complete');

  const teams = (m.teams || []).map((t, teamIdx) => {
    const teamWon = (t.players || []).some(p => p.won === true);
    const teamLost = (t.players || []).some(p => p.won === false);
    const players = (t.players || []).map(p => ({
      profileId: p.profileId,
      name: p.name || `Jugador #${p.profileId}`,
      country: p.country || '',
      civ: p.civName,
      rating: p.rating,
      ratingDiff: p.ratingDiff ?? null,
      won: p.won,
      colorHex: p.colorHex,
      isTracked: trackedIdsSet.has(p.profileId)
    }));

    return {
      teamId: t.teamId ?? teamIdx + 1,
      won: teamWon ? true : (teamLost ? false : null),
      players
    };
  });

  const allPlayers = teams.flatMap(t => t.players);
  const trackedPlayers = allPlayers.filter(p => p.isTracked);

  let modeLabel = 'RM';
  if (m.leaderboardId === 'rm_1v1') modeLabel = 'RM 1vs1';
  else if (m.leaderboardId === 'rm_team') modeLabel = 'RM Team';
  else if (m.leaderboardId === 'ew_1v1') modeLabel = 'EW 1vs1';
  else if (m.leaderboardId === 'ew_team') modeLabel = 'EW Team';
  else if (m.leaderboardId?.startsWith('unranked')) modeLabel = 'Unranked';
  else if (m.leaderboardName) modeLabel = m.leaderboardName;
  else if (m.gameModeName) modeLabel = m.gameModeName;

  const team1Count = teams[0]?.players.length || 1;
  const team2Count = teams[1]?.players.length || 1;
  const ratio = teams.length > 2 ? 'FFA' : `${team1Count}v${team2Count}`;

  return {
    matchId: m.matchId,
    started,
    startedMs: started ? started * 1000 : 0,
    finished,
    finishedMs: finished ? finished * 1000 : 0,
    duration: finished && started ? (finished - started) : (started ? Math.floor(nowSec - started) : 0),
    status,
    abandoned: isAbandoned,
    mapName: m.mapName || 'Unknown Map',
    mapImageUrl: m.mapImageUrl || (m.map ? `https://backend.cdn.aoe2companion.com/public/aoe2/de/maps/${m.map}.png` : ''),
    leaderboardId: m.leaderboardId,
    modeLabel,
    server: m.server || '',
    ratio,
    teams,
    allPlayers,
    trackedPlayers,
    hasTrackedPlayers: trackedPlayers.length > 0
  };
}

/**
 * Renderiza la vista completa de Últimas Partidas con filtros y exclusión de jugadores
 */
export function renderRecentMatchesView(rawMatches, container, trackedIdsList = [], onPlayerClick = null, filters = {}, onFilterChange = null) {
  const trackedIdsSet = new Set(trackedIdsList);
  const nowMs = Date.now();

  // Valores de filtros por defecto
  const timeWindowHours = filters.timeWindowHours ?? 48; // 48 horas por defecto
  const modeFilter = filters.mode ?? 'all';
  const excludedPlayerIds = Array.isArray(filters.excludedPlayerIds) ? filters.excludedPlayerIds : [];

  // Mapeamos todas las partidas grupales
  const mappedMatches = (rawMatches || []).map(m => mapGroupMatch(m, trackedIdsSet));

  // Mapa de nombres para todos los jugadores conocidos
  const playerNameMap = new Map();
  CONFIG.DEFAULT_PLAYERS.forEach(dp => playerNameMap.set(dp.id, dp.name));
  mappedMatches.forEach(m => {
    m.allPlayers.forEach(p => {
      if (p.profileId && p.name) playerNameMap.set(p.profileId, p.name);
    });
  });

  // Filtrado de partidas
  const filteredMatches = mappedMatches.filter(m => {
    // 1. Filtro de tiempo
    if (timeWindowHours > 0 && m.startedMs > 0) {
      const ageHours = (nowMs - m.startedMs) / (3600 * 1000);
      if (ageHours > timeWindowHours) return false;
    }

    // 2. Filtro de modo
    if (modeFilter === 'rm_1v1' && m.leaderboardId !== 'rm_1v1') return false;
    if (modeFilter === 'rm_team' && m.leaderboardId !== 'rm_team') return false;
    if (modeFilter === 'other' && (m.leaderboardId === 'rm_1v1' || m.leaderboardId === 'rm_team')) return false;

    // 3. Filtro de exclusión de jugadores (excluye partidas donde jugó alguno de los excluidos)
    if (excludedPlayerIds.length > 0) {
      const hasExcluded = m.allPlayers.some(p => excludedPlayerIds.includes(p.profileId));
      if (hasExcluded) return false;
    }

    return true;
  });

  // Lista de opciones para el selector de exclusión (jugadores activos del grupo)
  const availableExcludeOptions = trackedIdsList
    .map(id => ({ id, name: playerNameMap.get(id) || `Jugador #${id}` }))
    .filter(opt => !excludedPlayerIds.includes(opt.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Generamos el HTML de badges de jugadores excluidos
  const excludedChipsHtml = excludedPlayerIds.map(id => {
    const name = playerNameMap.get(id) || `Jugador #${id}`;
    return `
      <span class="hm-exclude-pill">
        <span>🚫 ${name}</span>
        <button type="button" class="hm-exclude-remove-btn" data-remove-pid="${id}" title="Quitar exclusión de ${name}">&times;</button>
      </span>
    `;
  }).join('');

  // Contador y resumen
  const totalCountInWindow = mappedMatches.filter(m => {
    if (timeWindowHours > 0 && m.startedMs > 0) {
      return (nowMs - m.startedMs) / (3600 * 1000) <= timeWindowHours;
    }
    return true;
  }).length;

  const windowLabel = timeWindowHours === 24 ? 'últimas 24 hs' :
    timeWindowHours === 48 ? 'últimas 48 hs' :
    timeWindowHours === 168 ? 'últimos 7 días' : 'todo el historial cargado';

  // Renderizamos cada partida individual
  const matchesCardsHtml = filteredMatches.map(m => {
    const timeAgoStr = formatTimeAgo(m.startedMs);
    const exactDateStr = m.startedMs ? new Date(m.startedMs).toLocaleString() : '';
    const durationStr = formatDuration(m.duration);
    const matchUrl = m.matchId ? `https://www.aoe2companion.com/matches/${m.matchId}` : '#';

    // Badge de estado
    let statusBadgeHtml = '';
    if (m.status === 'ongoing') {
      statusBadgeHtml = '<span class="hm-status-badge is-live">En curso</span>';
    } else if (m.status === 'abandoned') {
      statusBadgeHtml = '<span class="hm-status-badge is-abandoned">Abandonada</span>';
    }

    // Render de cada jugador dentro del equipo
    function renderPlayerChip(p, alignSide = 'left') {
      const civIcon = p.civ
        ? `<img src="${getCivIconUrl(p.civ)}" class="hm-player-civ" alt="${p.civ}" title="${p.civ}" onerror="this.onerror=null;this.src='assets/icons/logo-128.png';">`
        : '';
      const flagIcon = p.country
        ? `<img src="${getFlagUrl(p.country)}" class="hm-player-flag" alt="${p.country}">`
        : '';

      const isWon = p.won === true;
      const isLost = p.won === false;
      const resultIcon = isWon ? '🏆' : (isLost ? '💀' : '');

      let eloDiffHtml = '';
      if (typeof p.ratingDiff === 'number' && m.status === 'complete') {
        const sign = p.ratingDiff > 0 ? '+' : '';
        const diffClass = p.ratingDiff > 0 ? 'green' : (p.ratingDiff < 0 ? 'red' : '');
        eloDiffHtml = `<span class="hm-player-diff ${diffClass}">${sign}${p.ratingDiff}</span>`;
      }

      const ratingStr = p.rating != null ? `(${p.rating})` : '';
      const isClickable = Boolean(p.profileId);
      const trackedClass = p.isTracked ? 'is-tracked' : '';

      return `
        <div 
          class="hm-player-row ${trackedClass} ${isClickable ? 'is-clickable' : ''} ${alignSide === 'right' ? 'align-right' : ''}" 
          data-profile-id="${p.profileId || ''}"
          title="${p.isTracked ? '★ Jugador del Grupo TM - Click para ver perfil' : 'Click para ver perfil de ' + p.name}"
        >
          <div class="hm-player-main-info">
            ${civIcon}
            ${flagIcon}
            <span class="hm-player-name">${p.isTracked ? '★ ' : ''}${p.name}</span>
            <span class="hm-player-rating">${ratingStr}</span>
            ${eloDiffHtml}
            ${resultIcon ? `<span class="hm-player-result-icon">${resultIcon}</span>` : ''}
          </div>
        </div>
      `;
    }

    const team1 = m.teams[0] || { players: [] };
    const team2 = m.teams[1] || { players: [] };

    const team1WonClass = team1.won === true ? 'team-won' : (team1.won === false ? 'team-lost' : '');
    const team2WonClass = team2.won === true ? 'team-won' : (team2.won === false ? 'team-lost' : '');

    const team1PlayersHtml = team1.players.map(p => renderPlayerChip(p, 'left')).join('');
    const team2PlayersHtml = team2.players.map(p => renderPlayerChip(p, 'right')).join('');

    return `
      <div class="history-match-card ${m.status === 'ongoing' ? 'is-live-card' : ''}">
        <!-- Columna Izquierda: Información de la partida -->
        <div class="hm-meta-col">
          <div class="hm-map-frame">
            ${m.mapImageUrl ? `<img src="${m.mapImageUrl}" class="hm-map-img" alt="${m.mapName}" onerror="this.style.display='none';">` : ''}
          </div>
          <div class="hm-meta-text">
            <div class="hm-time-row">
              <span class="hm-time" title="${exactDateStr}">${timeAgoStr}</span>
              ${statusBadgeHtml}
            </div>
            <strong class="hm-map-title">${m.mapName}</strong>
            <div class="hm-tags-row">
              <span class="hm-tag hm-ratio-tag">${m.ratio}</span>
              <span class="hm-tag hm-mode-tag">${m.modeLabel}</span>
              <span class="hm-tag hm-duration-tag">⏱️ ${durationStr}</span>
              ${m.server ? `<span class="hm-tag hm-server-tag">${m.server}</span>` : ''}
            </div>
          </div>
        </div>

        <!-- Columna Central: Alineación de Equipos -->
        <div class="hm-teams-col">
          <div class="hm-team-box side-left ${team1WonClass}">
            <div class="hm-team-header">
              <span class="hm-team-label">Equipo 1</span>
              ${team1.won === true ? '<span class="hm-team-outcome win">Victoria</span>' : (team1.won === false ? '<span class="hm-team-outcome loss">Derrota</span>' : '')}
            </div>
            <div class="hm-players-list">
              ${team1PlayersHtml || '<span style="color:#777;">Sin jugadores</span>'}
            </div>
          </div>

          <div class="hm-vs-separator">
            <span>VS</span>
          </div>

          <div class="hm-team-box side-right ${team2WonClass}">
            <div class="hm-team-header">
              <span class="hm-team-label">Equipo 2</span>
              ${team2.won === true ? '<span class="hm-team-outcome win">Victoria</span>' : (team2.won === false ? '<span class="hm-team-outcome loss">Derrota</span>' : '')}
            </div>
            <div class="hm-players-list">
              ${team2PlayersHtml || '<span style="color:#777;">Sin jugadores</span>'}
            </div>
          </div>
        </div>

        <!-- Columna Derecha: Acciones -->
        <div class="hm-actions-col">
          <a href="${matchUrl}" target="_blank" rel="noopener noreferrer" class="hm-stats-link-btn" title="Ver análisis y estadísticas de la partida #${m.matchId || ''} en AoE2Companion">
            Stats ↗
          </a>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="view-container">
      <!-- Encabezado de la vista -->
      <div class="view-header-row">
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h2>📜 Últimas Partidas del Grupo</h2>
            <span class="weekly-period-badge">⏱️ Historial conjunto</span>
          </div>
          <p class="subtitle">Cronología estricta de partidas jugadas por los miembros del grupo en las ${windowLabel}.</p>
        </div>

        <!-- Selector de Ventana de Tiempo -->
        <div class="mode-toggle-group">
          <button class="mode-toggle-btn time-filter-btn ${timeWindowHours === 24 ? 'active' : ''}" data-hours="24">
            24 hs
          </button>
          <button class="mode-toggle-btn time-filter-btn ${timeWindowHours === 48 ? 'active' : ''}" data-hours="48">
            48 hs
          </button>
          <button class="mode-toggle-btn time-filter-btn ${timeWindowHours === 168 ? 'active' : ''}" data-hours="168">
            7 días
          </button>
          <button class="mode-toggle-btn time-filter-btn ${timeWindowHours === 0 ? 'active' : ''}" data-hours="0">
            Todas
          </button>
        </div>
      </div>

      <!-- Barra de Filtros: Modos y Exclusión de Jugadores -->
      <div class="hm-filters-bar">
        <!-- Filtro por Modo -->
        <div class="hm-filter-group">
          <span class="hm-filter-label">Modo:</span>
          <div class="mode-toggle-group">
            <button class="mode-toggle-btn mode-filter-btn ${modeFilter === 'all' ? 'active' : ''}" data-mode="all">Todos</button>
            <button class="mode-toggle-btn mode-filter-btn ${modeFilter === 'rm_1v1' ? 'active' : ''}" data-mode="rm_1v1">⚔️ RM 1v1</button>
            <button class="mode-toggle-btn mode-filter-btn ${modeFilter === 'rm_team' ? 'active' : ''}" data-mode="rm_team">🛡️ RM Team</button>
            <button class="mode-toggle-btn mode-filter-btn ${modeFilter === 'other' ? 'active' : ''}" data-mode="other">🎲 Otros</button>
          </div>
        </div>

        <!-- Selector para Excluir Jugadores -->
        <div class="hm-filter-group" style="flex:1; min-width:240px;">
          <span class="hm-filter-label">Excluir jugador:</span>
          <select id="excludePlayerSelect" class="hm-exclude-select">
            <option value="">🚫 Seleccionar para excluir...</option>
            ${availableExcludeOptions.map(opt => `<option value="${opt.id}">${opt.name}</option>`).join('')}
          </select>
          ${excludedPlayerIds.length > 0 ? '<button type="button" id="clearExclusionsBtn" class="btn" style="font-size:0.8rem; padding:4px 8px;">Restablecer</button>' : ''}
        </div>
      </div>

      <!-- Lista de Jugadores Excluidos Activos -->
      ${excludedPlayerIds.length > 0 ? `
        <div class="hm-excluded-list-row">
          <span style="font-size:0.85rem; color:#f87171; font-weight:700;">🚫 Excluyendo partidas con:</span>
          <div class="hm-excluded-chips-wrap">
            ${excludedChipsHtml}
          </div>
        </div>
      ` : ''}

      <!-- Resumen de resultados -->
      <div class="hm-summary-bar">
        <span>Mostrando <strong>${filteredMatches.length}</strong> partidas (${windowLabel})${excludedPlayerIds.length > 0 ? ` • <strong>${excludedPlayerIds.length}</strong> jugador(es) excluido(s)` : ''}</span>
      </div>

      <!-- Listado de tarjetas de partidas -->
      <div class="hm-matches-list">
        ${matchesCardsHtml || `
          <div class="loading-box" style="padding:40px 20px;">
            <p>No se encontraron partidas para los filtros seleccionados.</p>
          </div>
        `}
      </div>
    </div>
  `;

  // Listener para cambiar ventana de tiempo (24h, 48h, 7d, todas)
  container.querySelectorAll('.time-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const hours = parseInt(btn.dataset.hours, 10);
      if (!isNaN(hours) && onFilterChange) {
        onFilterChange({ ...filters, timeWindowHours: hours });
      }
    });
  });

  // Listener para cambiar filtro de modo
  container.querySelectorAll('.mode-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.mode;
      if (m && onFilterChange) {
        onFilterChange({ ...filters, mode: m });
      }
    });
  });

  // Listener para el selector de exclusión
  const excludeSelect = container.querySelector('#excludePlayerSelect');
  if (excludeSelect) {
    excludeSelect.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (val && !excludedPlayerIds.includes(val) && onFilterChange) {
        onFilterChange({ ...filters, excludedPlayerIds: [...excludedPlayerIds, val] });
      }
    });
  }

  // Listener para remover una exclusión individual
  container.querySelectorAll('.hm-exclude-remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = parseInt(btn.dataset.removePid, 10);
      if (pid && onFilterChange) {
        onFilterChange({ ...filters, excludedPlayerIds: excludedPlayerIds.filter(id => id !== pid) });
      }
    });
  });

  // Listener para restablecer todas las exclusiones
  const clearExclBtn = container.querySelector('#clearExclusionsBtn');
  if (clearExclBtn) {
    clearExclBtn.addEventListener('click', () => {
      if (onFilterChange) {
        onFilterChange({ ...filters, excludedPlayerIds: [] });
      }
    });
  }

  // Listener para hacer click en cualquier jugador (para abrir su modal)
  container.querySelectorAll('.hm-player-row[data-profile-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = parseInt(row.dataset.profileId, 10);
      if (pid && onPlayerClick) {
        onPlayerClick(pid);
      }
    });
  });
}
