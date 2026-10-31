# Classic runtime (`@softarc/native-federation-runtime`)

Live docs: https://native-federation.com/docs/v3/llms.txt ·
[Migration to v4](https://native-federation.com/docs/v4/angular-adapter/migration-v4.md)

**Deprecated.** The 3.x line is used by `@angular-architects/native-federation` ≤ 21, whose runtime re-exports it.
The 4.x line ended at **4.1.2**. When the real fix is "resolve versions" or "cache", say so and point to the
migration (Angular 20/21: the v4-bridge `@angular-architects/native-federation-v4`).
How it resolves (3.x and 4.x behave the same):

1. **Shared packages are reused only at an exact `packageName@version`.** `singleton`, `strictVersion` and
   `requiredVersion` are never read at runtime. A remote whose version differs by a single patch gets its
   own copy, so Angular ends up loaded twice. Nothing is logged.
2. **The shell's shared packages go in `imports`. Each remote's go in `scopes["<remote baseUrl>/"]`.**
   A remote's scope applies only to files whose URL starts with that directory. Exposed modules are root
   `imports` keyed `<remoteName>/<key without ./>`, e.g. `mfe1/Component`. (The orchestrator writes
   `mfe1/./Component` by convention; that isn't a reliable way to tell the runtimes apart.) Two *different* remote entries in one directory share that scope, and the later one wins.
   One entry registered under several names is harmless.
3. **The map is always `<script type="importmap-shim">`**, and modules load via `importShim()` when that
   exists. Without es-module-shims, the map does nothing.
4. **Remotes are registered once, by `initFederation`.** `loadRemoteModule({ remoteEntry })` registers a
   remote whose base URL isn't known yet and **appends a second import map**. Remotes that failed during
   init are not retried.
5. **No persistent cache.** State lives in memory on `globalThis.__NATIVE_FEDERATION__`. Every reload
   refetches the manifest and every `remoteEntry.json`. Staleness can only come from the HTTP cache.

## Reading the evidence

Step 2 identifies the runtime by the shape of `globalThis.__NATIVE_FEDERATION__`. If the global also holds
orchestrator records, or classic calls throw `Cannot read properties of undefined (reading 'get')` on a page that runs
the orchestrator, two runtimes share the global: see [More than one orchestrator](orchestrator.md#more-than-one-orchestrator-on-the-page-unpredictable-versions-or-maps). Then run
[scripts/dump-classic-state.js](../scripts/dump-classic-state.js) with Step 5 (there is no cache, so Step 6 doesn't apply). Two
`externals` rows with the same `pkg` are two instances.

- `externals`: key `name@version` → the URL that first registered it, whether the shell's (relative,
  `./x.js`) or a remote's (absolute). Chunks show up as `@nf-internal/chunk-*`; v3 core lists them as
  shared entries at `@0.0.0`.
- `remoteNamesToRemote`: name → `{ name, exposes, shared, baseUrl }`. A missing name explains
  `unknown remote`.
- `baseUrlToRemoteNames`: what `loadRemoteModule({ remoteEntry })` checks before fetching again.
- `document.querySelectorAll('script[type="importmap-shim"]').length > 1` means a remote was added via
  `remoteEntry` after init (point 4). Check every map, or use `importShim.getImportMap()`.

**Not failures:**
- `blob:` URLs in the Network tab or in errors are es-module-shims shim-mode rewrites, not double loads. Map the
  blob back through the stack frame `(at <file>:<line>)`. A real double load shows two different file URLs for one
  package.
- `/@id/<pkg>` entries in a dev-mode `remoteEntry.json` are added for Angular's Vite dev server.
- An empty `scopes` for the shell is normal. The shell's shared packages live in `imports`.

## Failure modes

### Exact-version sharing: a shared package runs twice (`NG0203`, NullInjector, "services not singleton")
- **Mechanism:** a shared package is reused only when another participant registered the identical
  `packageName@version` (point 1). Any drift, even a patch, gives the remote its own copy in its scope.
  `singleton`, `strictVersion` and ranges change nothing. A `skip`ped package is compiled into the remote, so it is
  never taken from the shell either.
- **Symptoms:** silent at runtime. With Angular: `NG0203: inject() must be called from an injection context …`,
  `NullInjectorError: No provider for …`, or the remote just doesn't render. Often "only in prod/QA", because the
  deployed remote was built from another lockfile.
- **Evidence:** Step 5: `dump-classic-state.js` shows two `externals` rows for one `pkg`. Step 4: one package is
  fetched from two origins. The stack trace mixes two file names for one package. Step 7: the `shared[].version`
  values differ across the `remoteEntry.json` files.
- **Fix direction:** align versions exactly (lockfiles), then rebuild and redeploy every participant. Don't `skip`
  what must be shared. **Migrate to the orchestrator** if versions can't stay in lockstep.
- **Applies to:** classic runtime. On the orchestrator, versions are resolved by semver per share scope. A remote gets a scoped copy only in the cases listed
  under [Scoped copy](orchestrator.md#scoped-copy-a-framework-or-library-runs-twice-no-warning). Compiled Angular still expects
  the core version it was built against, so keep Angular aligned anyway.

### Import map not there yet: shared import before `initFederation`
- **Mechanism:** the import map exists only once `initFederation` resolves. Anything `main.ts` imports statically,
  including a static `import './bootstrap'`, resolves before that.
- **Symptoms:** on initial load, `Unable to resolve specifier '@angular/core' imported from …/main.js`, or in dev
  `Unsupported Content-Type "text/html" loading …/@id/<pkg>`.
- **Evidence:** Step 1: it fails on every load. Step 3: the importer named in the error is `main.js`, or a chunk
  that `main.js` imports statically.
- **Fix direction:** `initFederation(…).then(() => import('./bootstrap'))`, with no other static imports of shared
  code in `main.ts`. Skipping a package helps only if it imports no shared packages itself.
- **Applies to:** the orchestrator too (it's inherent to import maps).

### Registration at init: `unknown remote`, permanent fallback, a second import map
- **Mechanism:** `initFederation` registers the manifest's remotes once (point 4). A remote whose entry failed
  then is logged and skipped, never retried. A remote known only to another remote isn't registered at all.
  `loadRemoteModule({ remoteEntry })` registers a new base URL later and appends a second `importmap-shim`, which
  only adds mappings.
- **Symptoms:** `Error: unknown remote <name>`, or `Unknown exposed module <key> in remote <name>`, or the
  `fallback` is returned every time. At init, `Error loading remote entry for <name> from file <url>` is a
  `console.error`, not a throw, unless `throwIfRemoteNotFound` is set.
- **Evidence:** Step 3: the init-time error. Step 5: the name is missing from `remoteNamesToRemote`, or two
  `importmap-shim` scripts exist. Step 4: the entry's status and content type. For `Unknown exposed module`, Step 7:
  compare the key with `exposes[].key`.
- **Fix direction:** list every remote, including indirect ones, in the shell manifest, and call `initFederation`
  only in the shell. Load remotes that are unknown at deploy time, or that need a retry, with
  `loadRemoteModule({ remoteEntry, exposedModule })`. A 404 on the shell's own `remoteEntry.json` (fetched relative to the
  page) leaves its shared packages unmapped: serve it next to `index.html`, or on 3.x pass
  `initFederation(manifest, { deployUrl })`; classic 4.x has no such option.
- **Applies to:** classic runtime. On the orchestrator, late remotes use `initRemoteEntry(url, name)`, which also appends a complementary map
  and can't change the existing mappings. A remote that failed at init is not retried automatically; register it
  again with `initRemoteEntry(url, name)` (see orchestrator.md). The skipped remote's warning is hidden unless the shell raises the log level.

### Scope per base URL: a remote's own versions aren't used, or its imports don't resolve
- **Mechanism:** a remote's shared packages are mapped under `scopes["<directory of its remoteEntry.json>/"]`
  (point 2). That scope applies only to files whose URL starts with that directory. Two different entries in one
  directory share one scope, and the later one wins.
- **Symptoms:** silent. A remote file served from another path (CDN, `deployUrl`, a subpath behind a proxy) falls
  back to the shell's `imports`, so it runs the shell's version. If the shell doesn't share the package:
  `Unable to resolve specifier '<pkg>' imported from <remote file URL>`.
- **Evidence:** Step 5: resolve by hand. Take the importing file's URL from the error or the Network tab, and check
  whether it starts with the remote's scope key.
- **Fix direction:** serve each remote's `remoteEntry.json` and its bundles from the same directory, with one
  directory per remote.
- **Applies to:** classic runtime. On the orchestrator, the scope is also the folder of the remote's `remoteEntry.json`, so the same rule holds.

### HTTP cache only: old bundle names or a blank page after a deploy
- **Mechanism:** the runtime keeps no state across reloads (point 5). It refetches the manifest and every
  `remoteEntry.json` each time, so staleness can only come from the HTTP cache of those un-hashed files.
- **Symptoms:** after a deploy, requests for bundle names that no longer exist (404, or `index.html` served as
  JS), or a blank page until a hard reload. With v3 core, a shared entry keeps its name when only its chunk imports
  change, so a cached entry can request a deleted chunk: send no-cache for shared entries too.
- **Evidence:** Step 4: the entry or manifest is served from the disk/memory cache, and its file names differ from
  a fresh fetch with `?nocache`. Step 8: a cold profile works.
- **Fix direction:** no-cache headers on the manifest and on `remoteEntry.json`, or `initFederation(manifest,
  { cacheTag })`, which appends `?t=` to the manifest and every entry.
- **Applies to:** classic runtime. On the orchestrator, the HTTP layer still applies, and a persistent cache sits on top: a warm init doesn't
  refetch cached remotes at all (see orchestrator.md).

### Plain `fetch`: CORS or auth failure on `remoteEntry.json`
- **Mechanism:** the manifest and the entries are fetched with `fetch(url)`, with no `credentials` and no headers.
- **Symptoms:** a CORS error or a 401 on `remoteEntry.json` for entries behind cookies or bearer tokens, usually
  across subdomains. The remote is then unregistered (see "Registration at init").
- **Evidence:** Step 4: the entry request carries no cookie or `Authorization` header, and its response is a 401
  or lacks `Access-Control-Allow-Origin`.
- **Fix direction:** serve entries publicly with CORS headers, or route them through a same-origin gateway or BFF.
- **Applies to:** the orchestrator fetches the same way; check whether the entry request carries credentials.

If the evidence matches none of these failure modes, suspect a defect in a deprecated runtime: build a
reproduction ([repro.md](repro.md)) to confirm it, then advise migrating to the orchestrator. Don't file v3 or
classic-runtime issues.
