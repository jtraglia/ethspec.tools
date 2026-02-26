/**
 * Reference linking module - makes spec references clickable
 */

// Registry of all known item names mapped to their tree node elements
const itemRegistry = new Map();

// Reverse reference index: maps item name -> Set of item names that use it
const usedByIndex = new Map();

// Fork suffixes for parsing fork-specific names
const FORK_SUFFIXES = ['PHASE0', 'ALTAIR', 'BELLATRIX', 'CAPELLA', 'DENEB', 'ELECTRA', 'FULU', 'GLOAS'];

/**
 * Register an item name for reference linking
 */
export function registerItem(name, element) {
  itemRegistry.set(name, element);
}

/**
 * Check if an item exists in the registry
 */
export function hasItem(name) {
  return itemRegistry.has(name);
}

/**
 * Get the element for an item name
 */
export function getItemElement(name) {
  return itemRegistry.get(name);
}

/**
 * Clear the item registry
 */
export function clearRegistry() {
  itemRegistry.clear();
  usedByIndex.clear();
}

/**
 * Build the reverse reference index from all items
 * Call this after all items have been registered
 * @param {Object} items - The items object from collectItems (category -> name -> item)
 */
export function buildUsedByIndex(items) {
  usedByIndex.clear();

  // First pass: ensure all item names have an entry in usedByIndex
  Object.values(items).forEach(categoryItems => {
    Object.values(categoryItems).forEach(item => {
      if (!usedByIndex.has(item.name)) {
        usedByIndex.set(item.name, new Set());
      }
    });
  });

  // Second pass: scan all code/values to find references
  const identifierRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;

  Object.values(items).forEach(categoryItems => {
    Object.values(categoryItems).forEach(item => {
      const sourceName = item.name;

      // Get all the code/value content from this item
      Object.values(item.values).forEach(value => {
        let textContent = '';

        if (typeof value === 'string') {
          textContent = value;
        } else if (value && typeof value === 'object') {
          // Handle variable format { mainnet, minimal }
          if (value.mainnet) {
            if (Array.isArray(value.mainnet)) {
              textContent += ' ' + value.mainnet.join(' ');
            } else {
              textContent += ' ' + String(value.mainnet);
            }
          }
          if (value.minimal) {
            if (Array.isArray(value.minimal)) {
              textContent += ' ' + value.minimal.join(' ');
            } else {
              textContent += ' ' + String(value.minimal);
            }
          }
        }

        // Find all identifiers in this content
        let match;
        while ((match = identifierRegex.exec(textContent)) !== null) {
          const identifier = match[1];

          // Skip self-references
          if (identifier === sourceName) continue;

          // Check if this identifier is a known item
          let targetName = null;
          if (itemRegistry.has(identifier)) {
            targetName = identifier;
          } else {
            // Try stripping fork suffix
            const { base, fork } = parseForkNameInternal(identifier);
            if (fork && base !== identifier && itemRegistry.has(base)) {
              targetName = base;
            }
          }

          if (targetName && usedByIndex.has(targetName)) {
            usedByIndex.get(targetName).add(sourceName);
          }
        }
      });
    });
  });
}

/**
 * Internal version of parseForkName for use before export
 */
function parseForkNameInternal(varName) {
  const varNameUpper = varName.toUpperCase();
  for (const fork of FORK_SUFFIXES) {
    const suffix = '_' + fork;
    if (varNameUpper.endsWith(suffix)) {
      return {
        base: varName.slice(0, varName.length - suffix.length),
        fork: fork
      };
    }
  }
  return { base: varName, fork: null };
}

/**
 * Get the list of items that use a given item
 * @param {string} itemName - The item name to look up
 * @returns {string[]} - Array of item names that use this item
 */
export function getUsedBy(itemName) {
  const usedBy = usedByIndex.get(itemName);
  if (!usedBy) return [];
  return Array.from(usedBy).sort();
}

/**
 * Parse fork name from variable name (e.g., MIN_PER_EPOCH_CHURN_LIMIT_ELECTRA -> MIN_PER_EPOCH_CHURN_LIMIT)
 */
function parseForkName(varName) {
  const varNameUpper = varName.toUpperCase();
  for (const fork of FORK_SUFFIXES) {
    const suffix = '_' + fork;
    if (varNameUpper.endsWith(suffix)) {
      return {
        base: varName.slice(0, varName.length - suffix.length),
        fork: fork
      };
    }
  }
  return { base: varName, fork: null };
}

/**
 * Add clickable references to a code block
 */
export function addClickableReferences(block) {
  // Skip if already processed
  if (block.dataset.referencesAdded) return;

  // Get all text nodes
  const walker = document.createTreeWalker(
    block,
    NodeFilter.SHOW_TEXT,
    null
  );

  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    textNodes.push(node);
  }

  // Process each text node
  textNodes.forEach(textNode => {
    const text = textNode.textContent;

    // Find Python identifiers
    const identifierRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
    let match;
    const replacements = [];

    while ((match = identifierRegex.exec(text)) !== null) {
      const identifier = match[1];
      let targetName = null;

      // Check if this identifier exists in our registry
      if (hasItem(identifier)) {
        targetName = identifier;
      } else {
        // Try parsing fork-specific names
        const { base, fork } = parseForkName(identifier);
        if (fork && base !== identifier && hasItem(base)) {
          targetName = base;
        }
      }

      if (targetName) {
        replacements.push({
          start: match.index,
          end: match.index + identifier.length,
          identifier: identifier,
          targetName: targetName
        });
      }
    }

    // If we found any replacements, rebuild the node
    if (replacements.length > 0) {
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;

      replacements.forEach(replacement => {
        // Add text before the match
        if (replacement.start > lastIndex) {
          fragment.appendChild(
            document.createTextNode(text.substring(lastIndex, replacement.start))
          );
        }

        // Create clickable span for the identifier
        const refSpan = document.createElement('span');
        refSpan.className = 'spec-reference';
        refSpan.textContent = replacement.identifier;
        refSpan.dataset.targetName = replacement.targetName;
        refSpan.title = `Jump to ${replacement.targetName}`;
        fragment.appendChild(refSpan);

        lastIndex = replacement.end;
      });

      // Add remaining text
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }

      // Replace the text node with the fragment
      textNode.parentNode.replaceChild(fragment, textNode);
    }
  });

  block.dataset.referencesAdded = 'true';
}

/**
 * Navigate to a referenced item
 * @param {string} targetName - The item name to navigate to
 * @param {string} preferredFork - The fork to try to open (default: null, opens latest)
 */
export function navigateToReference(targetName, preferredFork = null) {
  const element = getItemElement(targetName);
  if (!element) return false;

  // Find the tree node and click it
  const label = element.querySelector('.tree-label');
  if (label) {
    // Expand parent nodes
    let parent = element.parentElement;
    while (parent) {
      if (parent.classList.contains('tree-children')) {
        parent.classList.remove('collapsed');
        const parentNode = parent.previousElementSibling;
        if (parentNode) {
          const icon = parentNode.querySelector('.tree-icon');
          if (icon) icon.innerHTML = '<i class="fas fa-chevron-down"></i>';
        }
      }
      parent = parent.parentElement;
    }

    // Trigger item selection — selectItem calls onItemSelect which handles pushState
    const itemData = element._itemData;
    if (itemData && window.selectItem) {
      window.selectItem(itemData, true, preferredFork);
    } else {
      // Fallback to click
      label.click();
    }

    // Scroll the sidebar to show the item
    label.scrollIntoView({ behavior: 'smooth', block: 'center' });

    return true;
  }

  return false;
}

/**
 * Find the current fork being viewed by traversing up from an element
 */
function findCurrentFork(element) {
  let current = element;
  while (current && current !== document.body) {
    if (current.classList && current.classList.contains('fork-code-block')) {
      return current.dataset.fork;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Initialize reference click handling
 */
export function initReferenceClickHandler() {
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('spec-reference')) {
      const targetName = e.target.dataset.targetName;
      if (targetName) {
        // Find which fork the user is currently viewing
        const currentFork = findCurrentFork(e.target);

        // Navigate to the target with the same fork context
        navigateToReference(targetName, currentFork);
      }
    }
  });
}
