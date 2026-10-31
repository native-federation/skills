// Run in the page console after init (classic runtime only). Read-only: two rows with the same pkg are two instances.
(() => {
  const nf = globalThis.__NATIVE_FEDERATION__;
  if (!(nf?.externals instanceof Map)) return console.warn('not the classic runtime');
  const externals = [...nf.externals].map(([key, url]) => {
    const at = key.lastIndexOf('@');
    return { pkg: key.slice(0, at), version: key.slice(at + 1), url };
  });
  const copies = externals.reduce((m, e) => m.set(e.pkg, (m.get(e.pkg) ?? 0) + 1), new Map());
  const result = {
    externals: externals.map((e) => ({ ...e, copies: copies.get(e.pkg) })).sort((a, b) => b.copies - a.copies),
    remotes: [...nf.remoteNamesToRemote].map(([name, r]) => ({ name, baseUrl: r.baseUrl, exposes: r.exposes.map((e) => e.key) })),
    baseUrlToRemoteNames: Object.fromEntries(nf.baseUrlToRemoteNames),
  };
  console.table(result.externals);
  console.table(result.remotes);
  return result;
})();
