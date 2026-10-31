// Run in the page console after init. Read-only: says which NF browser runtime is on the page, and why.
(() => {
  const nf = globalThis.__NATIVE_FEDERATION__;
  const descriptors = globalThis.__NF_ORCHESTRATOR__?.storage;
  const maps = [...document.querySelectorAll('script[type="importmap"], script[type="importmap-shim"]')];
  const importKeys = maps.flatMap((s) => Object.keys(JSON.parse(s.textContent || '{}').imports ?? {}));
  const persistedKeys = [localStorage, sessionStorage].flatMap((store) =>
    Object.keys(store).filter((k) => /\.(remotes|shared-externals|cache-state)$/.test(k)),
  );

  const signals = {
    nfOrchestrator: descriptors
      ? Object.fromEntries(Object.entries(descriptors).map(([ns, d]) => [ns, `${d.version} / ${d.type}`]))
      : null,
    // Same global name for both runtimes: the classic one keeps Maps, the orchestrator plain records.
    classicState: nf?.externals instanceof Map,
    // cache-state (4.8+) is written before commit, so it is there even when init fails.
    orchestratorState: nf?.['shared-externals'] !== undefined || nf?.['cache-state'] !== undefined,
    persistedKeys,
    // The orchestrator keys exposed modules '<remote>/./<key>', the classic runtime '<remote>/<key>'.
    orchestratorExposeKeys: importKeys.some((k) => k.includes('/./')),
    importMapTypes: maps.map((s) => s.type),
    esModuleShims: typeof globalThis.importShim === 'function',
    eventRegistry: !!globalThis.__NF_REGISTRY__,
    ngVersion: document.querySelector('[ng-version]')?.getAttribute('ng-version') ?? null,
  };

  const orchestrator =
    !!descriptors || signals.orchestratorState || persistedKeys.length > 0 || signals.orchestratorExposeKeys;
  let runtime = 'unknown';
  if (signals.classicState) runtime = 'classic';
  else if (orchestrator) runtime = 'orchestrator';

  const result = { runtime, signals };
  if (descriptors && Object.keys(descriptors).length > 1) {
    result.warning = 'More than one orchestrator namespace: only one orchestrator per page is supported.';
    console.warn(result.warning);
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
})();
