// Run in the page console. Prints every import map in the DOM, plus the effective map es-module-shims resolves against (shim mode).
(() => {
  const maps = [...document.querySelectorAll('script[type="importmap"], script[type="importmap-shim"]')].map((s) => {
    if (s.src) return { type: s.type, src: s.src };
    try {
      return { type: s.type, map: JSON.parse(s.textContent || '{}') };
    } catch (e) {
      return { type: s.type, error: String(e) };
    }
  });
  if (typeof globalThis.importShim?.getImportMap === 'function') {
    try {
      maps.push({ type: 'importShim.getImportMap()', map: globalThis.importShim.getImportMap() });
    } catch (e) {
      maps.push({ type: 'importShim.getImportMap()', error: String(e) });
    }
  }
  console.log(JSON.stringify(maps, null, 2));
  return maps;
})();
