(function () {
  "use strict";
  // Upgrade bridge for browsers that still have the earlier unpacked manifest
  // in memory. On the next Disney page refresh it reloads the extension once,
  // then the current manifest takes over.
  try {
    if (chrome.runtime.getManifest().version !== "1.1.1") chrome.runtime.reload();
  } catch (_) {}
})();
