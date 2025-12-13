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
  specsHasSelection: false,
  testsHasSelection: false
};

// Storage keys for remembering versions per mode
const SPECS_VERSION_KEY = 'ethspec-tools-specs-version';
const TESTS_VERSION_KEY = 'ethspec-tools-tests-version';

/**
 * Initialize search functionality (centralized for both modes)
 */
function initSearch() {
  const searchInput = document.getElementById('searchInput');
  const searchClear = document.getElementById('searchClear');

  let debounceTimer;

  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);

    const hasText = searchInput.value.length > 0;
    searchClear.classList.toggle('hidden', !hasText);

    debounceTimer = setTimeout(() => {
      const searchTerm = searchInput.value.toLowerCase();

      // Update state and filter the appropriate tree
      if (state.mode === 'specs') {
        state.specsSearch = searchInput.value;
        if (state.specsModule && state.specsModule.applySearch) {
          state.specsModule.applySearch(searchTerm);
        }
      } else {
        state.testsSearch = searchInput.value;
        if (state.testsModule && state.testsModule.applySearch) {
          state.testsModule.applySearch(searchTerm);
        }
      }
    }, 150);
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.classList.add('hidden');

    if (state.mode === 'specs') {
      state.specsSearch = '';
      if (state.specsModule && state.specsModule.applySearch) {
        state.specsModule.applySearch('');
      }
    } else {
      state.testsSearch = '';
      if (state.testsModule && state.testsModule.applySearch) {
        state.testsModule.applySearch('');
      }
    }
  });
}

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
 * Uses CSS visibility toggle for instant switching (like browser tabs)
 */
async function switchMode(newMode) {
  if (state.mode === newMode) return;

  // Save current search before switching
  const searchInput = document.getElementById('searchInput');
  if (state.mode === 'specs') {
    state.specsSearch = searchInput.value;
  } else {
    state.testsSearch = searchInput.value;
  }

  state.mode = newMode;

  // Update body class for CSS mode visibility (this handles sidebar toggle instantly)
  document.body.classList.remove('mode-specs', 'mode-tests');
  document.body.classList.add(`mode-${newMode}`);

  // Update toggle buttons
  document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === newMode);
  });

  // Restore search for new mode
  const savedSearch = newMode === 'specs' ? state.specsSearch : state.testsSearch;
  searchInput.value = savedSearch;
  document.getElementById('searchClear').classList.toggle('hidden', !savedSearch);

  // Initialize mode if first time (lazy initialization)
  if (newMode === 'specs' && !state.specsInitialized) {
    await initSpecsMode(savedSearch);
  } else if (newMode === 'tests' && !state.testsInitialized) {
    await initTestsMode(savedSearch);
  }

  // Update welcome screen visibility based on whether the new mode has a selection
  const hasSelection = newMode === 'specs' ? state.specsHasSelection : state.testsHasSelection;
  document.getElementById('welcome').classList.toggle('hidden', hasSelection);

  // Update URL
  updateHash(newMode);
}

/**
 * Initialize specs mode
 */
async function initSpecsMode(searchTerm = '') {
  if (!state.specsModule) {
    // Dynamically import specs module
    state.specsModule = await import('./specs/specsMain.js');
  }

  // Get saved version or default
  const savedVersion = localStorage.getItem(SPECS_VERSION_KEY);

  // Initialize
  await state.specsModule.init(savedVersion, searchTerm);
  state.specsInitialized = true;
}

/**
 * Initialize tests mode
 */
async function initTestsMode(searchTerm = '') {
  if (!state.testsModule) {
    // Dynamically import tests module
    state.testsModule = await import('./tests/testsMain.js');
  }

  // Get saved version or default
  const savedVersion = localStorage.getItem(TESTS_VERSION_KEY);

  // Initialize
  await state.testsModule.init(savedVersion, searchTerm);
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
  initSearch();

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

export function setSpecsHasSelection(hasSelection) {
  state.specsHasSelection = hasSelection;
}

export function setTestsHasSelection(hasSelection) {
  state.testsHasSelection = hasSelection;
}

export { updateHash };

// Start the application
init();
