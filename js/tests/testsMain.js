/**
 * Tests mode main module
 * Handles initialization and state management for the tests viewer
 */

import { loadVersions, loadManifest, loadTestFilesProgressive } from './loader.js';
import { buildTree, filterTree, clearFilters, setVersionGetter as setTreeVersionGetter } from './tree.js';
import { displayTest, displayWelcome, displayTestSkeleton, updateFileBox, enableDownloadTest, clearTest, setVersionGetter as setViewerVersionGetter } from './testViewer.js';
import { saveTestsVersion, updateHash, setTestsHasSelection } from '../main.js';

// Application state
const state = {
  versions: null,
  currentVersion: null,
  manifest: null,
  currentTest: null,
  loadedSuites: new Map(),
  searchTerm: '',
  initialLoadComplete: false
};

/**
 * Get current version
 */
function getCurrentVersion() {
  return state.currentVersion;
}

// Set version getter for tree and viewer modules
setTreeVersionGetter(getCurrentVersion);
setViewerVersionGetter(getCurrentVersion);

/**
 * Initialize the application
 */
export async function init(savedVersion, searchTerm = '') {
  // Reset state
  state.initialLoadComplete = false;
  state.loadedSuites.clear();

  // Initialize UI
  setupVersionSelector();

  // Load versions
  try {
    state.versions = await loadVersions();
    populateVersionDropdown();

    // Use saved version or default
    const defaultVersion = state.versions.versions[0];
    state.currentVersion = savedVersion && state.versions.versions.includes(savedVersion)
      ? savedVersion
      : defaultVersion;

    // Set version selector
    document.getElementById('versionSelect').value = state.currentVersion;

    // Load manifest for selected version
    await loadVersionData(state.currentVersion);

    // Apply search term if provided
    if (searchTerm) {
      state.searchTerm = searchTerm.toLowerCase();
      filterTree(state.searchTerm);
    }

    state.initialLoadComplete = true;
  } catch (error) {
    showError('Failed to load versions: ' + error.message);
  }
}

/**
 * Select a test by its path
 */
function selectTestByPath(testPath) {
  const node = document.querySelector(`#testsTree .tree-node[data-test-path="${CSS.escape(testPath)}"]`);
  if (!node) return;

  // Expand parent nodes
  let parent = node.parentElement;
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

  // Click the node's label
  const label = node.querySelector('.tree-label');
  if (label) {
    label.click();
    label.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/**
 * Populate the version dropdown
 */
function populateVersionDropdown() {
  const versionSelect = document.getElementById('versionSelect');
  versionSelect.innerHTML = '';

  for (const version of state.versions.versions) {
    const option = document.createElement('option');
    option.value = version;
    option.textContent = version;
    versionSelect.appendChild(option);
  }
}

/**
 * Setup version selector
 */
function setupVersionSelector() {
  const versionSelect = document.getElementById('versionSelect');

  // Remove existing listeners by cloning
  const newSelect = versionSelect.cloneNode(true);
  versionSelect.parentNode.replaceChild(newSelect, versionSelect);

  newSelect.addEventListener('change', async (e) => {
    const newVersion = e.target.value;
    if (newVersion === state.currentVersion) return;

    state.currentVersion = newVersion;
    saveTestsVersion(newVersion);

    // Clear cache
    state.loadedSuites.clear();

    // Update URL
    history.replaceState(null, '', `#tests/${newVersion}/`);

    // Load new version data
    await loadVersionData(newVersion);
  });
}

/**
 * Load data for a specific version
 */
async function loadVersionData(version) {
  const loading = document.getElementById('loading');
  const error = document.getElementById('error');

  loading.classList.remove('hidden');
  error.classList.add('hidden');

  try {
    state.manifest = await loadManifest(version);
    displayWelcome(state.manifest);
    buildTree(state.manifest, onTestSelect);

    loading.classList.add('hidden');
  } catch (err) {
    loading.classList.add('hidden');
    showError(`Failed to load manifest for ${version}: ` + err.message);
  }
}

/**
 * Handle test selection from tree
 */
async function onTestSelect(testPath) {
  const { preset, fork, testType, testSuite, config, testCase, testPath: fullPath, files } = testPath;

  try {
    // Check cache
    const cacheKey = `${state.currentVersion}:${fullPath}`;
    let loadedFiles = state.loadedSuites.get(cacheKey);

    if (loadedFiles) {
      // Use cached data - display immediately
      state.currentTest = { preset, fork, testType, testSuite, config, testCase, files: loadedFiles, testPath: fullPath };
      displayTest(state.currentTest);
      setTestsHasSelection(true);
      return;
    }

    // Show test skeleton immediately with loading spinners
    displayTestSkeleton({
      preset,
      fork,
      testType,
      testSuite,
      config,
      testCase,
      fileNames: files,
      testPath: fullPath
    });

    // Notify main.js that we have a selection
    setTestsHasSelection(true);

    // Start loading all files in parallel
    const filePromises = loadTestFilesProgressive(state.currentVersion, fullPath, files);

    // Track loaded files
    const allLoadedFiles = [];
    const loadedFileMap = new Map();

    // Identify which SSZ files have YAML companions
    const sszWithYaml = new Set();
    for (const filePromise of filePromises) {
      const name = filePromise.name;
      if (name.endsWith('.ssz_snappy.yaml')) {
        const sszName = name.replace('.yaml', '');
        sszWithYaml.add(sszName);
      }
    }

    // Process each file as it loads
    const loadPromises = filePromises.map(filePromise => {
      return filePromise.promise.then(fileData => {
        allLoadedFiles.push(fileData);
        loadedFileMap.set(fileData.name, fileData);

        if (fileData.name.endsWith('.ssz_snappy.yaml')) {
          const sszName = fileData.name.replace('.yaml', '');
          if (loadedFileMap.has(sszName)) {
            const sszFile = loadedFileMap.get(sszName);
            updateFileBox(sszName, sszFile, fileData);
          }
        } else {
          if (sszWithYaml.has(fileData.name)) {
            const yamlName = fileData.name + '.yaml';
            const yamlData = loadedFileMap.get(yamlName);
            if (yamlData) {
              updateFileBox(fileData.name, fileData, yamlData);
            }
          } else {
            updateFileBox(fileData.name, fileData);
          }
        }
      }).catch(error => {
        console.error(`Failed to load ${filePromise.name}:`, error);
      });
    });

    // Wait for all files to complete
    await Promise.all(loadPromises);

    // Cache the loaded files
    state.loadedSuites.set(cacheKey, allLoadedFiles);

    // Enable download button
    enableDownloadTest(testCase, allLoadedFiles);

  } catch (error) {
    showError('Failed to load test data: ' + error.message);
  }
}

/**
 * Apply search term (called from main.js)
 */
export function applySearch(searchTerm) {
  state.searchTerm = searchTerm;
  filterTree(searchTerm);
}

/**
 * Show error message
 */
function showError(message) {
  const errorEl = document.getElementById('error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');

  document.getElementById('loading').classList.add('hidden');
  document.getElementById('testViewer').classList.add('hidden');
}

/**
 * Handle deep link for tests mode
 * Format: version/preset/fork/testType/testSuite/config/testCase[/filename:viewmode]
 */
export function handleDeepLink(path) {
  if (!path || !state.initialLoadComplete) return;

  const parts = path.split('/').filter(p => p);
  if (parts.length === 0) return;

  // First part might be version
  let version = parts[0];
  let testPathParts = parts.slice(1);

  // Check if this is a valid version
  if (state.versions && state.versions.versions.includes(version)) {
    if (version !== state.currentVersion) {
      state.currentVersion = version;
      document.getElementById('versionSelect').value = version;
      loadVersionData(version).then(() => {
        navigateToTest(testPathParts);
      });
      return;
    }
  } else {
    // First part is not a version, use current version
    testPathParts = parts;
  }

  navigateToTest(testPathParts);
}

/**
 * Navigate to a specific test by path parts
 * Supports optional file targeting: preset/fork/testType/testSuite/config/testCase/filename:viewmode
 */
function navigateToTest(pathParts) {
  if (pathParts.length < 6) return;

  const [preset, fork, testType, testSuite, config, ...testCaseParts] = pathParts;

  // Check if the last part contains a file reference (filename:viewmode or just filename)
  let targetFilename = null;
  let targetViewMode = null;
  let testCase = testCaseParts.join('/');

  // Look for filename pattern in the last part (URL-encoded filename, optionally with :hex or :yaml)
  const lastPart = testCaseParts[testCaseParts.length - 1];
  if (lastPart && (lastPart.includes(':hex') || lastPart.includes(':yaml') ||
      lastPart.includes('.yaml') || lastPart.includes('.ssz') || lastPart.includes('.json'))) {
    // This might be a filename reference
    const colonIndex = lastPart.lastIndexOf(':');
    if (colonIndex !== -1 && (lastPart.endsWith(':hex') || lastPart.endsWith(':yaml'))) {
      targetFilename = decodeURIComponent(lastPart.substring(0, colonIndex));
      targetViewMode = lastPart.substring(colonIndex + 1);
      testCase = testCaseParts.slice(0, -1).join('/');
    } else if (lastPart.match(/\.(yaml|ssz|ssz_snappy|json)$/)) {
      // Just a filename without view mode
      targetFilename = decodeURIComponent(lastPart);
      testCase = testCaseParts.slice(0, -1).join('/');
    }
  }

  // Find and select the test in the tree
  const testPath = `${preset}/${fork}/${testType}/${testSuite}/${config}/${testCase}`;

  // Look for the test node in the tree
  const treeNodes = document.querySelectorAll('#testsTree .tree-node[data-test-path]');
  for (const node of treeNodes) {
    if (node.dataset.testPath === testPath) {
      // Expand parent nodes
      let parent = node.parentElement;
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

      // Click the node
      const label = node.querySelector('.tree-label');
      if (label) {
        label.click();

        // If a specific file was targeted, scroll to and expand it after loading
        if (targetFilename) {
          scrollToFile(targetFilename, targetViewMode);
        } else {
          label.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      break;
    }
  }
}

/**
 * Scroll to a specific file box and optionally switch view mode
 */
function scrollToFile(filename, viewMode) {
  let retryCount = 0;
  const maxRetries = 20; // Up to 2 seconds of retries

  const checkAndScroll = () => {
    const fileBox = document.querySelector(`[data-filename="${CSS.escape(filename)}"]`);
    if (!fileBox) {
      // File box doesn't exist yet, retry
      if (retryCount++ < maxRetries) {
        setTimeout(checkAndScroll, 100);
      }
      return;
    }

    // Check if file content is loaded (has 'loaded' class)
    const isLoaded = fileBox.classList.contains('loaded');

    // Expand the file box
    const content = fileBox.querySelector('.file-content');
    const icon = fileBox.querySelector('.file-toggle-icon');
    if (content && content.classList.contains('collapsed')) {
      content.classList.remove('collapsed');
      if (icon) icon.className = 'fas fa-chevron-down file-toggle-icon';
    }

    // If view mode is specified, we need to wait for content to load
    if (viewMode) {
      if (!isLoaded) {
        // Content not loaded yet, retry
        if (retryCount++ < maxRetries) {
          setTimeout(checkAndScroll, 100);
        }
        return;
      }

      // Content is loaded, switch view mode
      const viewBtn = fileBox.querySelector(`[data-view="${viewMode}"]`);
      if (viewBtn && !viewBtn.classList.contains('active') && !viewBtn.disabled) {
        viewBtn.click();
      }
    }

    // Scroll to the file box
    fileBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Start checking
  checkAndScroll();
}

/**
 * Export state for debugging
 */
window.debugTestsState = () => state;
