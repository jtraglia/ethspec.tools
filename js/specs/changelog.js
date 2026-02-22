/**
 * Changelog ("What Changed") module
 * Shows items that changed between two spec versions
 */

import { collectItems } from './tree.js';
import { extractForks, compareVersions, getCurrentVersion } from './specsMain.js';
import { escapeHtml, renderUnifiedDiff, renderAllAdded, exitCompare, isCompareActive } from './specCompare.js';
import { CATEGORY_ORDER } from './constants.js';

// Changelog state
const changelogState = {
  active: false,
  baseVersion: null,
  baseData: null,
  baseForks: [],
  baseItems: null,
  currentItems: null,
  currentForks: [],
  changes: null,           // Map<name, { type: 'added'|'modified', category }>
  removedItems: []         // Array of { name, category }
};

// Cache fetched version data
const dataCache = new Map();

// Reference to state getter and applyFilters callback
let getStateFn = null;
let applyFiltersFn = null;

/**
 * Check if changelog mode is active
 */
export function isChangelogActive() {
  return changelogState.active;
}

/**
 * Initialize changelog — sets up the header "What Changed" button for version comparison
 */
export function initChangelog(stateFn, filtersFn) {
  getStateFn = stateFn;
  applyFiltersFn = filtersFn;

  const { availableVersions, version } = getStateFn();

  const headerBtn = document.getElementById('versionChangelogBtn');
  if (!headerBtn) return;

  const newBtn = headerBtn.cloneNode(true);
  headerBtn.parentNode.replaceChild(newBtn, headerBtn);

  const sorted = [...availableVersions].sort((a, b) => {
    if (a === 'nightly') return -1;
    if (b === 'nightly') return 1;
    return compareVersions(a, b);
  });
  const currentIndex = sorted.indexOf(version);
  const isOldest = currentIndex === sorted.length - 1;

  if (isOldest || availableVersions.length <= 1) {
    newBtn.disabled = true;
    newBtn.title = 'No previous version to compare against';
  } else {
    newBtn.disabled = false;
    newBtn.title = 'Show what changed from the previous version';
    newBtn.addEventListener('click', () => {
      if (changelogState.active) {
        exitChangelog();
      } else {
        enterChangelog();
      }
    });
  }
}

/**
 * Enter changelog mode
 */
export function enterChangelog() {
  // Exit specCompare if active
  if (isCompareActive()) {
    exitCompare(true);
  }

  const { data, forks, version, availableVersions } = getStateFn();

  changelogState.active = true;
  changelogState.currentItems = collectItems(data, forks);
  changelogState.currentForks = forks;

  // Add body class to hide fork filter buttons
  document.body.classList.add('changelog-active');

  // Mark header button as active
  const headerBtn = document.getElementById('versionChangelogBtn');
  if (headerBtn) headerBtn.classList.add('active');

  // Find the previous version
  const sorted = [...availableVersions].sort((a, b) => {
    if (a === 'nightly') return -1;
    if (b === 'nightly') return 1;
    return compareVersions(a, b);
  });
  const currentIndex = sorted.indexOf(version);
  const prevVersion = currentIndex >= 0 && currentIndex < sorted.length - 1
    ? sorted[currentIndex + 1]
    : null;
  changelogState.baseVersion = prevVersion;

  if (prevVersion) {
    fetchAndComputeVersionChanges(prevVersion);
  }

  renderChangelogBar();
}

/**
 * Exit changelog mode
 */
export function exitChangelog() {
  if (!changelogState.active) return;

  changelogState.active = false;
  changelogState.baseVersion = null;
  changelogState.baseData = null;
  changelogState.baseForks = [];
  changelogState.baseItems = null;
  changelogState.currentItems = null;
  changelogState.currentForks = [];
  changelogState.changes = null;
  changelogState.removedItems = [];

  // Expose changes on window for the navigation check
  window._changelogChanges = null;

  // Remove body class
  document.body.classList.remove('changelog-active');

  // Hide changelog bar
  const bar = document.getElementById('changelogBar');
  bar.classList.add('hidden');
  bar.innerHTML = '';

  // Deactivate header button
  const headerBtn = document.getElementById('versionChangelogBtn');
  if (headerBtn) headerBtn.classList.remove('active');

  // Remove badges from tree
  clearTreeBadges();

  // Re-apply normal filters
  if (applyFiltersFn) applyFiltersFn();
}

/**
 * Compute version changes — compare current items with base version items
 */
function computeVersionChanges() {
  const currentItems = changelogState.currentItems;
  const baseItems = changelogState.baseItems;
  const currentForks = changelogState.currentForks;
  const baseForks = changelogState.baseForks;
  const changes = new Map();
  const removedItems = [];

  CATEGORY_ORDER.forEach(category => {
    const currentCat = currentItems[category] || {};
    const baseCat = baseItems[category] || {};

    // Items in current but not in base → added
    // Items in both but different effective latest → modified
    Object.values(currentCat).forEach(item => {
      if (!baseCat[item.name]) {
        changes.set(item.name, { type: 'added', category });
      } else {
        const currentValue = getEffectiveLatestValue(item, currentForks);
        const baseValue = getEffectiveLatestValue(baseCat[item.name], baseForks);
        if (JSON.stringify(currentValue) !== JSON.stringify(baseValue)) {
          changes.set(item.name, { type: 'modified', category });
        }
      }
    });

    // Items in base but not in current → removed
    Object.values(baseCat).forEach(item => {
      if (!currentCat[item.name]) {
        removedItems.push({ name: item.name, category });
      }
    });
  });

  changelogState.changes = changes;
  changelogState.removedItems = removedItems;
  window._changelogChanges = changes;
}

/**
 * Get effective latest value for an item by walking forks in reverse
 */
function getEffectiveLatestValue(item, forks) {
  for (let i = forks.length - 1; i >= 0; i--) {
    const fork = forks[i];
    if (item.values[fork] !== undefined) {
      return item.values[fork];
    }
  }
  return null;
}

/**
 * Fetch base version data and compute version changes
 */
async function fetchAndComputeVersionChanges(version) {
  const bar = document.getElementById('changelogBar');

  // Show loading in the summary area
  const existingSummary = bar.querySelector('.changelog-summary');
  if (existingSummary) {
    existingSummary.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
  }

  try {
    let baseData = dataCache.get(version);
    if (!baseData) {
      const response = await fetch(`pyspec/${version}/pyspec.json`);
      if (!response.ok) throw new Error(`Failed to load ${version}`);
      baseData = await response.json();
      dataCache.set(version, baseData);
    }

    changelogState.baseData = baseData;
    changelogState.baseForks = extractForks(baseData);
    changelogState.baseItems = collectItems(baseData, changelogState.baseForks);

    computeVersionChanges();
    renderChangelogBar();
    applyFiltersFn();
  } catch (err) {
    console.error('Error loading version for changelog:', err);
    const summary = bar.querySelector('.changelog-summary');
    if (summary) {
      summary.textContent = 'Error loading version';
    }
  }
}

/**
 * Render the changelog bar UI
 */
function renderChangelogBar() {
  const bar = document.getElementById('changelogBar');
  bar.classList.remove('hidden');
  bar.innerHTML = '';

  const { availableVersions, version } = getStateFn();

  // Version dropdown
  const select = document.createElement('select');
  select.className = 'changelog-base-select';

  // Sort versions: nightly first, then semver descending
  const sorted = [...availableVersions].sort((a, b) => {
    if (a === 'nightly') return -1;
    if (b === 'nightly') return 1;
    return compareVersions(a, b);
  });

  sorted.forEach(v => {
    if (v === version) return;
    const option = document.createElement('option');
    option.value = v;
    option.textContent = v;
    if (v === changelogState.baseVersion) option.selected = true;
    select.appendChild(option);
  });

  select.addEventListener('change', () => {
    changelogState.baseVersion = select.value;
    changelogState.changes = null;
    renderChangelogBar();
    fetchAndComputeVersionChanges(select.value);
  });

  bar.appendChild(select);

  // Change summary
  const summary = document.createElement('span');
  summary.className = 'changelog-summary';

  if (changelogState.changes) {
    let addedCount = 0;
    let modifiedCount = 0;
    changelogState.changes.forEach(({ type }) => {
      if (type === 'added') addedCount++;
      else modifiedCount++;
    });

    const parts = [];
    if (addedCount > 0) parts.push(`<span class="changelog-summary-added">${addedCount} added</span>`);
    if (modifiedCount > 0) parts.push(`<span class="changelog-summary-modified">${modifiedCount} modified</span>`);
    if (changelogState.removedItems.length > 0) {
      parts.push(`<span class="changelog-summary-removed">${changelogState.removedItems.length} removed</span>`);
    }
    if (parts.length === 0) {
      summary.textContent = 'No changes';
    } else {
      summary.innerHTML = parts.join(', ');
    }
  } else {
    summary.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
  }

  bar.appendChild(summary);

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'changelog-close-btn';
  closeBtn.innerHTML = '<i class="fas fa-times"></i>';
  closeBtn.title = 'Exit What Changed mode';
  closeBtn.addEventListener('click', () => {
    exitChangelog();
  });

  bar.appendChild(closeBtn);
}

/**
 * Apply changelog filtering to the tree
 * Called from specsMain.applyFilters() when changelog is active
 */
export function applyChangelogToTree(typeFilter, searchTerm) {
  const changes = changelogState.changes;
  if (!changes) return;

  const container = document.getElementById('specsTree');
  const categoryNodes = container.querySelectorAll(':scope > .tree-node');

  // First clear any existing badges
  clearTreeBadges();

  categoryNodes.forEach(categoryNode => {
    const category = categoryNode.dataset.category;

    // Type filter - hide entire category if doesn't match
    if (typeFilter && category !== typeFilter) {
      categoryNode.classList.add('tree-filtered');
      return;
    }
    categoryNode.classList.remove('tree-filtered');

    const itemNodes = categoryNode.querySelectorAll(':scope > .tree-children > .tree-node');
    let visibleItemCount = 0;

    itemNodes.forEach(itemNode => {
      const name = itemNode.dataset.name;
      const nameLower = name.toLowerCase();
      const change = changes.get(name);

      // Search filter
      const matchesSearch = !searchTerm || nameLower.includes(searchTerm);

      if (change && matchesSearch) {
        itemNode.classList.remove('tree-filtered');
        visibleItemCount++;

        // Add change-type badge
        const label = itemNode.querySelector('.tree-label');
        if (label && !label.querySelector('.changelog-badge')) {
          const badge = document.createElement('span');
          badge.className = 'changelog-badge ' + (change.type === 'added' ? 'changelog-badge-added' : 'changelog-badge-modified');
          badge.textContent = change.type === 'added' ? 'NEW' : 'MOD';

          // Insert before fork badges
          const forkBadges = label.querySelector('.tree-fork-badges');
          if (forkBadges) {
            label.insertBefore(badge, forkBadges);
          } else {
            label.appendChild(badge);
          }
        }
      } else {
        itemNode.classList.add('tree-filtered');
      }
    });

    // Hide category if no visible items
    if (visibleItemCount === 0) {
      categoryNode.classList.add('tree-filtered');
    } else {
      // Auto-expand categories
      const children = categoryNode.querySelector('.tree-children');
      const icon = categoryNode.querySelector('.tree-icon');
      if (children) children.classList.remove('collapsed');
      if (icon) icon.innerHTML = '<i class="fas fa-chevron-down"></i>';
    }
  });
}

/**
 * Remove all changelog badges from the tree
 */
function clearTreeBadges() {
  document.querySelectorAll('#specsTree .changelog-badge').forEach(badge => badge.remove());
}

/**
 * Render changelog item in the viewer content area
 * Called by specViewer.displaySpec when changelog is active
 */
export function renderChangelogItem(item, container) {
  container.innerHTML = '';
  renderVersionDiff(item, container);
}

/**
 * Render version diff for a changelog item
 */
function renderVersionDiff(item, container) {
  const currentItems = changelogState.currentItems;
  const baseItems = changelogState.baseItems;
  const currentVersion = getCurrentVersion();
  const baseVersion = changelogState.baseVersion;

  if (!baseItems) {
    container.innerHTML = '<div class="diff-loading"><i class="fas fa-spinner fa-spin"></i> Loading comparison data...</div>';
    return;
  }

  const currentItem = currentItems[item.category]?.[item.name] || null;
  const baseItem = baseItems[item.category]?.[item.name] || null;
  const isVariable = ['constant_vars', 'preset_vars', 'config_vars'].includes(item.category);

  // Version header bar
  const headerBar = document.createElement('div');
  headerBar.className = 'compare-header-bar';
  headerBar.innerHTML = `
    <span class="compare-version-label compare-old">${escapeHtml(baseVersion)}</span>
    <i class="fas fa-arrow-right compare-arrow"></i>
    <span class="compare-version-label compare-new">${escapeHtml(currentVersion)}</span>
  `;

  container.appendChild(headerBar);

  // Handle missing items
  if (!baseItem) {
    const msg = document.createElement('div');
    msg.className = 'diff-item-missing';
    msg.innerHTML = `<i class="fas fa-plus-circle"></i> Item <code>${escapeHtml(item.name)}</code> is entirely new in ${escapeHtml(currentVersion)}.`;
    container.appendChild(msg);
  }

  if (!currentItem) {
    const msg = document.createElement('div');
    msg.className = 'diff-item-missing';
    msg.innerHTML = `<i class="fas fa-minus-circle"></i> Item <code>${escapeHtml(item.name)}</code> was removed in ${escapeHtml(currentVersion)}.`;
    container.appendChild(msg);
    return;
  }

  if (isVariable) {
    // Variable comparison
    const currentValue = getEffectiveLatestValue(currentItem, changelogState.currentForks);
    const baseValue = baseItem ? getEffectiveLatestValue(baseItem, changelogState.baseForks) : null;

    if (!baseItem) {
      renderSingleVariableTable(container, currentValue);
    } else {
      renderVariableComparisonTable(container, baseValue, currentValue, baseVersion, currentVersion);
    }
  } else {
    // Code comparison - get effective latest values
    const currentCode = getEffectiveLatestValue(currentItem, changelogState.currentForks);
    const baseCode = baseItem ? getEffectiveLatestValue(baseItem, changelogState.baseForks) : null;

    const diffContainer = document.createElement('div');
    diffContainer.className = 'diff-container';

    const currentStr = currentCode != null ? String(currentCode) : '';
    const baseStr = baseCode != null ? String(baseCode) : '';

    if (!baseItem || baseCode === null) {
      renderAllAdded(diffContainer, currentStr);
    } else if (currentStr === baseStr) {
      diffContainer.innerHTML = '<div class="diff-no-changes">No changes in effective code</div>';
    } else {
      renderUnifiedDiff(diffContainer, baseStr, currentStr);
    }

    const box = document.createElement('div');
    box.className = 'file-box';
    box.appendChild(diffContainer);
    container.appendChild(box);
  }
}

/**
 * Render a single variable value table (for newly added items)
 */
function renderSingleVariableTable(container, value) {
  const box = document.createElement('div');
  box.className = 'fork-box';

  const tableWrapper = document.createElement('div');
  tableWrapper.style.padding = '1rem';

  const table = document.createElement('table');
  table.className = 'variable-table';

  // Parse value
  let mainnetParsed, minimalParsed;
  if (value && typeof value === 'object' && ('mainnet' in value || 'minimal' in value)) {
    mainnetParsed = parseVarValue(value.mainnet);
    minimalParsed = parseVarValue(value.minimal);
  } else {
    mainnetParsed = parseVarValue(value);
    minimalParsed = mainnetParsed;
  }

  const hasDiff = String(mainnetParsed.value) !== String(minimalParsed.value);

  const thead = document.createElement('thead');
  if (hasDiff) {
    thead.innerHTML = '<tr><th>Type</th><th>Mainnet</th><th>Minimal</th></tr>';
  } else {
    thead.innerHTML = '<tr><th>Type</th><th>Value</th></tr>';
  }
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const row = document.createElement('tr');
  const displayType = mainnetParsed.type || minimalParsed.type;
  if (hasDiff) {
    row.innerHTML = `
      <td><code>${escapeHtml(displayType || 'N/A')}</code></td>
      <td><code>${escapeHtml(String(mainnetParsed.value))}</code></td>
      <td><code>${escapeHtml(String(minimalParsed.value))}</code></td>
    `;
  } else {
    row.innerHTML = `
      <td><code>${escapeHtml(displayType || 'N/A')}</code></td>
      <td><code>${escapeHtml(String(mainnetParsed.value))}</code></td>
    `;
  }
  tbody.appendChild(row);
  table.appendChild(tbody);
  tableWrapper.appendChild(table);
  box.appendChild(tableWrapper);
  container.appendChild(box);
}

/**
 * Render a variable comparison table (old vs new)
 */
function renderVariableComparisonTable(container, oldValue, newValue, oldLabel, newLabel) {
  const box = document.createElement('div');
  box.className = 'fork-box';

  const tableWrapper = document.createElement('div');
  tableWrapper.style.padding = '1rem';

  const table = document.createElement('table');
  table.className = 'compare-variable-table';

  let oldMainnet, newMainnet;
  if (oldValue && typeof oldValue === 'object' && ('mainnet' in oldValue || 'minimal' in oldValue)) {
    oldMainnet = parseVarValue(oldValue.mainnet);
  } else {
    oldMainnet = parseVarValue(oldValue);
  }
  if (newValue && typeof newValue === 'object' && ('mainnet' in newValue || 'minimal' in newValue)) {
    newMainnet = parseVarValue(newValue.mainnet);
  } else {
    newMainnet = parseVarValue(newValue);
  }

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>Type</th>
      <th class="compare-old">${escapeHtml(oldLabel)}</th>
      <th class="compare-new">${escapeHtml(newLabel)}</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const displayType = newMainnet.type || oldMainnet.type;
  const oldStr = String(oldMainnet.value);
  const newStr = String(newMainnet.value);
  const changed = oldStr !== newStr;

  const row = document.createElement('tr');
  row.innerHTML = `
    <td><code>${escapeHtml(displayType || 'N/A')}</code></td>
    <td class="${changed ? 'cell-changed cell-old' : ''}"><code>${escapeHtml(oldStr)}</code></td>
    <td class="${changed ? 'cell-changed cell-new' : ''}"><code>${escapeHtml(newStr)}</code></td>
  `;
  tbody.appendChild(row);
  table.appendChild(tbody);
  tableWrapper.appendChild(table);
  box.appendChild(tableWrapper);
  container.appendChild(box);
}

/**
 * Parse a variable value (array format or raw)
 */
function parseVarValue(value) {
  if (Array.isArray(value)) {
    return { type: value[0] || '', value: value[1] !== undefined ? value[1] : '' };
  }
  return { type: '', value: value || '' };
}
