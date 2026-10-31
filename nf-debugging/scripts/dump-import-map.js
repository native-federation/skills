// Run in the page console. Prints every import map in the DOM, plus the effective map es-module-shims resolves against (shim mode).
(() => {
  const maps = [...document.querySelectorAll('script[type="importmap"], script[type="importmap-shim"]')].map((s) => ({
    type: s.type,
    src: s.src || undefined,
    map: s.src ? undefined : JSON.parse(s.textContent || '{}'),
  }));
  if (typeof globalThis.importShim?.getImportMap === 'function') {
    maps.push({ type: 'importShim.getImportMap()', map: globalThis.importShim.getImportMap() });
  }
  console.log(JSON.stringify(maps, null, 2));
  return maps;
})();
