import { getCivIconUrl, getFlagUrl } from './api.js';

let liveTimerInterval = null;

/**
 * Renderiza el banner superior de "Live now"
 */
export function renderLiveBanner(playersData, container) {
  if (liveTimerInterval) clearInterval(liveTimerInterval);

  // Buscamos jugadores con partida en curso
  const playingPlayers = playersData.filter(p => p && p.isPlayingNow && p.ongoingMatch);

  if (playingPlayers.length === 0) {
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

  // Tomamos la primera partida activa (o podemos mostrar varias si hay más)
  const active = playingPlayers[0];
  const match = active.ongoingMatch;
  const targetPlayer = match.player;
  const opponent = match.opponents && match.opponents.length > 0 ? match.opponents[0] : null;

  function updateBannerHtml() {
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const elapsedSec = match.started ? Math.max(0, Math.floor(Date.now() / 1000 - match.started)) : 0;
    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;
    const durationStr = `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;

    const p1Civ = targetPlayer?.civ ? `<img src="${getCivIconUrl(targetPlayer.civ)}" class="live-civ-shield" title="${targetPlayer.civ}">` : '';
    const p1Flag = targetPlayer?.country ? `<img src="${getFlagUrl(targetPlayer.country)}" class="live-flag">` : '';

    const p2Civ = opponent?.civ ? `<img src="${getCivIconUrl(opponent.civ)}" class="live-civ-shield" title="${opponent.civ}">` : '';
    const p2Flag = opponent?.country ? `<img src="${getFlagUrl(opponent.country)}" class="live-flag">` : '';

    container.innerHTML = `
      <div class="live-banner">
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="live-badge">Live now</span>
          <span class="live-clock">${nowStr}</span>
        </div>
        <div class="live-match-info">
          <span>${active.name} (${targetPlayer?.rating ?? active.currentElo})</span>
          ${p1Flag}
          ${p1Civ}
          <span class="live-vs">vs</span>
          ${p2Civ}
          ${p2Flag}
          <span>(${opponent?.rating ?? '?'}) ${opponent?.name || 'Rival'}</span>
        </div>
        <div class="live-meta">
          <span class="live-map">${match.mapName}</span>
          <span class="live-duration">${durationStr}</span>
        </div>
      </div>
    `;
  }

  updateBannerHtml();
  liveTimerInterval = setInterval(updateBannerHtml, 1000);
}

/**
 * Renderiza la grilla de tarjetas de jugadores
 */
export function renderPlayersGrid(playersData, container, onCardClick, onRemovePlayer) {
  // Filtramos los válidos y ordenamos descendentemente por currentElo
  const sorted = [...playersData.filter(Boolean)].sort((a, b) => b.currentElo - a.currentElo);

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

    // Diferencia respecto al jugador inmediatamente superior
    let diffHtml = '';
    if (index > 0) {
      const prevElo = sorted[index - 1].currentElo;
      const diff = player.currentElo - prevElo;
      diffHtml = `<span class="elo-diff red">(${diff})</span>`;
    }

    // Racha actual
    let streakHtml = '';
    if (player.streak !== 0) {
      const isWinStreak = player.streak > 0;
      const streakArrow = isWinStreak ? '↑' : '↓';
      const streakColor = isWinStreak ? 'green' : 'red';
      streakHtml = `<span class="streak-indicator ${streakColor}">${streakArrow}${Math.abs(player.streak)}</span>`;
    }

    // Delta total de partidas recientes
    let deltaHtml = '';
    if (player.totalEloChange !== 0) {
      const isPositive = player.totalEloChange > 0;
      const sign = isPositive ? '+' : '';
      const color = isPositive ? 'green' : 'red';
      deltaHtml = `<span class="${color}">(${sign}${player.totalEloChange})</span>`;
    }

    // Últimas 10 civs
    const recentCivs = player.matches.slice(0, 10).map((m, mIdx) => {
      const civName = m.player?.civ || 'britons';
      const isOngoing = m.status === 'ongoing';
      const isWon = m.player?.won === true;

      let borderClass = 'civ-loss';
      if (isOngoing) borderClass = 'civ-ongoing';
      else if (isWon) borderClass = 'civ-win';

      const tooltip = isOngoing
        ? `${civName} (Jugando ahora en ${m.mapName})`
        : `${civName} - ${isWon ? 'Victoria' : 'Derrota'} (${m.mapName})`;

      return `
        <img 
          src="${getCivIconUrl(civName)}" 
          class="civ-shield-icon ${borderClass}" 
          title="${tooltip}"
          alt="${civName}"
        />
      `;
    }).join('');

    const flagUrl = getFlagUrl(player.country);

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
        Now: <span class="elo-now">${player.currentElo}</span> ${diffHtml} - Max: <span class="elo-max">${player.maxElo}</span> - Avg: <span class="elo-avg">${player.averageEloLast20}</span>
      </div>
      <div class="card-civs-label">
        Last Played Civilizations: ${streakHtml} ${deltaHtml}
      </div>
      <div class="civs-icons-row">
        ${recentCivs || '<span style="font-size:0.8rem; color:#666;">Sin partidas recientes</span>'}
      </div>
      <button class="remove-player-btn" title="Quitar jugador">×</button>
    `;

    // Click en la tarjeta para ver estadísticas
    card.addEventListener('click', (e) => {
      if (e.target.closest('.remove-player-btn')) return;
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
export function showPlayerModal(player, modalContainer, modalOverlay) {
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
      <img src="${getCivIconUrl(c.name)}" alt="${c.name}">
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
    const opponent = m.opponents && m.opponents[0] ? m.opponents[0] : null;
    const dateStr = m.started ? new Date(m.started * 1000).toLocaleDateString() : '-';

    let resultHtml = isOngoing ? '<span class="red" style="font-weight:bold;">En curso...</span>' : (isWon ? '<span class="green" style="font-weight:bold;">Victoria</span>' : '<span class="red" style="font-weight:bold;">Derrota</span>');

    const eloChange = m.player?.ratingDiff;
    const eloDiffStr = eloChange != null ? (eloChange > 0 ? `+${eloChange}` : `${eloChange}`) : '-';
    const eloClass = eloChange > 0 ? 'green' : (eloChange < 0 ? 'red' : '');

    const oppCiv = opponent?.civ ? `<img src="${getCivIconUrl(opponent.civ)}" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:4px;">` : '';

    return `
      <tr>
        <td>${dateStr}</td>
        <td><strong>${m.mapName}</strong></td>
        <td><img src="${getCivIconUrl(m.player?.civ)}" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:4px;"> ${m.player?.civ || '-'}</td>
        <td>${oppCiv} ${opponent?.name || 'Rival'} (${opponent?.rating ?? '?'})</td>
        <td>${resultHtml}</td>
        <td class="${eloClass}"><strong>${eloDiffStr}</strong></td>
      </tr>
    `;
  }).join('');

  modalContainer.innerHTML = `
    <button class="modal-close" id="modalCloseBtn">&times;</button>
    <div class="modal-title-row">
      <img src="${getFlagUrl(player.country)}" style="width:36px; border-radius:4px;">
      <h2>${player.name}</h2>
      <span style="color:#0099ff; font-weight:800; font-size:1.3rem; margin-left:auto;">${player.currentElo} Elo</span>
    </div>

    <div class="modal-section-title">Civilizaciones Jugadas Recientemente</div>
    <div class="civs-stats-grid">
      ${civsHtml || '<p style="color:#777;">No hay datos de civilizaciones suficientes.</p>'}
    </div>

    <div class="modal-section-title">Historial de Últimas Partidas (${player.leaderboardId === 'rm_1v1' ? '1v1' : 'Team'})</div>
    <div style="overflow-x:auto;">
      <table class="matches-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Mapa</th>
            <th>Civilización</th>
            <th>Rival</th>
            <th>Resultado</th>
            <th>Elo</th>
          </tr>
        </thead>
        <tbody>
          ${matchesRowsHtml || '<tr><td colspan="6">Sin partidas registradas</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  modalOverlay.classList.add('active');

  document.getElementById('modalCloseBtn').onclick = () => {
    modalOverlay.classList.remove('active');
  };
}
