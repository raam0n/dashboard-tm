import { CONFIG } from './config.js?v=20261029e';
import { 
  getActivePlayerIds, 
  getAllConfiguredPlayerIds, 
  getDisabledPlayerIds, 
  saveDisabledPlayerIds, 
  saveActivePlayerIds, 
  getPlayerStats,
  fetchProfile,
  fetchMatches,
  fetchGroupLiveMatches,
  fetchGroupBootstrap,
  buildPlayerStatsFromProfileAndMatches,
  getProfileOverallLastMatchDate,
  getProfileOverallLastMatchTimestamp,
  fetchGroupRecentMatches
} from './api.js?v=20261029e';
import { renderLiveBanner, renderPlayersGrid, showPlayerModal } from './dashboard.js?v=20261029e';
import { renderWeeklyView } from './weekly.js?v=20261029e';
import { renderCivsAndMapsView } from './civs-maps.js?v=20261029e';
import { renderRecentMatchesView } from './history.js?v=20261029e';

// Estado global de la aplicación
const state = {
  currentTab: 'rm_1v1', // 'rm_1v1' | 'rm_team' | 'history' | 'weekly' | 'civs'
  eloSortBy: 'current', // 'current' | 'max'
  viewMode: localStorage.getItem(CONFIG.STORAGE_KEY_VIEW_MODE) || 'grid', // 'grid' | 'list'
  weeklyMode: 'rm_1v1', // 'rm_1v1' | 'rm_team'
  civsMode: 'rm_1v1',   // 'rm_1v1' | 'rm_team'
  recentMatchesRaw: [],
  isLoadingHistory: false,
  historyFilters: {
    timeWindowHours: 48, // 48 horas por defecto
    mode: 'all',         // 'all' | 'rm_1v1' | 'rm_team' | 'other'
    excludedPlayerIds: [] // IDs a excluir del feed
  },
  playerIds: getActivePlayerIds(),
  playersData1v1: [],
  playersDataTeam: [],
  liveMatches: [],
  isLoading: false,
  pollTimer: null,
  loadGeneration: 0
};

// Referencias a elementos del DOM
const elements = {
  liveBannerContainer: document.getElementById('liveBannerContainer'),
  rankingToolbar: document.getElementById('rankingToolbar'),
  sortBtns: document.querySelectorAll('.elo-sort-btn'),
  viewBtns: document.querySelectorAll('.view-btn'),
  contentArea: document.getElementById('contentArea'),
  modalOverlay: document.getElementById('modalOverlay'),
  modalContainer: document.getElementById('modalContainer'),
  addPlayerModal: document.getElementById('addPlayerModal'),
  addPlayerInput: document.getElementById('addPlayerInput'),
  refreshBtn: document.getElementById('refreshBtn'),
  addPlayerBtn: document.getElementById('addPlayerBtn'),
  confirmAddBtn: document.getElementById('confirmAddBtn'),
  cancelAddBtn: document.getElementById('cancelAddBtn'),
  navTabs: document.querySelectorAll('.nav-tab'),
  // Personalización / Checklist de Jugadores
  managePlayersBtn: document.getElementById('managePlayersBtn'),
  managePlayersModal: document.getElementById('managePlayersModal'),
  closeManageBtn: document.getElementById('closeManageBtn'),
  playersChecklistContainer: document.getElementById('playersChecklistContainer'),
  searchPlayersListInput: document.getElementById('searchPlayersListInput'),
  selectAllPlayersBtn: document.getElementById('selectAllPlayersBtn'),
  deselectAllPlayersBtn: document.getElementById('deselectAllPlayersBtn'),
  resetDefaultPlayersBtn: document.getElementById('resetDefaultPlayersBtn'),
  applyPlayersListBtn: document.getElementById('applyPlayersListBtn'),
  checklistSummaryText: document.getElementById('checklistSummaryText'),
  activeCountBadge: document.getElementById('activeCountBadge')
};

/**
 * Inicialización
 */
async function init() {
  setupEventListeners();
  await loadAllData(false);
  startPolling();
}

/**
 * Configura los eventos de interacción
 */
function setupEventListeners() {
  // Fallback global para imágenes rotas (mapas o escudos) compatible con CSP
  document.addEventListener('error', (e) => {
    const el = e.target;
    if (!el || el.tagName !== 'IMG') return;
    if (el.classList.contains('match-map-icon')) {
      el.classList.add('hidden');
      if (el.nextElementSibling && el.nextElementSibling.classList.contains('map-diamond-fallback')) {
        el.nextElementSibling.classList.remove('hidden');
      }
    } else if (el.classList.contains('hm-map-img') || el.classList.contains('table-map-icon')) {
      el.classList.add('hidden');
    } else if (!el.dataset.fallbackApplied) {
      el.dataset.fallbackApplied = '1';
      el.src = 'assets/icons/logo-128.png';
    }
  }, true);

  // Cambio de solapas
  elements.navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      elements.navTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.currentTab = tab.dataset.tab;
      renderCurrentView();
    });
  });

  // Ordenar por ELO Actual vs ELO Máximo
  elements.sortBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.sortBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.eloSortBy = btn.dataset.sort;
      renderCurrentView();
    });
  });

  // Toggle de Vista: Bloques (grid) vs Lista (list)
  elements.viewBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === state.viewMode);
    btn.addEventListener('click', () => {
      elements.viewBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.viewMode = btn.dataset.view || 'grid';
      localStorage.setItem(CONFIG.STORAGE_KEY_VIEW_MODE, state.viewMode);
      renderCurrentView();
    });
  });

  // Botón refrescar
  elements.refreshBtn.addEventListener('click', async () => {
    elements.refreshBtn.disabled = true;
    elements.refreshBtn.innerHTML = '🔄 Cargando...';
    await loadAllData(true);
    elements.refreshBtn.disabled = false;
    elements.refreshBtn.innerHTML = '🔄 Refrescar';
  });

  // Modal agregar jugador
  elements.addPlayerBtn.addEventListener('click', () => {
    elements.addPlayerModal.classList.add('active');
    elements.addPlayerInput.value = '';
    elements.addPlayerInput.focus();
  });

  elements.cancelAddBtn.addEventListener('click', () => {
    elements.addPlayerModal.classList.remove('active');
  });

  elements.confirmAddBtn.addEventListener('click', async () => {
    const val = elements.addPlayerInput.value.trim();
    if (!val) return;
    const allConfigured = getAllConfiguredPlayerIds();
    const newIds = val.split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n) && !allConfigured.includes(n));

    if (newIds.length > 0) {
      allConfigured.push(...newIds);
      saveActivePlayerIds(allConfigured);
      // Aseguramos que los nuevos no estén deshabilitados
      const disabled = getDisabledPlayerIds().filter(id => !newIds.includes(id));
      saveDisabledPlayerIds(disabled);
      state.playerIds = getActivePlayerIds();
      elements.addPlayerModal.classList.remove('active');
      await loadAllData(true);
    } else {
      alert('Ingresa uno o varios IDs numéricos válidos (que no estén ya en la lista).');
    }
  });

  // Modal Personalizar / Tildar Jugadores
  elements.managePlayersBtn.addEventListener('click', () => {
    openManagePlayersModal();
  });

  elements.closeManageBtn.addEventListener('click', () => {
    elements.managePlayersModal.classList.remove('active');
  });

  elements.selectAllPlayersBtn.addEventListener('click', () => {
    elements.playersChecklistContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = true;
      cb.closest('.player-check-item').classList.add('checked');
    });
    updateChecklistSummary();
  });

  elements.deselectAllPlayersBtn.addEventListener('click', () => {
    elements.playersChecklistContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = false;
      cb.closest('.player-check-item').classList.remove('checked');
    });
    updateChecklistSummary();
  });

  elements.resetDefaultPlayersBtn.addEventListener('click', async () => {
    if (!confirm(`¿Deseas restaurar la lista oficial con los ${CONFIG.DEFAULT_PLAYERS.length} jugadores del grupo?`)) return;
    localStorage.removeItem(CONFIG.STORAGE_KEY_PLAYERS);
    localStorage.removeItem(CONFIG.STORAGE_KEY_DISABLED);
    state.playerIds = getActivePlayerIds();
    elements.managePlayersModal.classList.remove('active');
    await loadAllData(true);
  });

  elements.applyPlayersListBtn.addEventListener('click', async () => {
    const disabled = [];
    elements.playersChecklistContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      const pid = parseInt(cb.value, 10);
      if (!cb.checked) {
        disabled.push(pid);
      }
    });
    saveDisabledPlayerIds(disabled);
    state.playerIds = getActivePlayerIds();
    elements.managePlayersModal.classList.remove('active');
    await loadAllData(false);
  });

  elements.searchPlayersListInput.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    elements.playersChecklistContainer.querySelectorAll('.player-check-item').forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(q) ? 'flex' : 'none';
    });
  });

  // Cerrar modales al hacer clic en el fondo oscuro
  elements.modalOverlay.addEventListener('click', (e) => {
    if (e.target === elements.modalOverlay) {
      elements.modalOverlay.classList.remove('active');
    }
  });

  elements.addPlayerModal.addEventListener('click', (e) => {
    if (e.target === elements.addPlayerModal) {
      elements.addPlayerModal.classList.remove('active');
    }
  });

  elements.managePlayersModal.addEventListener('click', (e) => {
    if (e.target === elements.managePlayersModal) {
      elements.managePlayersModal.classList.remove('active');
    }
  });
}

/**
 * Sincroniza el estado "en vivo" entre 1v1, Team y la consulta grupal de partidas en curso.
 * Limpia correctamente `isPlayingNow` cuando una partida termina o es abandonada.
 */
function syncPlayingState(list1v1, listTeam, groupLiveMatches = []) {
  const liveMap = new Map();

  // Tomamos las partidas en curso verificadas de la consulta grupal
  (groupLiveMatches || []).forEach(m => {
    if (!m || m.abandoned || m.status === 'abandoned' || m.finished || !Array.isArray(m.allPlayers)) return;
    m.allPlayers.forEach(p => {
      if (p && p.profileId && !liveMap.has(p.profileId)) {
        liveMap.set(p.profileId, m);
      }
    });
  });

  // Aplicamos el estado a las tarjetas de 1v1 y Team (y limpiamos los que ya no están en vivo)
  [...list1v1, ...listTeam].forEach(p => {
    if (!p) return;
    if (liveMap.has(p.profileId)) {
      const liveMatch = liveMap.get(p.profileId);
      p.isPlayingNow = true;
      p.ongoingMatch = liveMatch;
      if (liveMatch.leaderboardId === p.leaderboardId) {
        p.isActiveLastMonth = true;
      }
    } else {
      p.isPlayingNow = false;
      p.ongoingMatch = null;
    }
  });
}

/**
 * Carga los datos de los jugadores en 2 fases:
 * - Fase 1 (Instantánea ~0.5s): 4 llamadas grupales en lote para renderizar el ranking y el banner live al instante.
 * - Fase 2 (Segundo plano): hidrata perfiles de inactivos faltantes y el historial de 20 partidas SOLO de los jugadores activos en el último mes.
 */
async function loadAllData(forceRefresh = false) {
  const myGen = ++state.loadGeneration;

  if (state.playersData1v1.length === 0 && state.playersDataTeam.length === 0) {
    state.isLoading = true;
    elements.contentArea.innerHTML = `
      <div class="loading-box">
        <div class="spinner"></div>
        <p>Cargando datos de ${state.playerIds.length} jugadores en tiempo real...</p>
      </div>
    `;
  }

  try {
    // FASE 1: Bootstrap grupal ultrarrápido
    const bootstrap = await fetchGroupBootstrap(state.playerIds, forceRefresh);
    if (myGen !== state.loadGeneration) return;

    state.liveMatches = bootstrap.liveMatches || [];
    state.recentMatchesRaw = bootstrap.groupMatches || [];
    state.playersData1v1 = bootstrap.initial1v1 || [];
    state.playersDataTeam = bootstrap.initialTeam || [];
    syncPlayingState(state.playersData1v1, state.playersDataTeam, state.liveMatches);

    state.isLoading = false;
    renderCurrentView();

    // FASE 2A: Completar perfiles de jugadores inactivos que no estaban en ambos leaderboards activos
    const missingProfileIds = bootstrap.missingProfileIds || [];
    const batchSize = 4;

    for (let i = 0; i < missingProfileIds.length; i += batchSize) {
      if (myGen !== state.loadGeneration) return;
      const batchIds = missingProfileIds.slice(i, i + batchSize);
      const profiles = await Promise.all(batchIds.map(id => fetchProfile(id, forceRefresh)));
      if (myGen !== state.loadGeneration) return;

      profiles.forEach(prof => {
        if (!prof || !prof.profileId) return;
        const idx1 = state.playersData1v1.findIndex(p => p.profileId === prof.profileId);
        if (idx1 !== -1) {
          const prev = state.playersData1v1[idx1];
          state.playersData1v1[idx1] = buildPlayerStatsFromProfileAndMatches(
            prof,
            CONFIG.LEADERBOARDS.RM_1V1,
            prev.matches,
            prev.matchesLoaded
          );
        }
        const idxT = state.playersDataTeam.findIndex(p => p.profileId === prof.profileId);
        if (idxT !== -1) {
          const prev = state.playersDataTeam[idxT];
          state.playersDataTeam[idxT] = buildPlayerStatsFromProfileAndMatches(
            prof,
            CONFIG.LEADERBOARDS.RM_TEAM,
            prev.matches,
            prev.matchesLoaded
          );
        }
      });

      syncPlayingState(state.playersData1v1, state.playersDataTeam, state.liveMatches);
      renderCurrentView();
      if (i + batchSize < missingProfileIds.length) {
        await new Promise(r => setTimeout(r, 180));
      }
    }

    // FASE 2B: Cargar el historial de 20 partidas ÚNICAMENTE para los jugadores activos en el último mes
    async function hydrateActiveLeaderboardMatches(targetList, leaderboardId) {
      const toHydrate = targetList.filter(p => p && p.isActiveLastMonth && (!p.matchesLoaded || forceRefresh));
      for (let i = 0; i < toHydrate.length; i += batchSize) {
        if (myGen !== state.loadGeneration) return;
        const batch = toHydrate.slice(i, i + batchSize);
        const matchesBatch = await Promise.all(
          batch.map(p => fetchMatches(p.profileId, leaderboardId, 20, forceRefresh))
        );
        if (myGen !== state.loadGeneration) return;

        batch.forEach((p, idx) => {
          const matches = matchesBatch[idx] || [];
          const listIdx = targetList.findIndex(item => item && item.profileId === p.profileId);
          if (listIdx !== -1) {
            targetList[listIdx] = buildPlayerStatsFromProfileAndMatches(
              targetList[listIdx].profile,
              leaderboardId,
              matches,
              true
            );
          }
        });

        syncPlayingState(state.playersData1v1, state.playersDataTeam, state.liveMatches);
        renderCurrentView();
        if (i + batchSize < toHydrate.length) {
          await new Promise(r => setTimeout(r, 180));
        }
      }
    }

    // Priorizamos la solapa que el usuario está viendo actualmente
    const prioritizeTeam = state.currentTab === 'rm_team' ||
      (state.currentTab === 'weekly' && state.weeklyMode === 'rm_team') ||
      (state.currentTab === 'civs' && state.civsMode === 'rm_team');

    if (prioritizeTeam) {
      await hydrateActiveLeaderboardMatches(state.playersDataTeam, CONFIG.LEADERBOARDS.RM_TEAM);
      await hydrateActiveLeaderboardMatches(state.playersData1v1, CONFIG.LEADERBOARDS.RM_1V1);
    } else {
      await hydrateActiveLeaderboardMatches(state.playersData1v1, CONFIG.LEADERBOARDS.RM_1V1);
      await hydrateActiveLeaderboardMatches(state.playersDataTeam, CONFIG.LEADERBOARDS.RM_TEAM);
    }
  } catch (err) {
    console.error('Error cargando datos de jugadores:', err);
  } finally {
    if (myGen === state.loadGeneration) {
      state.isLoading = false;
      renderCurrentView();
    }
  }
}

/**
 * Renderiza la vista según la solapa activa
 */
function renderCurrentView() {
  if (elements.activeCountBadge) {
    elements.activeCountBadge.textContent = state.playerIds.length;
  }

  // Siempre actualizamos el banner de live con las partidas que estén en curso (en 1v1 o Team)
  const allCurrent = [...state.playersData1v1, ...state.playersDataTeam];
  renderLiveBanner(allCurrent, elements.liveBannerContainer, state.liveMatches, state.playerIds, handlePlayerProfileClick);

  // Mostrar/ocultar barra de ordenamiento solo en solapas de ranking
  if (elements.rankingToolbar) {
    const isRankingTab = state.currentTab === 'rm_1v1' || state.currentTab === 'rm_team';
    elements.rankingToolbar.style.display = isRankingTab ? 'flex' : 'none';
  }

  if (state.isLoading) return;

  if (state.currentTab === 'rm_1v1') {
    elements.contentArea.className = state.viewMode === 'list' ? 'ranking-list-wrapper' : 'cards-grid';
    renderPlayersGrid(
      state.playersData1v1,
      elements.contentArea,
      onCardClick,
      onRemovePlayer,
      state.eloSortBy,
      CONFIG.LEADERBOARDS.RM_1V1,
      state.viewMode
    );
  } else if (state.currentTab === 'rm_team') {
    elements.contentArea.className = state.viewMode === 'list' ? 'ranking-list-wrapper' : 'cards-grid';
    renderPlayersGrid(
      state.playersDataTeam,
      elements.contentArea,
      onCardClick,
      onRemovePlayer,
      state.eloSortBy,
      CONFIG.LEADERBOARDS.RM_TEAM,
      state.viewMode
    );
  } else if (state.currentTab === 'history') {
    elements.contentArea.className = '';
    if ((!state.recentMatchesRaw || state.recentMatchesRaw.length === 0) && !state.isLoadingHistory) {
      state.isLoadingHistory = true;
      elements.contentArea.innerHTML = `
        <div class="loading-box">
          <div class="spinner"></div>
          <p>Cargando historial conjunto de partidas recientes...</p>
        </div>
      `;
      fetchGroupRecentMatches(state.playerIds, 100)
        .then(matches => {
          state.recentMatchesRaw = matches || [];
        })
        .catch(err => {
          console.warn('Error cargando historial grupal:', err);
        })
        .finally(() => {
          state.isLoadingHistory = false;
          if (state.currentTab === 'history') {
            renderRecentMatchesView(
              state.recentMatchesRaw,
              elements.contentArea,
              state.playerIds,
              handlePlayerProfileClick,
              state.historyFilters,
              (newFilters) => {
                state.historyFilters = newFilters;
                renderCurrentView();
              }
            );
          }
        });
      return;
    }

    renderRecentMatchesView(
      state.recentMatchesRaw,
      elements.contentArea,
      state.playerIds,
      handlePlayerProfileClick,
      state.historyFilters,
      (newFilters) => {
        state.historyFilters = newFilters;
        renderCurrentView();
      }
    );
  } else if (state.currentTab === 'weekly') {
    elements.contentArea.className = '';
    const data = state.weeklyMode === 'rm_team' ? state.playersDataTeam : state.playersData1v1;
    renderWeeklyView(data, elements.contentArea, state.weeklyMode, (newMode) => {
      state.weeklyMode = newMode;
      renderCurrentView();
    });
  } else if (state.currentTab === 'civs') {
    elements.contentArea.className = '';
    const data = state.civsMode === 'rm_team' ? state.playersDataTeam : state.playersData1v1;
    renderCivsAndMapsView(data, elements.contentArea, state.civsMode, (newMode) => {
      state.civsMode = newMode;
      renderCurrentView();
    });
  }
}

/**
 * Abre el modal con las estadísticas de un jugador (carga su historial bajo demanda si estaba inactivo)
 */
async function onCardClick(player) {
  if (!player) return;

  if (!player.matchesLoaded) {
    elements.modalContainer.innerHTML = `
      <button class="modal-close" id="modalCloseBtn">&times;</button>
      <div class="loading-box" style="padding: 40px 20px;">
        <div class="spinner"></div>
        <p>Cargando historial de ${player.name}...</p>
      </div>
    `;
    elements.modalOverlay.classList.add('active');
    const closeBtn = document.getElementById('modalCloseBtn');
    if (closeBtn) {
      closeBtn.onclick = () => elements.modalOverlay.classList.remove('active');
    }

    const fullStats = await getPlayerStats(player.profileId, player.leaderboardId, false, true);
    if (fullStats) {
      const targetList = player.leaderboardId === CONFIG.LEADERBOARDS.RM_TEAM
        ? state.playersDataTeam
        : state.playersData1v1;
      const idx = targetList.findIndex(p => p && p.profileId === player.profileId);
      if (idx !== -1) {
        targetList[idx] = fullStats;
        syncPlayingState(state.playersData1v1, state.playersDataTeam, state.liveMatches);
      }
      showPlayerModal(fullStats, elements.modalContainer, elements.modalOverlay);
      return;
    }
  }

  showPlayerModal(player, elements.modalContainer, elements.modalOverlay);
}

/**
 * Abre el modal con las estadísticas de un jugador a partir de su profileId
 * (útil para compañeros o rivales al clickearlos en el Live Banner o en el historial)
 */
async function handlePlayerProfileClick(profileId, leaderboardId = 'rm_1v1') {
  if (!profileId) return;

  const targetLb = (state.currentTab === 'rm_team') ? 'rm_team' : (leaderboardId || 'rm_1v1');
  const pool = targetLb === 'rm_team' ? state.playersDataTeam : state.playersData1v1;
  const altPool = targetLb === 'rm_team' ? state.playersData1v1 : state.playersDataTeam;
  const found = pool.find(p => p && p.profileId === profileId) || altPool.find(p => p && p.profileId === profileId);

  if (found) {
    await onCardClick(found);
    return;
  }

  // Si no está en memoria, mostramos modal con loading y lo consultamos a la API
  elements.modalContainer.innerHTML = `
    <button class="modal-close" id="modalCloseBtn">&times;</button>
    <div class="loading-box" style="padding: 40px 20px;">
      <div class="spinner"></div>
      <p>Cargando estadísticas del jugador...</p>
    </div>
  `;
  elements.modalOverlay.classList.add('active');
  const closeBtn = document.getElementById('modalCloseBtn');
  if (closeBtn) {
    closeBtn.onclick = () => elements.modalOverlay.classList.remove('active');
  }

  const stats = await getPlayerStats(profileId, targetLb, false, true);
  if (stats) {
    showPlayerModal(stats, elements.modalContainer, elements.modalOverlay);
  } else {
    alert('No se pudo cargar el perfil del jugador.');
    elements.modalOverlay.classList.remove('active');
  }
}

/**
 * Convierte una fecha dd/mm/yyyy en un entero comparable YYYYMMDD (o 0 si no es válida)
 */
function dateStrToSortableInt(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return 0;
  const m = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return 0;
  return parseInt(`${m[3]}${m[2]}${m[1]}`, 10) || 0;
}

/**
 * Ordena los elementos del checklist en el DOM por fecha de última partida descendente
 */
function sortChecklistItemsDom() {
  const items = Array.from(elements.playersChecklistContainer.querySelectorAll('.player-check-item'));
  items.sort((a, b) => {
    const dateTextA = a.querySelector('.player-check-lastmatch')?.textContent || '';
    const dateTextB = b.querySelector('.player-check-lastmatch')?.textContent || '';
    const dayIntA = dateStrToSortableInt(dateTextA);
    const dayIntB = dateStrToSortableInt(dateTextB);
    if (dayIntB !== dayIntA) return dayIntB - dayIntA;

    const tsA = Number(a.dataset.lastmatchTs ?? -1);
    const tsB = Number(b.dataset.lastmatchTs ?? -1);
    if (tsB !== tsA) return tsB - tsA;

    const nameA = (a.querySelector('.player-check-name')?.textContent || '').toLowerCase();
    const nameB = (b.querySelector('.player-check-name')?.textContent || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });
  items.forEach(item => elements.playersChecklistContainer.appendChild(item));
}

/**
 * Abre el modal para gestionar / tildar jugadores
 */
function openManagePlayersModal() {
  const allConfigured = getAllConfiguredPlayerIds();
  const disabledIds = getDisabledPlayerIds();
  
  // Mapa de nombres predeterminados conocidos, fecha de última partida y timestamp
  const nameMap = new Map();
  const lastMatchMap = new Map();
  const lastMatchTsMap = new Map();
  CONFIG.DEFAULT_PLAYERS.forEach(p => nameMap.set(p.id, p.name));
  
  // También usamos los nombres y fechas que ya hayamos cargado de la API
  [...state.playersData1v1, ...state.playersDataTeam].forEach(p => {
    if (p && p.profileId) {
      if (p.name) nameMap.set(p.profileId, p.name);
      const ts = p.overallLastMatchTimestamp || 0;
      const dateStr = p.overallLastMatchDate || p.lastMatchDate || 'Sin registro';
      const prevTs = lastMatchTsMap.get(p.profileId) ?? -1;
      if (ts > prevTs) {
        lastMatchTsMap.set(p.profileId, ts);
        lastMatchMap.set(p.profileId, dateStr);
      } else if (!lastMatchMap.has(p.profileId)) {
        lastMatchMap.set(p.profileId, dateStr);
      }
    }
  });

  // Ordenamos inicialmente por fecha de última partida descendente
  const sortedIds = [...allConfigured].sort((a, b) => {
    const dayIntA = dateStrToSortableInt(lastMatchMap.get(a));
    const dayIntB = dateStrToSortableInt(lastMatchMap.get(b));
    if (dayIntB !== dayIntA) return dayIntB - dayIntA;

    const tsA = lastMatchTsMap.get(a) ?? -1;
    const tsB = lastMatchTsMap.get(b) ?? -1;
    if (tsB !== tsA) return tsB - tsA;

    const nameA = (nameMap.get(a) || '').toLowerCase();
    const nameB = (nameMap.get(b) || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });

  elements.playersChecklistContainer.innerHTML = sortedIds.map(id => {
    const isChecked = !disabledIds.includes(id);
    const playerName = nameMap.get(id) || `Jugador #${id}`;
    const lastMatchStr = lastMatchMap.get(id) || 'Cargando...';
    const lastMatchTs = lastMatchTsMap.get(id) ?? -1;
    return `
      <label class="player-check-item ${isChecked ? 'checked' : ''}" data-item-id="${id}" data-lastmatch-ts="${lastMatchTs}">
        <input type="checkbox" value="${id}" ${isChecked ? 'checked' : ''}>
        <div class="player-check-info">
          <span class="player-check-name" data-name-id="${id}" title="${playerName}">${playerName}</span>
          <span class="player-check-id">ID: ${id} • <span class="player-check-lastmatch" data-lastmatch-id="${id}">Últ. partida: ${lastMatchStr}</span></span>
        </div>
      </label>
    `;
  }).join('');

  // Si algún jugador (ej. destildado o aún cargando) no tenía su perfil en memoria, lo consultamos y reordenamos por fecha descendente
  sortedIds.forEach(async (id) => {
    if (!lastMatchMap.has(id)) {
      const prof = await fetchProfile(id, false);
      const dateStr = prof ? getProfileOverallLastMatchDate(prof) : 'Sin registro';
      const ts = prof ? getProfileOverallLastMatchTimestamp(prof) : 0;
      const itemEl = elements.playersChecklistContainer.querySelector(`[data-item-id="${id}"]`);
      if (itemEl) itemEl.dataset.lastmatchTs = String(ts);
      const spanEl = elements.playersChecklistContainer.querySelector(`[data-lastmatch-id="${id}"]`);
      if (spanEl) spanEl.textContent = `Últ. partida: ${dateStr}`;
      if (prof && prof.name) {
        const nameEl = elements.playersChecklistContainer.querySelector(`[data-name-id="${id}"]`);
        if (nameEl) {
          nameEl.textContent = prof.name;
          nameEl.title = prof.name;
        }
      }
      sortChecklistItemsDom();
    }
  });

  elements.playersChecklistContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.closest('.player-check-item').classList.toggle('checked', cb.checked);
      updateChecklistSummary();
    });
  });

  elements.searchPlayersListInput.value = '';
  updateChecklistSummary();
  elements.managePlayersModal.classList.add('active');
}

/**
 * Actualiza el contador de seleccionados en el modal
 */
function updateChecklistSummary() {
  const total = elements.playersChecklistContainer.querySelectorAll('input[type="checkbox"]').length;
  const checked = elements.playersChecklistContainer.querySelectorAll('input[type="checkbox"]:checked').length;
  elements.checklistSummaryText.textContent = `${checked} de ${total} seleccionados`;
}

/**
 * Quita un jugador de la lista (lo oculta/destilda)
 */
async function onRemovePlayer(profileId) {
  if (!confirm('¿Deseas ocultar este jugador del dashboard? Podrás volver a tildarlo en cualquier momento desde el botón "👥 Jugadores".')) return;
  const disabled = getDisabledPlayerIds();
  if (!disabled.includes(profileId)) {
    disabled.push(profileId);
    saveDisabledPlayerIds(disabled);
  }
  state.playerIds = getActivePlayerIds();
  state.playersData1v1 = state.playersData1v1.filter(p => p.profileId !== profileId);
  state.playersDataTeam = state.playersDataTeam.filter(p => p.profileId !== profileId);
  renderCurrentView();
}

/**
 * Polling liviano para chequear partidas en vivo cada 30s (1 sola petición grupal).
 * Solo refresca estadísticas individuales si un jugador acaba de terminar su partida en vivo.
 */
function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try {
      // Recordamos quiénes estaban jugando antes de esta consulta
      const prevPlayingIds = new Set();
      [...state.playersData1v1, ...state.playersDataTeam].forEach(p => {
        if (p && p.isPlayingNow) prevPlayingIds.add(p.profileId);
      });

      // 1 sola llamada grupal para ver partidas en vivo actuales
      const liveMatches = await fetchGroupLiveMatches(state.playerIds);
      state.liveMatches = liveMatches || [];
      syncPlayingState(state.playersData1v1, state.playersDataTeam, state.liveMatches);

      // Si la solapa activa es 'history', refrescamos el feed en segundo plano
      if (state.currentTab === 'history') {
        fetchGroupRecentMatches(state.playerIds, 100).then(matches => {
          if (matches && matches.length > 0) {
            state.recentMatchesRaw = matches;
            renderCurrentView();
          }
        }).catch(() => {});
      }

      // Si algún jugador que estaba en vivo terminó su partida, refrescamos únicamente a ese jugador
      const nowPlayingIds = new Set();
      [...state.playersData1v1, ...state.playersDataTeam].forEach(p => {
        if (p && p.isPlayingNow) nowPlayingIds.add(p.profileId);
      });

      const finishedPlayingIds = [...prevPlayingIds].filter(id => !nowPlayingIds.has(id));
      for (const pid of finishedPlayingIds) {
        const [updated1v1, updatedTeam] = await Promise.all([
          getPlayerStats(pid, CONFIG.LEADERBOARDS.RM_1V1, true),
          getPlayerStats(pid, CONFIG.LEADERBOARDS.RM_TEAM, true)
        ]);
        if (updated1v1) {
          const idx1 = state.playersData1v1.findIndex(p => p && p.profileId === pid);
          if (idx1 !== -1) state.playersData1v1[idx1] = updated1v1;
        }
        if (updatedTeam) {
          const idxT = state.playersDataTeam.findIndex(p => p && p.profileId === pid);
          if (idxT !== -1) state.playersDataTeam[idxT] = updatedTeam;
        }
      }

      syncPlayingState(state.playersData1v1, state.playersDataTeam, state.liveMatches);
      renderCurrentView();
    } catch (err) {
      console.warn('Error en polling:', err);
    }
  }, CONFIG.POLL_INTERVAL_MS);
}

// Iniciar app al cargar la ventana
window.addEventListener('DOMContentLoaded', init);
