/**
 * Specification viewer module - displays selected items
 */

import { getForkDisplayName, getForkColor, getForkShortLabel, getCategoryDisplayName } from './constants.js';
import { addClickableReferences, getUsedBy, navigateToReference } from './references.js';
import { renderUnifiedDiff, renderSideBySideDiff, renderAllAdded } from './specCompare.js';
import { isChangelogActive, renderChangelogItem } from './changelog.js';

// Current item being displayed
let currentItem = null;

// Reference to getCurrentVersion function (set by specsMain)
let getCurrentVersionFn = null;

// Fork diff view state (persists across navigation)
const forkDiffState = {
  mode: 'code',           // 'code' or 'diff'
  diffViewMode: 'unified' // 'unified' or 'side-by-side'
};

/**
 * Set the getCurrentVersion function reference
 */
export function setGetCurrentVersion(fn) {
  getCurrentVersionFn = fn;
}

/**
 * Create a "Used by" section showing items that reference this item
 * @param {string} itemName - The name of the current item
 * @returns {HTMLElement|null} - The used by section element, or null if no usages
 */
function createUsedBySection(itemName) {
  const usedBy = getUsedBy(itemName);
  if (usedBy.length === 0) return null;

  const section = document.createElement('div');
  section.className = 'used-by-section';

  const header = document.createElement('div');
  header.className = 'used-by-header';
  header.innerHTML = `<span class="used-by-title">Consumers</span>`;
  section.appendChild(header);

  const list = document.createElement('div');
  list.className = 'used-by-list';

  usedBy.forEach(refName => {
    const item = document.createElement('button');
    item.className = 'used-by-item';
    item.innerHTML = `<code>${escapeHtml(refName)}</code>`;
    item.title = `Jump to ${refName}`;
    item.addEventListener('click', () => {
      navigateToReference(refName, true);
    });
    list.appendChild(item);
  });

  section.appendChild(list);
  return section;
}

/**
 * Display a specification item
 */
export function displaySpec(item, data) {
  currentItem = item;

  const title = document.getElementById('specTitle');
  const breadcrumb = document.getElementById('specBreadcrumb');
  const content = document.getElementById('specContent');

  // Set title as inline code
  title.innerHTML = `<code>${item.name}</code>`;

  // Set breadcrumb
  breadcrumb.innerHTML = `
    <span>${getCategoryDisplayName(item.category)}</span> /
    <span>${getForkDisplayName(item.forks[0])}</span> /
    <span>${item.name}</span>
  `;

  // Update URL hash for direct linking (include version)
  const version = getCurrentVersionFn ? getCurrentVersionFn() : 'nightly';
  const itemId = `specs/${version}/${item.category}-${item.name}`;
  history.replaceState(null, '', `#${itemId}`);

  // Manage Code/Diff toggle in header
  const header = document.querySelector('.spec-header');
  const existingToggle = header.querySelector('.fork-diff-toggle-bar');
  if (existingToggle) existingToggle.remove();

  // Clear existing content
  content.innerHTML = '';

  // If changelog mode is active, render changelog diff instead of normal view
  if (isChangelogActive()) {
    renderChangelogItem(item, content);
    return;
  }

  // Check if this is a variable type (constants, presets, config) or code type
  const isVariable = ['constant_vars', 'preset_vars', 'config_vars'].includes(item.category);

  if (isVariable) {
    displayVariable(item, content);
    // Add "Used by" section
    const usedBySection = createUsedBySection(item.name);
    if (usedBySection) {
      content.appendChild(usedBySection);
    }
  } else {
    renderCodeView(item, content);
  }
}

/**
 * Parse a variable value array into type and value
 */
function parseVariableValue(value) {
  if (Array.isArray(value)) {
    return {
      type: value[0] || '',
      value: value[1] !== undefined ? value[1] : ''
    };
  }
  return { type: '', value: value || '' };
}

/**
 * Check if mainnet and minimal values differ for any fork in the item
 */
function hasNetworkDifferences(item) {
  for (const fork of item.forks) {
    const forkValue = item.values[fork];
    if (forkValue && typeof forkValue === 'object' && ('mainnet' in forkValue || 'minimal' in forkValue)) {
      const mainnetParsed = parseVariableValue(forkValue.mainnet);
      const minimalParsed = parseVariableValue(forkValue.minimal);
      if (String(mainnetParsed.value) !== String(minimalParsed.value)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Display a variable item (constants, presets, config)
 * Only shows forks where the value changed
 */
function displayVariable(item, container) {
  // Check if there are differences between mainnet and minimal
  const hasDifferences = hasNetworkDifferences(item);

  // Create a table showing values across forks
  const box = document.createElement('div');
  box.className = 'fork-box';

  // Header with copy link button
  const header = document.createElement('div');
  header.className = 'variable-header';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-link-icon';
  copyBtn.innerHTML = '<i class="fas fa-link"></i>';
  copyBtn.title = 'Copy link to this item';
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Build URL with version
    const version = getCurrentVersionFn ? getCurrentVersionFn() : 'nightly';
    const itemId = `specs/${version}/${item.category}-${item.name}`;
    const url = new URL(window.location.href);
    url.hash = itemId;
    navigator.clipboard.writeText(url.href).then(() => {
      copyBtn.innerHTML = '<i class="fas fa-check"></i>';
      setTimeout(() => {
        copyBtn.innerHTML = '<i class="fas fa-link"></i>';
      }, 1500);
    });
  });

  header.appendChild(copyBtn);
  box.appendChild(header);

  const tableWrapper = document.createElement('div');
  tableWrapper.style.padding = '0 1rem 1rem 1rem';

  const table = document.createElement('table');
  table.className = 'variable-table';

  // Header - show separate columns only if values differ
  const thead = document.createElement('thead');
  if (hasDifferences) {
    thead.innerHTML = `
      <tr>
        <th>Fork</th>
        <th>Type</th>
        <th>Mainnet</th>
        <th>Minimal</th>
      </tr>
    `;
  } else {
    thead.innerHTML = `
      <tr>
        <th>Fork</th>
        <th>Type</th>
        <th>Value</th>
      </tr>
    `;
  }
  table.appendChild(thead);

  // Body - show each fork's value (item.forks already only contains forks where value changed)
  const tbody = document.createElement('tbody');

  // Reverse to show newest first
  const forksReversed = [...item.forks].reverse();

  forksReversed.forEach(fork => {
    const forkValue = item.values[fork];

    // Handle both old format (single value) and new format ({ mainnet, minimal })
    let mainnetParsed, minimalParsed;
    if (forkValue && typeof forkValue === 'object' && ('mainnet' in forkValue || 'minimal' in forkValue)) {
      mainnetParsed = parseVariableValue(forkValue.mainnet);
      minimalParsed = parseVariableValue(forkValue.minimal);
    } else {
      // Old format - same value for both
      mainnetParsed = parseVariableValue(forkValue);
      minimalParsed = mainnetParsed;
    }

    const row = document.createElement('tr');

    // Use mainnet type, or minimal if mainnet not available
    const displayType = mainnetParsed.type || minimalParsed.type;
    const typeCell = displayType ? `<code>${escapeHtml(displayType)}</code>` : 'N/A';

    if (hasDifferences) {
      row.innerHTML = `
        <td>
          <span class="fork-badge" style="background-color: ${getForkColor(fork)}">
            ${getForkDisplayName(fork)}
          </span>
        </td>
        <td>${typeCell}</td>
        <td><code>${escapeHtml(String(mainnetParsed.value))}</code></td>
        <td><code>${escapeHtml(String(minimalParsed.value))}</code></td>
      `;
    } else {
      row.innerHTML = `
        <td>
          <span class="fork-badge" style="background-color: ${getForkColor(fork)}">
            ${getForkDisplayName(fork)}
          </span>
        </td>
        <td>${typeCell}</td>
        <td><code>${escapeHtml(String(mainnetParsed.value))}</code></td>
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
 * Orchestrator for code item rendering.
 * Clears the container, adds the Code/Diff toggle bar (if applicable),
 * dispatches to displayCode or displayForkDiffs, then appends "Used by".
 */
function renderCodeView(item, container) {
  container.innerHTML = '';

  const hasMultipleForks = item.forks.length >= 2;
  const isSideBySideDiff = hasMultipleForks && forkDiffState.mode === 'diff' && forkDiffState.diffViewMode === 'side-by-side';

  // Widen the viewer for side-by-side diffs
  const viewer = document.getElementById('specViewer');
  if (viewer) {
    viewer.classList.toggle('wide-diff', isSideBySideDiff);
  }

  // Add toggle bar for multi-fork items in the spec header
  const header = document.querySelector('.spec-header');
  const existingToggle = header.querySelector('.fork-diff-toggle-bar');
  if (existingToggle) existingToggle.remove();
  const toggleBar = createForkDiffToggle(item, container);
  if (toggleBar) {
    header.appendChild(toggleBar);
  }

  // Render based on mode
  if (hasMultipleForks && forkDiffState.mode === 'diff') {
    displayForkDiffs(item, container);
  } else {
    displayCode(item, container);
  }

  // Add "Used by" section
  const usedBySection = createUsedBySection(item.name);
  if (usedBySection) {
    container.appendChild(usedBySection);
  }
}

/**
 * Create the Code/Diff toggle bar for multi-fork items.
 * Returns null for single-fork items.
 */
function createForkDiffToggle(item, container) {
  if (item.forks.length < 2) return null;

  const bar = document.createElement('div');
  bar.className = 'fork-diff-toggle-bar';

  // Code / Diff toggle
  const modeToggle = document.createElement('div');
  modeToggle.className = 'diff-view-toggle';

  const codeBtn = document.createElement('button');
  codeBtn.className = 'diff-view-btn' + (forkDiffState.mode === 'code' ? ' active' : '');
  codeBtn.textContent = 'Code';
  codeBtn.addEventListener('click', () => {
    if (forkDiffState.mode === 'code') return;
    forkDiffState.mode = 'code';
    renderCodeView(item, container);
  });

  const diffBtn = document.createElement('button');
  diffBtn.className = 'diff-view-btn' + (forkDiffState.mode === 'diff' ? ' active' : '');
  diffBtn.textContent = 'Diff';
  diffBtn.addEventListener('click', () => {
    if (forkDiffState.mode === 'diff') return;
    forkDiffState.mode = 'diff';
    renderCodeView(item, container);
  });

  modeToggle.appendChild(codeBtn);
  modeToggle.appendChild(diffBtn);
  bar.appendChild(modeToggle);

  // Unified / Side-by-side sub-toggle (only in diff mode)
  if (forkDiffState.mode === 'diff') {
    const viewToggle = document.createElement('div');
    viewToggle.className = 'diff-view-toggle';

    const unifiedBtn = document.createElement('button');
    unifiedBtn.className = 'diff-view-btn' + (forkDiffState.diffViewMode === 'unified' ? ' active' : '');
    unifiedBtn.textContent = 'Unified';
    unifiedBtn.addEventListener('click', () => {
      if (forkDiffState.diffViewMode === 'unified') return;
      forkDiffState.diffViewMode = 'unified';
      renderCodeView(item, container);
    });

    const sideBySideBtn = document.createElement('button');
    sideBySideBtn.className = 'diff-view-btn' + (forkDiffState.diffViewMode === 'side-by-side' ? ' active' : '');
    sideBySideBtn.textContent = 'Side-by-side';
    sideBySideBtn.addEventListener('click', () => {
      if (forkDiffState.diffViewMode === 'side-by-side') return;
      forkDiffState.diffViewMode = 'side-by-side';
      renderCodeView(item, container);
    });

    viewToggle.appendChild(unifiedBtn);
    viewToggle.appendChild(sideBySideBtn);
    bar.appendChild(viewToggle);
  }

  return bar;
}

/**
 * Strip comment-only lines from Python code.
 * Removes lines where the only non-whitespace content is a # comment,
 * to produce cleaner diffs between forks.
 */
function stripComments(code) {
  return code.split('\n')
    .filter(line => !(/^\s*#/.test(line)))
    .join('\n')
    .trimEnd() + '\n';
}

/**
 * Display fork diffs for a code item.
 * Iterates forks newest-first. For the oldest fork, renders all lines as added.
 * For each subsequent fork, computes diff from the previous fork's code.
 */
function displayForkDiffs(item, container) {
  const forksReversed = [...item.forks].reverse();

  forksReversed.forEach((fork, index) => {
    const value = item.values[fork];
    const isFirst = index === 0; // newest fork, expanded by default
    const isOldest = index === forksReversed.length - 1;

    // Find the previous fork (one step older) code for diffing
    const olderForkIndex = item.forks.indexOf(fork) - 1;
    const olderFork = olderForkIndex >= 0 ? item.forks[olderForkIndex] : null;
    const olderCode = olderFork ? item.values[olderFork] : null;

    const box = document.createElement('div');
    box.className = 'file-box fork-code-block diff-fork-block';
    box.dataset.fork = fork;

    // Header
    const header = document.createElement('div');
    header.className = 'file-header diff-fork-header';

    const icon = document.createElement('i');
    icon.className = (isFirst ? 'fas fa-chevron-down' : 'fas fa-chevron-right') + ' file-toggle-icon';

    const nameEl = document.createElement('span');
    nameEl.className = 'file-name-badge';
    nameEl.textContent = getForkDisplayName(fork);
    nameEl.style.backgroundColor = getForkColor(fork);

    header.appendChild(icon);
    header.appendChild(nameEl);

    // Strip comments for cleaner diffs
    const strippedValue = stripComments(String(value));
    const strippedOlderCode = olderCode != null ? stripComments(String(olderCode)) : null;

    // Diff stats
    if (isOldest) {
      // Oldest fork: all lines are "added"
      const lines = strippedValue.split('\n');
      const lineCount = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
      const stats = document.createElement('span');
      stats.className = 'diff-stats';
      stats.innerHTML = `<span class="diff-stat-added">+${lineCount}</span>`;
      header.appendChild(stats);
    } else {
      // Compute diff stats
      const changes = Diff.diffLines(strippedOlderCode, strippedValue);
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

    // Spacer + copy link button
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    header.appendChild(spacer);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-link-icon';
    copyBtn.innerHTML = '<i class="fas fa-link"></i>';
    copyBtn.title = 'Copy link to this item';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const version = getCurrentVersionFn ? getCurrentVersionFn() : 'nightly';
      const itemId = `specs/${version}/${item.category}-${item.name}-${fork.toLowerCase()}`;
      const url = new URL(window.location.href);
      url.hash = itemId;
      navigator.clipboard.writeText(url.href).then(() => {
        copyBtn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => {
          copyBtn.innerHTML = '<i class="fas fa-link"></i>';
        }, 1500);
      });
    });
    header.appendChild(copyBtn);

    // Content
    const contentEl = document.createElement('div');
    contentEl.className = 'file-content';
    if (!isFirst) {
      contentEl.classList.add('collapsed');
    }

    const diffContainer = document.createElement('div');
    diffContainer.className = 'diff-container';

    if (isOldest) {
      // Oldest fork: show all lines as added
      renderAllAdded(diffContainer, strippedValue);
    } else {
      if (forkDiffState.diffViewMode === 'unified') {
        renderUnifiedDiff(diffContainer, strippedOlderCode, strippedValue);
      } else {
        renderSideBySideDiff(diffContainer, strippedOlderCode, strippedValue);
      }
    }

    contentEl.appendChild(diffContainer);

    // Toggle functionality
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
 * Display a code item (functions, types, classes, etc.)
 * Only shows forks where the value changed
 */
function displayCode(item, container) {
  // Show each fork's code in collapsible boxes
  // item.forks already only contains forks where the code changed
  // Reverse to show newest first
  const forksReversed = [...item.forks].reverse();

  forksReversed.forEach((fork, index) => {
    const value = item.values[fork];
    const isFirst = index === 0;

    const box = document.createElement('div');
    box.className = 'file-box fork-code-block';
    box.dataset.fork = fork;

    // Header (matching test viewer style)
    const header = document.createElement('div');
    header.className = 'file-header';

    const icon = document.createElement('i');
    icon.className = isFirst ? 'fas fa-chevron-down file-toggle-icon' : 'fas fa-chevron-right file-toggle-icon';

    const nameEl = document.createElement('span');
    nameEl.className = 'file-name-badge';
    nameEl.textContent = getForkDisplayName(fork);
    nameEl.style.backgroundColor = getForkColor(fork);

    // Copy link button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-link-icon';
    copyBtn.innerHTML = '<i class="fas fa-link"></i>';
    copyBtn.title = 'Copy link to this item';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Don't toggle the collapsible
      // Include version and fork in the URL hash: specs/version/category-itemName-fork
      const version = getCurrentVersionFn ? getCurrentVersionFn() : 'nightly';
      const itemId = `specs/${version}/${item.category}-${item.name}-${fork.toLowerCase()}`;
      const url = new URL(window.location.href);
      url.hash = itemId;
      navigator.clipboard.writeText(url.href).then(() => {
        copyBtn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => {
          copyBtn.innerHTML = '<i class="fas fa-link"></i>';
        }, 1500);
      });
    });

    // Spacer to push copy button to the right
    const spacer = document.createElement('div');
    spacer.style.flex = '1';

    header.appendChild(icon);
    header.appendChild(nameEl);
    header.appendChild(spacer);
    header.appendChild(copyBtn);

    // Content
    const content = document.createElement('div');
    content.className = 'file-content';
    if (!isFirst) {
      content.classList.add('collapsed');
    }

    const codeBox = document.createElement('pre');
    codeBox.className = 'test-code-box';

    const code = document.createElement('code');
    code.className = 'language-python';
    code.textContent = value;

    codeBox.appendChild(code);
    content.appendChild(codeBox);

    // Toggle functionality
    header.addEventListener('click', () => {
      const isCollapsed = content.classList.contains('collapsed');
      content.classList.toggle('collapsed');
      icon.className = isCollapsed ? 'fas fa-chevron-down file-toggle-icon' : 'fas fa-chevron-right file-toggle-icon';
    });

    box.appendChild(header);
    box.appendChild(content);
    container.appendChild(box);
  });

  // Trigger syntax highlighting
  if (typeof Prism !== 'undefined') {
    Prism.highlightAllUnder(container);
  }

  // Add clickable references after syntax highlighting
  // Use broader selector since Prism may add additional classes
  container.querySelectorAll('code[class*="language-python"]').forEach(block => {
    addClickableReferences(block);
  });
}

// Fork order for finding the best matching fork
const FORK_ORDER = ['PHASE0', 'ALTAIR', 'BELLATRIX', 'CAPELLA', 'DENEB', 'ELECTRA', 'FULU', 'GLOAS'];

/**
 * Open a specific fork in the current spec viewer
 * @param {string} preferredFork - The fork to try to open
 */
export function openForkInViewer(preferredFork) {
  const content = document.getElementById('specContent');
  if (!content) return;

  const forkBlocks = content.querySelectorAll('.fork-code-block');
  if (forkBlocks.length === 0) return;

  let forkToOpen = null;

  // If a preferred fork is specified, try to find it
  if (preferredFork) {
    for (const block of forkBlocks) {
      if (block.dataset.fork === preferredFork) {
        forkToOpen = block;
        break;
      }
    }

    // If preferred fork not found, find the most recent fork <= preferred fork
    if (!forkToOpen) {
      const preferredIndex = FORK_ORDER.indexOf(preferredFork);
      if (preferredIndex >= 0) {
        const availableForks = Array.from(forkBlocks).map(block => block.dataset.fork);

        // Starting from preferred fork, go backwards to find the latest one that exists
        for (let i = preferredIndex; i >= 0; i--) {
          const candidateFork = FORK_ORDER[i];
          if (availableForks.includes(candidateFork)) {
            forkToOpen = Array.from(forkBlocks).find(block => block.dataset.fork === candidateFork);
            break;
          }
        }
      }
    }
  }

  // If still not found, open the first one (latest fork available, since they're reversed)
  if (!forkToOpen) {
    forkToOpen = forkBlocks[0];
  }

  // Collapse all fork blocks, then expand the selected one
  forkBlocks.forEach(block => {
    const content = block.querySelector('.file-content');
    const icon = block.querySelector('.file-toggle-icon');
    if (content && icon) {
      if (block === forkToOpen) {
        content.classList.remove('collapsed');
        icon.className = 'fas fa-chevron-down file-toggle-icon';
      } else {
        content.classList.add('collapsed');
        icon.className = 'fas fa-chevron-right file-toggle-icon';
      }
    }
  });
}

/**
 * Clear the spec viewer
 */
export function clearSpec() {
  currentItem = null;

  document.getElementById('specTitle').textContent = '';
  document.getElementById('specBreadcrumb').innerHTML = '';
  document.getElementById('specContent').innerHTML = '';

  document.getElementById('specViewer').classList.add('hidden');
  document.getElementById('welcome').classList.remove('hidden');
}

/**
 * Show a "not found" message when an item doesn't exist in the selected version
 * @param {string} itemName - The name of the item that wasn't found
 * @param {string} version - The version being viewed
 */
export function showItemNotFound(itemName, version) {
  const title = document.getElementById('specTitle');
  const breadcrumb = document.getElementById('specBreadcrumb');
  const content = document.getElementById('specContent');

  title.innerHTML = `<code>${escapeHtml(itemName)}</code>`;
  breadcrumb.innerHTML = `<span>Not found in ${escapeHtml(version)}</span>`;

  content.innerHTML = `
    <div class="not-found-message">
      <i class="fas fa-exclamation-triangle"></i>
      <p>This specification item does not exist in version <strong>${escapeHtml(version)}</strong></p>
      <p>Try selecting a different version from the dropdown</p>
    </div>
  `;

  document.getElementById('welcome').classList.add('hidden');
  document.getElementById('specViewer').classList.remove('hidden');
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
