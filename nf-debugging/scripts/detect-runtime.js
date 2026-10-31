// Run in the page console after init. Read-only: says which NF browser runtime is on the page, and why.
(() => {
  const nf = globalThis.__NATIVE_FEDERATION__;
  const descriptors = globalThis.__NF_ORCHESTRATOR__?.storage;
  const maps = [...document.querySelectorAll('script[type="importmap"], script[type="importmap-shim"]')];
  // A malformed third-party map or a storage-blocked frame must not cost the whole verdict.
  const importKeys = maps.flatMap((s) => {
    try {
      return Object.keys(JSON.parse(s.textContent || '{}').imports ?? {});
    } catch {
      return [];
    }
  });
  const persistedKeys = ['localStorage', 'sessionStorage'].flatMap((name) => {
    try {
      return Object.keys(globalThis[name]).filter((k) => /\.(remotes|shared-externals|cache-state)$/.test(k));
    } catch {
      return [];
    }
  });

  const signals = {
    nfOrchestrator: descriptors
      ? Object.fromEntries(Object.entries(descriptors).map(([ns, d]) => [ns, `${d.version} / ${d.type}`]))
      : null,
    // Same global name for both runtimes: the classic one keeps Maps, the orchestrator plain records.
    classicState: nf?.externals instanceof Map,
    // cache-state (4.8+) is written before commit, so it is there even when init fails.
    orchestratorState: nf?.['shared-externals'] !== undefined || nf?.['cache-state'] !== undefined,
    persistedKeys,
    // '<remote>/./<key>' is only a convention (the './' can be dropped), so it is a hint, not part of the verdict.
    dotSlashKeysHint: importKeys.some((k) => k.includes('/./')),
    importMapTypes: maps.map((s) => s.type),
    esModuleShims: typeof globalThis.importShim === 'function',
    eventRegistry: !!globalThis.__NF_REGISTRY__,
    ngVersion: document.querySelector('[ng-version]')?.getAttribute('ng-version') ?? null,
  };

  const orchestrator = !!descriptors || signals.orchestratorState || persistedKeys.length > 0;
  let runtime = 'unknown';
  if (signals.classicState) runtime = 'classic';
  else if (orchestrator) runtime = 'orchestrator';

  const result = { runtime, signals };
  // The classic runtime next to the orchestrator is the same unsupported setup as two orchestrators.
  if ((descriptors && Object.keys(descriptors).length > 1) || (signals.classicState && orchestrator)) {
    result.warning = 'More than one orchestrator (or the classic runtime next to the orchestrator): only one per page is supported.';
    console.warn(result.warning);
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
})();
