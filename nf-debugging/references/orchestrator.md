# Orchestrator (`@softarc/native-federation-orchestrator`)

Live docs: [Configuration](https://native-federation.com/docs/v4/orchestrator/configuration.md) ·
[Version Resolver](https://native-federation.com/docs/v4/orchestrator/version-resolver.md) ·
[Architecture](https://native-federation.com/docs/v4/orchestrator/architecture.md) ·
[DevTools](https://native-federation.com/docs/v4/devtools.md)

- On init the orchestrator fetches the manifest and every `remoteEntry.json`, stores them, elects a
  version and a serving build per shared package per share scope, writes one import map, and commits the
  records to storage. Before writing, it removes every `<head>` script of the type it writes (`importmap-shim` in
  shim mode, `importmap` otherwise), including a static map the build put there.
- **A warm init doesn't refetch remotes that are already in storage.** With `localStorage` or
  `sessionStorage`, the cache outlives reloads, so a stale cache is a top suspect for "deploy not visible" and
  "fails only on reload". The default storage is `globalThis`, which is in memory and gone on reload.
- **The shell's build always wins.** The Angular adapter turns `hostRemoteEntry` on by default
  (`./remoteEntry.json`), stored as the remote `__NF-HOST__`.
- When a remote can't use the shared copy, it **runs the whole package from its own build**: a *scoped copy*
  (`action: "scope"`, mapped under the remote's URL in `scopes`). By design, and on a cold init **without any
  log line**. It's the usual cause of "two Angulars, no warning" (see Failure modes).
- **`initRemoteEntry` only adds mappings.** It appends a second import map and can't change committed keys
  (see Failure modes).
- It reads v3 (flat `shared`) and v4 (flat or dense) remote entries alike. Classify each participant
  separately (Step 2).

Contents: [Reading the evidence](#reading-the-evidence):
[identify the runtime](#identify-the-runtime-step-2) ·
[logging](#turn-on-logging-step-3) ·
[storage](#find-and-read-storage-step-6) ·
[cache rules](#cache-rules-step-8) ·
[common failures](#what-common-failures-look-like) ·
[DevTools extension](#devtools-extension)

[Failure modes](#failure-modes):
- [Scoped copy: a framework or library runs twice, no warning](#scoped-copy-a-framework-or-library-runs-twice-no-warning)
- [Missing entry point in the serving build: `NG0203` once `toSignal()` / `rxjs-interop` runs](#missing-entry-point-in-the-serving-build-ng0203-once-tosignal--rxjs-interop-runs)
- [Stale cached remote: a deploy doesn't show, or it fails only on reload](#stale-cached-remote-a-deploy-doesnt-show-or-it-fails-only-on-reload)
- [Remote absent: `Remote '<r>' is not initialized.`](#remote-absent-remote-r-is-not-initialized)
- [Exposed module not found: `Exposed module '<key>' from remote '<r>' not found in storage.`](#exposed-module-not-found-exposed-module-key-from-remote-r-not-found-in-storage)
- [Silent version skew: a remote runs a shared version outside its range](#silent-version-skew-a-remote-runs-a-shared-version-outside-its-range)
- [Late remote (`initRemoteEntry`): scoped although a global choice would fit, or ignored](#late-remote-initremoteentry-scoped-although-a-global-choice-would-fit-or-ignored)
- [Init signal missed: the remote never mounts, no error, no failed request](#init-signal-missed-the-remote-never-mounts-no-error-no-failed-request)
- [Integrity and Trusted Types: a module is blocked](#integrity-and-trusted-types-a-module-is-blocked)
- [Static import map replaced: hand-written mappings stop resolving](#static-import-map-replaced-hand-written-mappings-stop-resolving)
- [More than one orchestrator on the page: unpredictable versions or maps](#more-than-one-orchestrator-on-the-page-unpredictable-versions-or-maps)
- [Serving-build choice in dev: the static build's copy wins over the dev-served one](#serving-build-choice-in-dev-the-static-builds-copy-wins-over-the-dev-served-one)
- [Version stamps: `Version '' is not a valid version.`](#version-stamps-version--is-not-a-valid-version)

## Reading the evidence

### Identify the runtime (Step 2)

`detect-runtime.js` prints its verdict and these signals:

| Evidence | Means |
|---|---|
| `globalThis.__NF_ORCHESTRATOR__.storage` present | Orchestrator ≥ 4.7; its entry gives the `version` and storage `type`. More than one entry is [more than one orchestrator](#more-than-one-orchestrator-on-the-page-unpredictable-versions-or-maps) |
| `globalThis.__NATIVE_FEDERATION__.externals instanceof Map` | Classic runtime (`@softarc/native-federation-runtime`, also the v3 Angular adapter). Maps next to orchestrator records or a descriptor: two runtimes on one page, the same [unsupported setup](#more-than-one-orchestrator-on-the-page-unpredictable-versions-or-maps) |
| `globalThis.__NATIVE_FEDERATION__` has `remotes`/`shared-externals`, or storage has `<ns>.remotes` | Orchestrator (the default namespace is the same name as the classic global, so check the shape) |
| Import-map keys like `mfe1/./Component` | A weak hint for the orchestrator only: `/./` is a convention, not enforced. Storage shape and the descriptor decide |
| `importmap-shim` maps, `typeof importShim === 'function'` | Shim mode (es-module-shims). Both runtimes can use it, so it does not identify the runtime. The Angular adapters default to it |
| `window.__NF_REGISTRY__` | The registry script (`init-registry.mjs`) is loaded. Most npm-built shells don't have it, so its absence proves nothing, unless a remote's code throws reading `onReady` of undefined ([init signal missed](#init-signal-missed-the-remote-never-mounts-no-error-no-failed-request)) |
| `[ng-version]` attribute | The shell's Angular version. 20 or 21 plus the orchestrator usually means the v4-bridge package |

**No descriptor on an orchestrator page** (the shell may have disabled it, where the version supports that, or the
orchestrator predates it): probe instead.
`__NATIVE_FEDERATION__['cache-state']` (4.8+) is written before commit, so it exists even when init fails;
`['shared-externals']` and `<ns>.remotes` storage keys also identify the orchestrator. A custom storage adapter is
invisible to probing; with a descriptor (`type: 'custom'`), only its `get()` reads it.

### Turn on logging (Step 3)

Logging is bring-your-own: the default is `logger: noopLogger`, `logLevel: 'error'`, so the orchestrator prints
**nothing, not even errors**. The one exception is a failed `initRemoteEntry`, which always prints
`Failed to initialize remote entry, continuing anyway.` (`console.warn`, no detail). Init still rejects with an
`NFError`, but its message is generic (e.g. `Failed to fetch manifest`, `Could not create ImportMap.`). Only phase-3
rejections (`Could not determine shared externals …`, `Could not pool shared externals …`) carry `err.cause`; the
detail is in the log lines. To debug, the shell passes `consoleLogger` with `logLevel: 'debug'`.

| Shell | Default | To see more |
|---|---|---|
| Angular adapter (`@angular-architects/native-federation` 22+, v4-bridge) | `consoleLogger`; the level depends on the adapter line | check which logger and level the adapter's `initFederation` passes to the orchestrator, then raise the level (`{ logLevel: 'debug' }` in `main.ts`). On the Angular 20 bridge and adapters ≤ 21.2.7 / ≤ 22.0.5, logging defaults to `debug` and the option is `logging`, not `logLevel` |
| Direct `initFederation` | silent | `import { consoleLogger } from '@softarc/native-federation-orchestrator/options'`, then pass `{ logger: consoleLogger, logLevel: 'debug' }` |
| quickstart.mjs | whatever the quickstart page passes | rebuild not possible; read storage instead |
| Custom orchestrator or logger | whatever it passes | lines may read `[<n>]: msg` without the `[NF]` prefix; `<n>` is still the phase |
| `initNodeFederation` (SSR) | silent | pass `logger` + `logLevel` (see [ssr.md](ssr.md)) |

The level is set in the shell's init code, so raising it usually needs a rebuild. If you can't rebuild, read the same
verdicts from storage (below).

Format: `[DEBUG][<n>]: msg` goes to `console.log`, `[NF][<n>]: msg` goes to `console.warn` or
`console.error`. `<n>` is the orchestrator's internal phase (not a Step of the procedure) and tells you which phase failed. Texts are
from orchestrator 4.x; match by meaning if a line reads slightly differently:

| `<n>` | Phase | Lines worth knowing |
|---|---|---|
| 1 | fetch manifest + entries | `Fetched '<r>' from '<url>', exposing: […]` · **`Found remote '<r>' in storage, omitting fetch.`** (warm init; the staleness line) · `Overriding existing remote '<r>' with '<url>'.` · warn `Could not fetch remote '<r>'. skipping init.` (the remote is then simply absent) · error `Could not fetch manifest.` · warn `Fetched remote '<a>' does not match requested '<b>'. Omitting expected name.` (stored under `<a>`, so `loadRemoteModule('<b>')` fails later) · `Removing stored remotes the manifest doesn't list: …` (4.9, `mergeManifests: false`) |
| 2 | store entries | warn `[<r>][<pkg>] Version '<v>' is not a valid version.` · warn `[<r>][<pkg>] requiredVersion '<range>' excludes its own version '<v>'; …` (package.json/lockfile drift, 4.8+) · `Required version-range '<a>' does not match cached version-range '<b>'` |
| 3 | elect versions, pool | error `[<r>][<pkg>@<v>] Is not compatible with requiredRange '<range>' of shared <pkg>@<tag>.` (**only with `strict.strictExternalCompatibility`**, then init rejects `Could not determine shared externals in scope <scope>.`) · `[<scope>][pool:<p>] …` lines (see [pooling.md](pooling.md)) |
| 4 | build import map | `Singleton external <x> has multiple shared versions.` · `Remote name not found in cache.` → `Could not create ImportMap.` (inconsistent or corrupt cache) |
| 5 | commit | **debug `Added import map to browser. {imports, scopes}`** (the full map; the single most useful line) · warn `Could not save '<key>' to storage; this page runs from memory and the next page starts without a cache.` (4.9+) |
| 6 | `loadRemoteModule` | `Remote '<r>' is not initialized.` · `Exposed module '<key>' from remote '<r>' not found in storage.` These two are the only failures it logs. A failing `import()` (404, `Failed to resolve module specifier`, CORS) reaches you as the raw browser error |
| 7–9 | `initRemoteEntry` (7 fetch, 8 update cache and pooling, 9 convert) | 7: debug `Found remote '<r>' at '<url>' in storage, omitting fetch.` · warn `[<r>] Already initialized from '<u1>', ignoring '<u2>'.` (4.8+) · 8: warn `[<scope>][<r>] <spec>@<v> Is not compatible with existing <spec>@<tag> requiredRange '<range>'` (runtime loads do warn when not strict) |
| 0 | misc | debug `[init] STATE DUMP {remotes, shared-externals, scoped-externals}` when init fails. On 4.8+, `[dynamic-init][<r>] STATE DUMP` before a failed runtime load is rolled back. error `[SSE] Connection error:` (dev). This is the in-memory state that never reached storage |

### Find and read storage (Step 6)

Since 4.7, `initFederation` publishes a frozen descriptor as soon as it reads its options, before any fetch, so it
exists even when init fails:

```js
globalThis.__NF_ORCHESTRATOR__ = { storage: { // one entry per storageNamespace
  __NATIVE_FEDERATION__: {
    version: '4.9.0',          // orchestrator that published it ('dev' = unbuilt bundle)
    type: 'localStorage',      // 'globalThis' | 'localStorage' | 'sessionStorage' | 'custom'
    namespace: '__NATIVE_FEDERATION__',
    keys: ['remotes', 'shared-externals', 'scoped-externals', 'shared-chunks', 'cache-state'], // 'cache-state' since 4.8
    get: (key) => {},          // copy of the last committed value; absent with exposeStorageGetter: false
  } } };
```

| `type` | Where `<key>` lives |
|---|---|
| `globalThis` | `globalThis[namespace][key]` |
| `localStorage` / `sessionStorage` | `getItem(\`${namespace}.${key}\`)`, JSON |
| `custom` | only via `get(key)` |

- `get` returns what was **committed**. A running or failed init isn't in it; use the STATE DUMP for that.
- **Exactly one namespace is expected.** More than one, or a `version` that differs from the installed package,
  means more than one orchestrator on the page. That is unsupported, and it is the finding
  ([More than one orchestrator](#more-than-one-orchestrator-on-the-page-unpredictable-versions-or-maps)).
- **No descriptor** means the shell disabled it (where the version supports that), the orchestrator is < 4.7, the classic runtime is in use, or the
  global wasn't writable. A failed init still publishes it, so absence never means "init failed". The dump script then probes the default namespace in all three built-in storages. A custom
  namespace or storage has to be found in the shell's `initFederation` call.
- **Shells may keep their own keys** under the namespace (e.g. `__NATIVE_FEDERATION__.settings` with a `tag` that
  changes the manifest URL). The dump lists them under `values` too. Read them: a per-browser flag explains
  "works on my machine".
- `exposeStorageGetter: false` (4.7+) removes only `get`.

Run [scripts/dump-orchestrator-storage.js](../scripts/dump-orchestrator-storage.js). Next to the raw values it
returns `verdicts`, one row per shared copy, flattened from `shared-externals`.

The shapes below are the **4.x** storage format. On another major, check the descriptor's `version` first; the
shapes may differ.

Annotated example. This is real output of orchestrator 4.9.0: a shell with `@angular/core` 22.1.0 and rxjs
7.8.2; mfe1 ships core 22.1.0 plus `rxjs-interop`; mfe2 ships core 21.2.15 (`~21.2.0`, strict) and rxjs 7.8.1
(not strict). Some fields are trimmed.

```jsonc
// remotes: per remote; the shell is "__NF-HOST__" (`"host": true` marks its copies below)
{ "mfe1": { "scopeUrl": "http://localhost:4201/",
            "exposes": [{ "moduleName": "./Component", "file": "Component.EEE.js" }] },  // + "integrity" if pinned
  "__NF-HOST__": { "scopeUrl": "http://localhost:4200/", "exposes": [] } }

// shared-externals: { <shareScope>: { <package>: … } }. Global scope "__GLOBAL__", strict scope "strict".
{ "__GLOBAL__": {
  "@angular/core": {
    "dirty": false,                    // true = re-elected on the next init
    "servingBuild": "__NF-HOST__",     // 4.8+: the one build serving this package in this scope
    // "poolName", "poolWinner": only when pooled, see pooling.md
    "versions": [                      // one row per (tag, action); the same tag can have several rows
      { "tag": "22.1.0", "action": "share", "host": true,     // share = mapped in global `imports`
        "remotes": [                   // remotes[0] is the basis: its files are what gets served
          { "name": "__NF-HOST__", "requiredVersion": "^22.1.0", "strictVersion": true,
            "cached": true,            // means "mapped in the committed import map", not "HTTP-cached"
            "bundle": "browser-shared", "dense": true,       // dense: 4.9+
            "entries": { "@angular/core": "_angular_core.AAA.js",
                         "@angular/core/primitives/signals": "_angular_core_primitives_signals.BBB.js" } } ] },
      { "tag": "22.1.0", "action": "scope", "host": false,    // same tag, yet scoped: mfe1 imports
        "remotes": [ { "name": "mfe1", "entries": {           // rxjs-interop, which the shell build lacks,
            "@angular/core": "_angular_core.M1.js",           // so mfe1 runs its own core. No log line.
            "@angular/core/rxjs-interop": "_angular_core_rxjs-interop.M1.js" } } ] },
      { "tag": "21.2.15", "action": "scope", "host": false,   // ~21.2.0 rejects 22.1.0: own core. No log line
        "remotes": [ { "name": "mfe2", "requiredVersion": "~21.2.0", "strictVersion": true, … } ] } ] },
  "rxjs": { "servingBuild": "__NF-HOST__", "versions": [
      { "tag": "7.8.2", "action": "share", "host": true, "remotes": [
          { "name": "__NF-HOST__", "cached": true, … },
          { "name": "mfe1", "cached": false, … } ] },         // same tag, deduped onto the basis
      { "tag": "7.8.1", "action": "skip", "remotes": [ { "name": "mfe2", "strictVersion": false, … } ] } ] } } }
      // skip = this copy uses the shared 7.8.2

// scoped-externals: non-singletons per remote (+ fake "0.0.0" @nf-internal/chunk-* rows for flat-chunking builds)
{ "mfe1": { "lodash-es": { "tag": "4.18.1", "bundle": "browser-shared", "entries": { "lodash-es": "lodash-es.M1.js" } } } }

// shared-chunks: { <remote>: { <bundle>: files } }; mapped as "@nf-internal/<chunk>" in that remote's scope
{ "mfe1": { "browser-shared": ["chunk-M1A.js"], "mapping-or-exposed": ["chunk-M1B.js"] } }

// cache-state (4.8+): which orchestrator wrote the cache; share scopes a runtime load wrote but didn't decide
{ "version": "4.9.0", "undecidedScopes": [] }
```

The resulting map has `scopes["http://localhost:4201/"]["@angular/core"]` and
`scopes["http://localhost:4202/"]["@angular/core"]`: **three Angular cores, with no warning.** Read verdicts
like this:

| Action | Meaning | For a singleton |
|---|---|---|
| `share` | served globally from `remotes[0]` | fine |
| `skip` | the copy resolves to the shared version; its own files are unused | fine |
| `scope` | the copy runs its own files through its remote's scope | **a second instance for that remote** |

Why a row is `scope`: see "Scoped copy" under Failure modes.

**Stale cache check:** compare `remotes[<r>].exposes` and `scopeUrl` with a freshly fetched
`<scopeUrl>remoteEntry.json`.

### Cache rules (Step 8)

| Rule | Effect |
|---|---|
| Warm init | Remotes already in storage are **not fetched**. `cacheTag`/`profile.cacheTag` only affect fetched entries, so they don't help here |
| Same URL, redeployed | Stays stale until storage is cleared, unless `profile.overrideCachedRemotesIfURLMatches: true`. By design: the cache assumes versioned entry URLs in the manifest (`…/<name>/<version>/remoteEntry.json`), where a new URL triggers the override. "Same URL" means the manifest URL equals `<scopeUrl>remoteEntry.json` exactly: a query string (`…?v=2`) or another file name never matches, so that remote is refetched on every init |
| `profile.cacheTag` | Appends `?cacheTag=<tag>` to fetched remote entries only, not to the manifest or `initRemoteEntry`; `hostRemoteEntry.cacheTag` wins for the shell |
| Multi-page shell (full page loads) | `initFederation` runs on every page. Without persistent storage each page elects again (different manifests, different versions per page); with it, the first page's choices persist. Reproduce the **navigation path**, not just a reload |
| New URL for a known remote | `initFederation` overrides it (`profile.overrideCachedRemotes: 'init-only'`, the default; `'never'`, also set by the opt-in `cachingProfile`, keeps the old one). Since 4.8, `initRemoteEntry` **never** overrides: warn `Already initialized from …`. `'always'` is deprecated and behaves like `'init-only'` |
| Remote removed from the manifest | Still served from storage (`profile.mergeManifests: true`, the default, 4.9). With `false`, it's dropped |
| Orchestrator version changed | 4.8+: `cache-state.version` ≠ running version clears every key once (one cold init). ≤ 4.7: no stamp, so a new orchestrator reads the old shape until you clear storage by hand |
| Storage write fails (quota) | 4.9+: one warn `Could not save '<key>' to storage; …`; the page runs from memory and the next page starts cold. ≤ 4.8: the write throws and init fails |
| `clearStorage: true` | Clears on every init |

To prove that a cache is the cause: clear site data (or remove the `<namespace>.*` keys), reload twice, and
compare cold with warm.

### What common failures look like

Each row was induced and captured with `nf-capture.mjs` ([repro.md](repro.md)) on core 4.x (`angular/simple`,
Angular 22.2, `denseExternals`) · orchestrator 4.9.0 · v4 · dev build, shim mode, `logLevel: 'debug'`. Text is
verbatim; `<…>` marks shortened parts.

| Induced failure | Console (verbatim) | Where the evidence is | Rules out |
|---|---|---|---|
| **remoteEntry 404** (remote not deployed or wrong manifest URL) | `[NF][1]: Could not fetch remote 'team/mfe1'. skipping init. NFError: Fetch of 'http://localhost:4201/remoteEntry.json' returned 404 - Not Found` (warning), then on load `[NF][6]: Failed to load module team/mfe1/./Component: {error: NFError: Remote 'team/mfe1' is not initialized.}` | `failedRequests` (404 on `remoteEntry.json`). The remote is absent from the import map and from storage `remotes` | Exposes mismatch and resolution. Init does **not** fail (unless `strict.strictRemoteEntry`), so "not initialized" is a symptom: the cause is the earlier `[NF][1]` warning. No automatic retry; the failed remote is never stored, so `initRemoteEntry('<url>', '<r>')` loads it later in the same page |
| **Missing shared dep** (package dropped from one remote's `shared`) | `Unable to resolve specifier '@internal/logging' imported from http://localhost:4201/Component.js` (page error). **No `[NF]` log** | `pageErrors`. The specifier is absent from every map. The importer URL names the build that lacks the share | Network and cache. The map is complete for what was declared, so the cause is in build output (Step 7) |
| **Exposes key mismatch** | `[NF][6]: Failed to load module mfe2/./Component: {error: NFError: Exposed module './Component' from remote 'mfe2' not found in storage.}` | Import map has `mfe2/./Cmp`. Storage `remotes.mfe2.exposes[].moduleName`. At debug, `[DEBUG][1]: Fetched 'mfe2' <…> exposing: [{"key":"./Cmp",<…>}]` | Network (the entry loaded fine). If the live entry has the right key, it's a stale cache instead (next row) |
| **Stale persistent cache** (localStorage, default profile: `overrideCachedRemotes: 'init-only'` + `overrideCachedRemotesIfURLMatches: false`; remote redeployed at the **same** URL with a renamed file) | `[DEBUG][1]: Found remote 'team/mfe1' in storage, omitting fetch.`, then `Failed to find a valid digest in the 'integrity' attribute for resource 'http://localhost:4201/Component.js' with computed SHA-384 integrity '<…>'. The resource has been blocked.` and page error `Unable to fetch http://localhost:4201/Component.js - see network log for details.` | `failedRequests` 404 on a remote module. **No** `remoteEntry.json` request (none in `entries`). Storage `type: localStorage`, `remotes[…].exposes[].file` differs from the live entry | Tampering: the SRI error hashes the 404 body. A cold run (fresh `--profile`) works, which confirms the cache. The default refetches a cached remote only when its manifest URL changes. `cachingProfile` (`'never'`) never refetches |
| **Strict version conflict** (`strictVersion: true`, ranges don't overlap) | **Nothing**, even at debug | Import map `scopes["http://localhost:4202/"]` maps `rxjs`. `sharedLoads.duplicates` lists `rxjs` from two origins. Storage `shared-externals.__GLOBAL__.rxjs.versions[]`: `action: "scope"` | "No error means healthy". This conflict shows up only as a scope and a duplicate |
| **Non-strict version conflict** (`strictVersion: false`) | **Nothing**, even at debug | Only storage: `versions[]` row with `action: "skip"`. The remote silently runs the shared version outside its declared range | Duplicates (there are none). Look here when a remote misbehaves on an API that differs between versions |
| **Framework conflict in a pool** (`@angular/*` 22.1.0 vs shell 22.2.3, pool `ng-core`) | `[NF][3]: [__GLOBAL__][pool:ng-core] 'mfe2' is islanded: its range rejects '@angular/common@22.2.3' of the elected build '__NF-HOST__'. All 11 of its entrypoints are scoped for it.` (warning) | `sharedLoads.duplicates` lists every `@angular/*` from two origins. Import map scope for the remote. No runtime error until something crosses the boundary | Missing shares. Read [pooling.md](pooling.md) |
| **SRI mismatch** (file changed after build) | `Failed to find a valid digest in the 'integrity' attribute for resource 'http://localhost:4202/Component.js' <…> The resource has been blocked.`, `Fetch API cannot load <…>. SRI's integrity checks failed.` | `console` only. `failedRequests` is **empty** (the response was 200) | A stale cache, when no 404 precedes it |

`@nf-internal/chunk-*` mapped under two origins is expected when a remote is scoped; `nf-capture` leaves it out
of `sharedLoads.duplicates`.

## DevTools extension

The [Native Federation DevTools](https://native-federation.com/docs/v4/devtools.md) Chrome panel shows the
orchestrator's committed state: who won each package, who declared what, isolated copies, and the import map. It
doesn't support the classic runtime, and automation browsers don't load it. When the **user** has it, ask for a
screenshot of the relevant tab or for **Export JSON**, and have them press Refresh after any `initRemoteEntry`.
It can't tell you three things:
- whether a mapped file actually loaded (check Network)
- anything about remotes whose `remoteEntry.json` failed (check the `[NF][1]` console lines)
- whether a remote actually imports a package it declared

## Failure modes

Most common first. Pooling's own failure modes are in [pooling.md](pooling.md), SSR's in [ssr.md](ssr.md).

### Scoped copy: a framework or library runs twice, no warning
- **Mechanism:** the orchestrator elects one version and one serving build per package per share scope. A
  remote gets **its own copy** (the whole package from its own build, mapped under its URL in `scopes`) in exactly
  four cases:
  - its `strictVersion` range rejects the elected version (the shell's version always wins when
    `hostRemoteEntry` is set, which the Angular adapter does by default)
  - the package is `singleton: false`
  - pooling islands it ([pooling.md](pooling.md))
  - since 4.8, the serving build lacks an entry point the remote imports: one build per package, so the remote runs
    the whole package from its own build (next failure mode)

  This is by design. On a cold init it isn't logged at any level, unless pooling decided it.
- **Symptoms:** silent at init. Later: Angular `NG0203`/`NG0201`, `NullInjectorError`, `inject() must be
  called from an injection context`; React "Invalid hook call"; `instanceof` or a singleton service failing across
  remotes. On `initRemoteEntry` the same case warns `[NF][8]: [<scope>][<r>] <spec>@<v> Is not compatible with
  existing <spec>@<tag> requiredRange '<range>'`.
- **Evidence:**
  - Step 5: the package is mapped under `scopes["<remote URL>"]` as well as in `imports`.
  - Step 6: the remote's row has `action: "scope"`. `poolCause` means pooling decided it. Otherwise compare
    the remote's `requiredVersion` with the elected `tag`, and its `entries` with the `servingBuild`'s `entries`.
  - To surface range violations, set `strict: { strictExternalCompatibility: true }` once. Init then rejects with
    `[NF][3]: [<r>][<pkg>@<v>] Is not compatible with requiredRange '<range>' of shared <pkg>@<tag>.`
- **Fix direction:** align the versions or ranges; relax `strictVersion` where a shared newer version is safe;
  put a framework family in a `pool` or a share scope; make the serving build cover every entry point remotes import
  (`includeSecondaries: { keepAll: true }` on the shell's `@angular/*`, see below).

### Missing entry point in the serving build: `NG0203` once `toSignal()` / `rxjs-interop` runs
- **Mechanism:** every build bundles only the entry points it imports (`ignoreUnusedDeps`), so builds at the
  same tag can ship different entry-point sets. The import map resolves a bare import **by the importing file's
  URL**, so a file pulls in its own build's internal chunks and scope. How the orchestrator handles a remote that
  imports an entry point the serving build doesn't ship differs by design:
  - **≤ 4.7:** the missing entry point was taken from another build at the same tag ("stitching"). The page
    renders, then breaks when that entry point runs: a second copy of the framework's internals.
  - **≥ 4.8:** the remote runs the **whole package** from its own build, which is a scoped copy (above). More
    downloads, no tear.
- **Symptoms:** ≤ 4.7: `NG0203` only after a code path that uses the borrowed entry point, typically
  `@angular/core/rxjs-interop`. ≥ 4.8: silent extra downloads, or a second instance if the remote shares state
  with the shell.
- **Evidence:** Step 5: on ≤ 4.7, `@angular/core` and `@angular/core/rxjs-interop` map to different origins.
  On ≥ 4.8, the remote has its own scope for the whole package. Step 7: the entry point is in the remote's
  `entries` and missing from the serving build's.
- **Applies to:** orchestrator ≤ 4.7 vs ≥ 4.8, as above.
- **Fix direction:** have the serving build (usually the shell) ship the entry point:
  `includeSecondaries: { keepAll: true }` on that package, or import it there
  ([build-output.md](build-output.md)).

### Stale cached remote: a deploy doesn't show, or it fails only on reload
- **Mechanism:** with `localStorage`/`sessionStorage`, a warm init reuses every stored remote and doesn't fetch
  its `remoteEntry.json`. The cache assumes versioned entry URLs: only a changed manifest URL triggers an override
  at `initFederation`. Storage also keeps remotes from other pages' manifests (`mergeManifests`, default `true`).
  Multi-page shells run `initFederation` on every page, so the navigation path decides what's cached.
- **Symptoms:** old UI after a deploy; 404s on exposed modules or `@nf-internal/chunk-*` files the new build
  renamed; an SRI block whose computed hash is that of the 404 body (`Failed to find a valid digest in the
  'integrity' attribute …`); `Exposed module '<key>' from remote '<r>' not found in storage.` for a key the new
  entry has. Debug log: `[DEBUG][1]: Found remote '<r>' in storage, omitting fetch.`
- **Evidence:** Step 4: no `remoteEntry.json` request for that remote (absent from nf-capture's `entries`). Step 6: storage `type` is
  `localStorage`/`sessionStorage`, and `remotes[<r>].exposes`/`scopeUrl` differ from the live entry. Step 8: a
  cold run (clear site data) works.
- **Applies to:** orchestrator ≥ 4.8 clears the whole cache once when `cache-state.version` differs from the
  running orchestrator; ≤ 4.7 has no stamp.
- **Fix direction:** deploy each build at a versioned URL, or set `profile.overrideCachedRemotesIfURLMatches: true`,
  or clear storage (`clearStorage`); `mergeManifests: false` when every page passes the full manifest. See
  Cache rules above.

### Remote absent: `Remote '<r>' is not initialized.`
- **Mechanism:** a remote whose `remoteEntry.json` can't be fetched or parsed is skipped at init (warn) and never
  stored. Init still resolves, unless `strict.strictRemoteEntry` is set. A manifest key that differs from the
  entry's `name` stores the remote under the entry's `name`. There's no automatic retry.
- **Symptoms:** `[NF][1]: Could not fetch remote '<r>'. skipping init.` (only with a logger), later
  `[NF][6]: Failed to load module <r>/<key>: … Remote '<r>' is not initialized.` (`<key>` as passed, usually `./X`);
  `Fetched remote '<a>' does not match requested '<b>'. Omitting expected name.`
- **Evidence:** Step 4: 404, CORS error or an HTML body (SPA fallback; `htmlBody: true` in nf-capture's `entries`)
  for that `remoteEntry.json`. Step 6: the
  name is absent from `remotes`, or present under another name.
- **Fix direction:** fix the manifest URL, the deployment or CORS. Make the manifest key match `name`.
  `initRemoteEntry('<url>', '<r>')` can load it later in the same page.

### Exposed module not found: `Exposed module '<key>' from remote '<r>' not found in storage.`
- **Mechanism:** `loadRemoteModule(remote, key)` looks the key up in the stored `exposes`, so storage, not the import
  map, is the authority. The import-map key is `<remote>/./<key>` by convention only.
- **Symptoms:** the error above, at `[NF][6]`.
- **Evidence:** Step 7: the live entry's `exposes[].key` (including `./`). If the live key matches, it's a stale
  cache (above).
- **Fix direction:** call `loadRemoteModule` with the exact `exposes` key.

### Silent version skew: a remote runs a shared version outside its range
- **Mechanism:** a copy with `strictVersion: false` whose range rejects the elected version is mapped onto that
  version anyway (`action: "skip"`). Nothing is logged.
- **Symptoms:** runtime API errors in that remote only (a missing export or method, changed behaviour), no NF
  log.
- **Evidence:** Step 6: the remote's row is `skip` at a tag its `requiredVersion` doesn't accept.
- **Fix direction:** align the versions, or make the range strict so the remote gets its own copy instead.

### Late remote (`initRemoteEntry`): scoped although a global choice would fit, or ignored
- **Mechanism:** `initRemoteEntry` appends a second import map with only new keys; committed keys never change.
  A late remote whose range rejects the committed version gets a scoped copy, even when electing its version at
  init would have satisfied everyone. A remote that is already initialized is never replaced (≥ 4.8). A failed
  runtime load is rolled back, so a retry fetches again.
- **Symptoms:** `[NF][8]: … Is not compatible with existing …` (warn); `[NF][7]: [<r>] Already initialized from
  '<u1>', ignoring '<u2>'.`; in native mode on browsers without multiple-import-map support, the late map has no
  effect and imports fail to resolve.
- **Evidence:** Step 5: one additional map script per runtime load. Step 6: the late remote's rows.
- **Applies to:** native mode needs a browser that supports multiple import maps; shim mode always works. The
  never-replace rule is ≥ 4.8.
- **Fix direction:** list remotes whose versions matter in the manifest so they take part in the election; load
  each remote once.

### Init signal missed: the remote never mounts, no error, no failed request
- **Mechanism:** quickstart and custom orchestrators announce readiness with
  `window.dispatchEvent(new CustomEvent('mfe-loader-available', …))`. A listener attached later (a
  `type="module-shim"` or `async` script) misses it. The event registry (`init-registry.mjs`,
  `window.__NF_REGISTRY__`) replays: `onReady('orch.init-ready', …)` resolves even after the fact.
- **Symptoms:** silent. The map and storage are complete, but no exposed module is ever requested. A remote
  using the registry may throw reading `onReady` of undefined.
- **Evidence:** Step 4: no request for any exposed module. Step 5/6 complete. `typeof window.loadRemoteModule ===
  'function'` (quickstart) and calling it by hand mounts the remote.
- **Fix direction:** load `init-registry.mjs` before everything else and use `__NF_REGISTRY__.onReady`.

### Integrity and Trusted Types: a module is blocked
- **Mechanism:** manifest `integrity` pins each entry and file; the browser blocks any file whose hash differs.
  The orchestrator writes the import map and the module URLs through the Trusted Types policy `nfo` whenever the
  browser supports Trusted Types.
- **Symptoms:** `Failed to find a valid digest in the 'integrity' attribute for resource '<url>' … The resource
  has been blocked.` with a 200 response (file changed after the build), or after a 404 (stale cache, above).
  Under a CSP `trusted-types` directive without `nfo`: `Policy "nfo" disallowed`. From the policy's validators:
  `[nf-orchestrator] trusted-types: invalid script URL "<u>"` / `disallowed protocol`.
- **Evidence:** Step 3 console; Step 4: whether the response was 200 or 404; the page's CSP header.
- **Fix direction:** rebuild or redeploy so the hashes match; allow `nfo` in `trusted-types`, or turn the policy off:
  pass `trustedTypesPolicyName: false` to a direct `initFederation` that uses the default import-map functions, or as
  the second argument of `useShimImportMap(cfg, false)` / `useDefaultImportMap(false)`. The Angular adapters build
  these functions without the argument, so with them `nfo` must be allowed in the CSP.

### Static import map replaced: hand-written mappings stop resolving
- **Mechanism:** `initFederation` removes every `<head>` script of the type it writes (`importmap-shim` in shim mode,
  `importmap` otherwise) before writing its own, including a static map the build put there.
- **Symptoms:** entries from a hand-written import map stop resolving (`Failed to resolve module specifier`).
- **Evidence:** Step 5: only the orchestrator's map remains.
- **Fix direction:** put extra mappings in a remote entry or a later map.

### More than one orchestrator on the page: unpredictable versions or maps
- **Mechanism:** one orchestrator per page is the only supported setup, with no concurrency: only the shell calls
  `initFederation`. Each orchestrator bundle, instance, storage namespace or overlapping `initFederation` call elects
  on its own and writes its own map, so the page ends up with whichever choice landed last. The classic runtime
  counts as an orchestrator here: a classic runtime next to the orchestrator (typically a v3 remote running its own
  `initFederation`) is the same failure. Seeing more than one is itself the finding.
- **Symptoms:** versions or remotes that change between loads, maps that don't match storage, or a remote that
  resolves differently from one load to the next.
- **Evidence:** Step 2/6: more than one namespace in `__NF_ORCHESTRATOR__.storage` (`detect-runtime.js` warns), or a
  `version` that differs from the installed package. Step 5: more than one map written at init (maps added later by
  `initRemoteEntry` carry only new keys). Step 3: init logged twice (two `[NF][1]` fetch sequences or two
  `Added import map` lines). Classic next to the orchestrator: `__NATIVE_FEDERATION__` holds both `Map`s and plain
  records, or, when the orchestrator created the global first, classic `initFederation` throws `Cannot read
  properties of undefined (reading 'set')` and `loadRemoteModule` `(reading 'get')`/`(reading 'has')` (classic first:
  nothing throws).
- **Fix direction:** one orchestrator, one `initFederation` call, in the shell; load later remotes with
  `initRemoteEntry`. A remote that loads other remotes takes the shell's `loadRemoteModule` (passed into its
  bootstrap) instead of calling `initFederation` itself ([angular.md](angular.md)).

### Serving-build choice in dev: the static build's copy wins over the dev-served one
- **Mechanism:** within one version, the served copy is chosen by shell → already mapped (`cached`) → most entry
  points → remote name. Workspace libraries usually share one version (often `0.0.0`), so a statically served
  remote can win over a remote under `ng serve` on its name alone, and persistent storage keeps it.
- **Symptoms:** a library edit doesn't show; no error.
- **Evidence:** Step 6: the library's `versions[0].remotes[0].name` (or `servingBuild`) is the static remote.
- **Fix direction:** serve that remote in dev too, or clear storage.

### Version stamps: `Version '' is not a valid version.`
- **Mechanism:** each shared entry needs a semver `version`. Workspace libraries without a version produce `""`.
- **Symptoms:** `[NF][2]: [<r>][<pkg>] Version '' is not a valid version.` The version is coerced to the floor of
  `requiredVersion`, or the entry is skipped (`profile.skipInvalidExternalVersions`), or init rejects
  (`strict.strictExternalVersion`).
- **Evidence:** Step 7: `"version": ""` in that `remoteEntry.json`.
- **Fix direction:** give mappings a version (core's `mappingVersion` feature).

If the evidence matches none of these failure modes, suspect a defect: build a reproduction
([repro.md](repro.md)) and check the repo's issue tracker.
