import { getCivIconUrl, formatDateDDMMYYYY } from './api.js?v=20261110a';

let activeSubView = 'civs'; // 'civs' | 'maps'
let internalPeriodDays = 7; // 7 | 30 | 90
let internalSelectedPlayerId = null; // null (todos) | number (profileId)

/**
 * Renderiza la vista de Top Civilizaciones y Mapas con:
 * - Toggle de período: Semanal (7d), Mensual (30d), Últimos 3 meses (90d)
 * - Filtro de 1 jugador dentro de la lista de seleccionados
 * - Toggle entre Civilizaciones / Mapas y RM 1v1 / RM Team
 */
export function renderCivsAndMapsView(
  playersData,
  container,
  currentMode = 'rm_1v1',
  onModeChange,
  periodDays = null,
  onPeriodChange = null,
  selectedPlayerId = undefined,
  onPlayerFilterChange = null
) {
  const days = periodDays || internalPeriodDays || 7;
  const currentPlayerId = selectedPlayerId !== undefined ? selectedPlayerId : internalSelectedPlayerId;

  const nowSec = Date.now() / 1000;
  const periodAgo = nowSec - (days * 24 * 60 * 60);
  const fromDateStr = formatDateDDMMYYYY(periodAgo);
  const toDateStr = formatDateDDMMYYYY(nowSec);
  const periodShort = `${days}d`;

  const validPlayers = playersData.filter(Boolean);
  const selectedPlayer = currentPlayerId
    ? validPlayers.find(p => p.profileId === currentPlayerId) || null
    : null;

  // Si el jugador filtrado ya no está en la lista de seleccionados, volvemos a todos
  const targetPlayers = selectedPlayer ? [selectedPlayer] : validPlayers;

  // Opciones ordenadas alfabéticamente para el selector de jugador
  const sortedPlayerOptions = [...validPlayers].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '')
  );

  const allMatches = [];
  targetPlayers.forEach(p => {
    (p.matches || []).forEach(m => {
      if (m.status === 'complete' && typeof m.player?.won === 'boolean' && m.started && m.started >= periodAgo) {
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
          <img src="${getCivIconUrl(c.name)}" class="table-civ-icon" alt="${c.name}">
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
      ? `<img src="${m.mapImageUrl}" class="table-map-icon" alt="${m.name}">`
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
  const periodBadgeLabel = days === 7
    ? 'Semanal (Últimos 7 días)'
    : days === 30
      ? 'Mensual (Últimos 30 días)'
      : 'Últimos 3 meses (90 días)';

  const modeDesc = currentMode === 'rm_team'
    ? 'partidas por equipos (RM Team)'
    : 'partidas individuales (RM 1vs1)';

  const modeSubtitle = selectedPlayer
    ? `Estadísticas de ${selectedPlayer.name} en los últimos ${days} días (${fromDateStr} al ${toDateStr}) en ${modeDesc}.`
    : `Acumulado grupal de los últimos ${days} días (${fromDateStr} al ${toDateStr}) de elecciones de civilización y mapas en ${modeDesc}.`;

  const emptyTargetLabel = selectedPlayer ? ` para ${selectedPlayer.name}` : '';
  const loadingPlayerMsg = selectedPlayer && !selectedPlayer.matchesLoaded
    ? `Cargando historial de partidas de ${selectedPlayer.name}...`
    : null;

  const civSectionHtml = `
    <div>
      <h3 style="color:#f59e0b; margin-bottom: 12px;">🛡️ Top Civilizaciones (${sortedCivs.length})${selectedPlayer ? ` — ${selectedPlayer.name}` : ''}</h3>
      <table class="matches-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Civilización</th>
            <th>Partidas (${periodShort})</th>
            <th>V/D</th>
            <th>Winrate</th>
          </tr>
        </thead>
        <tbody>
          ${civRows || `<tr><td colspan="5" style="text-align:center; padding:20px; color:#777;">${loadingPlayerMsg || `Sin partidas registradas en los últimos ${days} días${emptyTargetLabel} para este modo`}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  const mapSectionHtml = `
    <div>
      <h3 style="color:#0099ff; margin-bottom: 12px;">🗺️ Rendimiento por Mapa (${sortedMaps.length})${selectedPlayer ? ` — ${selectedPlayer.name}` : ''}</h3>
      <table class="matches-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Mapa</th>
            <th>Partidas (${periodShort})</th>
            <th>V/D</th>
            <th>Winrate</th>
          </tr>
        </thead>
        <tbody>
          ${mapRows || `<tr><td colspan="5" style="text-align:center; padding:20px; color:#777;">${loadingPlayerMsg || `Sin mapas registrados en los últimos ${days} días${emptyTargetLabel} para este modo`}</td></tr>`}
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
            <span class="weekly-period-badge">📅 ${periodBadgeLabel}</span>
            ${selectedPlayer ? `<span class="weekly-period-badge" style="background:rgba(245, 158, 11, 0.2); border-color:rgba(245, 158, 11, 0.45); color:#fcd34d;">👤 ${selectedPlayer.name}</span>` : ''}
          </div>
          <p class="subtitle">${modeSubtitle}</p>
        </div>

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
      </div>

      <!-- Barra de Filtros: Vista (Civs/Mapas), Modo (1v1/Team) y Jugador -->
      <div class="hm-filters-bar">
        <div style="display:flex; flex-wrap:wrap; gap:14px; align-items:center;">
          <!-- Toggle entre Civilizaciones y Mapas -->
          <div class="hm-filter-group">
            <span class="hm-filter-label">Vista:</span>
            <div class="mode-toggle-group">
              <button class="mode-toggle-btn subview-toggle-btn ${activeSubView === 'civs' ? 'active' : ''}" data-subview="civs">
                <span>🛡️</span> Civilizaciones
              </button>
              <button class="mode-toggle-btn subview-toggle-btn ${activeSubView === 'maps' ? 'active' : ''}" data-subview="maps">
                <span>🗺️</span> Mapas
              </button>
            </div>
          </div>

          <!-- Toggle entre RM 1vs1 y RM Team -->
          <div class="hm-filter-group">
            <span class="hm-filter-label">Modo:</span>
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

        <!-- Selector para Filtrar 1 Jugador de la lista de seleccionados -->
        <div class="hm-filter-group" style="min-width:240px;">
          <span class="hm-filter-label">Jugador:</span>
          <select id="civsPlayerFilterSelect" class="hm-exclude-select">
            <option value="">👥 Todos los seleccionados (${validPlayers.length})</option>
            ${sortedPlayerOptions.map(p => `
              <option value="${p.profileId}" ${selectedPlayer && selectedPlayer.profileId === p.profileId ? 'selected' : ''}>
                ${p.name} (${p.currentElo})
              </option>
            `).join('')}
          </select>
          ${selectedPlayer ? '<button type="button" id="clearCivsPlayerFilterBtn" class="btn" style="font-size:0.8rem; padding:4px 8px;" title="Volver a ver todos los jugadores">✕ Todos</button>' : ''}
        </div>
      </div>

      <div>
        ${activeSubView === 'maps' ? mapSectionHtml : civSectionHtml}
      </div>
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
          renderCivsAndMapsView(playersData, container, currentMode, onModeChange, newDays, onPeriodChange, currentPlayerId, onPlayerFilterChange);
        }
      }
    });
  });

  // Listener para el toggle de Civs vs Mapas
  container.querySelectorAll('.subview-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const subview = btn.dataset.subview;
      if (subview && subview !== activeSubView) {
        activeSubView = subview;
        renderCivsAndMapsView(playersData, container, currentMode, onModeChange, days, onPeriodChange, currentPlayerId, onPlayerFilterChange);
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

  // Listener para el selector de jugador individual
  const playerSelect = container.querySelector('#civsPlayerFilterSelect');
  if (playerSelect) {
    playerSelect.addEventListener('change', (e) => {
      const val = e.target.value ? parseInt(e.target.value, 10) : null;
      internalSelectedPlayerId = val;
      if (onPlayerFilterChange) {
        onPlayerFilterChange(val);
      } else {
        renderCivsAndMapsView(playersData, container, currentMode, onModeChange, days, onPeriodChange, val, onPlayerFilterChange);
      }
    });
  }

  // Listener para limpiar filtro de jugador
  const clearPlayerBtn = container.querySelector('#clearCivsPlayerFilterBtn');
  if (clearPlayerBtn) {
    clearPlayerBtn.addEventListener('click', () => {
      internalSelectedPlayerId = null;
      if (onPlayerFilterChange) {
        onPlayerFilterChange(null);
      } else {
        renderCivsAndMapsView(playersData, container, currentMode, onModeChange, days, onPeriodChange, null, onPlayerFilterChange);
      }
    });
  }
}
