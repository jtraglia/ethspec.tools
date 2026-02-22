/**
 * Changelog ("What Changed") module
 * Shows items that changed between two spec versions
 */

import { collectItems } from './tree.js';
import { extractForks, compareVersions, getCurrentVersion } from './specsMain.js';
import { FORK_ORDER, escapeHtml, renderUnifiedDiff, renderAllAdded, renderAllRemoved } from './specCompare.js';
import { CATEGORY_ORDER, getForkDisplayName, getForkColor } from './constants.js';

// Changelog state
const changelogState = {
  active: false,
  baseVersion: null,
  baseData: null,
  baseForks: [],
  baseItems: null,
  currentItems: null,
  currentForks: [],
  changes: null,           // Map<name, { type: 'added'|'modified', category, changedForks }>
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
  const { data, forks, version, availableVersions } = getStateFn();

  changelogState.active = true;
  changelogState.currentItems = collectItems(data, forks);
  changelogState.currentForks = forks;

  // Add body class to hide fork letter badges on tree items
  document.body.classList.add('changelog-active');

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
    // Update button text to show version comparison
    const headerBtn = document.getElementById('versionChangelogBtn');
    if (headerBtn) {
      headerBtn.classList.add('active');
      const textEl = headerBtn.querySelector('.version-changelog-text');
      if (textEl) textEl.textContent = `${prevVersion} → ${version}`;
    }

    fetchAndComputeVersionChanges(prevVersion);
  }
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

  // Deactivate header button and restore text
  const headerBtn = document.getElementById('versionChangelogBtn');
  if (headerBtn) {
    headerBtn.classList.remove('active');
    const textEl = headerBtn.querySelector('.version-changelog-text');
    if (textEl) textEl.textContent = 'What Changed';
  }

  // Remove badges from tree
  clearTreeBadges();

  // Re-apply normal filters
  if (applyFiltersFn) applyFiltersFn();
}

/**
 * Compute version changes — compare current items with base version items per-fork
 */
function computeVersionChanges() {
  const currentItems = changelogState.currentItems;
  const baseItems = changelogState.baseItems;
  const changes = new Map();
  const removedItems = [];

  CATEGORY_ORDER.forEach(category => {
    const currentCat = currentItems[category] || {};
    const baseCat = baseItems[category] || {};

    // Items in current but not in base → added (all forks are new)
    // Items in both → check per-fork for differences
    Object.values(currentCat).forEach(item => {
      const baseEquiv = baseCat[item.name];
      if (!baseEquiv) {
        changes.set(item.name, { type: 'added', category, changedForks: [...item.forks] });
      } else {
        // Compare explicit values at each fork where either version has a redefinition
        const allForks = new Set([...item.forks, ...baseEquiv.forks]);
        const changedForks = [];
        for (const fork of allForks) {
          const currentVal = item.values[fork];
          const baseVal = baseEquiv.values[fork];
          if (JSON.stringify(currentVal) !== JSON.stringify(baseVal)) {
            changedForks.push(fork);
          }
        }
        if (changedForks.length > 0) {
          changes.set(item.name, { type: 'modified', category, changedForks });
        }
      }
    });

    // Items in base but not in current → removed
    Object.values(baseCat).forEach(item => {
      if (!currentCat[item.name]) {
        removedItems.push({ name: item.name, category });
        changes.set(item.name, { type: 'removed', category, changedForks: [...item.forks] });
      }
    });
  });

  changelogState.changes = changes;
  changelogState.removedItems = removedItems;
  window._changelogChanges = changes;
}

/**
 * Fetch base version data and compute version changes
 */
async function fetchAndComputeVersionChanges(version) {
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
    applyFiltersFn();
  } catch (err) {
    console.error('Error loading version for changelog:', err);
  }
}

/**
 * Apply changelog filtering to the tree
 * Called from specsMain.applyFilters() when changelog is active
 */
export function applyChangelogToTree(forkFilter, typeFilter, searchTerm) {
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

      // Fork filter — only show items where the selected fork changed
      const matchesFork = !forkFilter || (change && change.changedForks.includes(forkFilter));
      // Search filter
      const matchesSearch = !searchTerm || nameLower.includes(searchTerm);

      if (change && matchesFork && matchesSearch) {
        itemNode.classList.remove('tree-filtered');
        visibleItemCount++;
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

  // Show removed items in the tree
  renderRemovedItemsInTree(container, forkFilter, typeFilter, searchTerm);
}

/**
 * Inject removed items into the tree as proper tree nodes
 */
function renderRemovedItemsInTree(container, forkFilter, typeFilter, searchTerm) {
  const removedItems = changelogState.removedItems;
  if (!removedItems || removedItems.length === 0) return;

  // Skip removed items when fork filter is active (we don't track per-fork info for removed items)
  if (forkFilter) return;

  // Group by category, filtering as we go
  const byCategory = {};
  removedItems.forEach(item => {
    if (typeFilter && item.category !== typeFilter) return;
    if (searchTerm && !item.name.toLowerCase().includes(searchTerm)) return;
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item.name);
  });

  // Inject into each category's tree-children
  const categoryNodes = container.querySelectorAll(':scope > .tree-node');
  categoryNodes.forEach(categoryNode => {
    const category = categoryNode.dataset.category;
    const names = byCategory[category];
    if (!names) return;

    const childrenContainer = categoryNode.querySelector('.tree-children');
    if (!childrenContainer) return;

    // Un-hide and expand this category if it was filtered out
    categoryNode.classList.remove('tree-filtered');
    childrenContainer.classList.remove('collapsed');
    const icon = categoryNode.querySelector('.tree-icon');
    if (icon) icon.innerHTML = '<i class="fas fa-chevron-down"></i>';

    names.sort().forEach(name => {
      const node = document.createElement('div');
      node.className = 'tree-node changelog-injected-node';

      const labelEl = document.createElement('div');
      labelEl.className = 'tree-label';
      labelEl.style.cursor = 'pointer';

      const iconEl = document.createElement('span');
      iconEl.className = 'tree-icon';
      iconEl.innerHTML = '<i class="fas fa-cube"></i>';
      labelEl.appendChild(iconEl);

      const codeEl = document.createElement('code');
      codeEl.className = 'tree-item-name';
      codeEl.textContent = name;
      labelEl.appendChild(codeEl);

      // Make clickable — select as a synthetic item so the viewer shows old code
      labelEl.addEventListener('click', () => {
        if (window.selectItem) {
          const baseItem = changelogState.baseItems?.[category]?.[name];
          const forks = baseItem ? baseItem.forks : [];
          window.selectItem({ name, category, forks, element: labelEl });
        }
      });

      node.appendChild(labelEl);
      childrenContainer.appendChild(node);
    });
  });
}

/**
 * Remove injected removed-item nodes from the tree
 */
function clearTreeBadges() {
  document.querySelectorAll('#specsTree .changelog-injected-node').forEach(node => node.remove());
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
 * Strip comment-only lines from Python code for cleaner diffs
 */
function stripComments(code) {
  return code.split('\n')
    .filter(line => !(/^\s*#/.test(line)))
    .join('\n')
    .trimEnd() + '\n';
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

  // Handle entirely missing items
  if (!baseItem) {
    const msg = document.createElement('div');
    msg.className = 'diff-item-missing';
    msg.innerHTML = `<i class="fas fa-plus-circle"></i> Item <code>${escapeHtml(item.name)}</code> is entirely new in ${escapeHtml(currentVersion)}.`;
    container.appendChild(msg);
  }

  if (!currentItem) {
    // Show the old code as all-removed diffs
    if (isVariable) {
      renderVariableVersionDiff(null, baseItem, container, baseVersion, currentVersion);
    } else {
      renderCodeVersionDiff(null, baseItem, container);
    }
    return;
  }

  if (isVariable) {
    renderVariableVersionDiff(currentItem, baseItem, container, baseVersion, currentVersion);
  } else {
    renderCodeVersionDiff(currentItem, baseItem, container);
  }
}

/**
 * Render per-fork code diffs between versions
 */
function renderCodeVersionDiff(currentItem, baseItem, container) {
  // Gather all forks from both versions that have differences
  const currentForks = currentItem ? currentItem.forks : [];
  const baseForks = baseItem ? baseItem.forks : [];
  const allForks = [...new Set([...currentForks, ...baseForks])];

  // Sort by known fork order, newest first
  allForks.sort((a, b) => {
    const ai = FORK_ORDER.indexOf(a);
    const bi = FORK_ORDER.indexOf(b);
    return (bi >= 0 ? bi : 999) - (ai >= 0 ? ai : 999);
  });

  // Filter to only forks where explicit values differ between versions
  const changedForks = allForks.filter(fork => {
    const currentVal = currentItem?.values[fork];
    const baseVal = baseItem?.values[fork];
    return JSON.stringify(currentVal) !== JSON.stringify(baseVal);
  });

  if (changedForks.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'diff-no-changes';
    msg.textContent = 'No changes detected';
    container.appendChild(msg);
    return;
  }

  // Show per-fork diffs using explicit values
  // A dropped override (base has value, current doesn't) shows as all-removed
  // A new override (current has value, base doesn't) shows as all-added
  changedForks.forEach((fork, index) => {
    const currentCode = currentItem?.values[fork];
    const baseCode = baseItem?.values[fork];

    const currentStr = currentCode != null ? stripComments(String(currentCode)) : null;
    const baseStr = baseCode != null ? stripComments(String(baseCode)) : null;

    renderForkDiffBlock(container, fork, baseStr, currentStr, index === 0);
  });
}

/**
 * Render a single collapsible fork diff block (mirrors specViewer.displayForkDiffs style)
 */
function renderForkDiffBlock(container, fork, baseStr, currentStr, expanded) {
  const box = document.createElement('div');
  box.className = 'file-box fork-code-block diff-fork-block';
  box.dataset.fork = fork;

  // Header
  const header = document.createElement('div');
  header.className = 'file-header diff-fork-header';

  const icon = document.createElement('i');
  icon.className = (expanded ? 'fas fa-chevron-down' : 'fas fa-chevron-right') + ' file-toggle-icon';

  const nameEl = document.createElement('span');
  nameEl.className = 'file-name-badge';
  nameEl.textContent = getForkDisplayName(fork);
  nameEl.style.backgroundColor = getForkColor(fork);

  header.appendChild(icon);
  header.appendChild(nameEl);

  // Diff stats
  if (!baseStr && currentStr) {
    // Entirely new fork
    const stats = document.createElement('span');
    stats.className = 'diff-stats';
    stats.innerHTML = `<span class="diff-stat-added">added</span>`;
    header.appendChild(stats);
  } else if (baseStr && !currentStr) {
    // Removed fork
    const stats = document.createElement('span');
    stats.className = 'diff-stats';
    stats.innerHTML = `<span class="diff-stat-removed">removed</span>`;
    header.appendChild(stats);
  } else if (baseStr && currentStr) {
    // Modified fork — compute diff stats
    const changes = Diff.diffLines(baseStr, currentStr);
    let addedLines = 0;
    let removedLines = 0;
    changes.forEach(part => {
      const lines = part.count || part.value.split('\n').length - (part.value.endsWith('\n') ? 1 : 0);
      if (part.added) addedLines += lines;
      else if (part.removed) removedLines += lines;
    });

    if (addedLines > 0 || removedLines > 0) {
      const stats = document.createElement('span');
      stats.className = 'diff-stats';
      stats.innerHTML = `<span class="diff-stat-added">+${addedLines}</span> <span class="diff-stat-removed">-${removedLines}</span>`;
      header.appendChild(stats);
    } else {
      const noChange = document.createElement('span');
      noChange.className = 'diff-no-change-badge';
      noChange.textContent = 'No changes';
      header.appendChild(noChange);
    }
  }

  // Spacer
  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  header.appendChild(spacer);

  // Content
  const contentEl = document.createElement('div');
  contentEl.className = 'file-content';
  if (!expanded) contentEl.classList.add('collapsed');

  const diffContainer = document.createElement('div');
  diffContainer.className = 'diff-container';

  if (!baseStr && currentStr) {
    renderAllAdded(diffContainer, currentStr);
  } else if (baseStr && !currentStr) {
    renderAllRemoved(diffContainer, baseStr);
  } else if (baseStr && currentStr) {
    renderUnifiedDiff(diffContainer, baseStr, currentStr);
  }

  contentEl.appendChild(diffContainer);

  // Toggle
  header.addEventListener('click', () => {
    const isCollapsed = contentEl.classList.contains('collapsed');
    contentEl.classList.toggle('collapsed');
    icon.className = (isCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-right') + ' file-toggle-icon';
  });

  box.appendChild(header);
  box.appendChild(contentEl);
  container.appendChild(box);
}

/**
 * Render per-fork variable comparison between versions
 */
function renderVariableVersionDiff(currentItem, baseItem, container, baseVersion, currentVersion) {
  // Get all forks that have differences between versions
  const currentForks = currentItem ? currentItem.forks : [];
  const baseForks = baseItem ? baseItem.forks : [];
  const allForks = [...new Set([...currentForks, ...baseForks])];

  // Sort by known fork order, newest first
  allForks.sort((a, b) => {
    const ai = FORK_ORDER.indexOf(a);
    const bi = FORK_ORDER.indexOf(b);
    return (bi >= 0 ? bi : 999) - (ai >= 0 ? ai : 999);
  });

  // Filter to forks where explicit values differ
  const changedForks = allForks.filter(fork => {
    const currentVal = currentItem?.values[fork];
    const baseVal = baseItem?.values[fork];
    return JSON.stringify(currentVal) !== JSON.stringify(baseVal);
  });

  if (changedForks.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'diff-no-changes';
    msg.textContent = 'No changes detected';
    container.appendChild(msg);
    return;
  }

  const box = document.createElement('div');
  box.className = 'fork-box';

  const tableWrapper = document.createElement('div');
  tableWrapper.style.padding = '1rem';

  const table = document.createElement('table');
  table.className = 'compare-variable-table';

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>Fork</th>
      <th>Type</th>
      <th class="compare-old">${escapeHtml(baseVersion)}</th>
      <th class="compare-new">${escapeHtml(currentVersion)}</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  changedForks.forEach(fork => {
    const currentVal = currentItem?.values[fork];
    const baseVal = baseItem?.values[fork];

    const currentParsed = parseVarValue(currentVal);
    const baseParsed = parseVarValue(baseVal);

    const displayType = currentParsed.type || baseParsed.type;
    const oldStr = baseParsed.value != null ? String(baseParsed.value) : '-';
    const newStr = currentParsed.value != null ? String(currentParsed.value) : '-';

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>
        <span class="fork-badge" style="background-color: ${getForkColor(fork)}">
          ${getForkDisplayName(fork)}
        </span>
      </td>
      <td><code>${escapeHtml(displayType || 'N/A')}</code></td>
      <td class="cell-changed cell-old"><code>${escapeHtml(oldStr)}</code></td>
      <td class="cell-changed cell-new"><code>${escapeHtml(newStr)}</code></td>
    `;
    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  tableWrapper.appendChild(table);
  box.appendChild(tableWrapper);
  container.appendChild(box);
}

/**
 * Parse a variable value — handles both { mainnet, minimal } objects and [type, value] arrays
 */
function parseVarValue(value) {
  if (value == null) return { type: '', value: null };

  // Handle { mainnet, minimal } format — use mainnet as primary
  if (typeof value === 'object' && !Array.isArray(value) && ('mainnet' in value || 'minimal' in value)) {
    const primary = value.mainnet !== undefined ? value.mainnet : value.minimal;
    return parseVarValue(primary);
  }

  if (Array.isArray(value)) {
    return { type: value[0] || '', value: value[1] !== undefined ? value[1] : '' };
  }
  return { type: '', value: value || '' };
}
