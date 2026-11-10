import { getFlagUrl, formatDateDDMMYYYY } from './api.js?v=20261110c';

let internalPeriodDays = 7;

/**
 * Renderiza la vista de Winrate con toggle de período (7d, 30d, 90d) y modo (RM 1v1 / RM Team)
 */
export function renderWeeklyView(playersData, container, currentMode = 'rm_1v1', onModeChange, periodDays = null, onPeriodChange = null) {
  const days = periodDays || internalPeriodDays || 7;
  const nowSec = Date.now() / 1000;
  const periodAgo = nowSec - (days * 24 * 60 * 60);
  const fromDateStr = formatDateDDMMYYYY(periodAgo);
  const toDateStr = formatDateDDMMYYYY(nowSec);
  const periodShort = `${days}d`;

  const periodStats = playersData.filter(Boolean).map(player => {
    // Filtramos partidas completadas dentro de la ventana de tiempo elegida (excluyendo en curso y abandonadas)
    const periodMatches = (player.matches || []).filter(
      m => m.started && m.started >= periodAgo && m.status === 'complete' && typeof m.player?.won === 'boolean'
    );
    const total = periodMatches.length;
    const wins = periodMatches.filter(m => m.player?.won).length;
    const losses = total - wins;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    const netElo = periodMatches.reduce((acc, m) => acc + (m.player?.ratingDiff || 0), 0);

    return {
      profileId: player.profileId,
      name: player.name,
      country: player.country,
      currentElo: player.currentElo,
      lastMatchDate: player.lastMatchDate || 'Sin registro',
      total,
      wins,
      losses,
      winRate,
      netElo
    };
  });

  // Separamos jugadores activos (con al menos 1 partida en el período) de los inactivos (0 partidas)
  const activePlayers = periodStats.filter(p => p.total > 0);
  const inactivePlayers = [...periodStats.filter(p => p.total === 0)].sort((a, b) => b.currentElo - a.currentElo);

  // Estadísticas globales del grupo en este período
  const totalGamesGroup = activePlayers.reduce((acc, p) => acc + p.total, 0);
  const totalWinsGroup = activePlayers.reduce((acc, p) => acc + p.wins, 0);
  const groupWinRate = totalGamesGroup > 0 ? ((totalWinsGroup / totalGamesGroup) * 100).toFixed(1) : 0;

  // Jugador con mayor subida de Elo (entre los activos)
  const bestGainer = [...activePlayers].sort((a, b) => b.netElo - a.netElo)[0];
  // Jugador con más partidas jugadas (entre los activos)
  const mostActive = [...activePlayers].sort((a, b) => b.total - a.total)[0];

  // Ordenamos la tabla de activos por mayor delta de Elo en el período
  const sortedByDelta = [...activePlayers].sort((a, b) => {
    if (b.netElo !== a.netElo) return b.netElo - a.netElo;
    return b.total - a.total;
  });

  const rowsHtml = sortedByDelta.map((p, index) => {
    const deltaClass = p.netElo > 0 ? 'green' : (p.netElo < 0 ? 'red' : '');
    const deltaSign = p.netElo > 0 ? '+' : '';
    const wrClass = p.winRate >= 50 ? 'green' : 'red';

    return `
      <tr>
        <td><strong>#${index + 1}</strong></td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <img src="${getFlagUrl(p.country)}" class="table-flag-icon" alt="${p.country}">
            <span>${p.name}</span>
          </div>
        </td>
        <td><strong>${p.currentElo}</strong></td>
        <td>${p.total}</td>
        <td><span class="green">${p.wins}W</span> / <span class="red">${p.losses}L</span></td>
        <td>
          <span class="${wrClass}" style="font-weight:700;">${p.winRate.toFixed(1)}%</span>
          <div class="progress-bar-bg" style="width:100px;">
            <div class="progress-bar-fill" style="width:${p.winRate}%; background:${p.winRate >= 50 ? '#22c55e' : '#ef4444'};"></div>
          </div>
        </td>
        <td class="${deltaClass}" style="font-size:1.1rem; font-weight:800;">
          ${deltaSign}${p.netElo}
        </td>
      </tr>
    `;
  }).join('');

  const inactiveHeadingText = days === 7
    ? `💤 Jugadores sin partidas esta semana (${inactivePlayers.length})`
    : `💤 Jugadores sin partidas en los últimos ${days} días (${inactivePlayers.length})`;

  const inactiveListHtml = inactivePlayers.length > 0
    ? `
      <div class="inactive-weekly-section">
        <div class="inactive-weekly-header">
          <h3>${inactiveHeadingText}</h3>
          <span>0 partidas registradas en ${currentMode === 'rm_team' ? 'RM Team' : 'RM 1vs1'} en los últimos ${days} días</span>
        </div>
        <div class="inactive-players-grid">
          ${inactivePlayers.map(p => `
            <div class="inactive-player-chip">
              <img src="${getFlagUrl(p.country)}" class="inactive-player-flag" alt="${p.country}">
              <div class="inactive-player-info">
                <span class="inactive-player-name">${p.name} <small>(${p.currentElo})</small></span>
                <span class="inactive-player-last">Últ. partida: ${p.lastMatchDate}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `
    : '';

  const modeLabel = currentMode === 'rm_team' ? 'RM Team' : 'RM 1vs1';
  const modeSubtitle = currentMode === 'rm_team' 
    ? `Monitoreo de los últimos ${days} días (${fromDateStr} al ${toDateStr}) de jugadores activos en partidas por equipos (RM Team).` 
    : `Monitoreo de los últimos ${days} días (${fromDateStr} al ${toDateStr}) de jugadores activos en partidas individuales (RM 1vs1).`;

  container.innerHTML = `
    <div class="view-container">
      <div class="view-header-row">
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h2>📊 Winrate y Rendimiento (${modeLabel})</h2>
            <span class="weekly-period-badge">📅 Últimos ${days} días (${activePlayers.length} activos)</span>
          </div>
          <p class="subtitle">${modeSubtitle}</p>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
          <!-- Toggle de Período de Tiempo: Semanal / Mensual (30d) / Últimos 3 meses (90d) -->
          <div class="mode-toggle-group">
            <button class="mode-toggle-btn period-toggle-btn ${days === 7 ? 'active' : ''}" data-days="7" title="Últimos 7 días">
              Semanal
            </button>
            <button class="mode-toggle-btn period-toggle-btn ${days === 30 ? 'active' : ''}" data-days="30" title="Últimos 30 días">
              Mensual (30d)
            </button>
            <button class="mode-toggle-btn period-toggle-btn ${days === 90 ? 'active' : ''}" data-days="90" title="Últimos 90 días">
              Últimos 3 meses (90d)
            </button>
          </div>

          <!-- Toggle entre RM 1v1 y RM Team -->
          <div class="mode-toggle-group">
            <button class="mode-toggle-btn leaderboard-mode-btn ${currentMode === 'rm_1v1' ? 'active' : ''}" data-mode="rm_1v1">
              <span>⚔️</span> RM 1vs1
            </button>
            <button class="mode-toggle-btn leaderboard-mode-btn ${currentMode === 'rm_team' ? 'active' : ''}" data-mode="rm_team">
              <span>🛡️</span> RM Team
            </button>
          </div>
        </div>
      </div>

      <div class="metrics-cards-row">
        <div class="metric-card">
          <div class="label">Partidas Totales (${periodShort})</div>
          <div class="value">${totalGamesGroup}</div>
        </div>

        <div class="metric-card">
          <div class="label">Winrate Colectivo (${periodShort})</div>
          <div class="value ${parseFloat(groupWinRate) >= 50 ? 'green' : 'red'}">${groupWinRate}%</div>
        </div>

        <div class="metric-card">
          <div class="label">🔥 Mayor Subida (${periodShort})</div>
          <div class="value" style="font-size:1.4rem;">
            ${bestGainer && bestGainer.netElo > 0 ? `${bestGainer.name} (+${bestGainer.netElo})` : 'Sin ascensos'}
          </div>
        </div>

        <div class="metric-card">
          <div class="label">⚔️ Jugador Más Activo (${periodShort})</div>
          <div class="value" style="font-size:1.4rem;">
            ${mostActive && mostActive.total > 0 ? `${mostActive.name} (${mostActive.total} PJ)` : '-'}
          </div>
        </div>
      </div>

      <table class="matches-table" style="font-size:1rem;">
        <thead>
          <tr>
            <th>Pos</th>
            <th>Jugador</th>
            <th>Elo Actual</th>
            <th>Partidas (${periodShort})</th>
            <th>Récord (V/D)</th>
            <th>Winrate</th>
            <th>Delta Elo (${periodShort})</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || `<tr><td colspan="7" style="text-align:center; padding:20px; color:#777;">No se registraron jugadores con partidas en los últimos ${days} días</td></tr>`}
        </tbody>
      </table>

      ${inactiveListHtml}
    </div>
  `;

  // Listener para el toggle de período (7d / 30d / 90d)
  container.querySelectorAll('.period-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newDays = parseInt(btn.dataset.days, 10);
      if (newDays && newDays !== days) {
        internalPeriodDays = newDays;
        if (onPeriodChange) {
          onPeriodChange(newDays);
        } else {
          renderWeeklyView(playersData, container, currentMode, onModeChange, newDays, onPeriodChange);
        }
      }
    });
  });

  // Listener para el toggle de modo (RM 1v1 / RM Team)
  container.querySelectorAll('.leaderboard-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode && onModeChange && mode !== currentMode) {
        onModeChange(mode);
      }
    });
  });
}
