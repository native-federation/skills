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
  // The tag type the runtime wrote decides which loader resolves; a loaded importShim alone proves nothing.
  // In polyfill mode (shim loaded, shimMode off) getImportMap() mirrors the native map, and on browsers without
  // multiple-import-map support the shim is what resolves it.
  const shimTags = maps.some((m) => m.type === 'importmap-shim');
  maps.forEach((m) => (m.effective = m.type === (shimTags ? 'importmap-shim' : 'importmap')));
  if (typeof globalThis.importShim?.getImportMap === 'function') {
    try {
      maps.push({ type: 'importShim.getImportMap()', effective: shimTags, map: globalThis.importShim.getImportMap() });
    } catch (e) {
      maps.push({ type: 'importShim.getImportMap()', effective: shimTags, error: String(e) });
    }
    // Same rules es-module-shims applies at load: the esms-options JSON (never exposed as a global), the global, or a shim tag.
    let options = {};
    try {
      options = JSON.parse(document.querySelector('script[type="esms-options"]')?.textContent || '{}');
    } catch {}
    Object.assign(options, globalThis.esmsInitOptions);
    const shimMode =
      !!options.shimMode || !!document.querySelector('script[type="module-shim"], link[rel="modulepreload-shim"]');
    // shimMode makes es-module-shims ignore native maps, so importShim() can resolve nothing the runtime mapped.
    if (shimMode && !shimTags && maps.some((m) => m.type === 'importmap')) {
      console.warn('es-module-shims is in shim mode, but the maps are native `importmap`: importShim() resolves nothing from them.');
    }
  }
  console.log(JSON.stringify(maps, null, 2));
  return maps;
})();
