import {
  getCivIconUrl,
  getFlagUrl,
  formatDateDDMMYYYY,
  getPlayerCivsAndMapsAnalytics
} from './api.js?v=20261110c';

let activeSubView = 'maps'; // 'civs' | 'maps' | 'both'

/**
 * Renderiza la solapa de Analítica de Jugadores y Comparación (1 o 2 jugadores lado a lado,
 * mitad izquierda Jugador 1 y mitad derecha Jugador 2) con filtros Semanal (7d), Mensual (30d),
 * Últimos 3 meses (90d) e Histórico (Desde el principio de los tiempos).
 */
export function renderAnalyticsComparisonView(
  playersData,
  container,
  stateConfig = {},
  onConfigChange = null,
  onPlayerClick = null
) {
  const validPlayers = playersData.filter(Boolean);
  const currentMode = stateConfig.mode || 'rm_1v1';
  const period = stateConfig.period || 7; // 7 | 30 | 90 | 'max'

  // Ordenamos por ELO actual descendente para elegir defaults razonables, y alfabético para los selectores
  const byEloDesc = [...validPlayers].sort((a, b) => (b.currentElo || 0) - (a.currentElo || 0));
  const sortedByName = [...validPlayers].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  let player1Id = stateConfig.player1Id;
  let player2Id = stateConfig.player2Id;

  if (!player1Id || !validPlayers.some(p => p.profileId === player1Id)) {
    player1Id = byEloDesc[0]?.profileId || null;
  }

  if (player2Id === undefined) {
    // Por defecto preseleccionamos el segundo jugador del ranking para mostrar la comparación lado a lado
    player2Id = byEloDesc.find(p => p.profileId !== player1Id)?.profileId || null;
  } else if (player2Id !== null && !validPlayers.some(p => p.profileId === player2Id)) {
    player2Id = null;
  }

  const player1 = validPlayers.find(p => p.profileId === player1Id) || null;
  const player2 = player2Id ? validPlayers.find(p => p.profileId === player2Id) || null : null;

  const stats1 = player1 ? getPlayerCivsAndMapsAnalytics(player1, currentMode, period) : null;
  const stats2 = player2 ? getPlayerCivsAndMapsAnalytics(player2, currentMode, period) : null;

  // Mapas rápidos de búsqueda cruzada para resaltar coincidencias entre Jugador 1 y Jugador 2
  const p1CivMap = new Map((stats1?.civs || []).map(c => [c.name.toLowerCase(), c]));
  const p2CivMap = new Map((stats2?.civs || []).map(c => [c.name.toLowerCase(), c]));
  const p1MapMap = new Map((stats1?.maps || []).map(m => [m.name.toLowerCase(), m]));
  const p2MapMap = new Map((stats2?.maps || []).map(m => [m.name.toLowerCase(), m]));

  const nowSec = Date.now() / 1000;
  const isAllTime = period === 'max';
  const daysNum = isAllTime ? 0 : Number(period) || 7;
  const fromDateStr = !isAllTime ? formatDateDDMMYYYY(nowSec - daysNum * 86400) : '';
  const toDateStr = formatDateDDMMYYYY(nowSec);

  const periodShort = isAllTime ? 'Total' : `${daysNum}d`;
  const periodBadgeLabel = isAllTime
    ? '🏛️ Histórico (Desde el principio de los tiempos)'
    : daysNum === 7
      ? '📅 Semanal (Últimos 7 días)'
      : daysNum === 30
        ? '📅 Mensual (Últimos 30 días)'
        : '📅 Últimos 3 meses (90 días)';

  const modeLabel = currentMode === 'rm_team' ? 'RM Team' : 'RM 1vs1';
  const subtitleText = isAllTime
    ? `Comparación histórica acumulada desde el principio de los tiempos en ${modeLabel} (estadísticas condensadas recicladas).`
    : `Comparación de civilizaciones y mapas jugados en los últimos ${daysNum} días (${fromDateStr} al ${toDateStr}) en ${modeLabel}.`;

  /**
   * Renderiza la tabla de Civilizaciones para una columna de jugador
   */
  function renderCivsTable(playerStats, otherCivLookup, playerName) {
    const civs = playerStats?.civs || [];
    const rows = civs.map((c, idx) => {
      const otherStat = otherCivLookup ? otherCivLookup.get(c.name.toLowerCase()) : null;
      const sharedBadge = otherStat
        ? `<span class="analytics-shared-tag" title="También jugada por el otro jugador (${otherStat.total} PJ • ${otherStat.winRate.toFixed(1)}% WR)">⚡ En común</span>`
        : '';

      return `
        <tr>
          <td><strong>#${idx + 1}</strong></td>
          <td>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <img src="${getCivIconUrl(c.name)}" class="table-civ-icon" alt="${c.name}">
              <strong>${c.name}</strong>
              ${sharedBadge}
            </div>
          </td>
          <td><strong>${c.total}</strong></td>
          <td><span class="green">${c.wins}W</span> / <span class="red">${c.losses}L</span></td>
          <td>
            <span class="${c.winRate >= 50 ? 'green' : 'red'}" style="font-weight:700;">${c.winRate.toFixed(1)}%</span>
            <div class="progress-bar-bg" style="width:90px;">
              <div class="progress-bar-fill" style="width:${c.winRate}%; background:${c.winRate >= 50 ? '#22c55e' : '#ef4444'};"></div>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="analytics-table-section">
        <h4 class="analytics-section-subtitle civs-color">
          <span>🛡️ Civilizaciones Jugadas (${civs.length})</span>
          <span class="analytics-period-tag">${periodShort}</span>
        </h4>
        <div class="analytics-table-scroll">
          <table class="matches-table analytics-compact-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Civilización</th>
                <th>PJ (${periodShort})</th>
                <th>V/D</th>
                <th>Winrate</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="5" style="text-align:center; padding:18px; color:#777;">Sin civilizaciones registradas para ${playerName} en este período</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  /**
   * Renderiza la tabla de Mapas para una columna de jugador
   */
  function renderMapsTable(playerStats, otherMapLookup, playerName) {
    const maps = playerStats?.maps || [];
    const rows = maps.map((m, idx) => {
      const mapIconHtml = m.mapImageUrl
        ? `<img src="${m.mapImageUrl}" class="table-map-icon" alt="${m.name}">`
        : '';
      const otherStat = otherMapLookup ? otherMapLookup.get(m.name.toLowerCase()) : null;
      const sharedBadge = otherStat
        ? `<span class="analytics-shared-tag" title="También jugado por el otro jugador (${otherStat.total} PJ • ${otherStat.winRate.toFixed(1)}% WR)">⚡ En común</span>`
        : '';

      return `
        <tr>
          <td><strong>#${idx + 1}</strong></td>
          <td>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              ${mapIconHtml}
              <strong>${m.name}</strong>
              ${sharedBadge}
            </div>
          </td>
          <td><strong>${m.total}</strong></td>
          <td><span class="green">${m.wins}W</span> / <span class="red">${m.losses}L</span></td>
          <td>
            <span class="${m.winRate >= 50 ? 'green' : 'red'}" style="font-weight:700;">${m.winRate.toFixed(1)}%</span>
            <div class="progress-bar-bg" style="width:90px;">
              <div class="progress-bar-fill" style="width:${m.winRate}%; background:${m.winRate >= 50 ? '#22c55e' : '#ef4444'};"></div>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="analytics-table-section">
        <h4 class="analytics-section-subtitle maps-color">
          <span>🗺️ Mapas Jugados (${maps.length})</span>
          <span class="analytics-period-tag">${periodShort}</span>
        </h4>
        <div class="analytics-table-scroll">
          <table class="matches-table analytics-compact-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Mapa</th>
                <th>PJ (${periodShort})</th>
                <th>V/D</th>
                <th>Winrate</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="5" style="text-align:center; padding:18px; color:#777;">Sin mapas registrados para ${playerName} en este período</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  /**
   * Renderiza la mitad vertical completa de un jugador (1/2 de pantalla)
   */
  function renderPlayerColumn(slotNum, playerObj, playerStats, otherCivLookup, otherMapLookup) {
    const isSlot2 = slotNum === 2;
    const selectId = isSlot2 ? 'analyticsPlayer2Select' : 'analyticsPlayer1Select';
    const accentClass = isSlot2 ? 'slot-right' : 'slot-left';

    const selectOptionsHtml = `
      ${isSlot2 ? `<option value="" ${!playerObj ? 'selected' : ''}>— Sin 2° jugador (Analizar solo 1) —</option>` : ''}
      ${sortedByName.map(p => `
        <option value="${p.profileId}" ${playerObj && playerObj.profileId === p.profileId ? 'selected' : ''}>
          ${p.name} (${p.currentElo} Elo)
        </option>
      `).join('')}
    `;

    if (!playerObj) {
      return `
        <div class="analytics-player-col ${accentClass} is-empty-slot">
          <div class="analytics-col-header">
            <div class="analytics-slot-selector-row">
              <span class="analytics-slot-badge ${accentClass}">👤 Jugador 2 (Opcional)</span>
              <select id="${selectId}" class="hm-exclude-select analytics-player-select">
                ${selectOptionsHtml}
              </select>
            </div>
          </div>
          <div class="analytics-empty-comparison">
            <div style="font-size:2.2rem; margin-bottom:8px;">⚖️</div>
            <h3>Comparar con un 2° Jugador</h3>
            <p>Seleccioná un jugador en el desplegable superior para comparar lado a lado sus mapas y civilizaciones contra <strong>${player1?.name || 'el Jugador 1'}</strong>.</p>
          </div>
        </div>
      `;
    }

    const topCiv = playerStats?.civs?.[0] || null;
    const topMap = playerStats?.maps?.[0] || null;
    const wrClass = (playerStats?.winRate || 0) >= 50 ? 'green' : 'red';

    let tablesHtml = '';
    if (activeSubView === 'civs') {
      tablesHtml = renderCivsTable(playerStats, otherCivLookup, playerObj.name);
    } else if (activeSubView === 'maps') {
      tablesHtml = renderMapsTable(playerStats, otherMapLookup, playerObj.name);
    } else {
      tablesHtml = `
        ${renderMapsTable(playerStats, otherMapLookup, playerObj.name)}
        <div style="height:18px;"></div>
        ${renderCivsTable(playerStats, otherCivLookup, playerObj.name)}
      `;
    }

    return `
      <div class="analytics-player-col ${accentClass}">
        <!-- Encabezado y selector del Jugador -->
        <div class="analytics-col-header">
          <div class="analytics-slot-selector-row">
            <span class="analytics-slot-badge ${accentClass}">👤 Jugador ${slotNum}</span>
            <select id="${selectId}" class="hm-exclude-select analytics-player-select">
              ${selectOptionsHtml}
            </select>
            ${isSlot2 ? `<button type="button" id="clearPlayer2Btn" class="btn" style="padding:4px 8px; font-size:0.78rem;" title="Quitar 2° jugador">✕</button>` : ''}
          </div>

          <div class="analytics-player-identity">
            <div style="display:flex; align-items:center; gap:10px; min-width:0;">
              <img src="${getFlagUrl(playerObj.country)}" class="card-flag" alt="${playerObj.country}">
              <button type="button" class="analytics-player-name-btn" data-profile-id="${playerObj.profileId}" title="Click para abrir perfil completo de ${playerObj.name}">
                ${playerObj.name}
              </button>
            </div>
            <div class="analytics-elo-pills">
              <span class="analytics-elo-pill current" title="ELO Actual en ${modeLabel}">⚡ ${playerObj.currentElo}</span>
              <span class="analytics-elo-pill max" title="ELO Máximo en ${modeLabel}">🏆 ${playerObj.maxElo}</span>
            </div>
          </div>

          <!-- Resumen de métricas en el período elegido -->
          <div class="analytics-kpis-grid">
            <div class="analytics-kpi-box">
              <span class="kpi-label">Partidas (${periodShort})</span>
              <span class="kpi-val">${playerStats?.totalGames || 0}</span>
            </div>
            <div class="analytics-kpi-box">
              <span class="kpi-label">Récord (V/D)</span>
              <span class="kpi-val"><span class="green">${playerStats?.totalWins || 0}W</span> / <span class="red">${playerStats?.totalLosses || 0}L</span></span>
            </div>
            <div class="analytics-kpi-box">
              <span class="kpi-label">Winrate (${periodShort})</span>
              <span class="kpi-val ${playerStats?.totalGames > 0 ? wrClass : ''}">${playerStats?.totalGames > 0 ? playerStats.winRate.toFixed(1) + '%' : '-'}</span>
            </div>
            <div class="analytics-kpi-box">
              <span class="kpi-label">Civ / Mapa Top</span>
              <span class="kpi-val kpi-favs">
                ${topCiv ? `<img src="${getCivIconUrl(topCiv.name)}" class="kpi-civ-icon" title="${topCiv.name} (${topCiv.total} PJ)">` : ''}
                <span>${topMap ? topMap.name : (topCiv ? topCiv.name : '-')}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- Tablas de Mapas y/o Civilizaciones -->
        <div class="analytics-col-body">
          ${tablesHtml}
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="view-container">
      <!-- Encabezado principal -->
      <div class="view-header-row">
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h2>⚖️ Analítica y Comparación de Jugadores (${modeLabel})</h2>
            <span class="weekly-period-badge">${periodBadgeLabel}</span>
          </div>
          <p class="subtitle">${subtitleText}</p>
        </div>

        <!-- Selector de Ventana de Tiempo (incluyendo Histórico) -->
        <div class="mode-toggle-group">
          <button class="mode-toggle-btn analytics-period-btn ${period === 7 ? 'active' : ''}" data-period="7" title="Últimos 7 días">
            Semanal
          </button>
          <button class="mode-toggle-btn analytics-period-btn ${period === 30 ? 'active' : ''}" data-period="30" title="Últimos 30 días">
            Mensual (30d)
          </button>
          <button class="mode-toggle-btn analytics-period-btn ${period === 90 ? 'active' : ''}" data-period="90" title="Últimos 90 días">
            Últimos 3 meses (90d)
          </button>
          <button class="mode-toggle-btn analytics-period-btn ${period === 'max' ? 'active' : ''}" data-period="max" title="Histórico desde el principio de los tiempos">
            🏛️ Histórico
          </button>
        </div>
      </div>

      <!-- Barra de herramientas: Vista (Mapas / Civs / Ambos), Modo (1v1 / Team) e Intercambio -->
      <div class="hm-filters-bar">
        <div style="display:flex; flex-wrap:wrap; gap:14px; align-items:center;">
          <div class="hm-filter-group">
            <span class="hm-filter-label">Mostrar:</span>
            <div class="mode-toggle-group">
              <button class="mode-toggle-btn analytics-subview-btn ${activeSubView === 'maps' ? 'active' : ''}" data-subview="maps">
                <span>🗺️</span> Mapas
              </button>
              <button class="mode-toggle-btn analytics-subview-btn ${activeSubView === 'civs' ? 'active' : ''}" data-subview="civs">
                <span>🛡️</span> Civilizaciones
              </button>
              <button class="mode-toggle-btn analytics-subview-btn ${activeSubView === 'both' ? 'active' : ''}" data-subview="both">
                <span>📊</span> Mapas + Civs
              </button>
            </div>
          </div>

          <div class="hm-filter-group">
            <span class="hm-filter-label">Modo:</span>
            <div class="mode-toggle-group">
              <button class="mode-toggle-btn analytics-mode-btn ${currentMode === 'rm_1v1' ? 'active' : ''}" data-mode="rm_1v1">
                <span>⚔️</span> RM 1vs1
              </button>
              <button class="mode-toggle-btn analytics-mode-btn ${currentMode === 'rm_team' ? 'active' : ''}" data-mode="rm_team">
                <span>🛡️</span> RM Team
              </button>
            </div>
          </div>
        </div>

        ${player1 && player2 ? `
          <button type="button" id="swapPlayersAnalyticsBtn" class="btn" style="font-size:0.85rem; padding:6px 12px;" title="Intercambiar Jugador 1 y Jugador 2">
            ⇄ Intercambiar lados
          </button>
        ` : ''}
      </div>

      <!-- Pantalla partida al medio: 1/2 izquierda Jugador 1 | 1/2 derecha Jugador 2 -->
      <div class="analytics-split-grid">
        ${renderPlayerColumn(1, player1, stats1, player2 ? p2CivMap : null, player2 ? p2MapMap : null)}
        ${renderPlayerColumn(2, player2, stats2, player1 ? p1CivMap : null, player1 ? p1MapMap : null)}
      </div>
    </div>
  `;

  // Listeners de período (7d, 30d, 90d, max)
  container.querySelectorAll('.analytics-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const raw = btn.dataset.period;
      const newPeriod = raw === 'max' ? 'max' : parseInt(raw, 10);
      if (newPeriod && newPeriod !== period && onConfigChange) {
        onConfigChange({ ...stateConfig, mode: currentMode, period: newPeriod, player1Id, player2Id });
      }
    });
  });

  // Listeners de subvista (Mapas / Civilizaciones / Ambos)
  container.querySelectorAll('.analytics-subview-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sv = btn.dataset.subview;
      if (sv && sv !== activeSubView) {
        activeSubView = sv;
        renderAnalyticsComparisonView(playersData, container, { ...stateConfig, mode: currentMode, period, player1Id, player2Id }, onConfigChange, onPlayerClick);
      }
    });
  });

  // Listeners de modo (RM 1v1 / RM Team)
  container.querySelectorAll('.analytics-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.mode;
      if (m && m !== currentMode && onConfigChange) {
        onConfigChange({ ...stateConfig, mode: m, period, player1Id, player2Id });
      }
    });
  });

  // Selector Jugador 1
  const select1 = container.querySelector('#analyticsPlayer1Select');
  if (select1) {
    select1.addEventListener('change', (e) => {
      const newP1 = parseInt(e.target.value, 10);
      if (newP1 && onConfigChange) {
        const nextP2 = player2Id === newP1 ? player1Id : player2Id;
        onConfigChange({ ...stateConfig, mode: currentMode, period, player1Id: newP1, player2Id: nextP2 });
      }
    });
  }

  // Selector Jugador 2
  const select2 = container.querySelector('#analyticsPlayer2Select');
  if (select2) {
    select2.addEventListener('change', (e) => {
      const val = e.target.value ? parseInt(e.target.value, 10) : null;
      if (onConfigChange) {
        onConfigChange({ ...stateConfig, mode: currentMode, period, player1Id, player2Id: val });
      }
    });
  }

  // Botón quitar Jugador 2
  const clearP2Btn = container.querySelector('#clearPlayer2Btn');
  if (clearP2Btn) {
    clearP2Btn.addEventListener('click', () => {
      if (onConfigChange) {
        onConfigChange({ ...stateConfig, mode: currentMode, period, player1Id, player2Id: null });
      }
    });
  }

  // Botón intercambiar lados
  const swapBtn = container.querySelector('#swapPlayersAnalyticsBtn');
  if (swapBtn && player1 && player2) {
    swapBtn.addEventListener('click', () => {
      if (onConfigChange) {
        onConfigChange({ ...stateConfig, mode: currentMode, period, player1Id: player2.profileId, player2Id: player1.profileId });
      }
    });
  }

  // Click en el nombre del jugador para abrir su modal detallado
  container.querySelectorAll('.analytics-player-name-btn[data-profile-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = parseInt(btn.dataset.profileId, 10);
      if (pid && onPlayerClick) {
        onPlayerClick(pid, currentMode);
      }
    });
  });
}
