# Finding the orchestrator's cache: `globalThis.__NF_ORCHESTRATOR__`

Source: [native-federation/orchestrator#86](https://github.com/native-federation/orchestrator/pull/86),
released in orchestrator **4.7.0**. Live docs: [Orchestrator Configuration](https://native-federation.com/docs/v4/orchestrator/configuration.md)
(the "Discovering the storage from tools" section).

## Why this matters for debugging

The host decides where the orchestrator caches its state: the storage type (`globalThis`,
`localStorage`, `sessionStorage` or a custom storage) and the `storageNamespace`. Before 4.7 you
had to find the host's `initFederation` config to know where to look. Since 4.7, every
`initFederation` / `initNodeFederation` call publishes a frozen, read-only descriptor, so you can
find the cache from the console without knowing the config.

> **May become opt-in:** publishing the descriptor might become opt-in in 4.10. Check the
> orchestrator version and the live docs. If `__NF_ORCHESTRATOR__` is missing on 4.10+, the host
> probably hasn't enabled it.

## Shape

```js
globalThis.__NF_ORCHESTRATOR__ = {
  storage: {
    // keyed by storageNamespace; each namespace on the page gets its own entry
    __NATIVE_FEDERATION__: {
      version: '4.7.0', // the orchestrator that published this namespace ('dev' for unversioned builds)
      type: 'localStorage', // 'globalThis' | 'localStorage' | 'sessionStorage' | 'custom'
      namespace: '__NATIVE_FEDERATION__',
      keys: ['remotes', 'shared-externals', 'scoped-externals', 'shared-chunks'],
      get: (key) => {}, // a copy of the committed value; absent when exposeStorageGetter is false
    },
  },
};
```

- **Multiple namespaces:** several orchestrator bundles or configs on one page each publish their
  own entry, with their own `version`. If you see more than one namespace, that alone is worth
  investigating.
- **`get(key)`** works for every storage type, including custom ones. It returns a copy of the
  last *committed* value. An init that is still running hasn't written to storage yet.
- **Missing descriptor:** publishing never fails init. If the global can't be written, the
  descriptor is simply absent. It is also absent on orchestrator < 4.7 and on the classic runtime.

## Reading the location directly

Use this when `get` is absent (`exposeStorageGetter: false`) or you don't want to call page code:

| `type` | Where `<key>` lives |
|---|---|
| `globalThis` | `globalThis[namespace][key]` (the default storage: in memory, gone after a reload) |
| `localStorage` | `` localStorage.getItem(`${namespace}.${key}`) `` (JSON) |
| `sessionStorage` | `` sessionStorage.getItem(`${namespace}.${key}`) `` (JSON) |
| `custom` | Not directly readable; only through `get(key)` |

The default namespace is `__NATIVE_FEDERATION__`.

## What the keys hold

These descriptions are inferred from the key names and aren't verified yet.

| Key | Contents |
|---|---|
| `remotes` | The cached remote entries per remote (what was read from each `remoteEntry.json`) |
| `shared-externals` | The shared dependencies after version resolution: which version and URL won |
| `scoped-externals` | Dependencies that are scoped to a single remote (not shared globally) |
| `shared-chunks` | The `@nf-internal` chunk groups |

TODO: verify the exact value shapes against a real app and add an annotated example.

## Debugging recipes

- **Stale remote after a deploy:** compare `remotes` with a freshly fetched `remoteEntry.json`. If
  they differ and the storage is `localStorage` or `sessionStorage`, that's the cause.
- **Unexpected version of a shared dependency:** `shared-externals` shows which version won and
  why the import map points where it does.
- TODO: more recipes.

## Before 4.7

There is no descriptor. Probe the default namespace in all three built-in storages (the dump script
does this automatically). If the host uses a custom namespace or storage, you have to find it in the
host's `initFederation` call.
