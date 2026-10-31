# Browser storage (orchestrator caching)

Live docs: [Orchestrator Configuration](https://native-federation.com/docs/v4/orchestrator/configuration.md) · [Orchestrator Architecture](https://native-federation.com/docs/v4/orchestrator/architecture.md)

## What gets stored

The v4 orchestrator can cache remote entries (`remoteEntry.json`) persistently in `localStorage`
or `sessionStorage`. That makes the next start faster, but it also means the host can keep
using an old remote entry after a remote has been redeployed.

The storage type and `storageNamespace` (default `__NATIVE_FEDERATION__`) are set in the host's
`initFederation` options. The default storage is `globalThis`, which lives in memory and is lost on
reload. Only `localStorage` and `sessionStorage` persist between page loads. The stored keys are
`remotes`, `shared-externals`, `scoped-externals` and `shared-chunks`. For web storage they are
written as `<namespace>.<key>` (JSON).

Since orchestrator 4.7, the location is published on `globalThis.__NF_ORCHESTRATOR__`. See the
**nf-debugging** skill (`references/orchestrator-storage-hook.md`).

TODO: the shape of each stored value.

## Choosing a storage strategy

TODO: localStorage vs sessionStorage vs in-memory. Trade-offs for dev, staging and production.

## Invalidation

TODO: how and when the cache is refreshed, and how to force a refresh after a deploy.

## Debugging stale state

- Clear the site's storage in DevTools (Application → Storage → Clear site data) and reload. If
  the problem disappears, it was cached state.
- To inspect the cache, use `scripts/dump-orchestrator-storage.js` from the **nf-debugging** skill.

## Interaction with HTTP caching

TODO: recommended cache headers for `remoteEntry.json`, `importmap.json` and hashed bundles.
