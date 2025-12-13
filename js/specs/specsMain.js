/**
 * Specs mode main module
 * Handles initialization and state management for the specs viewer
 */

import { buildTree, filterTree, setOnItemSelectCallback } from './tree.js';
import { displaySpec, clearSpec, openForkInViewer, showItemNotFound, setGetCurrentVersion } from './specViewer.js';
import { CATEGORY_TYPES, CATEGORY_ORDER, getForkDisplayName } from './constants.js';
import { initReferenceClickHandler, addToHistory, goBack, goForward, navigateToReference, clearHistory } from './references.js';
import { saveSpecsVersion, updateHash, setSpecsHasSelection } from '../main.js';

// Application state
const state = {
  data: null,
  currentItem: null,
  currentItemName: null,
  forks: [],
  categories: [],
  activeForkFilter: null,
  activeTypeFilter: null,
  searchTerm: '',
  currentVersion: 'nightly',
  availableVersions: ['nightly'],
  initialLoadComplete: false
};

/**
 * Extract forks from data
 */
function extractForks(data) {
  const networkData = data.mainnet || data.minimal;
  if (!networkData) return [];

  const knownOrder = ['PHASE0', 'ALTAIR', 'BELLATRIX', 'CAPELLA', 'DENEB', 'ELECTRA', 'FULU'];
  const discoveredForks = Object.keys(networkData)
    .filter(f => !f.toUpperCase().startsWith('EIP') && f.toUpperCase() !== 'WHISK')
    .map(f => f.toUpperCase());

  const knownForks = knownOrder.filter(f => discoveredForks.includes(f));
  const unknownForks = discoveredForks.filter(f => !knownOrder.includes(f)).sort();

  return [...knownForks, ...unknownForks];
}

/**
 * Build fork filter buttons
 */
function buildForkFilters() {
  const container = document.getElementById('specsForkFilters');
  container.innerHTML = '';

  state.forks.forEach(fork => {
    const btn = document.createElement('button');
    btn.className = 'fork-filter-btn';
    btn.textContent = getForkDisplayName(fork);
    btn.dataset.fork = fork;

    btn.addEventListener('click', () => {
      if (state.activeForkFilter === fork) {
        state.activeForkFilter = null;
        btn.classList.remove('active');
      } else {
        container.querySelectorAll('.fork-filter-btn').forEach(b => b.classList.remove('active'));
        state.activeForkFilter = fork;
        btn.classList.add('active');
      }
      applyFilters();
    });

    container.appendChild(btn);
  });
}

/**
 * Build type filter buttons
 */
function buildTypeFilters() {
  const container = document.getElementById('specsTypeFilters');
  container.innerHTML = '';

  CATEGORY_ORDER.forEach(key => {
    const displayName = CATEGORY_TYPES[key];
    const btn = document.createElement('button');
    btn.className = 'type-filter-btn';
    btn.textContent = displayName;
    btn.dataset.type = key;

    btn.addEventListener('click', () => {
      if (state.activeTypeFilter === key) {
        state.activeTypeFilter = null;
        btn.classList.remove('active');
      } else {
        container.querySelectorAll('.type-filter-btn').forEach(b => b.classList.remove('active'));
        state.activeTypeFilter = key;
        btn.classList.add('active');
      }
      applyFilters();
    });

    container.appendChild(btn);
  });
}

/**
 * Apply all filters to the tree
 */
function applyFilters() {
  filterTree(state.activeForkFilter, state.activeTypeFilter, state.searchTerm);
}

/**
 * Apply search term (called from main.js)
 */
export function applySearch(searchTerm) {
  state.searchTerm = searchTerm;
  applyFilters();
}

/**
 * Handle item selection from tree
 */
function onItemSelect(item, addHistory = true, preferredFork = null) {
  state.currentItem = item;
  state.currentItemName = item.name;

  // Update active state in tree
  document.querySelectorAll('#specsTree .tree-label.active').forEach(el => el.classList.remove('active'));
  if (item.element) {
    item.element.classList.add('active');
  }

  // Add to navigation history
  if (addHistory) {
    addToHistory(item.name, preferredFork);
  }

  // Display the spec
  displaySpec(item, state.data);

  // Open the preferred fork if specified
  if (preferredFork) {
    openForkInViewer(preferredFork);
  }

  // Show spec viewer, hide welcome
  document.getElementById('welcome').classList.add('hidden');
  document.getElementById('specViewer').classList.remove('hidden');

  // Notify main.js that we have a selection
  setSpecsHasSelection(true);
}

// Expose for reference navigation
window.selectItem = onItemSelect;

/**
 * Get current version
 */
function getCurrentVersion() {
  return state.currentVersion;
}

// Set the getCurrentVersion function in specViewer
setGetCurrentVersion(getCurrentVersion);

/**
 * Select an item by name
 */
function selectItemByName(itemName, preferredFork) {
  const treeNodes = document.querySelectorAll('#specsTree .tree-node[data-name]');
  for (const node of treeNodes) {
    const name = node.dataset.name;
    if (name === itemName) {
      const label = node.querySelector('.tree-label');
      if (label) {
        // Expand parent nodes
        let parent = node.parentElement;
        while (parent) {
          if (parent.classList.contains('tree-children')) {
            parent.classList.remove('collapsed');
            const parentNode = parent.previousElementSibling;
            if (parentNode) {
              const icon = parentNode.querySelector('.tree-icon');
              if (icon) icon.textContent = '▼';
            }
          }
          parent = parent.parentElement;
        }

        const itemData = node._itemData;
        if (itemData) {
          onItemSelect({ ...itemData, element: label }, true, preferredFork);
        } else {
          label.click();
        }

        label.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
    }
  }
}

/**
 * Discover available versions from versions.json
 */
async function discoverVersions() {
  try {
    const response = await fetch('pyspec/versions.json');
    if (response.ok) {
      const versions = await response.json();
      state.availableVersions = versions;
    }
  } catch (err) {
    console.log('versions.json not found, using nightly only');
    state.availableVersions = ['nightly'];
  }
}

/**
 * Parse a semver string into components for sorting
 */
function parseVersion(version) {
  const v = version.replace(/^v/, '');
  const [base, prerelease] = v.split('-');
  const [major, minor, patch] = base.split('.').map(Number);

  let prereleaseType = 3; // stable
  let prereleaseNum = 0;

  if (prerelease) {
    if (prerelease.startsWith('alpha')) {
      prereleaseType = 1;
      prereleaseNum = parseInt(prerelease.replace('alpha.', ''), 10) || 0;
    } else if (prerelease.startsWith('beta')) {
      prereleaseType = 2;
      prereleaseNum = parseInt(prerelease.replace('beta.', ''), 10) || 0;
    }
  }

  return { major, minor, patch, prereleaseType, prereleaseNum };
}

/**
 * Compare two version strings for sorting
 */
function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);

  if (vb.major !== va.major) return vb.major - va.major;
  if (vb.minor !== va.minor) return vb.minor - va.minor;
  if (vb.patch !== va.patch) return vb.patch - va.patch;
  if (vb.prereleaseType !== va.prereleaseType) return vb.prereleaseType - va.prereleaseType;
  return vb.prereleaseNum - va.prereleaseNum;
}

/**
 * Populate the version dropdown
 */
function populateVersionDropdown() {
  const select = document.getElementById('versionSelect');
  select.innerHTML = '';

  const sortedVersions = [...state.availableVersions].sort((a, b) => {
    if (a === 'nightly') return -1;
    if (b === 'nightly') return 1;
    return compareVersions(a, b);
  });

  sortedVersions.forEach(version => {
    const option = document.createElement('option');
    option.value = version;
    option.textContent = version;
    if (version === state.currentVersion) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

/**
 * Handle version change
 */
async function onVersionChange(version) {
  if (version === state.currentVersion) return;

  const itemNameToFind = state.currentItemName;

  state.currentVersion = version;
  saveSpecsVersion(version);
  clearHistory();

  // Update URL
  if (itemNameToFind && state.currentItem) {
    const itemId = `specs/${version}/${state.currentItem.category}-${itemNameToFind}`;
    history.replaceState(null, '', `#${itemId}`);
  } else {
    history.replaceState(null, '', `#specs/${version}/`);
  }

  await loadVersionData(version);

  // Try to re-select the same item in the new version
  if (itemNameToFind) {
    let itemFound = false;
    const treeNodes = document.querySelectorAll('#specsTree .tree-node[data-name]');
    for (const node of treeNodes) {
      if (node.dataset.name === itemNameToFind) {
        const itemData = node._itemData;
        if (itemData) {
          const label = node.querySelector('.tree-label');
          onItemSelect({ ...itemData, element: label }, false);
          label.scrollIntoView({ behavior: 'smooth', block: 'center' });
          itemFound = true;
        }
        break;
      }
    }

    if (!itemFound) {
      showItemNotFound(itemNameToFind, version);
      state.currentItem = null;
    }
  }
}

/**
 * Load data for a specific version
 */
async function loadVersionData(version) {
  const loading = document.getElementById('loading');
  const error = document.getElementById('error');

  loading.classList.remove('hidden');
  error.classList.add('hidden');

  // Save current filter states
  const savedForkFilter = state.activeForkFilter;
  const savedTypeFilter = state.activeTypeFilter;
  const savedSearchTerm = state.searchTerm;

  try {
    const response = await fetch(`pyspec/${version}/pyspec.json`);
    if (!response.ok) {
      throw new Error(`Failed to load data: ${response.status} ${response.statusText}`);
    }

    state.data = await response.json();
    state.forks = extractForks(state.data);

    buildForkFilters();
    buildTypeFilters();

    // Restore filter states
    state.activeForkFilter = savedForkFilter;
    state.activeTypeFilter = savedTypeFilter;
    state.searchTerm = savedSearchTerm;

    // Re-apply active states to buttons
    if (savedForkFilter) {
      const forkBtn = document.querySelector(`#specsForkFilters .fork-filter-btn[data-fork="${savedForkFilter}"]`);
      if (forkBtn) forkBtn.classList.add('active');
    }
    if (savedTypeFilter) {
      const typeBtn = document.querySelector(`#specsTypeFilters .type-filter-btn[data-type="${savedTypeFilter}"]`);
      if (typeBtn) typeBtn.classList.add('active');
    }

    setOnItemSelectCallback(onItemSelect);
    buildTree(state.data, state.forks);

    if (savedForkFilter || savedTypeFilter || savedSearchTerm) {
      applyFilters();
    }

    loading.classList.add('hidden');

  } catch (err) {
    console.error('Error loading data:', err);
    loading.classList.add('hidden');
    error.textContent = `Error loading specification data: ${err.message}`;
    error.classList.remove('hidden');
  }
}

/**
 * Initialize version selector
 */
function initVersionSelector() {
  const select = document.getElementById('versionSelect');

  // Remove existing listeners by cloning
  const newSelect = select.cloneNode(true);
  select.parentNode.replaceChild(newSelect, select);

  newSelect.addEventListener('change', () => {
    onVersionChange(newSelect.value);
  });
}

/**
 * Initialize navigation buttons
 */
function initNavigation() {
  const backButton = document.getElementById('navBack');
  const forwardButton = document.getElementById('navForward');

  // Remove existing listeners by cloning
  if (backButton) {
    const newBackButton = backButton.cloneNode(true);
    backButton.parentNode.replaceChild(newBackButton, backButton);

    newBackButton.addEventListener('click', () => {
      const entry = goBack();
      if (entry) {
        navigateToReference(entry.name, false, entry.fork);
      }
    });
  }

  if (forwardButton) {
    const newForwardButton = forwardButton.cloneNode(true);
    forwardButton.parentNode.replaceChild(newForwardButton, forwardButton);

    newForwardButton.addEventListener('click', () => {
      const entry = goForward();
      if (entry) {
        navigateToReference(entry.name, false, entry.fork);
      }
    });
  }
}

/**
 * Handle deep link
 * Format: version/category-itemName or version/category-itemName-FORK
 */
export function handleDeepLink(path) {
  if (!path) return;

  let version = null;
  let remainder = path;

  if (path.includes('/')) {
    const slashIndex = path.indexOf('/');
    version = path.substring(0, slashIndex);
    remainder = path.substring(slashIndex + 1);
  }

  if (!remainder) return;

  const parts = remainder.split('-');
  const knownForks = ['phase0', 'altair', 'bellatrix', 'capella', 'deneb', 'electra', 'fulu', 'gloas'];
  let preferredFork = null;
  let itemName = null;

  const lastPart = parts[parts.length - 1].toLowerCase();
  if (parts.length >= 3 && knownForks.includes(lastPart)) {
    preferredFork = lastPart.toUpperCase();
    itemName = parts.slice(1, -1).join('-');
  } else if (parts.length >= 2) {
    itemName = parts.slice(1).join('-');
  } else {
    itemName = remainder;
  }

  // If a version was specified, switch to it
  if (version && version !== state.currentVersion && state.availableVersions.includes(version)) {
    state.currentVersion = version;
    const select = document.getElementById('versionSelect');
    if (select) select.value = version;
    loadVersionData(version).then(() => {
      selectItemByName(itemName, preferredFork);
    });
  } else {
    setTimeout(() => {
      selectItemByName(itemName, preferredFork);
    }, 100);
  }
}

/**
 * Initialize specs mode
 */
export async function init(savedVersion, searchTerm = '') {
  // Reset state
  state.initialLoadComplete = false;

  // Initialize UI
  initNavigation();
  initVersionSelector();
  initReferenceClickHandler();

  // Discover available versions
  await discoverVersions();

  // Use saved version or default
  if (savedVersion && state.availableVersions.includes(savedVersion)) {
    state.currentVersion = savedVersion;
  } else {
    state.currentVersion = state.availableVersions[0] || 'nightly';
  }

  // Populate dropdown
  populateVersionDropdown();

  // Load data
  await loadVersionData(state.currentVersion);

  // Apply search term if provided
  if (searchTerm) {
    state.searchTerm = searchTerm.toLowerCase();
    applyFilters();
  }

  state.initialLoadComplete = true;
}
