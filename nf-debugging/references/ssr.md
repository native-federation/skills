# The orchestrator in Node (SSR)

Live docs: https://native-federation.com/docs/v4/orchestrator/node.md ·
https://native-federation.com/docs/v4/angular-adapter/ssr.md ·
https://native-federation.com/docs/v4/ssr-hydration.md ·
https://native-federation.com/docs/v3/angular-adapter/ssr.md

How federation works when the orchestrator runs in Node instead of the browser. Only the stable concepts are here; the
launch mechanics differ per adapter and version, so take them from the live docs.

- **What runs where:** a Node init (`initNodeFederation` in v4) runs the same resolver as the browser: fetch the
  manifest and every `remoteEntry.json`, elect versions, build one import map.
- **Where the import map lives:** in a loader hook (`module.register()`), on Node's loader thread. Nothing on disk shows it;
  the only main-thread view is the init's debug log (check 2). The hook must be registered before any shared package is imported, so it is loaded
  ahead of the server bundle (`node --import …`).
- **Singletons bridged from the shell (only when sharing on the server):** the shell process can hand its
  already-loaded singletons to the loader (`hostInstances`), so remotes rendered on the server use the shell's copy. A
  package that isn't bridged, or was loaded from `node_modules` before the map existed, can exist twice.
- **Startup-only state:** remotes are fetched once, when the process starts. No persistent cache, no retry, no re-read:
  a remote that was down at boot, or was redeployed since, stays missing or stale until the process restarts.
- **Logging:** depends on the logger the Node init is given. With none, the orchestrator prints nothing, not even
  errors; a launcher may print its own lines.
- **v3:** `@softarc/native-federation-node` did the same with a `node.importmap` written to `process.cwd()`, and
  exact-version dedupe like the classic runtime. Under `ng serve`, v3 renders without federated SSR.

**Server code ideally isn't federated.** In SSR, sharing dependencies between servers buys little: pulling externals
from one HTML provider into another only adds coupling, so keep all server code in the same server or container. Sharing
on the server only makes sense for a Node process that acts as a long-running server composing remotes at runtime, or an
IoT-style device; there the failure modes below apply in full.

## Reading the evidence

1. **Which side fails?** `curl` the page and look for the remote's markup. Missing markup, filled in later by the
   browser: the Node side failed. Markup present, then gone on hydration: a browser problem (the procedure in SKILL.md).
2. **Logs.** Give the Node init a console logger at `debug` if the setup lets you. Its log then shows every phase and
   the full import map (`Added import map …`), which is the only view of where each specifier resolves on the server.
3. **Where a shared singleton resolves.** It must be a federated file (under the shell's browser build or a remote's
   URL), not `node_modules`. A stack frame in `node_modules/<pkg>`, or partial-compilation code (`ɵɵngDeclare`) in a
   loaded file, means the unlinked package was loaded.
4. **Node version and working directory.** `require()` of ESM needs Node ≥ 20.19 (20.x) or ≥ 22.12. Relative manifest and bundle paths
   resolve against `process.cwd()`.

## Failure modes

### Startup order: federated regions render empty
- **Mechanism:** each `remoteEntry.json` is fetched once, at startup. A remote that isn't reachable then is skipped for
  the life of the process.
- **Symptoms:** empty regions or a placeholder in the server-rendered HTML, while the browser fills them in later. A
  redeployed remote keeps serving its old code on the server.
- **Evidence:** the start order of shell and remotes; a startup log line about remotes that weren't registered.
- **Fix direction:** start remotes before the shell; restart the shell after a remote is redeployed.

### Two instances on the server: `NG0203`, `JIT compilation failed for injectable`
- **Mechanism:** a shared singleton must resolve to one file for the shell and every remote. The shell bridges its
  singletons to remotes; a package that isn't bridged, or that was loaded from `node_modules` before the import map
  existed, gives a second copy (once from `node_modules`, once from the federated files).
- **Symptoms:** `JIT compilation failed for injectable [class PlatformLocation]` (or another injectable),
  `isDevMode() === true` in a prod server, `NG0203` on a route that uses a secondary entry point. Mostly silent without
  a logger.
- **Evidence:** check 3: the singleton resolves into `node_modules`, or the debug log's bridge list lacks packages that
  are shared.
- **Fix direction:** keep server code out of federation where you can (above). Where server-side sharing is intended,
  keep every project on the same framework version.

### Module format on the server: `does not provide an export named`, `require() of ES Module`
- **Mechanism:** the loader treats import-map targets as ESM; everything else goes through Node's own format
  detection. If a loader overrides that detection (an older orchestrator loader or another hook), a CommonJS package
  parsed as ESM loses its named exports; and CommonJS code that `require()`s an ESM-only package fails on Node < 20.19 and on 22.0–22.11.
- **Symptoms:** `SyntaxError: The requested module 'rxjs' does not provide an export named 'BehaviorSubject'`,
  `ReferenceError: exports is not defined in ES module scope`, `require() of ES Module …/core.mjs not supported`.
- **Evidence:** the importer in the stack: a federated file (an http(s) or browser-build URL) or a `node_modules` file?
  And whether another `--import`/`module.register` hook is active.
- **Fix direction:** Node 20.19+ or 22.12+; find the CommonJS importer. Server code that isn't federated (above) removes the
  federated side of the mix.

### Launcher paths: `ENOENT`, or the server exits silently
- **Mechanism:** a launcher resolves the manifest and bundle paths against `process.cwd()` when they're relative, and
  may import the server bundle instead of running it as the main module.
- **Symptoms:** `ENOENT … browser/federation.manifest.json` / `'../browser/remoteEntry.json'`; `node
  dist/<app>/server/server.mjs` returns with no output (an `isMainModule(import.meta.url)` guard is false).
- **Evidence:** the working directory at launch; the generated bootstrap file.
- **Fix direction:** start from the expected directory or pass absolute paths; remove the main-module guard (keep its
  body).

If the evidence matches none of these failure modes, suspect a defect: build a reproduction ([repro.md](repro.md))
and check the repo's issue tracker.

## Angular SSR, in brief

- **Launch:** v4 starts the Node side through the adapter's preload (`node --import …/node-preload
  dist/<app>/server/server.mjs`); see the adapter's SSR docs for its options.
- **Dev artefacts under a prod server:** `-dev.js` file names in the `remoteEntry.json` a prod server reads hint that
  it serves a dev build's artefacts; `isDevMode()` on the server confirms dev-mode Angular in production SSR. Rebuild
  before starting the prod server.
- **Shared bundles built for Node:** `"bundle": "node-shared"` (or a `chunks` key starting with `node-`) in
  `remoteEntry.json` means the shared bundles were built for Node; without dense chunking, look for Node-only code
  (`require`, `process`) in the served shared files. Set `platform: 'browser'` explicitly in the federation config.
- **Direct request to a federated child route returns 404:** Angular's build-time route crawl can't load remotes, so
  their child routes never enter the route manifest. Use `loadComponent` children per exposed component in the shell, and
  `RenderMode.Server` instead of `Prerender` for federated routes.
- **Native mode (`shimMode: false`): lazy routes fail after hydration** with `Failed to resolve module specifier
  "@angular/core"`: server-rendered `modulepreload` links resolve before `initFederation` adds the map. The browser rule: no bare
  specifier may resolve before the import map exists, and that includes server-rendered `modulepreload`; a failed
  resolution sticks for the page. Evidence: `modulepreload` links ahead of the map in the served HTML. Make those
  shell routes eager, or don't preload them.
