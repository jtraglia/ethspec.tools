/**
 * Spec version comparison module
 * Handles comparing the same spec item between two different versions
 */

import { collectItems, parseVariableValue } from './tree.js';
import { extractForks, getAvailableVersions, getCurrentVersion } from './specsMain.js';
import { getForkDisplayName, getForkColor } from './constants.js';

// Fork order for resolving effective values
export const FORK_ORDER = ['PHASE0', 'ALTAIR', 'BELLATRIX', 'CAPELLA', 'DENEB', 'ELECTRA', 'FULU', 'GLOAS'];

// Comparison state
const compareState = {
  active: false,
  compareVersion: null,
  compareData: null,
  compareForks: [],
  viewMode: 'unified', // 'unified' or 'side-by-side'
  currentItem: null,
  currentData: null
};

// Cache fetched version data to avoid re-fetching
const dataCache = new Map();

// Callback for when comparison exits (to re-render normal view)
let onExitCallback = null;

/**
 * Set callback for when comparison mode exits
 */
export function setOnExitCallback(fn) {
  onExitCallback = fn;
}

/**
 * Check if comparison mode is active
 */
export function isCompareActive() {
  return compareState.active;
}

/**
 * Create compare controls for the spec header
 */
export function createCompareControls(item, data) {
  const container = document.createElement('div');
  container.className = 'compare-controls';

  if (!compareState.active) {
    // Show "Compare" button
    const btn = document.createElement('button');
    btn.className = 'compare-btn';
    btn.innerHTML = '<i class="fas fa-code-compare"></i> Compare';
    btn.title = 'Compare with another version';
    btn.addEventListener('click', () => {
      showVersionDropdown(container, item, data);
    });
    container.appendChild(btn);
  } else {
    // Show active comparison controls
    renderCompareBar(container, item, data);
  }

  return container;
}

/**
 * Show version dropdown when Compare is clicked
 */
function showVersionDropdown(container, item, data) {
  const currentVersion = getCurrentVersion();
  const versions = getAvailableVersions();

  // Replace button with dropdown
  container.innerHTML = '';

  const select = document.createElement('select');
  select.className = 'compare-version-select';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select version to compare...';
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  // Sort versions: nightly first, then semver descending
  const sortedVersions = [...versions].sort((a, b) => {
    if (a === 'nightly') return -1;
    if (b === 'nightly') return 1;
    return 0; // Keep original order (already sorted by populateVersionDropdown)
  });

  sortedVersions.forEach(version => {
    if (version === currentVersion) return; // Filter out current version
    const option = document.createElement('option');
    option.value = version;
    option.textContent = version;
    select.appendChild(option);
  });

  select.addEventListener('change', () => {
    if (select.value) {
      startCompare(item, data, select.value);
    }
  });

  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'compare-btn';
  cancelBtn.innerHTML = '<i class="fas fa-times"></i>';
  cancelBtn.title = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    // Re-render with just the Compare button
    container.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'compare-btn';
    btn.innerHTML = '<i class="fas fa-code-compare"></i> Compare';
    btn.title = 'Compare with another version';
    btn.addEventListener('click', () => {
      showVersionDropdown(container, item, data);
    });
    container.appendChild(btn);
  });

  container.appendChild(select);
  container.appendChild(cancelBtn);

  // Focus the dropdown
  select.focus();
}

/**
 * Render the comparison control bar (shown when comparison is active)
 */
function renderCompareBar(container, item, data) {
  const currentVersion = getCurrentVersion();
  const versions = getAvailableVersions();

  // Version selector
  const select = document.createElement('select');
  select.className = 'compare-version-select';

  const sortedVersions = [...versions].sort((a, b) => {
    if (a === 'nightly') return -1;
    if (b === 'nightly') return 1;
    return 0;
  });

  sortedVersions.forEach(version => {
    if (version === currentVersion) return;
    const option = document.createElement('option');
    option.value = version;
    option.textContent = version;
    if (version === compareState.compareVersion) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  select.addEventListener('change', () => {
    if (select.value) {
      startCompare(item, data, select.value);
    }
  });

  // View mode toggle
  const toggleGroup = document.createElement('div');
  toggleGroup.className = 'diff-view-toggle';

  const unifiedBtn = document.createElement('button');
  unifiedBtn.className = 'diff-view-btn' + (compareState.viewMode === 'unified' ? ' active' : '');
  unifiedBtn.textContent = 'Unified';
  unifiedBtn.addEventListener('click', () => {
    compareState.viewMode = 'unified';
    renderComparison();
    // Update button states
    unifiedBtn.classList.add('active');
    sideBySideBtn.classList.remove('active');
  });

  const sideBySideBtn = document.createElement('button');
  sideBySideBtn.className = 'diff-view-btn' + (compareState.viewMode === 'side-by-side' ? ' active' : '');
  sideBySideBtn.textContent = 'Side-by-side';
  sideBySideBtn.addEventListener('click', () => {
    compareState.viewMode = 'side-by-side';
    renderComparison();
    // Update button states
    sideBySideBtn.classList.add('active');
    unifiedBtn.classList.remove('active');
  });

  toggleGroup.appendChild(unifiedBtn);
  toggleGroup.appendChild(sideBySideBtn);

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'compare-btn';
  closeBtn.innerHTML = '<i class="fas fa-times"></i> Close';
  closeBtn.title = 'Exit comparison mode';
  closeBtn.addEventListener('click', () => {
    exitCompare();
  });

  container.appendChild(select);
  container.appendChild(toggleGroup);
  container.appendChild(closeBtn);
}

/**
 * Start comparison with a specific version
 */
async function startCompare(item, data, version) {
  compareState.currentItem = item;
  compareState.currentData = data;
  compareState.compareVersion = version;
  compareState.active = true;

  const content = document.getElementById('specContent');

  // Show loading
  content.innerHTML = '<div class="diff-loading"><i class="fas fa-spinner fa-spin"></i> Loading comparison data...</div>';

  try {
    // Fetch or use cached data
    let compareData = dataCache.get(version);
    if (!compareData) {
      const response = await fetch(`pyspec/${version}/pyspec.json`);
      if (!response.ok) {
        throw new Error(`Failed to load version ${version}: ${response.status}`);
      }
      compareData = await response.json();
      dataCache.set(version, compareData);
    }

    compareState.compareData = compareData;
    compareState.compareForks = extractForks(compareData);

    // Re-render the spec header to show compare controls
    refreshSpecHeader();

    // Render the comparison
    renderComparison();
  } catch (err) {
    content.innerHTML = `
      <div class="diff-error">
        <i class="fas fa-exclamation-triangle"></i>
        <p>Error loading comparison data: ${escapeHtml(err.message)}</p>
        <button class="compare-btn" onclick="this.closest('.diff-error').remove()">Dismiss</button>
      </div>
    `;
  }
}

/**
 * Refresh the spec header to update compare controls
 */
function refreshSpecHeader() {
  const header = document.querySelector('.spec-header');
  if (!header) return;

  // Remove existing compare controls
  const existingControls = header.querySelector('.compare-controls');
  if (existingControls) {
    existingControls.remove();
  }

  // Add new controls
  const controls = createCompareControls(compareState.currentItem, compareState.currentData);
  header.appendChild(controls);
}

/**
 * Update comparison for a new item (when navigating while comparing)
 */
export function updateCompareItem(item, data) {
  compareState.currentItem = item;
  compareState.currentData = data;
  renderComparison();
}

/**
 * Exit comparison mode and re-render normal view
 */
export function exitCompare(silent = false) {
  if (!compareState.active) return;

  const item = compareState.currentItem;
  const data = compareState.currentData;

  compareState.active = false;
  compareState.compareVersion = null;
  compareState.compareData = null;
  compareState.compareForks = [];
  compareState.currentItem = null;
  compareState.currentData = null;

  refreshSpecHeader();

  // Re-render normal view (unless silent, e.g. during version switch)
  if (!silent && onExitCallback && item && data) {
    onExitCallback(item, data);
  }
}

/**
 * Main render dispatcher for comparison view
 */
function renderComparison() {
  const content = document.getElementById('specContent');
  content.innerHTML = '';

  const item = compareState.currentItem;
  const currentVersion = getCurrentVersion();
  const compareVersion = compareState.compareVersion;
  const currentData = compareState.currentData;
  const compareData = compareState.compareData;

  if (!item || !currentData || !compareData) return;

  // Extract current forks
  const currentForks = extractForks(currentData);
  const compareForks = compareState.compareForks;

  // Extract the item from both versions
  const currentExtracted = extractItemFromData(currentData, currentForks, item.name, item.category);
  const compareExtracted = extractItemFromData(compareData, compareForks, item.name, item.category);

  // Version header bar
  const headerBar = document.createElement('div');
  headerBar.className = 'compare-header-bar';
  headerBar.innerHTML = `
    <span class="compare-version-label compare-old">${escapeHtml(compareVersion)}</span>
    <i class="fas fa-arrow-right compare-arrow"></i>
    <span class="compare-version-label compare-new">${escapeHtml(currentVersion)}</span>
  `;
  content.appendChild(headerBar);

  // Check if item exists in both versions
  if (!compareExtracted && !currentExtracted) {
    const msg = document.createElement('div');
    msg.className = 'diff-item-missing';
    msg.innerHTML = `<i class="fas fa-info-circle"></i> Item <code>${escapeHtml(item.name)}</code> not found in either version.`;
    content.appendChild(msg);
    return;
  }

  const isVariable = ['constant_vars', 'preset_vars', 'config_vars'].includes(item.category);

  if (isVariable) {
    renderVariableComparison(content, compareExtracted, currentExtracted, compareVersion, currentVersion, compareForks, currentForks);
  } else {
    renderCodeComparison(content, compareExtracted, currentExtracted, compareVersion, currentVersion, compareForks, currentForks);
  }
}

/**
 * Extract an item from pyspec data by name and category
 */
function extractItemFromData(data, forks, itemName, category) {
  const items = collectItems(data, forks);
  const categoryItems = items[category];
  if (!categoryItems) return null;
  return categoryItems[itemName] || null;
}

/**
 * Resolve the effective code value at a given fork for an item.
 * Items only store forks where the value changed, so we walk backwards
 * through FORK_ORDER to find the effective value.
 */
function resolveValueAtFork(item, fork) {
  if (!item) return null;

  // If the item has a value at this fork, return it
  if (item.values[fork] !== undefined) {
    return item.values[fork];
  }

  // Walk backwards through FORK_ORDER to find the latest fork <= requested fork
  const forkIndex = FORK_ORDER.indexOf(fork);
  if (forkIndex < 0) return null;

  for (let i = forkIndex - 1; i >= 0; i--) {
    const candidateFork = FORK_ORDER[i];
    if (item.values[candidateFork] !== undefined) {
      return item.values[candidateFork];
    }
  }

  return null;
}

/**
 * Render code comparison with per-fork collapsible diff blocks
 */
function renderCodeComparison(container, oldItem, newItem, oldVer, newVer, oldForks, newForks) {
  // Handle missing items
  if (!oldItem && !newItem) return;

  if (!oldItem) {
    const msg = document.createElement('div');
    msg.className = 'diff-item-missing';
    msg.innerHTML = `<i class="fas fa-plus-circle"></i> Item <code>${escapeHtml(newItem.name)}</code> does not exist in ${escapeHtml(oldVer)} — entirely new.`;
    container.appendChild(msg);
  }

  if (!newItem) {
    const msg = document.createElement('div');
    msg.className = 'diff-item-missing';
    msg.innerHTML = `<i class="fas fa-minus-circle"></i> Item <code>${escapeHtml(oldItem.name)}</code> does not exist in ${escapeHtml(newVer)} — removed.`;
    container.appendChild(msg);
  }

  // Union all forks from both versions
  const allForks = [...new Set([...oldForks, ...newForks])];
  // Keep only forks that are in FORK_ORDER, sorted by FORK_ORDER
  const sortedForks = allForks
    .filter(f => FORK_ORDER.includes(f))
    .sort((a, b) => FORK_ORDER.indexOf(a) - FORK_ORDER.indexOf(b));

  // Only show forks where the item is introduced (first fork in item.forks) or later
  const oldIntroFork = oldItem ? FORK_ORDER.indexOf(oldItem.forks[0]) : Infinity;
  const newIntroFork = newItem ? FORK_ORDER.indexOf(newItem.forks[0]) : Infinity;
  const earliestIntro = Math.min(oldIntroFork, newIntroFork);

  const relevantForks = sortedForks.filter(f => FORK_ORDER.indexOf(f) >= earliestIntro);

  // Render diffs per fork (newest first)
  const forksReversed = [...relevantForks].reverse();
  forksReversed.forEach((fork, index) => {
    const oldCode = oldItem ? resolveValueAtFork(oldItem, fork) : null;
    const newCode = newItem ? resolveValueAtFork(newItem, fork) : null;

    // Skip forks where neither version has a value
    if (oldCode === null && newCode === null) return;

    const oldStr = oldCode != null ? String(oldCode) : '';
    const newStr = newCode != null ? String(newCode) : '';

    // Calculate diff stats
    const changes = Diff.diffLines(oldStr, newStr);
    let addedLines = 0;
    let removedLines = 0;
    changes.forEach(part => {
      const lineCount = part.value.split('\n').filter(l => l !== '' || part.value.endsWith('\n')).length;
      // Correct count: split by newline, but trailing newline creates empty string
      const lines = part.count || part.value.split('\n').length - (part.value.endsWith('\n') ? 1 : 0);
      if (part.added) addedLines += lines;
      else if (part.removed) removedLines += lines;
    });

    const hasChanges = addedLines > 0 || removedLines > 0;
    const isFirst = index === 0;

    const box = document.createElement('div');
    box.className = 'file-box diff-fork-block';

    // Header
    const header = document.createElement('div');
    header.className = 'file-header diff-fork-header';

    const icon = document.createElement('i');
    icon.className = (isFirst ? 'fas fa-chevron-down' : 'fas fa-chevron-right') + ' file-toggle-icon';

    const nameEl = document.createElement('span');
    nameEl.className = 'file-name-badge';
    nameEl.textContent = getForkDisplayName(fork);
    nameEl.style.backgroundColor = getForkColor(fork);

    const spacer = document.createElement('div');
    spacer.style.flex = '1';

    header.appendChild(icon);
    header.appendChild(nameEl);

    // Diff stats
    if (hasChanges) {
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

    header.appendChild(spacer);

    // Content
    const contentEl = document.createElement('div');
    contentEl.className = 'file-content';
    if (!isFirst) {
      contentEl.classList.add('collapsed');
    }

    if (!hasChanges) {
      const msg = document.createElement('div');
      msg.className = 'diff-no-changes';
      msg.textContent = 'No changes in this fork';
      contentEl.appendChild(msg);
    } else if (oldCode === null) {
      // Entirely new in this version
      const diffContainer = document.createElement('div');
      diffContainer.className = 'diff-container';
      renderAllAdded(diffContainer, newStr);
      contentEl.appendChild(diffContainer);
    } else if (newCode === null) {
      // Removed in this version
      const diffContainer = document.createElement('div');
      diffContainer.className = 'diff-container';
      renderAllRemoved(diffContainer, oldStr);
      contentEl.appendChild(diffContainer);
    } else {
      const diffContainer = document.createElement('div');
      diffContainer.className = 'diff-container';
      if (compareState.viewMode === 'unified') {
        renderUnifiedDiff(diffContainer, oldStr, newStr);
      } else {
        renderSideBySideDiff(diffContainer, oldStr, newStr);
      }
      contentEl.appendChild(diffContainer);
    }

    // Toggle
    header.addEventListener('click', () => {
      const isCollapsed = contentEl.classList.contains('collapsed');
      contentEl.classList.toggle('collapsed');
      icon.className = (isCollapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-right') + ' file-toggle-icon';
    });

    box.appendChild(header);
    box.appendChild(contentEl);
    container.appendChild(box);
  });
}

/**
 * Render unified diff view with line numbers
 */
export function renderUnifiedDiff(container, oldCode, newCode) {
  const changes = Diff.diffLines(oldCode, newCode);
  const oldHighlighted = highlightCodeBlock(oldCode);
  const newHighlighted = highlightCodeBlock(newCode);
  const table = document.createElement('table');
  table.className = 'diff-unified';

  let oldLineIdx = 0;
  let newLineIdx = 0;

  changes.forEach(part => {
    const lines = part.value.split('\n');
    // Remove trailing empty string from split
    if (lines[lines.length - 1] === '') lines.pop();

    lines.forEach(() => {
      const row = document.createElement('tr');

      if (part.added) {
        row.className = 'diff-line-added';
        row.innerHTML = `
          <td class="diff-line-number"></td>
          <td class="diff-line-number">${newLineIdx + 1}</td>
          <td class="diff-line-prefix">+</td>
          <td class="diff-line-content">${newHighlighted[newLineIdx]}</td>
        `;
        newLineIdx++;
      } else if (part.removed) {
        row.className = 'diff-line-removed';
        row.innerHTML = `
          <td class="diff-line-number">${oldLineIdx + 1}</td>
          <td class="diff-line-number"></td>
          <td class="diff-line-prefix">-</td>
          <td class="diff-line-content">${oldHighlighted[oldLineIdx]}</td>
        `;
        oldLineIdx++;
      } else {
        row.className = 'diff-line-context';
        row.innerHTML = `
          <td class="diff-line-number">${oldLineIdx + 1}</td>
          <td class="diff-line-number">${newLineIdx + 1}</td>
          <td class="diff-line-prefix"> </td>
          <td class="diff-line-content">${newHighlighted[newLineIdx]}</td>
        `;
        oldLineIdx++;
        newLineIdx++;
      }

      table.appendChild(row);
    });
  });

  container.appendChild(table);
}

/**
 * Render side-by-side diff view with synchronized scrolling
 */
export function renderSideBySideDiff(container, oldCode, newCode) {
  const wrapper = document.createElement('div');
  wrapper.className = 'diff-side-by-side';

  const leftPanel = document.createElement('div');
  leftPanel.className = 'diff-panel diff-panel-left';
  const leftTable = document.createElement('table');
  leftTable.className = 'diff-panel-table';

  const rightPanel = document.createElement('div');
  rightPanel.className = 'diff-panel diff-panel-right';
  const rightTable = document.createElement('table');
  rightTable.className = 'diff-panel-table';

  const changes = Diff.diffLines(oldCode, newCode);
  const oldHighlighted = highlightCodeBlock(oldCode);
  const newHighlighted = highlightCodeBlock(newCode);

  let oldLineIdx = 0;
  let newLineIdx = 0;

  changes.forEach(part => {
    const lines = part.value.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();

    lines.forEach(() => {
      if (part.added) {
        // Empty row on left, added on right
        const leftRow = document.createElement('tr');
        leftRow.className = 'diff-line-side-empty';
        leftRow.innerHTML = `<td class="diff-line-number"></td><td class="diff-line-content"></td>`;
        leftTable.appendChild(leftRow);

        const rightRow = document.createElement('tr');
        rightRow.className = 'diff-line-added';
        rightRow.innerHTML = `<td class="diff-line-number">${newLineIdx + 1}</td><td class="diff-line-content">${newHighlighted[newLineIdx]}</td>`;
        rightTable.appendChild(rightRow);
        newLineIdx++;
      } else if (part.removed) {
        // Removed on left, empty on right
        const leftRow = document.createElement('tr');
        leftRow.className = 'diff-line-removed';
        leftRow.innerHTML = `<td class="diff-line-number">${oldLineIdx + 1}</td><td class="diff-line-content">${oldHighlighted[oldLineIdx]}</td>`;
        leftTable.appendChild(leftRow);

        const rightRow = document.createElement('tr');
        rightRow.className = 'diff-line-side-empty';
        rightRow.innerHTML = `<td class="diff-line-number"></td><td class="diff-line-content"></td>`;
        rightTable.appendChild(rightRow);
        oldLineIdx++;
      } else {
        // Context line on both sides
        const leftRow = document.createElement('tr');
        leftRow.className = 'diff-line-context';
        leftRow.innerHTML = `<td class="diff-line-number">${oldLineIdx + 1}</td><td class="diff-line-content">${oldHighlighted[oldLineIdx]}</td>`;
        leftTable.appendChild(leftRow);

        const rightRow = document.createElement('tr');
        rightRow.className = 'diff-line-context';
        rightRow.innerHTML = `<td class="diff-line-number">${newLineIdx + 1}</td><td class="diff-line-content">${newHighlighted[newLineIdx]}</td>`;
        rightTable.appendChild(rightRow);
        oldLineIdx++;
        newLineIdx++;
      }
    });
  });

  leftPanel.appendChild(leftTable);
  rightPanel.appendChild(rightTable);
  wrapper.appendChild(leftPanel);
  wrapper.appendChild(rightPanel);

  // Synchronized scrolling
  let syncing = false;
  leftPanel.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    rightPanel.scrollTop = leftPanel.scrollTop;
    rightPanel.scrollLeft = leftPanel.scrollLeft;
    syncing = false;
  });
  rightPanel.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    leftPanel.scrollTop = rightPanel.scrollTop;
    leftPanel.scrollLeft = rightPanel.scrollLeft;
    syncing = false;
  });

  container.appendChild(wrapper);
}

/**
 * Render all lines as added (item new in current version)
 */
export function renderAllAdded(container, code) {
  const table = document.createElement('table');
  table.className = 'diff-unified';
  const highlighted = highlightCodeBlock(code);
  // Remove trailing empty line if present
  const lines = code.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const lineCount = lines.length;

  for (let i = 0; i < lineCount; i++) {
    const row = document.createElement('tr');
    row.className = 'diff-line-added';
    row.innerHTML = `
      <td class="diff-line-number"></td>
      <td class="diff-line-number">${i + 1}</td>
      <td class="diff-line-prefix">+</td>
      <td class="diff-line-content">${highlighted[i]}</td>
    `;
    table.appendChild(row);
  }

  container.appendChild(table);
}

/**
 * Render all lines as removed (item removed in current version)
 */
export function renderAllRemoved(container, code) {
  const table = document.createElement('table');
  table.className = 'diff-unified';
  const highlighted = highlightCodeBlock(code);
  const lines = code.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const lineCount = lines.length;

  for (let i = 0; i < lineCount; i++) {
    const row = document.createElement('tr');
    row.className = 'diff-line-removed';
    row.innerHTML = `
      <td class="diff-line-number">${i + 1}</td>
      <td class="diff-line-number"></td>
      <td class="diff-line-prefix">-</td>
      <td class="diff-line-content">${highlighted[i]}</td>
    `;
    table.appendChild(row);
  }

  container.appendChild(table);
}

/**
 * Render variable comparison table
 */
function renderVariableComparison(container, oldItem, newItem, oldVer, newVer, oldForks, newForks) {
  if (!oldItem && !newItem) return;

  if (!oldItem) {
    const msg = document.createElement('div');
    msg.className = 'diff-item-missing';
    msg.innerHTML = `<i class="fas fa-plus-circle"></i> Variable <code>${escapeHtml(newItem.name)}</code> does not exist in ${escapeHtml(oldVer)} — entirely new.`;
    container.appendChild(msg);
  }

  if (!newItem) {
    const msg = document.createElement('div');
    msg.className = 'diff-item-missing';
    msg.innerHTML = `<i class="fas fa-minus-circle"></i> Variable <code>${escapeHtml(oldItem.name)}</code> does not exist in ${escapeHtml(newVer)} — removed.`;
    container.appendChild(msg);
  }

  const item = newItem || oldItem;

  // Union all forks
  const allForks = [...new Set([...oldForks, ...newForks])];
  const sortedForks = allForks
    .filter(f => FORK_ORDER.includes(f))
    .sort((a, b) => FORK_ORDER.indexOf(a) - FORK_ORDER.indexOf(b));

  // Determine earliest introduction fork
  const oldIntroFork = oldItem ? FORK_ORDER.indexOf(oldItem.forks[0]) : Infinity;
  const newIntroFork = newItem ? FORK_ORDER.indexOf(newItem.forks[0]) : Infinity;
  const earliestIntro = Math.min(oldIntroFork, newIntroFork);

  const relevantForks = sortedForks.filter(f => FORK_ORDER.indexOf(f) >= earliestIntro);

  const box = document.createElement('div');
  box.className = 'fork-box';

  const tableWrapper = document.createElement('div');
  tableWrapper.style.padding = '1rem';

  const table = document.createElement('table');
  table.className = 'compare-variable-table';

  // Check if any fork has different mainnet/minimal values
  const hasDifferences = relevantForks.some(fork => {
    const val = (newItem ? resolveVariableValueAtFork(newItem, fork) : null)
             || (oldItem ? resolveVariableValueAtFork(oldItem, fork) : null);
    if (val && typeof val === 'object' && !Array.isArray(val) && ('mainnet' in val || 'minimal' in val)) {
      const mainnet = parseVariableValue(val.mainnet);
      const minimal = parseVariableValue(val.minimal);
      return String(mainnet.value) !== String(minimal.value);
    }
    return false;
  });

  const thead = document.createElement('thead');
  if (hasDifferences) {
    thead.innerHTML = `
      <tr>
        <th>Fork</th>
        <th>Type</th>
        <th class="compare-old" colspan="2">${escapeHtml(oldVer)}</th>
        <th class="compare-new" colspan="2">${escapeHtml(newVer)}</th>
      </tr>
      <tr>
        <th></th>
        <th></th>
        <th class="compare-old">Mainnet</th>
        <th class="compare-old">Minimal</th>
        <th class="compare-new">Mainnet</th>
        <th class="compare-new">Minimal</th>
      </tr>
    `;
  } else {
    thead.innerHTML = `
      <tr>
        <th>Fork</th>
        <th>Type</th>
        <th class="compare-old">${escapeHtml(oldVer)}</th>
        <th class="compare-new">${escapeHtml(newVer)}</th>
      </tr>
    `;
  }
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  // Show forks newest first
  const forksReversed = [...relevantForks].reverse();
  forksReversed.forEach(fork => {
    const oldValue = oldItem ? resolveVariableValueAtFork(oldItem, fork) : null;
    const newValue = newItem ? resolveVariableValueAtFork(newItem, fork) : null;

    if (oldValue === null && newValue === null) return;

    const row = document.createElement('tr');

    if (hasDifferences) {
      const oldMainnet = getNetworkValueStr(oldValue, 'mainnet');
      const oldMinimal = getNetworkValueStr(oldValue, 'minimal');
      const newMainnet = getNetworkValueStr(newValue, 'mainnet');
      const newMinimal = getNetworkValueStr(newValue, 'minimal');
      const mainnetChanged = oldMainnet !== newMainnet;
      const minimalChanged = oldMinimal !== newMinimal;
      const displayType = getDisplayType(newValue) || getDisplayType(oldValue) || 'N/A';

      row.innerHTML = `
        <td>
          <span class="fork-badge" style="background-color: ${getForkColor(fork)}">
            ${getForkDisplayName(fork)}
          </span>
        </td>
        <td><code>${escapeHtml(displayType)}</code></td>
        <td class="${mainnetChanged ? 'cell-changed cell-old' : ''}"><code>${escapeHtml(oldMainnet)}</code></td>
        <td class="${minimalChanged ? 'cell-changed cell-old' : ''}"><code>${escapeHtml(oldMinimal)}</code></td>
        <td class="${mainnetChanged ? 'cell-changed cell-new' : ''}"><code>${escapeHtml(newMainnet)}</code></td>
        <td class="${minimalChanged ? 'cell-changed cell-new' : ''}"><code>${escapeHtml(newMinimal)}</code></td>
      `;
    } else {
      const oldParsed = oldValue ? parseVariableValue(getNetworkOrRaw(oldValue)) : { type: '', value: '' };
      const newParsed = newValue ? parseVariableValue(getNetworkOrRaw(newValue)) : { type: '', value: '' };
      const oldValStr = String(oldParsed.value);
      const newValStr = String(newParsed.value);
      const changed = oldValStr !== newValStr;

      row.innerHTML = `
        <td>
          <span class="fork-badge" style="background-color: ${getForkColor(fork)}">
            ${getForkDisplayName(fork)}
          </span>
        </td>
        <td><code>${escapeHtml(newParsed.type || oldParsed.type || 'N/A')}</code></td>
        <td class="${changed ? 'cell-changed cell-old' : ''}"><code>${escapeHtml(oldValStr)}</code></td>
        <td class="${changed ? 'cell-changed cell-new' : ''}"><code>${escapeHtml(newValStr)}</code></td>
      `;
    }
    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  tableWrapper.appendChild(table);
  box.appendChild(tableWrapper);
  container.appendChild(box);
}

/**
 * Resolve variable value at a fork (walk backwards through FORK_ORDER)
 */
function resolveVariableValueAtFork(item, fork) {
  if (!item) return null;
  if (item.values[fork] !== undefined) return item.values[fork];

  const forkIndex = FORK_ORDER.indexOf(fork);
  if (forkIndex < 0) return null;

  for (let i = forkIndex - 1; i >= 0; i--) {
    const candidateFork = FORK_ORDER[i];
    if (item.values[candidateFork] !== undefined) {
      return item.values[candidateFork];
    }
  }

  return null;
}

/**
 * Get a specific network's value string from a variable value
 */
function getNetworkValueStr(value, network) {
  if (value == null) return '-';
  if (typeof value === 'object' && !Array.isArray(value) && ('mainnet' in value || 'minimal' in value)) {
    const networkVal = value[network];
    if (networkVal == null) return '-';
    const parsed = parseVariableValue(networkVal);
    return parsed.value != null ? String(parsed.value) : '-';
  }
  const parsed = parseVariableValue(value);
  return parsed.value != null ? String(parsed.value) : '-';
}

/**
 * Get the mainnet (or raw) value from a variable for simple parsing
 */
function getNetworkOrRaw(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && ('mainnet' in value || 'minimal' in value)) {
    return value.mainnet !== undefined ? value.mainnet : value.minimal;
  }
  return value;
}

/**
 * Get display type from a variable value
 */
function getDisplayType(value) {
  if (value == null) return '';
  if (typeof value === 'object' && !Array.isArray(value) && ('mainnet' in value || 'minimal' in value)) {
    const primary = value.mainnet !== undefined ? value.mainnet : value.minimal;
    return parseVariableValue(primary).type;
  }
  return parseVariableValue(value).type;
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Syntax-highlight an entire code block and return an array of per-line HTML strings.
 * Highlights the full block so Prism understands multi-line constructs (docstrings, etc.),
 * then splits into lines while preserving open span tags across line boundaries.
 */
export function highlightCodeBlock(code) {
  if (typeof Prism === 'undefined' || !Prism.languages.python) {
    return code.split('\n').map(line => escapeHtml(line));
  }

  const highlighted = Prism.highlight(code, Prism.languages.python, 'python');
  const rawLines = highlighted.split('\n');
  const result = [];
  let openTags = []; // Stack of opening span tags inherited from previous lines

  for (const rawLine of rawLines) {
    // Prepend any open tags from previous lines
    const prefix = openTags.join('');

    // Track opens/closes in this line to find what's still open at end
    const newOpenTags = [...openTags];
    const tagRegex = /<(\/?)span([^>]*)>/g;
    let match;
    while ((match = tagRegex.exec(rawLine)) !== null) {
      if (match[1] === '/') {
        newOpenTags.pop();
      } else {
        newOpenTags.push(`<span${match[2]}>`);
      }
    }

    // Close any inherited+new open tags at end of this line
    const suffix = '</span>'.repeat(newOpenTags.length);
    result.push(prefix + rawLine + suffix);
    openTags = newOpenTags;
  }

  return result;
}
