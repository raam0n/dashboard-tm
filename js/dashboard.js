import { getCivIconUrl, getFlagUrl, getPlayerStats } from './api.js?v=20261028d';

let liveTimerInterval = null;
// Guarda qué tarjetas tienen desplegados los escudos de civilizaciones
const expandedCardsCivs = new Set();

/**
 * Renderiza el banner superior de "Live now" (soporta múltiples partidas simultáneas y partidas en equipo 2v2/3v3/4v4)
 */
export function renderLiveBanner(playersData, container, extraLiveMatches = [], trackedIdsList = []) {
  if (liveTimerInterval) clearInterval(liveTimerInterval);

  const validPlayers = playersData.filter(Boolean);
  const trackedProfileIds = new Set([
    ...trackedIdsList,
    ...validPlayers.map(p => p.profileId)
  ]);
  const playerEloMap = new Map();
  validPlayers.forEach(p => {
    if (p.profileId && p.currentElo) {
      playerEloMap.set(`${p.profileId}_${p.leaderboardId}`, p.currentElo);
      if (!playerEloMap.has(p.profileId)) {
        playerEloMap.set(p.profileId, p.currentElo);
      }
    }
  });

  // Unificamos las partidas en curso directas del grupo + las detectadas por jugador y deduplicamos por matchId
  const uniqueMatchesMap = new Map();
  (extraLiveMatches || []).forEach(m => {
    if (!m) return;
    const key = m.matchId || `${m.leaderboardId}_${m.started}_${m.mapName}`;
    if (!uniqueMatchesMap.has(key)) {
      uniqueMatchesMap.set(key, m);
    }
  });

  const playingPlayers = validPlayers.filter(p => p.isPlayingNow && p.ongoingMatch);
  playingPlayers.forEach(p => {
    const m = p.ongoingMatch;
    const key = m.matchId || `${m.leaderboardId}_${m.started}_${m.mapName}_${p.profileId}`;
    if (!uniqueMatchesMap.has(key)) {
      uniqueMatchesMap.set(key, m);
    }
  });

  const activeMatches = Array.from(uniqueMatchesMap.values());

  if (activeMatches.length === 0) {
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    container.innerHTML = `
      <div class="live-banner">
        <span class="live-clock">${nowStr}</span>
        <div class="live-empty">
          <span>⚔️</span> No hay partidas en curso en este momento (monitoreando en vivo)
        </div>
      </div>
    `;
    return;
  }

  function formatDuration(startedSec) {
    const elapsedSec = startedSec ? Math.max(0, Math.floor(Date.now() / 1000 - startedSec)) : 0;
    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  }

  function renderTeamPlayerChip(p, matchLeaderboardId, side) {
    const isTracked = trackedProfileIds.has(p.profileId);
    const elo = p.rating ?? playerEloMap.get(`${p.profileId}_${matchLeaderboardId}`) ?? playerEloMap.get(p.profileId) ?? '?';
    const civImg = p.civ
      ? `<img src="${getCivIconUrl(p.civ)}" class="live-civ-shield" title="${p.civ}" onerror="this.onerror=null;this.src='assets/icons/logo-128.png';">`
      : '';
    const flagImg = p.country
      ? `<img src="${getFlagUrl(p.country)}" class="live-flag" alt="${p.country}">`
      : '';

    if (side === 'left') {
      return `
        <div class="live-player-chip ${isTracked ? 'is-tracked' : ''}">
          <span class="live-player-name">${p.name || 'Jugador'}</span>
          <span class="live-player-elo">(${elo})</span>
          ${flagImg}
          ${civImg}
        </div>
      `;
    }
    return `
      <div class="live-player-chip ${isTracked ? 'is-tracked' : ''}">
        ${civImg}
        ${flagImg}
        <span class="live-player-elo">(${elo})</span>
        <span class="live-player-name">${p.name || 'Rival'}</span>
      </div>
    `;
  }

  const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const bannersHtml = activeMatches.map(match => {
    const allPlayers = Array.isArray(match.allPlayers) ? match.allPlayers : [];

    // Identificamos el equipo donde está nuestro jugador (o jugadores del grupo)
    const trackedInMatch = allPlayers.find(p => trackedProfileIds.has(p.profileId));
    const ourTeamId = trackedInMatch?.team ?? match.player?.team ?? 1;

    let teamLeft = allPlayers.filter(p => p.team === ourTeamId);
    let teamRight = allPlayers.filter(p => p.team !== ourTeamId);

    if (teamLeft.length === 0 && match.player) teamLeft = [match.player];
    if (teamRight.length === 0 && Array.isArray(match.opponents)) teamRight = match.opponents;

    // Ordenamos para que los jugadores del grupo aparezcan primero dentro de cada equipo
    teamLeft.sort((a, b) => (trackedProfileIds.has(b.profileId) ? 1 : 0) - (trackedProfileIds.has(a.profileId) ? 1 : 0));
    teamRight.sort((a, b) => (trackedProfileIds.has(b.profileId) ? 1 : 0) - (trackedProfileIds.has(a.profileId) ? 1 : 0));

    const isTeamGame = teamLeft.length > 1 || teamRight.length > 1;
    const formatLabel = `${teamLeft.length || 1}v${teamRight.length || 1}`;
    const durationStr = formatDuration(match.started);

    const leftPlayersHtml = teamLeft.map(p => renderTeamPlayerChip(p, match.leaderboardId, 'left')).join('');
    const rightPlayersHtml = teamRight.map(p => renderTeamPlayerChip(p, match.leaderboardId, 'right')).join('');

    return `
      <div class="live-banner ${isTeamGame ? 'live-banner-team' : ''}">
        <div class="live-status-col">
          <span class="live-badge">Live now</span>
          <span class="live-mode-tag">${formatLabel}</span>
          <span class="live-clock">${nowStr}</span>
        </div>
        <div class="live-match-info ${isTeamGame ? 'is-team-match' : ''}">
          <div class="live-team-side side-left">
            ${leftPlayersHtml}
          </div>
          <span class="live-vs">vs</span>
          <div class="live-team-side side-right">
            ${rightPlayersHtml}
          </div>
        </div>
        <div class="live-meta">
          <span class="live-map">${match.mapName}</span>
          <span class="live-duration" data-started="${match.started || 0}">${durationStr}</span>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="live-banners-list">${bannersHtml}</div>`;

  liveTimerInterval = setInterval(() => {
    const currentNowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    container.querySelectorAll('.live-clock').forEach(el => {
      el.textContent = currentNowStr;
    });
    container.querySelectorAll('.live-duration[data-started]').forEach(el => {
      const startedSec = Number(el.dataset.started);
      el.textContent = formatDuration(startedSec);
    });
  }, 1000);
}

/**
 * Renderiza la grilla de tarjetas de jugadores
 */
export function renderPlayersGrid(playersData, container, onCardClick, onRemovePlayer, sortBy = 'current') {
  // Filtramos los válidos y ordenamos descendentemente por currentElo o maxElo según corresponda
  const sorted = [...playersData.filter(Boolean)].sort((a, b) => {
    if (sortBy === 'max') {
      if (b.maxElo !== a.maxElo) return b.maxElo - a.maxElo;
      return b.currentElo - a.currentElo;
    }
    if (b.currentElo !== a.currentElo) return b.currentElo - a.currentElo;
    return b.maxElo - a.maxElo;
  });

  if (sorted.length === 0) {
    container.innerHTML = `<div class="loading-box"><p>No hay datos de jugadores cargados.</p></div>`;
    return;
  }

  container.innerHTML = '';

  sorted.forEach((player, index) => {
    const rank = index + 1;
    let rankClass = '';
    let stampClass = 'stamp-other';

    if (rank === 1) {
      rankClass = 'rank-1';
      stampClass = 'stamp-1';
    } else if (rank === 2) {
      rankClass = 'rank-2';
      stampClass = 'stamp-2';
    } else if (rank === 3) {
      rankClass = 'rank-3';
      stampClass = 'stamp-3';
    }

    if (player.isPlayingNow) {
      rankClass += ' is-playing';
    }

    // Racha actual y puntos ganados/perdidos durante esa racha
    let rachaHtml = 'Racha: <span style="color:#777;">0</span>';
    if (player.streak !== 0) {
      const isWinStreak = player.streak > 0;
      const streakArrow = isWinStreak ? '↑' : '↓';
      const streakColor = isWinStreak ? 'green' : 'red';
      const pts = player.streakEloChange || 0;
      const ptsSign = pts > 0 ? '+' : '';
      const ptsText = pts !== 0 ? ` (${ptsSign}${pts})` : '';
      rachaHtml = `Racha: <span class="streak-indicator ${streakColor}">${streakArrow}${Math.abs(player.streak)}${ptsText}</span>`;
    }

    // Últimas 10 partidas (Civ arriba + recuadro del Mapa abajo)
    const recentMatchesHtml = player.matches.slice(0, 10).map((m) => {
      const civName = m.player?.civ || 'britons';
      const isOngoing = m.status === 'ongoing';
      const isWon = m.player?.won === true;
      const mapName = m.mapName || 'Unknown Map';

      let borderClass = 'civ-loss';
      if (isOngoing) borderClass = 'civ-ongoing';
      else if (isWon) borderClass = 'civ-win';

      const tooltip = isOngoing
        ? `${civName} • Jugando ahora en ${mapName}`
        : `${civName} • ${isWon ? 'Victoria' : 'Derrota'} en ${mapName}`;

      const mapBoxHtml = m.mapImageUrl
        ? `<img src="${m.mapImageUrl}" class="match-map-icon" alt="${mapName}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
           <div class="map-diamond-fallback" style="display:none;"><span>?</span></div>`
        : `<div class="map-diamond-fallback"><span>?</span></div>`;

      return `
        <div class="last-match-col" title="${tooltip}">
          <img 
            src="${getCivIconUrl(civName)}" 
            class="civ-shield-icon ${borderClass}" 
            alt="${civName}"
            onerror="this.onerror=null;this.src='assets/icons/logo-128.png';"
          />
          <div class="match-map-frame">
            ${mapBoxHtml}
          </div>
        </div>
      `;
    }).join('');

    const flagUrl = getFlagUrl(player.country);
    const isCivsExpanded = expandedCardsCivs.has(player.profileId);

    const card = document.createElement('div');
    card.className = `player-card ${rankClass}`;
    card.innerHTML = `
      <div class="position-stamp ${stampClass}">${rank}</div>
      <div class="card-header">
        <img src="${flagUrl}" class="card-flag" alt="${player.country}">
        <span class="player-name" title="${player.name}">${player.name}</span>
        ${player.isPlayingNow ? '<span class="card-live-tag">Live now</span>' : ''}
      </div>
      <div class="card-stats-row">
        Now: <span class="elo-now ${sortBy === 'current' ? 'elo-active-sort' : ''}">${player.currentElo}</span> - Max: <span class="elo-max ${sortBy === 'max' ? 'elo-active-sort' : ''}">${player.maxElo}</span> - Avg: <span class="elo-avg">${player.averageEloLast20}</span>
      </div>
      <div class="card-last-match-row">
        <span>Últ. partida ${player.lastMatchDate || 'Sin registro'}</span>
        <span class="meta-separator">•</span>
        <span>${rachaHtml}</span>
      </div>
      <div class="card-civs-dropdown">
        <button type="button" class="card-civs-toggle ${isCivsExpanded ? 'open' : ''}" title="Desplegar / ocultar últimas partidas">
          <span class="toggle-arrow">${isCivsExpanded ? '▼' : '▶'}</span>
          <span>Last Matches</span>
        </button>
        <div class="civs-icons-row ${isCivsExpanded ? '' : 'hidden'}">
          ${recentMatchesHtml || '<span style="font-size:0.8rem; color:#666;">Sin partidas recientes</span>'}
        </div>
      </div>
      <button class="remove-player-btn" title="Quitar jugador">×</button>
    `;

    // Desplegable de emblemas de civilizaciones en la tarjeta
    const civsToggleBtn = card.querySelector('.card-civs-toggle');
    const civsRow = card.querySelector('.civs-icons-row');
    const toggleArrow = card.querySelector('.toggle-arrow');
    civsToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowOpen = civsRow.classList.toggle('hidden') === false;
      civsToggleBtn.classList.toggle('open', nowOpen);
      toggleArrow.textContent = nowOpen ? '▼' : '▶';
      if (nowOpen) {
        expandedCardsCivs.add(player.profileId);
      } else {
        expandedCardsCivs.delete(player.profileId);
      }
    });

    // Click en la tarjeta para ver estadísticas
    card.addEventListener('click', (e) => {
      if (e.target.closest('.remove-player-btn') || e.target.closest('.card-civs-toggle')) return;
      if (onCardClick) onCardClick(player);
    });

    // Click en botón quitar jugador
    const removeBtn = card.querySelector('.remove-player-btn');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onRemovePlayer) onRemovePlayer(player.profileId);
    });

    container.appendChild(card);
  });
}

/**
 * Muestra el modal con los detalles completos del jugador
 */
export function showPlayerModal(player, modalContainer, modalOverlay, previousPlayers = []) {
  // Calculamos estadísticas por civilización
  const civStats = {};
  player.matches.forEach(m => {
    if (m.status === 'ongoing') return;
    const civ = m.player?.civ;
    if (!civ) return;
    if (!civStats[civ]) {
      civStats[civ] = { total: 0, wins: 0, losses: 0 };
    }
    civStats[civ].total += 1;
    if (m.player?.won) civStats[civ].wins += 1;
    else civStats[civ].losses += 1;
  });

  const civList = Object.entries(civStats)
    .map(([name, stat]) => ({
      name,
      ...stat,
      winRate: (stat.wins / stat.total) * 100
    }))
    .sort((a, b) => b.total - a.total);

  const civsHtml = civList.map(c => `
    <div class="civ-stat-box">
      <img src="${getCivIconUrl(c.name)}" alt="${c.name}" onerror="this.onerror=null;this.src='assets/icons/logo-128.png';">
      <div class="civ-stat-info">
        <span class="civ-stat-name">${c.name}</span>
        <span class="civ-stat-numbers">Total: ${c.total} (W: ${c.wins} / L: ${c.losses})</span>
        <span style="font-weight:700;" class="${c.winRate >= 50 ? 'green' : 'red'}">${c.winRate.toFixed(1)}% WR</span>
      </div>
    </div>
  `).join('');

  // Filas de partidas recientes
  const matchesRowsHtml = player.matches.map(m => {
    const isOngoing = m.status === 'ongoing';
    const isWon = m.player?.won === true;
    const opponentsList = m.opponents && m.opponents.length > 0 ? m.opponents : [];
    const dateStr = m.started ? new Date(m.started * 1000).toLocaleDateString() : '-';

    let resultHtml = isOngoing ? '<span class="red" style="font-weight:bold;">En curso...</span>' : (isWon ? '<span class="green" style="font-weight:bold;">Victoria</span>' : '<span class="red" style="font-weight:bold;">Derrota</span>');

    const eloChange = m.player?.ratingDiff;
    const eloDiffStr = eloChange != null ? (eloChange > 0 ? `+${eloChange}` : `${eloChange}`) : '-';
    const eloClass = eloChange > 0 ? 'green' : (eloChange < 0 ? 'red' : '');

    const rivalsHtml = opponentsList.length > 0
      ? opponentsList.map(opp => {
          const oppCivImg = opp.civ ? `<img src="${getCivIconUrl(opp.civ)}" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;" onerror="this.onerror=null;this.src='assets/icons/logo-128.png';">` : '';
          if (opp.profileId) {
            return `
              <button type="button" class="rival-profile-link" data-profile-id="${opp.profileId}" title="Ver perfil de ${opp.name}">
                ${oppCivImg}
                <span class="rival-name-text">${opp.name || 'Rival'}</span>
                <span class="rival-elo-text">(${opp.rating ?? '?'})</span>
              </button>
            `;
          }
          return `<span>${oppCivImg} ${opp.name || 'Rival'} (${opp.rating ?? '?'})</span>`;
        }).join(' ')
      : '-';

    return `
      <tr>
        <td>${dateStr}</td>
        <td><strong>${m.mapName}</strong></td>
        <td><img src="${getCivIconUrl(m.player?.civ)}" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:4px;" onerror="this.onerror=null;this.src='assets/icons/logo-128.png';"> ${m.player?.civ || '-'}</td>
        <td><div class="rivals-cell-list">${rivalsHtml}</div></td>
        <td>${resultHtml}</td>
        <td class="${eloClass}"><strong>${eloDiffStr}</strong></td>
      </tr>
    `;
  }).join('');

  const prevPlayer = previousPlayers.length > 0 ? previousPlayers[previousPlayers.length - 1] : null;
  const backBtnHtml = prevPlayer
    ? `<button type="button" class="modal-back-btn" id="modalBackBtn">← Volver a ${prevPlayer.name}</button>`
    : '';

  modalContainer.innerHTML = `
    <button class="modal-close" id="modalCloseBtn">&times;</button>
    ${backBtnHtml}
    <div class="modal-title-row">
      <img src="${getFlagUrl(player.country)}" style="width:36px; border-radius:4px;">
      <h2>${player.name}</h2>
      <span style="color:#0099ff; font-weight:800; font-size:1.3rem; margin-left:auto;">${player.currentElo} Elo</span>
    </div>

    <!-- 1. Primero el Historial de Últimas Partidas (Colapsable) -->
    <div class="modal-collapsible-section">
      <button type="button" class="modal-section-header open" data-target="modalHistoryBody">
        <span>📜 Historial de Últimas Partidas (${player.leaderboardId === 'rm_1v1' ? '1v1' : 'Team'})</span>
        <span class="collapse-chevron">▼</span>
      </button>
      <div id="modalHistoryBody" class="modal-section-body">
        <div style="overflow-x:auto;">
          <table class="matches-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Mapa</th>
                <th>Civilización</th>
                <th>Rival (click para ver perfil)</th>
                <th>Resultado</th>
                <th>Elo</th>
              </tr>
            </thead>
            <tbody>
              ${matchesRowsHtml || '<tr><td colspan="6">Sin partidas registradas</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 2. Abajo las Civilizaciones Jugadas Recientemente (Colapsable) -->
    <div class="modal-collapsible-section">
      <button type="button" class="modal-section-header open" data-target="modalCivsBody">
        <span>🛡️ Civilizaciones Jugadas Recientemente (${civList.length})</span>
        <span class="collapse-chevron">▼</span>
      </button>
      <div id="modalCivsBody" class="modal-section-body">
        <div class="civs-stats-grid">
          ${civsHtml || '<p style="color:#777;">No hay datos de civilizaciones suficientes.</p>'}
        </div>
      </div>
    </div>
  `;

  modalOverlay.classList.add('active');

  document.getElementById('modalCloseBtn').onclick = () => {
    modalOverlay.classList.remove('active');
  };

  // Botón volver al jugador anterior
  const backBtn = document.getElementById('modalBackBtn');
  if (backBtn && prevPlayer) {
    backBtn.onclick = () => {
      const nextStack = previousPlayers.slice(0, -1);
      showPlayerModal(prevPlayer, modalContainer, modalOverlay, nextStack);
    };
  }

  // Eventos para colapsar / desplegar las secciones del modal
  modalContainer.querySelectorAll('.modal-section-header').forEach(headerBtn => {
    headerBtn.addEventListener('click', () => {
      const targetId = headerBtn.dataset.target;
      const bodyEl = modalContainer.querySelector(`#${targetId}`);
      const chevronEl = headerBtn.querySelector('.collapse-chevron');
      if (!bodyEl) return;
      const isCollapsed = bodyEl.classList.toggle('collapsed');
      headerBtn.classList.toggle('open', !isCollapsed);
      if (chevronEl) chevronEl.textContent = isCollapsed ? '▶' : '▼';
    });
  });

  // Eventos para abrir el perfil del rival al hacer click en el historial
  modalContainer.querySelectorAll('.rival-profile-link').forEach(rivalBtn => {
    rivalBtn.addEventListener('click', async () => {
      const rivalId = parseInt(rivalBtn.dataset.profileId, 10);
      if (!rivalId) return;

      modalContainer.innerHTML = `
        <button class="modal-close" id="modalCloseBtn">&times;</button>
        <div class="loading-box" style="padding: 40px 20px;">
          <div class="spinner"></div>
          <p>Cargando perfil del rival...</p>
        </div>
      `;
      document.getElementById('modalCloseBtn').onclick = () => {
        modalOverlay.classList.remove('active');
      };

      const rivalStats = await getPlayerStats(rivalId, player.leaderboardId);
      if (rivalStats) {
        showPlayerModal(rivalStats, modalContainer, modalOverlay, [...previousPlayers, player]);
      } else {
        alert('No se pudo cargar el perfil del rival.');
        showPlayerModal(player, modalContainer, modalOverlay, previousPlayers);
      }
    });
  });
}
