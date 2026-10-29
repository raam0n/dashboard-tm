import { getFlagUrl, formatDateDDMMYYYY } from './api.js?v=20261029d';

/**
 * Renderiza la vista de Métricas Semanales con toggle entre RM 1v1 y RM Team
 */
export function renderWeeklyView(playersData, container, currentMode = 'rm_1v1', onModeChange) {
  const nowSec = Date.now() / 1000;
  const oneWeekAgo = nowSec - (7 * 24 * 60 * 60);
  const fromDateStr = formatDateDDMMYYYY(oneWeekAgo);
  const toDateStr = formatDateDDMMYYYY(nowSec);

  const weeklyStats = playersData.filter(Boolean).map(player => {
    // Filtramos partidas completadas de los últimos 7 días (excluyendo en curso y abandonadas)
    const weekMatches = (player.matches || []).filter(
      m => m.started && m.started >= oneWeekAgo && m.status === 'complete' && typeof m.player?.won === 'boolean'
    );
    const total = weekMatches.length;
    const wins = weekMatches.filter(m => m.player?.won).length;
    const losses = total - wins;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    const netElo = weekMatches.reduce((acc, m) => acc + (m.player?.ratingDiff || 0), 0);

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

  // Separamos jugadores activos (con al menos 1 partida en la semana) de los inactivos (0 partidas)
  const activePlayers = weeklyStats.filter(p => p.total > 0);
  const inactivePlayers = [...weeklyStats.filter(p => p.total === 0)].sort((a, b) => b.currentElo - a.currentElo);

  // Estadísticas globales del grupo esta semana
  const totalGamesGroup = activePlayers.reduce((acc, p) => acc + p.total, 0);
  const totalWinsGroup = activePlayers.reduce((acc, p) => acc + p.wins, 0);
  const groupWinRate = totalGamesGroup > 0 ? ((totalWinsGroup / totalGamesGroup) * 100).toFixed(1) : 0;

  // Jugador con mayor subida de Elo (entre los activos)
  const bestGainer = [...activePlayers].sort((a, b) => b.netElo - a.netElo)[0];
  // Jugador con más partidas jugadas (entre los activos)
  const mostActive = [...activePlayers].sort((a, b) => b.total - a.total)[0];

  // Ordenamos la tabla de activos por mayor delta de Elo semanal
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
            <img src="${getFlagUrl(p.country)}" style="width:22px; border-radius:2px;">
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

  const inactiveListHtml = inactivePlayers.length > 0
    ? `
      <div class="inactive-weekly-section">
        <div class="inactive-weekly-header">
          <h3>💤 Jugadores sin partidas esta semana (${inactivePlayers.length})</h3>
          <span>0 partidas registradas en ${ currentMode === 'rm_team' ? 'RM Team' : 'RM 1vs1' } en los últimos 7 días</span>
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
    ? `Monitoreo semanal (${fromDateStr} al ${toDateStr}) de jugadores activos en partidas por equipos (RM Team).` 
    : `Monitoreo semanal (${fromDateStr} al ${toDateStr}) de jugadores activos en partidas individuales (RM 1vs1).`;

  container.innerHTML = `
    <div class="view-container">
      <div class="view-header-row">
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h2>📊 Rendimiento y Deltas Semanales (${modeLabel})</h2>
            <span class="weekly-period-badge">📅 Últimos 7 días (${activePlayers.length} activos)</span>
          </div>
          <p class="subtitle">${modeSubtitle}</p>
        </div>
        <div class="mode-toggle-group">
          <button class="mode-toggle-btn ${currentMode === 'rm_1v1' ? 'active' : ''}" data-mode="rm_1v1">
            <span>⚔️</span> RM 1vs1
          </button>
          <button class="mode-toggle-btn ${currentMode === 'rm_team' ? 'active' : ''}" data-mode="rm_team">
            <span>🛡️</span> RM Team
          </button>
        </div>
      </div>

      <div class="metrics-cards-row">
        <div class="metric-card">
          <div class="label">Partidas Totales del Grupo</div>
          <div class="value">${totalGamesGroup}</div>
        </div>

        <div class="metric-card">
          <div class="label">Winrate Colectivo Semanal</div>
          <div class="value ${parseFloat(groupWinRate) >= 50 ? 'green' : 'red'}">${groupWinRate}%</div>
        </div>

        <div class="metric-card">
          <div class="label">🔥 Mayor Subida Semanal</div>
          <div class="value" style="font-size:1.4rem;">
            ${bestGainer && bestGainer.netElo > 0 ? `${bestGainer.name} (+${bestGainer.netElo})` : 'Sin ascensos'}
          </div>
        </div>

        <div class="metric-card">
          <div class="label">⚔️ Jugador Más Activo</div>
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
            <th>Partidas Semanales</th>
            <th>Récord (V/D)</th>
            <th>Winrate</th>
            <th>Delta Elo Semanal</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="7" style="text-align:center; padding:20px; color:#777;">No se registraron jugadores con partidas en los últimos 7 días</td></tr>'}
        </tbody>
      </table>

      ${inactiveListHtml}
    </div>
  `;

  // Listener para el toggle
  container.querySelectorAll('.mode-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode && onModeChange && mode !== currentMode) {
        onModeChange(mode);
      }
    });
  });
}
