// Run in the page console. The orchestrator may register maps outside the DOM (e.g. via es-module-shims), so an empty result isn't conclusive.
(() => {
  const maps = [...document.querySelectorAll('script[type="importmap"], script[type="importmap-shim"]')].map((s) => ({
    type: s.type,
    map: JSON.parse(s.textContent || '{}'),
  }));
  console.log(JSON.stringify(maps, null, 2));
  return maps;
})();
