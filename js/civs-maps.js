import { getCivIconUrl } from './api.js';

/**
 * Renderiza la vista de Top Civilizaciones y Mapas del grupo con toggle entre RM 1v1 y RM Team
 */
export function renderCivsAndMapsView(playersData, container, currentMode = 'rm_1v1', onModeChange) {
  const allMatches = [];
  playersData.filter(Boolean).forEach(p => {
    (p.matches || []).forEach(m => {
      if (m.status !== 'ongoing') {
        allMatches.push(m);
      }
    });
  });

  // Agrupamos por civilización
  const civMap = {};
  // Agrupamos por mapa
  const mapsMap = {};

  allMatches.forEach(m => {
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
      if (!mapsMap[map]) mapsMap[map] = { name: map, total: 0, wins: 0, losses: 0 };
      mapsMap[map].total += 1;
      if (won) mapsMap[map].wins += 1;
      else mapsMap[map].losses += 1;
    }
  });

  const sortedCivs = Object.values(civMap)
    .map(c => ({ ...c, winRate: (c.wins / c.total) * 100 }))
    .sort((a, b) => b.total - a.total);

  const sortedMaps = Object.values(mapsMap)
    .map(m => ({ ...m, winRate: (m.wins / m.total) * 100 }))
    .sort((a, b) => b.total - a.total);

  const civRows = sortedCivs.map((c, idx) => `
    <tr>
      <td><strong>#${idx + 1}</strong></td>
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <img src="${getCivIconUrl(c.name)}" style="width:26px; height:26px; border-radius:50%;">
          <strong>${c.name}</strong>
        </div>
      </td>
      <td>${c.total}</td>
      <td><span class="green">${c.wins}W</span> / <span class="red">${c.losses}L</span></td>
      <td>
        <span class="${c.winRate >= 50 ? 'green' : 'red'}" style="font-weight:700;">${c.winRate.toFixed(1)}%</span>
        <div class="progress-bar-bg" style="width:100px;">
          <div class="progress-bar-fill" style="width:${c.winRate}%; background:${c.winRate >= 50 ? '#22c55e' : '#ef4444'};"></div>
        </div>
      </td>
    </tr>
  `).join('');

  const mapRows = sortedMaps.map((m, idx) => `
    <tr>
      <td><strong>#${idx + 1}</strong></td>
      <td><strong>${m.name}</strong></td>
      <td>${m.total}</td>
      <td><span class="green">${m.wins}W</span> / <span class="red">${m.losses}L</span></td>
      <td>
        <span class="${m.winRate >= 50 ? 'green' : 'red'}" style="font-weight:700;">${m.winRate.toFixed(1)}%</span>
        <div class="progress-bar-bg" style="width:100px;">
          <div class="progress-bar-fill" style="width:${m.winRate}%; background:${m.winRate >= 50 ? '#22c55e' : '#ef4444'};"></div>
        </div>
      </td>
    </tr>
  `).join('');

  const modeLabel = currentMode === 'rm_team' ? 'RM Team' : 'RM 1vs1';
  const modeSubtitle = currentMode === 'rm_team' 
    ? 'Análisis acumulado de elecciones de civilización y mapas en partidas por equipos (RM Team).' 
    : 'Análisis acumulado de elecciones de civilización y mapas en partidas individuales (RM 1vs1).';

  container.innerHTML = `
    <div class="view-container">
      <div class="view-header-row">
        <div>
          <h2>🗺️ Civilizaciones y Mapas más Jugados (${modeLabel})</h2>
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

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(450px, 1fr)); gap: 24px;">
        <div>
          <h3 style="color:#f59e0b; margin-bottom: 12px;">🛡️ Top Civilizaciones</h3>
          <table class="matches-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Civilización</th>
                <th>Partidas</th>
                <th>V/D</th>
                <th>Winrate</th>
              </tr>
            </thead>
            <tbody>
              ${civRows || '<tr><td colspan="5" style="text-align:center; padding:20px; color:#777;">Sin datos de partidas para este modo</td></tr>'}
            </tbody>
          </table>
        </div>

        <div>
          <h3 style="color:#0099ff; margin-bottom: 12px;">🗺️ Rendimiento por Mapa</h3>
          <table class="matches-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Mapa</th>
                <th>Partidas</th>
                <th>V/D</th>
                <th>Winrate</th>
              </tr>
            </thead>
            <tbody>
              ${mapRows || '<tr><td colspan="5" style="text-align:center; padding:20px; color:#777;">Sin datos de mapas para este modo</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
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
