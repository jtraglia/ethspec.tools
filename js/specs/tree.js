/**
 * Tree navigation module for the specification viewer
 */

import { getForkDisplayName, getForkColor, getForkShortLabel, getCategoryDisplayName, CATEGORY_ORDER } from './constants.js';
import { registerItem, clearRegistry, buildUsedByIndex } from './references.js';

// Callback for when an item is selected
let onItemSelectCallback = null;

// Cache for tree nodes
let treeNodes = [];

/**
 * Set the callback for item selection
 */
export function setOnItemSelectCallback(callback) {
  onItemSelectCallback = callback;
}

// Fork suffixes in order (oldest to newest)
const FORK_SUFFIXES = ['_PHASE0', '_ALTAIR', '_BELLATRIX', '_CAPELLA', '_DENEB', '_ELECTRA', '_FULU', '_GLOAS'];

/**
 * Get the base name of a variable by stripping fork suffixes
 * Returns { baseName, hasSuffix, suffixIndex }
 */
function getBaseName(name) {
  for (let i = 0; i < FORK_SUFFIXES.length; i++) {
    const suffix = FORK_SUFFIXES[i];
    if (name.endsWith(suffix)) {
      return { baseName: name.slice(0, -suffix.length), hasSuffix: true, suffixIndex: i };
    }
  }
  return { baseName: name, hasSuffix: false, suffixIndex: -1 };
}

/**
 * Parse a variable value array into type and value
 */
export function parseVariableValue(value) {
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
 * Get the best (latest) version value for a variable from a fork's category data
 */
function getBestVersionValue(categoryData) {
  const bestVersion = {}; // baseName -> { value, suffixIndex }

  Object.entries(categoryData).forEach(([name, value]) => {
    const { baseName, suffixIndex } = getBaseName(name);

    if (!bestVersion[baseName]) {
      bestVersion[baseName] = { value, suffixIndex };
    } else if (suffixIndex > bestVersion[baseName].suffixIndex) {
      bestVersion[baseName] = { value, suffixIndex };
    }
  });

  return bestVersion;
}

/**
 * Collect all items from the data, tracking only forks where the value changed
 */
export function collectItems(data, forks) {
  const mainnetData = data.mainnet;
  const minimalData = data.minimal;
  if (!mainnetData && !minimalData) return {};

  // Use mainnet as primary for determining forks/changes
  const primaryData = mainnetData || minimalData;

  const items = {};

  // For each category
  CATEGORY_ORDER.forEach(category => {
    items[category] = {};

    // Track last value for each item to detect changes (using mainnet)
    const lastValues = {};

    // Check if this is a variable category that needs consolidation
    const isVariableCategory = ['constant_vars', 'preset_vars', 'config_vars'].includes(category);

    // For each fork in order
    forks.forEach(fork => {
      const mainnetForkData = mainnetData && (mainnetData[fork] || mainnetData[fork.toLowerCase()]);
      const minimalForkData = minimalData && (minimalData[fork] || minimalData[fork.toLowerCase()]);

      const mainnetCategoryData = mainnetForkData && mainnetForkData[category];
      const minimalCategoryData = minimalForkData && minimalForkData[category];

      if (!mainnetCategoryData && !minimalCategoryData) return;

      if (isVariableCategory) {
        // Get best versions for both networks
        const mainnetBest = mainnetCategoryData ? getBestVersionValue(mainnetCategoryData) : {};
        const minimalBest = minimalCategoryData ? getBestVersionValue(minimalCategoryData) : {};

        // Combine all base names from both networks
        const allBaseNames = new Set([...Object.keys(mainnetBest), ...Object.keys(minimalBest)]);

        allBaseNames.forEach(baseName => {
          const mainnetValue = mainnetBest[baseName]?.value;
          const minimalValue = minimalBest[baseName]?.value;

          // Use mainnet value for change detection
          const valueStr = JSON.stringify(mainnetValue || minimalValue);

          if (!items[category][baseName]) {
            items[category][baseName] = {
              name: baseName,
              category,
              forks: [fork],
              values: { [fork]: { mainnet: mainnetValue, minimal: minimalValue } }
            };
            lastValues[baseName] = valueStr;
          } else if (lastValues[baseName] !== valueStr) {
            if (!items[category][baseName].forks.includes(fork)) {
              items[category][baseName].forks.push(fork);
            }
            items[category][baseName].values[fork] = { mainnet: mainnetValue, minimal: minimalValue };
            lastValues[baseName] = valueStr;
          }
        });
      } else {
        // Non-variable categories - no consolidation needed, use mainnet only
        const categoryData = mainnetCategoryData || minimalCategoryData;
        Object.entries(categoryData).forEach(([name, value]) => {
          const valueStr = JSON.stringify(value);

          if (!items[category][name]) {
            items[category][name] = {
              name,
              category,
              forks: [fork],
              values: { [fork]: value }
            };
            lastValues[name] = valueStr;
          } else if (lastValues[name] !== valueStr) {
            items[category][name].forks.push(fork);
            items[category][name].values[fork] = value;
            lastValues[name] = valueStr;
          }
        });
      }
    });
  });

  return items;
}

/**
 * Create a tree node element
 */
function createTreeNode(label, hasChildren = false, isLeaf = false) {
  const node = document.createElement('div');
  node.className = 'tree-node';

  const labelEl = document.createElement('div');
  labelEl.className = 'tree-label';

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  if (hasChildren) {
    icon.innerHTML = '<i class="fas fa-chevron-right"></i>';
  } else if (isLeaf) {
    icon.innerHTML = '<i class="fas fa-cube"></i>';
  }

  const text = document.createElement('span');
  text.className = 'tree-item-name';
  text.textContent = label;

  labelEl.appendChild(icon);
  labelEl.appendChild(text);
  node.appendChild(labelEl);

  if (hasChildren) {
    const children = document.createElement('div');
    children.className = 'tree-children collapsed';
    node.appendChild(children);

    labelEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCollapsed = children.classList.contains('collapsed');
      children.classList.toggle('collapsed');
      icon.innerHTML = isCollapsed ? '<i class="fas fa-chevron-down"></i>' : '<i class="fas fa-chevron-right"></i>';
    });
  }

  return { node, labelEl, children: node.querySelector('.tree-children') };
}

/**
 * Create a leaf node for an item
 */
function createItemNode(item) {
  const node = document.createElement('div');
  node.className = 'tree-node';

  const labelEl = document.createElement('div');
  labelEl.className = 'tree-label';

  // Add icon
  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.innerHTML = '<i class="fas fa-cube"></i>';
  labelEl.appendChild(icon);

  // Use code element for item name
  const code = document.createElement('code');
  code.className = 'tree-item-name';
  code.textContent = item.name;

  labelEl.appendChild(code);

  // Add warning icon if mainnet/minimal values differ (only for variable categories)
  const isVariableCategory = ['constant_vars', 'preset_vars', 'config_vars'].includes(item.category);
  if (isVariableCategory && hasNetworkDifferences(item)) {
    const warning = document.createElement('span');
    warning.className = 'network-diff-warning';
    warning.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
    warning.title = 'Values differ between mainnet and minimal';
    labelEl.appendChild(warning);
  }

  // Add fork badges container (reversed so latest forks appear first)
  const badgesContainer = document.createElement('span');
  badgesContainer.className = 'tree-fork-badges';

  [...item.forks].reverse().forEach(fork => {
    const badge = document.createElement('span');
    badge.className = 'tree-fork-badge';
    badge.textContent = getForkShortLabel(fork);
    badge.style.backgroundColor = getForkColor(fork);
    badge.title = getForkDisplayName(fork);
    badgesContainer.appendChild(badge);
  });

  labelEl.appendChild(badgesContainer);
  node.appendChild(labelEl);

  node.dataset.name = item.name;
  node.dataset.category = item.category;
  node.dataset.forks = item.forks.join(' ');
  node.dataset.introducingFork = item.forks[0];

  // Store item data for selection
  node._itemData = item;

  // Register item for reference linking
  registerItem(item.name, node);

  labelEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onItemSelectCallback) {
      onItemSelectCallback({
        ...item,
        element: labelEl
      });
    }
  });

  treeNodes.push(node);

  return node;
}

/**
 * Build the navigation tree
 */
export function buildTree(data, forks, sourceMap) {
  const container = document.getElementById('specsTree');
  container.innerHTML = '';
  treeNodes = [];
  clearRegistry();

  const items = collectItems(data, forks);

  // Build tree by category - items directly under category, sorted alphabetically
  CATEGORY_ORDER.forEach(category => {
    const categoryItems = items[category];
    if (!categoryItems || Object.keys(categoryItems).length === 0) return;

    const itemList = Object.values(categoryItems).sort((a, b) => a.name.localeCompare(b.name));
    const { node: categoryNode, children: categoryChildren } = createTreeNode(
      getCategoryDisplayName(category),
      true
    );

    // Add items directly under category
    itemList.forEach(item => {
      const node = createItemNode(item);

      // Store source file paths from sourceMap
      if (sourceMap && sourceMap.items && sourceMap.items[item.name]) {
        const fileSet = new Set();
        for (const fork of Object.keys(sourceMap.items[item.name])) {
          const loc = sourceMap.items[item.name][fork];
          if (loc && loc.file && !loc.file.startsWith('specs/_features/')) {
            const display = loc.file.startsWith('specs/') ? loc.file.slice(6) : loc.file;
            fileSet.add(display);
          }
        }
        node.dataset.files = Array.from(fileSet).join(' ');
      }

      categoryChildren.appendChild(node);
    });

    categoryNode.dataset.category = category;
    container.appendChild(categoryNode);
  });

  // Build the reverse reference index after all items are registered
  buildUsedByIndex(items);
}

/**
 * Compute which forks, categories, and files are available given the current filters.
 * Each set ignores its own filter dimension so users can see productive alternatives.
 */
export function getFilterableCounts(forkFilter, typeFilter, searchTerm, fileFilter) {
  const container = document.getElementById('specsTree');
  const itemNodes = container.querySelectorAll('.tree-node[data-name]');

  const availableForks = new Set();
  const availableCategories = new Set();
  const availableFiles = new Set();

  itemNodes.forEach(node => {
    const name = node.dataset.name.toLowerCase();
    const category = node.dataset.category;
    const itemForks = node.dataset.forks.split(' ');
    const files = node.dataset.files || '';

    const matchesSearch = !searchTerm || name.includes(searchTerm);
    const matchesFork = !forkFilter || itemForks.includes(forkFilter);
    const matchesType = !typeFilter || category === typeFilter;
    const matchesFile = !fileFilter || files.toLowerCase().includes(fileFilter);

    // Available forks: items matching search + file + type (fork ignored)
    if (matchesSearch && matchesFile && matchesType) {
      itemForks.forEach(f => availableForks.add(f));
    }

    // Available categories: items matching search + file + fork (type ignored)
    if (matchesSearch && matchesFile && matchesFork) {
      availableCategories.add(category);
    }

    // Available files: items matching search + fork + type (file ignored)
    if (matchesSearch && matchesFork && matchesType) {
      if (files) {
        files.split(' ').forEach(f => availableFiles.add(f));
      }
    }
  });

  return { availableForks, availableCategories, availableFiles };
}

/**
 * Filter the tree based on fork, type, and search term
 */
export function filterTree(forkFilter, typeFilter, searchTerm, fileFilter) {
  const container = document.getElementById('specsTree');
  const categoryNodes = container.querySelectorAll(':scope > .tree-node');

  categoryNodes.forEach(categoryNode => {
    const category = categoryNode.dataset.category;

    // Type filter - hide entire category if doesn't match
    if (typeFilter && category !== typeFilter) {
      categoryNode.classList.add('tree-filtered');
      return;
    }
    categoryNode.classList.remove('tree-filtered');

    // Get item nodes directly within this category
    const itemNodes = categoryNode.querySelectorAll(':scope > .tree-children > .tree-node');
    let visibleItemCount = 0;

    itemNodes.forEach(itemNode => {
      const name = itemNode.dataset.name.toLowerCase();
      const itemForks = itemNode.dataset.forks.split(' ');

      // Fork filter - check if item has this fork
      const matchesFork = !forkFilter || itemForks.includes(forkFilter);

      // Search filter
      const matchesSearch = !searchTerm || name.includes(searchTerm);

      // File filter - check if any source file contains the filter string
      let matchesFile = true;
      if (fileFilter) {
        const files = itemNode.dataset.files || '';
        matchesFile = files.toLowerCase().includes(fileFilter);
      }

      if (matchesFork && matchesSearch && matchesFile) {
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
      const children = categoryNode.querySelector('.tree-children');
      const icon = categoryNode.querySelector('.tree-icon');

      // Auto-expand category if searching or if type filter matches this category
      if (searchTerm || fileFilter || (typeFilter && category === typeFilter)) {
        if (children) children.classList.remove('collapsed');
        if (icon) icon.innerHTML = '<i class="fas fa-chevron-down"></i>';
      } else if (!typeFilter && !searchTerm && !fileFilter) {
        // Collapse when filters are cleared
        if (children) children.classList.add('collapsed');
        if (icon) icon.innerHTML = '<i class="fas fa-chevron-right"></i>';
      }
    }
  });
}
