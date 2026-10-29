import { getCivIconUrl, formatDateDDMMYYYY } from './api.js?v=20261029b';

let activeSubView = 'civs'; // 'civs' | 'maps'

/**
 * Renderiza la vista de Top Civilizaciones y Mapas del grupo (acumulado semanal - últimos 7 días)
 * con toggle entre Civs/Mapas y RM 1v1/RM Team
 */
export function renderCivsAndMapsView(playersData, container, currentMode = 'rm_1v1', onModeChange) {
  const nowSec = Date.now() / 1000;
  const oneWeekAgo = nowSec - (7 * 24 * 60 * 60);
  const fromDateStr = formatDateDDMMYYYY(oneWeekAgo);
  const toDateStr = formatDateDDMMYYYY(nowSec);

  const allMatches = [];
  playersData.filter(Boolean).forEach(p => {
    (p.matches || []).forEach(m => {
      if (m.status === 'complete' && typeof m.player?.won === 'boolean' && m.started && m.started >= oneWeekAgo) {
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
      if (!mapsMap[map]) mapsMap[map] = { name: map, mapImageUrl: m.mapImageUrl || '', total: 0, wins: 0, losses: 0 };
      if (!mapsMap[map].mapImageUrl && m.mapImageUrl) mapsMap[map].mapImageUrl = m.mapImageUrl;
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
          <img src="${getCivIconUrl(c.name)}" style="width:26px; height:26px; border-radius:50%;" onerror="this.onerror=null;this.src='assets/icons/logo-128.png';">
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

  const mapRows = sortedMaps.map((m, idx) => {
    const mapIconHtml = m.mapImageUrl
      ? `<img src="${m.mapImageUrl}" style="width:28px; height:28px; object-fit:contain;" alt="${m.name}" onerror="this.style.display='none';">`
      : '';
    return `
      <tr>
        <td><strong>#${idx + 1}</strong></td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            ${mapIconHtml}
            <strong>${m.name}</strong>
          </div>
        </td>
        <td>${m.total}</td>
        <td><span class="green">${m.wins}W</span> / <span class="red">${m.losses}L</span></td>
        <td>
          <span class="${m.winRate >= 50 ? 'green' : 'red'}" style="font-weight:700;">${m.winRate.toFixed(1)}%</span>
          <div class="progress-bar-bg" style="width:100px;">
            <div class="progress-bar-fill" style="width:${m.winRate}%; background:${m.winRate >= 50 ? '#22c55e' : '#ef4444'};"></div>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const modeLabel = currentMode === 'rm_team' ? 'RM Team' : 'RM 1vs1';
  const modeSubtitle = currentMode === 'rm_team' 
    ? `Acumulado semanal (últimos 7 días: ${fromDateStr} al ${toDateStr}) de elecciones de civilización y mapas en partidas por equipos (RM Team).` 
    : `Acumulado semanal (últimos 7 días: ${fromDateStr} al ${toDateStr}) de elecciones de civilización y mapas en partidas individuales (RM 1vs1).`;

  const civSectionHtml = `
    <div>
      <h3 style="color:#f59e0b; margin-bottom: 12px;">🛡️ Top Civilizaciones de la Semana (${sortedCivs.length})</h3>
      <table class="matches-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Civilización</th>
            <th>Partidas (7d)</th>
            <th>V/D</th>
            <th>Winrate</th>
          </tr>
        </thead>
        <tbody>
          ${civRows || '<tr><td colspan="5" style="text-align:center; padding:20px; color:#777;">Sin partidas registradas en los últimos 7 días para este modo</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  const mapSectionHtml = `
    <div>
      <h3 style="color:#0099ff; margin-bottom: 12px;">🗺️ Rendimiento Semanal por Mapa (${sortedMaps.length})</h3>
      <table class="matches-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Mapa</th>
            <th>Partidas (7d)</th>
            <th>V/D</th>
            <th>Winrate</th>
          </tr>
        </thead>
        <tbody>
          ${mapRows || '<tr><td colspan="5" style="text-align:center; padding:20px; color:#777;">Sin mapas registrados en los últimos 7 días para este modo</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = `
    <div class="view-container">
      <div class="view-header-row">
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h2>🗺️ Civilizaciones y Mapas más Jugados (${modeLabel})</h2>
            <span class="weekly-period-badge">📅 Acumulado Semanal (Últimos 7 días)</span>
          </div>
          <p class="subtitle">${modeSubtitle}</p>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
          <!-- Toggle entre Civilizaciones y Mapas -->
          <div class="mode-toggle-group">
            <button class="mode-toggle-btn subview-toggle-btn ${activeSubView === 'civs' ? 'active' : ''}" data-subview="civs">
              <span>🛡️</span> Civilizaciones
            </button>
            <button class="mode-toggle-btn subview-toggle-btn ${activeSubView === 'maps' ? 'active' : ''}" data-subview="maps">
              <span>🗺️</span> Mapas
            </button>
          </div>

          <!-- Toggle entre RM 1vs1 y RM Team -->
          <div class="mode-toggle-group">
            <button class="mode-toggle-btn leaderboard-toggle-btn ${currentMode === 'rm_1v1' ? 'active' : ''}" data-mode="rm_1v1">
              <span>⚔️</span> RM 1vs1
            </button>
            <button class="mode-toggle-btn leaderboard-toggle-btn ${currentMode === 'rm_team' ? 'active' : ''}" data-mode="rm_team">
              <span>🛡️</span> RM Team
            </button>
          </div>
        </div>
      </div>

      <div>
        ${activeSubView === 'maps' ? mapSectionHtml : civSectionHtml}
      </div>
    </div>
  `;

  // Listener para el toggle de Civs vs Mapas
  container.querySelectorAll('.subview-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const subview = btn.dataset.subview;
      if (subview && subview !== activeSubView) {
        activeSubView = subview;
        renderCivsAndMapsView(playersData, container, currentMode, onModeChange);
      }
    });
  });

  // Listener para el toggle de RM 1v1 vs RM Team
  container.querySelectorAll('.leaderboard-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode && onModeChange && mode !== currentMode) {
        onModeChange(mode);
      }
    });
  });
}
