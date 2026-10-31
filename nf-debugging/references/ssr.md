# SSR

Live docs: https://native-federation.com/docs/v4/orchestrator/node.md ·
https://native-federation.com/docs/v4/angular-adapter/ssr.md ·
https://native-federation.com/docs/v4/ssr-hydration.md ·
https://native-federation.com/docs/v3/angular-adapter/ssr.md

// TODO: this file is deliberately open. The method for debugging the server side isn't settled yet.

- **v3**: `@softarc/native-federation-node`. The schematic turns `server.ts` into a launcher
  (`initNodeFederation({ remotesOrManifestUrl, relBundlePath })`, then `import('./bootstrap-server')`), or you use
  `dist/<app>/server/fstart.mjs`. It writes `node.importmap` and `federation-resolver.mjs` **to `process.cwd()`** and
  registers them with `module.register()`. Exact-version dedupe, like the classic runtime. The `ssr` flag is ignored
  while `dev` is on, so `ng serve` renders **without** federated SSR.
- **v4**: the orchestrator's `/node` entry (`initNodeFederation`) runs the same resolver as the browser. The import map
  lives in a `module.register()` loader on its own worker thread, pushed over a message port. Node ≥ 20.6. In-memory
  storage, no SSE. **Logs nothing unless you pass a logger** (`logger: consoleLogger, logLevel: 'debug'` prints the
  full map as `[DEBUG][5]: Added import map to browser.`).
- **Angular v4** (22.x, v4-bridge 21.2.x): prod launches with
  `node --import @angular-architects/native-federation/node-preload dist/<app>/server/server.mjs`. The loader must be
  registered before any `@angular/*` loads, so it can't live in `server.ts`. The preload reads
  `<browserDir>/federation.manifest.json` and `<browserDir>/remoteEntry.json` (`browserDir` = `NF_BROWSER_DIR`, else
  `../browser` next to the entry), calls `initNodeFederation(…, { hostRemoteEntry, hostInstances: 'all' })` **without a
  logger**, and publishes `globalThis.__NF_HOST_SERVER_LOADER__` and `globalThis.__NF_FEDERATION_STATUS__`
  (`{ ok, initialized, missing, error? }`). Dev SSR (`ng serve`) uses an esbuild inject and initialises lazily on
  the first remote load, once. It publishes no status.
- Both versions fetch each `remoteEntry.json` **once at startup**. There is no retry and no re-read.
- Sharing Angular on the server is less forgiving than in the browser: the maintainer says it only works reliably when
  every project is on the **same Angular version**.

## First checks

1. **Which side fails?** Fetch the page with `curl` and look for the remote's markup and `ngh` hydration attributes.
   No markup, and the browser fills it in later: the server-side federation failed. Markup present, then gone on
   hydration: it's a browser problem (the procedure in SKILL.md).
2. **Launch command.** v4 Angular prod: is `--import …/node-preload` on the command line? v3: is the server started
   from the directory where `node.importmap` is expected (cwd)?
3. **Logging.** The shipped preload passes no logger and reads no log-level variable. To see the orchestrator's
   output, start the server with your own `--import` file that calls `initNodeFederation` with
   `logger: consoleLogger, logLevel: 'debug'`. Read the `[native-federation] hostInstances bridged: …` line and every
   `hostInstances: could not load '<spec>' from the host realm; skipping (…)` warning. Other loader errors:
   `[native-federation] host instance '<spec>' not published`, `Failed to fetch module from <url>: <status>`,
   `Could not locate the bundled node-loader at …`.
   // TODO: should the preload accept a log level?
4. **Remote registration.** The preload logs `[native-federation] N remote(s) not registered at startup: <names>` or
   `initNodeFederation failed; SSR will render without federated remotes: <msg>`. Read
   `globalThis.__NF_FEDERATION_STATUS__`.
5. **Where `@angular/core` resolves on the server.** It must be inside `dist/<host>/browser/` (the federated build),
   not `node_modules`. A stack frame in `node_modules/@angular/core/fesm2022`, or `ɵɵngDeclare` in the loaded code,
   means unlinked Angular. There is no per-specifier resolve probe on the server: read the full map from the debug
   log instead (check 3, `Added import map …`).
6. **Dev or prod artefacts.** Does `dist/<app>/browser/remoteEntry.json` reference `-dev` bundles while the server
   bundle is a prod build?
7. **Node version.** v4 needs ≥ 20.6. `require()` of ESM needs Node ≥ 22.12.

## Failure modes

### Startup order: federated regions render empty
- **Mechanism:** the server fetches each remote's `remoteEntry.json` once at startup. A remote that isn't reachable
  then is skipped for the life of the process. Dev SSR initialises once, lazily, and memoises the result.
- **Symptoms:** `[native-federation] N remote(s) not registered at startup: …`; empty regions or the
  `RemoteUnavailable` placeholder; `__NF_FEDERATION_STATUS__.ok === false`. Redeployed remotes keep serving old code.
- **Evidence:** first check 4; the start order of host and remotes.
- **Fix direction:** start remotes first, or use `NF_REQUIRE_REMOTES` with a restart-on-exit supervisor; restart the
  host after a remote is redeployed.

### Two Angular instances on the server: `NG0203`, `JIT compilation failed for injectable`
- **Mechanism:** the server must resolve every shared `@angular/*` specifier to one file. `hostInstances` bridges the
  host's already-loaded instances into the loader. If the bridge loads them from `node_modules` before the import map
  exists, it bridges unlinked partial-compilation output, and core internals exist twice (once from `node_modules`,
  once from the federated chunks). Secondaries that aren't bridged (`@angular/core/rxjs-interop`) resolve to the other
  copy.
- **Symptoms:** `JIT compilation failed for injectable [class PlatformLocation]` (also `BrowserXhr`,
  `NoopAnimationDriver`); `isDevMode() === true` in a prod server; `NG0203` on a route that uses `rxjs-interop`.
  Mostly silent without a logger.
- **Evidence:** first checks 3 and 5: `hostInstances bridged:` lists fewer packages than are shared, or core resolves
  into `node_modules`.
- **Applies to:** v4. On orchestrator ≤ 4.8 the Node side didn't normalise flat remote entries and didn't bridge
  dense secondaries (`TypeError: Cannot use 'in' operator to search for '@angular/common' in undefined`).
- **Fix direction:** in prod, the import map alone gives one instance: no `hostInstances`.
  // TODO: confirm "drop `hostInstances` in prod" as the advice; the shipped preload sets `'all'`.

### Dev artefacts under a prod server: dev-mode Angular in production SSR
- **Mechanism:** `ng serve` writes `-dev` federation artefacts into `dist/<app>/browser`, the same folder the prod
  server reads. `dist/<app>/server` is left alone.
- **Symptoms:** silent; `isDevMode() === true`, dev warnings in the server log.
- **Evidence:** first check 6.
- **Fix direction:** rebuild before starting the prod server. // TODO: will dev artefacts move to their own folder?

### Shared bundles built for Node: the browser runs Node builds
- **Mechanism:** when `platform` is unset, the adapter picks `'node'` if a shared key starts with
  `@angular/platform-server` or `@angular/ssr`, and every shared bundle is then built with Node conditions. The browser
  downloads the same files. `remoteEntry.json` has no platform field.
- **Symptoms:** silent for `@angular/*`; a library with separate `browser`/`node` exports runs its Node build in the
  browser. Bundle names like `node-angular_core*`.
- **Evidence:** bundle names in `dist` and the externals cache.
- **Fix direction:** set `platform: 'browser'` in `withNativeFederation({…})`.

### Server running a shared browser copy: `Angular app engine manifest is not set`
- **Mechanism:** a package that registers server-only state (`@angular/ssr`'s app-engine manifest) must run as the
  server build's own copy. If it is shared, the server can resolve it to the federated browser bundle, which never
  receives that state.
- **Symptoms:** `Error: Angular app engine manifest is not set…` with a stack in `dist/<app>/browser/_angular_ssr.*.js`.
- **Evidence:** the stack frame's file; `@angular/ssr` in `shared[]` (Step 7).
- **Fix direction:** skip `@angular/ssr` and `@angular/platform-server`. // TODO: confirm; inferred from a stack trace.

### Module format on the server: `does not provide an export named`, `require() of ES Module`
- **Mechanism:** Node loads federated modules as ESM and everything else with its own format detection. A CommonJS
  package forced to ESM loses its named exports; CommonJS code that `require()`s ESM-only Angular fails on Node < 22.12.
- **Symptoms:** `SyntaxError: The requested module 'rxjs' does not provide an export named 'BehaviorSubject'`,
  `ReferenceError: exports is not defined in ES module scope`, `require() of ES Module …/@angular/core/fesm2022/core.mjs
  not supported`, `ERR_INVALID_URL` for a remote's `./chunk-*.js`.
- **Evidence:** the importer in the stack: is it a federated file (an http(s) or `dist/browser` URL) or a
  `node_modules` file?
- **Applies to:** v4: orchestrator ≥ 4.7 marks only import-map targets and their chunks as ESM. v3: the old
  `@softarc/native-federation-node` loader.
- **Fix direction:** Node ≥ 22.12; find the CommonJS importer. The maintainer questions sharing at all in SSR-only
  apps (`shared: {}`). // TODO: still the recommendation?

### Blocking loader: every request stalls on a slow remote
- **Mechanism:** the loader thread fetches http(s) modules while Node blocks the main thread on the import. There is
  no timeout. A dev server whose import map points at itself waits on itself.
- **Symptoms:** requests hang; `node-loader.client: loader did not acknowledge <type> within 10000ms` can't fire.
- **Evidence:** a render waits exactly as long as the slowest remote; stopping that remote makes the hang permanent.
- **Applies to:** v4 on Node 24. // TODO: open in the orchestrator; confirm status.
- **Fix direction:** serve remotes from disk (`file://`) where possible.

### Route discovery: direct request to a federated child route returns 404
- **Mechanism:** Angular's SSR build crawls the host's router config at build time to make the route manifest, and
  `AngularNodeAppEngine` only renders URLs in it. A federated `loadChildren` can't run during that crawl, so its
  child routes never enter the manifest. Prerendering and build-time route extraction can't load remotes at all.
- **Symptoms:** `/todos` renders and client-side navigation to `/todos/42` works, but a direct request (F5) to
  `/todos/42` gets a 404 from Express. v3 prerender: `ENOENT … browser/federation.manifest.json`, then
  `server is not started`.
- **Evidence:** the parent route renders on direct request; the child doesn't.
- **Fix direction:** the host owns the route shape: `loadComponent` children per exposed component; `RenderMode.Server`
  instead of `Prerender` for federated routes.

### Native import maps with SSR: lazy routes fail after hydration
- **Mechanism:** server-rendered HTML carries `<link rel="modulepreload">` for lazy route chunks. In native mode the
  browser resolves them before `initFederation` adds the import map, and caches the failure for the page.
- **Symptoms:** `ERROR TypeError: Failed to resolve module specifier "@angular/core". Relative references must start
  with…`; server-rendered content disappears on hydration.
- **Evidence:** `modulepreload` links before the import map in the served HTML; the route works when made eager.
- **Applies to:** v4 with `shimMode: false`.
- **Fix direction:** eager host routes. // TODO: is a static import map in `index.html` planned? Does shim mode avoid it?

### v3 launcher paths: `ENOENT`, or the server exits silently
- **Mechanism:** the v3 launcher resolves the manifest, `relBundlePath` and `node.importmap` against `process.cwd()`,
  and imports `bootstrap-server.ts` instead of running it as the main module.
- **Symptoms:** `ENOENT … browser/federation.manifest.json` / `'../browser/remoteEntry.json'`; `node
  dist/<app>/server/server.mjs` returns with no output (Angular's `isMainModule(import.meta.url)` guard is false).
- **Evidence:** the working directory at launch; the generated `bootstrap-server.ts`.
- **Applies to:** v3. A hand-written v4 launcher that imports the server bundle has the same guard trap; the v4
  preload keeps `server.mjs` as the main module.
- **Fix direction:** start from the expected directory or pass absolute paths; remove the `isMainModule` guard (keep
  its body).

If the evidence matches none of these failure modes, suspect a defect: build a reproduction ([repro.md](repro.md))
and check the repo's issue tracker.

## Questions for the maintainer

1. Scope: does SSR stay a reference of nf-debugging, or will it become its own skill?
2. What is the endorsed way to see the server-side import map and where a specifier resolves (loader thread)?
3. Should the preload accept a log level (e.g. an env var)?
4. Is "no `hostInstances` in prod" the advice to give today, and will dev artefacts get their own folder?
5. Is a static import map planned for native mode + SSR?
6. Is `shared: {}` the recommendation for SSR apps that don't need sharing?
7. The v4 SSR docs still describe patching `@angular/core` in `node_modules`; the adapter now injects
   `ngServerMode` at bundle time. Update the docs?
