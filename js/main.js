/**
 * Main application entry point for ethspec.tools
 * Handles mode switching between specs and tests viewers
 */

import { initDarkMode } from './darkMode.js';
import { initResizable } from './resizable.js';

// Application state
const state = {
  mode: 'specs', // 'specs' or 'tests'
  specsModule: null,
  testsModule: null,
  specsInitialized: false,
  testsInitialized: false,
  specsSearch: '',
  testsSearch: '',
  specsSelectedItem: null,
  testsSelectedItem: null
};

// Storage keys for remembering versions per mode
const SPECS_VERSION_KEY = 'ethspec-tools-specs-version';
const TESTS_VERSION_KEY = 'ethspec-tools-tests-version';

/**
 * Parse URL hash to determine mode and path
 * Format: #specs/... or #tests/...
 */
function parseHash() {
  const hash = window.location.hash.substring(1);
  if (!hash) {
    return { mode: 'specs', path: '' };
  }

  if (hash.startsWith('tests/') || hash === 'tests') {
    return { mode: 'tests', path: hash.substring(6) };
  }

  // Default to specs mode
  if (hash.startsWith('specs/')) {
    return { mode: 'specs', path: hash.substring(6) };
  }

  // Legacy support: if no mode prefix, assume specs
  return { mode: 'specs', path: hash };
}

/**
 * Update URL hash for current mode
 */
function updateHash(mode, path = '') {
  const newHash = path ? `#${mode}/${path}` : `#${mode}/`;
  if (window.location.hash !== newHash) {
    history.replaceState(null, '', newHash);
  }
}

/**
 * Switch between specs and tests mode
 */
async function switchMode(newMode) {
  if (state.mode === newMode) return;

  // Save current state before switching
  const searchInput = document.getElementById('searchInput');
  const activeLabel = document.querySelector('.tree-label.active');

  if (state.mode === 'specs') {
    state.specsSearch = searchInput.value;
    state.specsSelectedItem = activeLabel ? activeLabel.closest('.tree-node')?.dataset.name : null;
  } else {
    state.testsSearch = searchInput.value;
    state.testsSelectedItem = activeLabel ? activeLabel.closest('.tree-node')?.dataset.testPath : null;
  }

  state.mode = newMode;

  // Update body class for CSS mode visibility
  document.body.classList.remove('mode-specs', 'mode-tests');
  document.body.classList.add(`mode-${newMode}`);

  // Update toggle buttons
  document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === newMode);
  });

  // Restore search for new mode
  const savedSearch = newMode === 'specs' ? state.specsSearch : state.testsSearch;
  searchInput.placeholder = newMode === 'specs' ? 'Search specifications...' : 'Search tests...';
  searchInput.value = savedSearch;
  document.getElementById('searchClear').classList.toggle('hidden', !savedSearch);

  // Clear tree
  document.getElementById('tree').innerHTML = '';

  // Clear filter containers
  document.getElementById('forkFilters').innerHTML = '';
  document.getElementById('typeFilters').innerHTML = '';
  document.getElementById('presetFilters').innerHTML = '';
  document.getElementById('runnerFilters').innerHTML = '';

  // Hide all viewers, show welcome
  document.getElementById('welcome').classList.remove('hidden');
  document.getElementById('specViewer').classList.add('hidden');
  document.getElementById('testViewer').classList.add('hidden');
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');

  // Load and initialize the appropriate module
  if (newMode === 'specs') {
    await initSpecsMode(savedSearch, state.specsSelectedItem);
  } else {
    await initTestsMode(savedSearch, state.testsSelectedItem);
  }

  // Update URL
  updateHash(newMode);
}

/**
 * Initialize specs mode
 */
async function initSpecsMode(searchTerm = '', selectedItem = null) {
  if (!state.specsModule) {
    // Dynamically import specs module
    state.specsModule = await import('./specs/specsMain.js');
  }

  // Get saved version or default
  const savedVersion = localStorage.getItem(SPECS_VERSION_KEY);

  // Initialize or reinitialize
  await state.specsModule.init(savedVersion, searchTerm, selectedItem);
  state.specsInitialized = true;
}

/**
 * Initialize tests mode
 */
async function initTestsMode(searchTerm = '', selectedItem = null) {
  if (!state.testsModule) {
    // Dynamically import tests module
    state.testsModule = await import('./tests/testsMain.js');
  }

  // Get saved version or default
  const savedVersion = localStorage.getItem(TESTS_VERSION_KEY);

  // Initialize or reinitialize
  await state.testsModule.init(savedVersion, searchTerm, selectedItem);
  state.testsInitialized = true;
}

/**
 * Initialize mode toggle buttons
 */
function initModeToggle() {
  document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      switchMode(mode);
    });
  });
}

/**
 * Initialize the application
 */
async function init() {
  // Initialize shared functionality
  initDarkMode();
  initResizable();
  initModeToggle();

  // Parse URL to determine initial mode
  const { mode, path } = parseHash();

  // Set initial body class
  document.body.classList.add(`mode-${mode}`);

  // Update toggle buttons for initial state
  document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Set state
  state.mode = mode;

  // Initialize the appropriate mode
  if (mode === 'specs') {
    await initSpecsMode();
    // Handle deep link if present
    if (path && state.specsModule.handleDeepLink) {
      state.specsModule.handleDeepLink(path);
    }
  } else {
    await initTestsMode();
    // Handle deep link if present
    if (path && state.testsModule.handleDeepLink) {
      state.testsModule.handleDeepLink(path);
    }
  }
}

// Export for use by mode modules
export function saveSpecsVersion(version) {
  localStorage.setItem(SPECS_VERSION_KEY, version);
}

export function saveTestsVersion(version) {
  localStorage.setItem(TESTS_VERSION_KEY, version);
}

export function getCurrentMode() {
  return state.mode;
}

export { updateHash };

// Start the application
init();
