/**
 * Resizable sidebar functionality
 */

const STORAGE_KEY = 'ethspec-tools-sidebar-width';
const DEFAULT_WIDTH = 500;
const MIN_WIDTH = 200;
const MAX_WIDTH = 1000;

/**
 * Initialize resizable sidebar
 */
export function initResizable() {
  const sidebar = document.getElementById('sidebar');
  const resizeHandle = document.getElementById('resizeHandle');

  // Load saved width
  const savedWidth = localStorage.getItem(STORAGE_KEY);
  if (savedWidth) {
    const width = parseInt(savedWidth, 10);
    if (width >= MIN_WIDTH && width <= MAX_WIDTH) {
      sidebar.style.width = `${width}px`;
    }
  }

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const delta = e.clientX - startX;
    let newWidth = startWidth + delta;

    // Clamp to min/max
    newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));

    sidebar.style.width = `${newWidth}px`;
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      // Save width
      localStorage.setItem(STORAGE_KEY, sidebar.offsetWidth.toString());
    }
  });

  // Double-click to reset
  resizeHandle.addEventListener('dblclick', () => {
    sidebar.style.width = `${DEFAULT_WIDTH}px`;
    localStorage.setItem(STORAGE_KEY, DEFAULT_WIDTH.toString());
  });
}
