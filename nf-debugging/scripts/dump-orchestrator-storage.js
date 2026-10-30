// Run in the page console. Read-only: prints the orchestrator's cached state per storage namespace.
(() => {
  const KEYS = ['remotes', 'shared-externals', 'scoped-externals', 'shared-chunks'];
  const parse = (raw) => (raw == null ? undefined : JSON.parse(raw));
  const readLocation = (type, namespace, key) => {
    if (type === 'globalThis') return globalThis[namespace]?.[key];
    if (type === 'localStorage') return parse(localStorage.getItem(`${namespace}.${key}`));
    if (type === 'sessionStorage') return parse(sessionStorage.getItem(`${namespace}.${key}`));
    return '<custom storage: not readable without get()>';
  };

  const descriptors = globalThis.__NF_ORCHESTRATOR__?.storage;
  const result = {};

  if (descriptors) {
    for (const [namespace, info] of Object.entries(descriptors)) {
      const values = {};
      for (const key of info.keys) {
        values[key] = typeof info.get === 'function' ? info.get(key) : readLocation(info.type, namespace, key);
      }
      result[namespace] = { source: '__NF_ORCHESTRATOR__', version: info.version, type: info.type, values };
    }
  } else {
    // Orchestrator < 4.7 publishes no descriptor, so probe the default namespace in every built-in storage.
    const namespace = '__NATIVE_FEDERATION__';
    for (const type of ['globalThis', 'localStorage', 'sessionStorage']) {
      const values = Object.fromEntries(KEYS.map((key) => [key, readLocation(type, namespace, key)]));
      if (Object.values(values).some((v) => v !== undefined)) {
        result[`${namespace} (${type})`] = { source: 'probe', type, values };
      }
    }
  }

  console.log(JSON.stringify(result, null, 2));
  return result;
})();
