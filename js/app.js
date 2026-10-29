import { CONFIG } from './config.js?v=20261028c';
import { 
  getActivePlayerIds, 
  getAllConfiguredPlayerIds, 
  getDisabledPlayerIds, 
  saveDisabledPlayerIds, 
  saveActivePlayerIds, 
  getPlayerStats,
  fetchProfile,
  fetchGroupLiveMatches,
  getProfileOverallLastMatchDate,
  getProfileOverallLastMatchTimestamp
} from './api.js?v=20261028c';
import { renderLiveBanner, renderPlayersGrid, showPlayerModal } from './dashboard.js?v=20261028c';
import { renderWeeklyView } from './weekly.js?v=20261028c';
import { renderCivsAndMapsView } from './civs-maps.js?v=20261028c';

// Estado global de la aplicación
const state = {
  currentTab: 'rm_1v1', // 'rm_1v1' | 'rm_team' | 'weekly' | 'civs'
  weeklyMode: 'rm_1v1', // 'rm_1v1' | 'rm_team'
  civsMode: 'rm_1v1',   // 'rm_1v1' | 'rm_team'
  playerIds: getActivePlayerIds(),
  playersData1v1: [],
  playersDataTeam: [],
  liveMatches: [],
  isLoading: false,
  pollTimer: null
};

// Referencias a elementos del DOM
const elements = {
  liveBannerContainer: document.getElementById('liveBannerContainer'),
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
  // Cambio de solapas
  elements.navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      elements.navTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.currentTab = tab.dataset.tab;
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
 * Sincroniza el estado "en vivo" entre 1v1, Team y la consulta grupal de partidas en curso
 * para que las tarjetas muestren "Live now" sin importar en qué modo esté jugando el jugador.
 */
function syncPlayingState(list1v1, listTeam, groupLiveMatches = []) {
  const liveMap = new Map();

  // Primero tomamos todas las partidas en curso de la consulta grupal directa
  (groupLiveMatches || []).forEach(m => {
    if (!m || !Array.isArray(m.allPlayers)) return;
    m.allPlayers.forEach(p => {
      if (p && p.profileId && !liveMap.has(p.profileId)) {
        liveMap.set(p.profileId, m);
      }
    });
  });

  // También sumamos cualquier partida en curso detectada individualmente
  [...list1v1, ...listTeam].forEach(p => {
    if (p && p.isPlayingNow && p.ongoingMatch) {
      liveMap.set(p.profileId, p.ongoingMatch);
    }
  });

  // Aplicamos el estado a las tarjetas de 1v1 y Team
  [...list1v1, ...listTeam].forEach(p => {
    if (!p) return;
    if (liveMap.has(p.profileId)) {
      p.isPlayingNow = true;
      p.ongoingMatch = liveMap.get(p.profileId);
    }
  });
}

/**
 * Carga los datos de todos los jugadores para 1v1 y Team
 */
async function loadAllData(forceRefresh = false) {
  state.isLoading = true;
  elements.contentArea.innerHTML = `
    <div class="loading-box">
      <div class="spinner"></div>
      <p>Cargando datos de ${state.playerIds.length} jugadores en tiempo real...</p>
    </div>
  `;

  try {
    // 1. Consultamos primero y en 1 sola llamada todas las partidas en curso del grupo
    fetchGroupLiveMatches(state.playerIds).then(liveMatches => {
      state.liveMatches = liveMatches || [];
      const allCurrent = [...state.playersData1v1, ...state.playersDataTeam];
      renderLiveBanner(allCurrent, elements.liveBannerContainer, state.liveMatches, state.playerIds);
    });

    // 2. Cargamos los jugadores en lotes de a 6 para evitar rate-limiting de Cloudflare cuando son muchos jugadores
    const data1v1 = [];
    const dataTeam = [];
    const batchSize = 6;

    for (let i = 0; i < state.playerIds.length; i += batchSize) {
      const batchIds = state.playerIds.slice(i, i + batchSize);
      const [batch1v1, batchTeam] = await Promise.all([
        Promise.all(batchIds.map(id => getPlayerStats(id, CONFIG.LEADERBOARDS.RM_1V1, forceRefresh))),
        Promise.all(batchIds.map(id => getPlayerStats(id, CONFIG.LEADERBOARDS.RM_TEAM, forceRefresh)))
      ]);
      data1v1.push(...batch1v1.filter(Boolean));
      dataTeam.push(...batchTeam.filter(Boolean));
    }

    state.playersData1v1 = data1v1;
    state.playersDataTeam = dataTeam;
    syncPlayingState(state.playersData1v1, state.playersDataTeam, state.liveMatches);
  } catch (err) {
    console.error('Error cargando datos de jugadores:', err);
  } finally {
    state.isLoading = false;
    renderCurrentView();
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
  renderLiveBanner(allCurrent, elements.liveBannerContainer, state.liveMatches, state.playerIds);

  if (state.isLoading) return;

  if (state.currentTab === 'rm_1v1') {
    elements.contentArea.className = 'cards-grid';
    renderPlayersGrid(
      state.playersData1v1,
      elements.contentArea,
      onCardClick,
      onRemovePlayer
    );
  } else if (state.currentTab === 'rm_team') {
    elements.contentArea.className = 'cards-grid';
    renderPlayersGrid(
      state.playersDataTeam,
      elements.contentArea,
      onCardClick,
      onRemovePlayer
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
 * Abre el modal con las estadísticas de un jugador
 */
function onCardClick(player) {
  showPlayerModal(player, elements.modalContainer, elements.modalOverlay);
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
 * Polling para chequear partidas en vivo periódicamente
 */
function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    console.log('🔄 Verificando estado en vivo de jugadores...');
    try {
      const liveMatches = await fetchGroupLiveMatches(state.playerIds);
      state.liveMatches = liveMatches || [];

      const data1v1 = [];
      const dataTeam = [];
      const batchSize = 6;
      for (let i = 0; i < state.playerIds.length; i += batchSize) {
        const batchIds = state.playerIds.slice(i, i + batchSize);
        const [b1v1, bTeam] = await Promise.all([
          Promise.all(batchIds.map(id => getPlayerStats(id, CONFIG.LEADERBOARDS.RM_1V1, true))),
          Promise.all(batchIds.map(id => getPlayerStats(id, CONFIG.LEADERBOARDS.RM_TEAM, true)))
        ]);
        data1v1.push(...b1v1.filter(Boolean));
        dataTeam.push(...bTeam.filter(Boolean));
      }

      state.playersData1v1 = data1v1;
      state.playersDataTeam = dataTeam;
      syncPlayingState(state.playersData1v1, state.playersDataTeam, state.liveMatches);
      renderCurrentView();
    } catch (err) {
      console.warn('Error en polling:', err);
    }
  }, CONFIG.POLL_INTERVAL_MS);
}

// Iniciar app al cargar la ventana
window.addEventListener('DOMContentLoaded', init);
