// Platform helpers so shortcuts read naturally on macOS and Windows/Linux.
export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export const MOD = isMac ? '⌘' : 'Ctrl';

// True when the platform's primary modifier is held (⌘ on macOS, Ctrl elsewhere).
export const modKey = (e) => (isMac ? e.metaKey : e.ctrlKey);
