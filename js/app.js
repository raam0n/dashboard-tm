import { CONFIG } from './config.js';
import { getActivePlayerIds, saveActivePlayerIds, getPlayerStats } from './api.js';
import { renderLiveBanner, renderPlayersGrid, showPlayerModal } from './dashboard.js';
import { renderWeeklyView } from './weekly.js';
import { renderCivsAndMapsView } from './civs-maps.js';

// Estado global de la aplicación
const state = {
  currentTab: 'rm_1v1', // 'rm_1v1' | 'rm_team' | 'weekly' | 'civs'
  weeklyMode: 'rm_1v1', // 'rm_1v1' | 'rm_team'
  civsMode: 'rm_1v1',   // 'rm_1v1' | 'rm_team'
  playerIds: getActivePlayerIds(),
  playersData1v1: [],
  playersDataTeam: [],
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
  navTabs: document.querySelectorAll('.nav-tab')
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
    const newIds = val.split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n) && !state.playerIds.includes(n));

    if (newIds.length > 0) {
      state.playerIds.push(...newIds);
      saveActivePlayerIds(state.playerIds);
      elements.addPlayerModal.classList.remove('active');
      await loadAllData(true);
    } else {
      alert('Ingresa un ID numérico de jugador válido (que no esté ya en la lista).');
    }
  });

  // Cerrar modal al hacer clic en el fondo oscuro
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
    const promises1v1 = state.playerIds.map(id => getPlayerStats(id, CONFIG.LEADERBOARDS.RM_1V1, forceRefresh));
    const promisesTeam = state.playerIds.map(id => getPlayerStats(id, CONFIG.LEADERBOARDS.RM_TEAM, forceRefresh));

    const [data1v1, dataTeam] = await Promise.all([
      Promise.all(promises1v1),
      Promise.all(promisesTeam)
    ]);

    state.playersData1v1 = data1v1.filter(Boolean);
    state.playersDataTeam = dataTeam.filter(Boolean);
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
  // Siempre actualizamos el banner de live con las partidas que estén en curso (en 1v1 o Team)
  const allCurrent = [...state.playersData1v1, ...state.playersDataTeam];
  renderLiveBanner(allCurrent, elements.liveBannerContainer);

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
 * Quita un jugador de la lista
 */
async function onRemovePlayer(profileId) {
  if (!confirm('¿Deseas quitar este jugador de la lista?')) return;
  state.playerIds = state.playerIds.filter(id => id !== profileId);
  saveActivePlayerIds(state.playerIds);
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
      // Actualizamos en segundo plano tanto 1v1 como Team
      const promises1v1 = state.playerIds.map(id => getPlayerStats(id, CONFIG.LEADERBOARDS.RM_1V1, true));
      const promisesTeam = state.playerIds.map(id => getPlayerStats(id, CONFIG.LEADERBOARDS.RM_TEAM, true));
      const [res1v1, resTeam] = await Promise.all([
        Promise.all(promises1v1),
        Promise.all(promisesTeam)
      ]);
      state.playersData1v1 = res1v1.filter(Boolean);
      state.playersDataTeam = resTeam.filter(Boolean);
      renderCurrentView();
    } catch (err) {
      console.warn('Error en polling:', err);
    }
  }, CONFIG.POLL_INTERVAL_MS);
}

// Iniciar app al cargar la ventana
window.addEventListener('DOMContentLoaded', init);
