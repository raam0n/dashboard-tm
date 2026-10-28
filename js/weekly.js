import { getFlagUrl } from './api.js';

/**
 * Renderiza la vista de Métricas Semanales
 */
export function renderWeeklyView(playersData, container) {
  const oneWeekAgo = Date.now() / 1000 - (7 * 24 * 60 * 60);

  const weeklyStats = playersData.filter(Boolean).map(player => {
    // Filtramos partidas de los últimos 7 días
    const weekMatches = player.matches.filter(m => m.started && m.started >= oneWeekAgo && m.status !== 'ongoing');
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
      total,
      wins,
      losses,
      winRate,
      netElo
    };
  });

  // Estadísticas globales del grupo esta semana
  const totalGamesGroup = weeklyStats.reduce((acc, p) => acc + p.total, 0);
  const totalWinsGroup = weeklyStats.reduce((acc, p) => acc + p.wins, 0);
  const groupWinRate = totalGamesGroup > 0 ? ((totalWinsGroup / totalGamesGroup) * 100).toFixed(1) : 0;

  // Jugador con mayor subida de Elo
  const bestGainer = [...weeklyStats].sort((a, b) => b.netElo - a.netElo)[0];
  // Jugador con más partidas jugadas
  const mostActive = [...weeklyStats].sort((a, b) => b.total - a.total)[0];

  // Ordenamos la tabla por mayor delta de Elo semanal
  const sortedByDelta = [...weeklyStats].sort((a, b) => b.netElo - a.netElo);

  const rowsHtml = sortedByDelta.map((p, index) => {
    const deltaClass = p.netElo > 0 ? 'green' : (p.netElo < 0 ? 'red' : '');
    const deltaSign = p.netElo > 0 ? '+' : '';
    const wrClass = p.winRate >= 50 ? 'green' : (p.total > 0 ? 'red' : '');

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
          <span class="${wrClass}" style="font-weight:700;">${p.total > 0 ? p.winRate.toFixed(1) + '%' : '-'}</span>
          <div class="progress-bar-bg" style="width:100px;">
            <div class="progress-bar-fill" style="width:${p.winRate}%; background:${p.winRate >= 50 ? '#22c55e' : '#ef4444'};"></div>
          </div>
        </td>
        <td class="${deltaClass}" style="font-size:1.1rem; font-weight:800;">
          ${p.total > 0 ? `${deltaSign}${p.netElo}` : '0'}
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="view-container">
      <h2>📊 Rendimiento y Deltas Semanales (Últimos 7 días)</h2>
      <p class="subtitle">Monitoreo semanal del grupo para ver quiénes están en racha ascendente y el winrate colectivo.</p>

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
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}
