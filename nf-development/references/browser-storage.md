# Browser storage (orchestrator caching)

Live docs: [Orchestrator Configuration](https://native-federation.com/docs/v4/orchestrator/configuration.md) · [Orchestrator Architecture](https://native-federation.com/docs/v4/orchestrator/architecture.md)

## What gets stored

The v4 orchestrator can cache remote entries (`remoteEntry.json`) persistently in `localStorage`
or `sessionStorage`. That makes the next start faster, but it also means the host can keep
using an old remote entry after a remote has been redeployed.

TODO: exact storage keys and the shape of what is stored.

## Choosing a storage strategy

TODO: localStorage vs sessionStorage vs in-memory. Trade-offs for dev, staging and production.

## Invalidation

TODO: how and when the cache is refreshed, and how to force a refresh after a deploy.

## Debugging stale state

- Clear the site's storage in DevTools (Application → Storage → Clear site data) and reload. If
  the problem disappears, it was cached state.
- TODO: a snippet to list and clear only the orchestrator's keys.

## Interaction with HTTP caching

TODO: recommended cache headers for `remoteEntry.json`, `importmap.json` and hashed bundles.
