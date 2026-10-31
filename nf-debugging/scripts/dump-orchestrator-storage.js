// Run in the page console. Read-only: prints the orchestrator's committed state per storage namespace,
// plus a table with one row per shared copy (which remote runs which version, and why).
(() => {
  const KEYS = ['remotes', 'shared-externals', 'scoped-externals', 'shared-chunks', 'cache-state'];
  const stores = { localStorage, sessionStorage };
  const parse = (raw) => {
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };
  const read = (type, namespace, key) => {
    if (type === 'globalThis') return globalThis[namespace]?.[key];
    if (stores[type]) return parse(stores[type].getItem(`${namespace}.${key}`));
    return '<custom storage: not readable without get()>';
  };
  // Hosts may keep their own keys under the namespace (feature flags, settings), so list those too.
  const keysIn = (type, namespace) => {
    if (type === 'globalThis') return Object.keys(globalThis[namespace] ?? {});
    if (!stores[type]) return [];
    const prefix = `${namespace}.`;
    return Object.keys(stores[type]).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  };
  const verdicts = (sharedExternals) =>
    Object.entries(sharedExternals ?? {}).flatMap(([scope, externals]) =>
      Object.entries(externals).flatMap(([pkg, ext]) =>
        (ext.versions ?? []).flatMap((v) =>
          (v.remotes ?? []).map((r) => ({
            scope, pkg, tag: v.tag, action: v.action, remote: r.name,
            requiredVersion: r.requiredVersion, strictVersion: r.strictVersion, servingBuild: ext.servingBuild,
            pool: ext.poolName, poolWinner: ext.poolWinner, servedBy: r.servedBy, poolCause: r.poolCause,
          })),
        ),
      ),
    );

  const result = {};
  const descriptors = globalThis.__NF_ORCHESTRATOR__?.storage;
  if (descriptors) {
    if (Object.keys(descriptors).length > 1) console.warn('More than one orchestrator namespace: only one orchestrator per page is supported.');
    for (const [namespace, d] of Object.entries(descriptors)) {
      const keys = new Set([...d.keys, ...keysIn(d.type, namespace)]);
      const values = Object.fromEntries(
        [...keys].map((key) => [key, d.keys.includes(key) && typeof d.get === 'function' ? d.get(key) : read(d.type, namespace, key)]),
      );
      result[namespace] = { source: '__NF_ORCHESTRATOR__', version: d.version, type: d.type, values };
    }
  } else {
    // Orchestrator < 4.7 publishes no descriptor, so probe the default namespace in every built-in storage.
    const namespace = '__NATIVE_FEDERATION__';
    for (const type of ['globalThis', 'localStorage', 'sessionStorage']) {
      const keys = new Set([...KEYS, ...keysIn(type, namespace)]);
      const values = Object.fromEntries([...keys].map((key) => [key, read(type, namespace, key)]));
      if (KEYS.some((key) => values[key] !== undefined)) result[`${namespace} (${type})`] = { source: 'probe', type, values };
    }
  }
  for (const entry of Object.values(result)) entry.verdicts = verdicts(entry.values['shared-externals']);

  console.log(JSON.stringify(result, null, 2));
  console.table(Object.entries(result).flatMap(([ns, e]) => e.verdicts.map((row) => ({ ns, ...row }))));
  return result;
})();
