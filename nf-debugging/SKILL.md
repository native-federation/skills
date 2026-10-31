---
name: nf-debugging
description: Finds the cause of a Native Federation micro-frontend failure at runtime in the browser (ESM + import maps; @softarc/native-federation, the native-federation orchestrator or the classic runtime, @angular-architects/native-federation and -v4). Use whenever a federated app fails at runtime: "Failed to resolve module specifier", a remote that won't load, initFederation/loadRemoteModule/initRemoteEntry errors, two instances of a framework (Angular NG0203 or injector errors, React "Invalid hook call"), version-mismatch or pooling warnings, or a deploy that doesn't show up, even if the user only pastes a console error and never says "Native Federation".
license: MIT
metadata:
  author: Copyright 2026 The native-federation team
  version: '1.0'
---

# Debugging Native Federation

This skill finds the cause. The fix belongs to **nf-development**. For version-specific API
details, fetch the live docs: https://native-federation.com/llms.txt (v4) or
https://native-federation.com/docs/v3/llms.txt (v3). Every page is also available as `.md`.

## The model in five lines

1. Bundlers leave shared packages as bare imports. A runtime in the page reads every
   `remoteEntry.json`, decides which file serves each shared package, and writes one import map.
2. The browser resolves every bare import through that map, **by the URL of the importing file**:
   a file that lives under a remote's URL uses that remote's scope, whoever loaded it.
3. One URL is one module instance. The same package at two URLs is two singletons.
4. So the cause is usually visible in what the browser received (import map, remote entries, the
   runtime's cache, the network), not in the source. Read those first and the code second.
5. Classify every finding on two axes: the NF line of each participant (v3 / v4 / v4-bridge on
   Angular 20–21) and where it happens (orchestrator / classic runtime / build output / Angular).

## Access level decides who runs the steps

| You have | Do this |
|---|---|
| A browser you drive (Chrome MCP, Playwright) | Run every step yourself. Headless: [scripts/nf-capture.mjs](scripts/nf-capture.mjs) runs all console scripts and records console and network in one go ([references/repro.md](references/repro.md#capture)). |
| The repo, no browser on the user's page | Build and serve it ([references/repro.md](references/repro.md)), then work as above. Confirm you reproduce the user's symptom before trusting anything else. |
| Only what the user pastes | Send one script at a time and say exactly what to copy back. In DevTools, `copy(<expr>)` puts a result on the clipboard. Ask for **Preserve log** on, and for the full error including the stack. |

## Procedure

Cheapest first. Each step names the evidence it gathers and the causes it removes. Stop as soon as
the evidence names the cause; skip steps whose branch doesn't apply.

### 1. Pin down the moment of failure

Gather: the exact error text, and *when* it happens: initial load, navigating to a lazy remote,
only after a deploy, only on a reload (warm cache), only after navigating from page A to page B (multi-page
hosts: page A's cache drives page B), only in prod or only in dev, only with one remote.
Rules out: nothing yet, but it chooses the branch. Init-time errors point at entries, the manifest
or resolution. Errors on first navigation point at `loadRemoteModule`/`initRemoteEntry` and exposes.
Errors that start after a deploy, or only on reload, point at caches (Step 8).
Also note each app's role. An app with `exposes` is a remote. A host never exposes. If an app both hosts and
exposes, that is the problem: split the exposed part into its own remote.

### 2. Identify the browser runtime and versions

Run [scripts/detect-runtime.js](scripts/detect-runtime.js) after init.

| Evidence | Means |
|---|---|
| `globalThis.__NF_ORCHESTRATOR__.storage` present | Orchestrator ≥ 4.7; its entry gives the `version` and storage `type`. More than one entry means more than one orchestrator on the page: unsupported, and the finding ([orchestrator.md](references/orchestrator.md#more-than-one-orchestrator-on-the-page-unpredictable-versions-or-maps)) |
| `globalThis.__NATIVE_FEDERATION__.externals instanceof Map` | Classic runtime (`@softarc/native-federation-runtime`, also the v3 Angular adapter) |
| `globalThis.__NATIVE_FEDERATION__` has `remotes`/`shared-externals`, or storage has `<ns>.remotes` | Orchestrator (the default namespace is the same name as the classic global, so check the shape) |
| Import-map keys like `mfe1/./Component` | Orchestrator. The classic runtime writes `mfe1/Component` |
| `importmap-shim` maps, `typeof importShim === 'function'` | Shim mode (es-module-shims). Both runtimes can use it, so it does not identify the runtime. The Angular adapters default to it |
| `window.__NF_REGISTRY__` | The registry script (`init-registry.mjs`) is loaded: quickstart registers `orch.init-ready` on it, and apps may use it as their event bus. Most npm-built hosts don't have it, so its absence proves nothing, unless a remote warns `__NF_REGISTRY__ is missing` |
| `[ng-version]` attribute | The host's Angular version. 20 or 21 plus the orchestrator usually means the v4-bridge package |

Then fetch each participant's `remoteEntry.json` (host: `./remoteEntry.json`) and read its core line from
the [fingerprints](references/build-output.md#reading-the-evidence). The orchestrator loads v3 and v4 entries
alike, so **classify each participant separately**, not the page.
With repo access, confirm in `package.json`: `@angular-architects/native-federation-v4` means the
v4-bridge, `@angular-architects/native-federation@<22` means v3, and `@softarc/native-federation-orchestrator` is the orchestrator.

Rules out: the failure modes of the other runtime, and every orchestrator-only cause (semver
resolution, share scopes, storage cache, pooling, the DevTools extension) on the classic runtime.
`runtime: unknown` means init never committed a map: go to Step 4 for the manifest and entries.

Branch:
- **Classic runtime**: read [references/classic-runtime.md](references/classic-runtime.md), then continue at Step 3. Skip Step 6.
- **Orchestrator**: continue. Read [references/orchestrator.md](references/orchestrator.md) once you reach Step 3.
- **`vanilla-native-federation`** (the pre-4.x orchestrator, 0.x–1.x; same namespace, `/./` keys and `remotes`/`shared-externals`, but no `shared-chunks`, `cache-state` or descriptor): out of scope. Upgrade to `@softarc/native-federation-orchestrator` first.
- **Angular** at any point: also read [references/angular.md](references/angular.md).
- **The failure is on the server** (SSR render error, Node stack trace, `initNodeFederation`): see [SSR](#ssr) below.

**No descriptor on an orchestrator page.** Publishing `__NF_ORCHESTRATOR__` is expected to become opt-in through
`profile: { enableDebugging: true }` ([roadmap](https://github.com/native-federation/orchestrator/issues/131)).
If the descriptor is missing on orchestrator ≥ 4.7 and you can rebuild, ask the host to set it. Otherwise fall
back to probing: `__NATIVE_FEDERATION__['cache-state']` (4.8+, written even when init fails),
`['shared-externals']`, `<ns>.remotes` storage keys and `/./` import-map keys still identify the orchestrator,
and `dump-orchestrator-storage.js` probes the default namespace in every built-in storage.

### 3. Read the console, at the right log level

Gather: every error and warning, in order, with stacks.
- **Logging is bring-your-own-logger.** The orchestrator's default logger is a no-op and its default level is
  `error`, so a plain orchestrator host prints nothing at all. To debug, the host passes the console logger at
  debug level and rebuilds:
  `initFederation(manifest, { logger: consoleLogger, logLevel: 'debug' })` (`consoleLogger` from
  `@softarc/native-federation-orchestrator/options`). The Angular adapter already passes the console logger at
  `error`, so there only `logLevel: 'debug'` (or `'warn'`) needs adding. Lines read `[NF][<n>]: …` (warn/error)
  and `[DEBUG][<n>]: …`, where `<n>` is the orchestrator's phase. Details: [orchestrator.md](references/orchestrator.md#turn-on-logging-step-3).
  If you can't rebuild, read the same verdicts from storage in Step 6.
- **A clean console proves nothing.** A scoped copy outside a pool (Step 6) and a missing shared package log no
  `[NF]` line on a cold init, even at debug. Run Steps 5 and 6 regardless.
- **The earliest `[NF]` line is the cause; later lines are symptoms.** `Remote 'x' is not initialized.` on
  navigation is the consequence of an earlier `[NF][1]: Could not fetch remote 'x'.`
- The resolve error's wording identifies the loader: es-module-shims says `Unable to resolve specifier 'x' imported
  from <url>` (`<url>` is the importing file you need in Step 5); native Chrome says `Failed to resolve module specifier "x"`.

Rules out: framework-level errors that aren't about federation at all (the failing import resolves and
the error is inside app code), and tells init-time failures apart from load-time ones. What common
failures look like end to end: [orchestrator.md](references/orchestrator.md#what-common-failures-look-like).

### 4. Check the network

Gather: the manifest and every `remoteEntry.json` response (status, `content-type`, body), 404s
on JS files, CORS failures, and which origin each copy of a shared package was fetched from.
Rules out: deploy and infra causes. Watch for a `remoteEntry.json` that returns `index.html`
(SPA fallback; a JSON parse error at init), a CDN that serves an old entry, and files missing for the
hash an entry names. An SRI block on a 200 response shows only in the console, not among failed requests.

### 5. Inspect the effective import map

Run [scripts/dump-import-map.js](scripts/dump-import-map.js). In shim mode, trust
`importShim.getImportMap()` over the DOM.
Gather: is the failing specifier mapped, and from which scope? Resolve it by hand: take the URL of
the *importing file*, find the most specific scope prefix that has the specifier, else `imports`.
For a duplicate instance, list every URL a package is mapped to and which files resolve to each.
Rules out: "not mapped at all" (build output or `skip`/`ignoreUnusedDeps`: go to Step 7) versus
"mapped to the wrong build" (resolution: go to Step 6) versus "mapped correctly" (the problem is
execution or app code).

### 6. Read the orchestrator's state (orchestrator only)

Run [scripts/dump-orchestrator-storage.js](scripts/dump-orchestrator-storage.js). It prints the storage
namespace (expect exactly one) and a table with one row per shared copy: `action` (`share`/`skip`/`scope`), `servingBuild`, and
the pooling fields. Read them with [orchestrator.md](references/orchestrator.md#find-and-read-storage-step-6).
Gather: why each remote runs the file it runs. Compare `remotes` with freshly fetched entries.
Rules out: a stale cache (cached entry differs from the live one), version-resolution surprises
(`scope`/`skip` verdicts), and pooling verdicts. If any row has `pool`, or any entry has a `pool` label, read
[references/pooling.md](references/pooling.md).
**Scoped copy (by design).** A remote that can't use the shared copy runs its own: `scopes["<remote url>/"]` in the
map, `action: "scope"` in storage, and no log line on a cold init. For a singleton that is a second instance, which
fails only when the remote's code meets the host's instance. When it happens:
[orchestrator.md](references/orchestrator.md#scoped-copy-a-framework-or-library-runs-twice-no-warning).
The storage shapes described in the references are those of 4.x; the format changes in the next major.
DevTools extension: if the user has it, ask for a screenshot of the relevant tab or its **Export JSON**.

### 7. Compare the remote entries

Gather: for the packages involved, put every participant's `shared` rows side by side (`version`,
`requiredVersion`, `strictVersion`, `singleton`, `shareScope`, `pool`, `entries`), and check
`exposes` keys against the `loadRemoteModule` call. Without a browser, use the one-liner in
[repro.md](references/repro.md#diff-two-builds).
Rules out: build-output causes: a package that isn't shared, a secondary entry point one build
lacks, ranges that don't overlap, a scope mismatch, an expose key typo. See
[references/build-output.md](references/build-output.md).

### 8. Cold versus warm

Clear site data (or use a fresh profile), then reload twice.
Rules out: cache causes. If it fails only warm, the persisted cache is the suspect
([orchestrator.md](references/orchestrator.md#cache-rules-step-8)); the classic runtime caches nothing, so
there it's the HTTP cache. If it fails cold too, the cause is deterministic in the inputs you collected in Steps 4–7.

### 9. Reproduce and bisect

When the evidence matches none of the failure modes, suspect a defect: build a reproduction
([references/repro.md](references/repro.md)) and check the issue tracker of the repo that owns the failing part.

## SSR

The browser steps above don't apply to errors raised during the server render. First decide which side fails:
`curl` the page and look for the remote's markup. Missing markup means the server-side federation failed: read
[references/ssr.md](references/ssr.md). Markup that disappears on hydration is a browser problem: use the procedure.

## Symptom routing

Each symptom maps to the NF concept that fails. The reference's **Failure modes** section explains the mechanism,
the evidence and the fix direction, per version line where behaviour differs by design.

| Symptom | Failure mode (concept) | Start at Step | Read |
|---|---|---|---|
| `Failed to resolve module specifier "x"` / `Unable to resolve specifier 'x' imported from …` | **Unmapped specifier**: `x` (often a secondary entry point, deep path or locale) is in no build's `shared`: pruned, skipped or not exported | 5 → 7 | [build-output.md](references/build-output.md#declaration-a-sub-path-or-entry-point-isnt-declared) |
| A feature silently does nothing (e.g. Angular animations), no error | **Unmapped specifier** behind a dynamic `import()` that the framework swallows. Try `importShim('<specifier>')` | 5 → 7 | [build-output.md](references/build-output.md#pruning-ignoreunuseddeps-an-entry-point-the-app-doesnt-import-isnt-published) |
| `NG0203`, `NG0201`/`NullInjectorError`, a root service created twice, "Invalid hook call", `instanceof` failing | **Scoped copy** (second instance by design: strict range, pool, `singleton: false`, or, from orchestrator 4.8, entry-point coverage); classic: **exact-version sharing** | 5 → 6 | [orchestrator.md](references/orchestrator.md#scoped-copy-a-framework-or-library-runs-twice-no-warning), [classic-runtime.md](references/classic-runtime.md#exact-version-sharing-a-shared-package-runs-twice-ng0203-nullinjector-services-not-singleton) |
| Same, and the duplicate is a workspace library or a component class | **Inlined and federated**: the library is bundled into a chunk *and* published as a shared file | 5 → 7 | [angular.md](references/angular.md#workspace-lib-both-inlined-and-federated-ng0201-a-root-service-created-twice), [build-output.md](references/build-output.md#not-shared-skip-the-dependency-list-and-mappings-produce-a-bundled-copy) |
| `NG0203` only once a secondary entry point (`toSignal()`/`rxjs-interop`) runs | **Entry-point coverage**: the serving build lacks the secondary. Orchestrator ≥ 4.8 runs the whole package from the remote's own build; ≤ 4.7 serves it from another build | 5 → 6 → 7 | [orchestrator.md](references/orchestrator.md#missing-entry-point-in-the-serving-build-ng0203-once-tosignal--rxjs-interop-runs), [build-output.md](references/build-output.md#pruning-ignoreunuseddeps-an-entry-point-the-app-doesnt-import-isnt-published) |
| `[NF][3]`/`[NF][8]` "is islanded" / "serves its own family" | **Pooling**: a range conflict or a coverage gap inside a labelled family | 6 | [pooling.md](references/pooling.md#failure-modes) |
| `Could not fetch remote 'x'`, JSON parse error, later `Remote 'x' is not initialized.` | **Remote entry not loaded**: wrong manifest URL, CORS, or `remoteEntry.json` answered by an HTML fallback | 4 | [orchestrator.md](references/orchestrator.md#remote-absent-remote-r-is-not-initialized) |
| `Exposed module '…' … not found in storage.` / `Unknown exposed module` / `unknown remote` | **Remote registry**: expose key or remote name doesn't match, or the cached entry is an older build | 7 → 6 | [orchestrator.md](references/orchestrator.md#exposed-module-not-found-exposed-module-key-from-remote-r-not-found-in-storage), [classic-runtime.md](references/classic-runtime.md#registration-at-init-unknown-remote-permanent-fallback-a-second-import-map) |
| A deploy isn't visible, old files are requested, or `chunk-*.js` 404s after a deploy | **Cache**: a warm init skips refetching a cached remote at an unchanged URL; or HTTP caching of entries/manifest | 8 → 6 | [orchestrator.md](references/orchestrator.md#stale-cached-remote-a-deploy-doesnt-show-or-it-fails-only-on-reload), [build-output.md](references/build-output.md#dev-and-prod-builds-different-output-and-mixing-them) |
| `Expected a JavaScript module script but the server responded with a MIME type of "text/html"` | **HTML fallback**: a federation URL resolved against the wrong base, or the file is missing | 4 | [angular.md](references/angular.md#dev-server-serving-model-404-texthtml-corrupted-assets-or-stale-code-in-ng-serve), [orchestrator.md](references/orchestrator.md#remote-absent-remote-r-is-not-initialized) |
| `does not provide an export named 'X'` (often from a `blob:` URL) | **Module format and build cache**: a CommonJS package converted to ESM, or shared bundles from a stale build cache | 5 → 7 | [build-output.md](references/build-output.md#commonjs-interop-named-exports-missing-or-require-at-runtime) / [externals cache](references/build-output.md#externals-cache-a-stale-shared-bundle) |
| CSP `Executing inline script violates …` / Trusted Types policy `nfo` refused | **Shim mode and page security**: es-module-shims and the orchestrator's DOM sinks need CSP/Trusted Types allowances | 3 | [orchestrator.md](references/orchestrator.md#integrity-and-trusted-types-a-module-is-blocked), [angular.md](references/angular.md#shim-vs-native-mode-modules-fail-before-or-while-loading) |
| `loadRemoteModule` never settles or the remote never renders, no error, no failed request | **Loader instance and init order**: the call reached a loader that was never initialised, or ran before init resolved | 3 → 5 | [angular.md](references/angular.md#init-state-per-bundle-loadremotemodule-from-inside-a-remote-never-settles), [orchestrator.md](references/orchestrator.md#init-signal-missed-the-remote-never-mounts-no-error-no-failed-request) |
| `Failed to initialize remote entry, continuing anyway.` / `Already initialized from …` | **Late registration** (`initRemoteEntry`): additive only; failures surface at `loadRemoteModule` | 3 → 4 | [orchestrator.md](references/orchestrator.md#late-remote-initremoteentry-scoped-although-a-global-choice-would-fit-or-ignored) |
| App runs in the wrong mode (`ngDevMode` undefined, `ng` global missing) | **Singleton decides for everyone**: the served `@angular/core` build sets dev/prod mode for all remotes | 7 | [angular.md](references/angular.md#mixed-dev-and-prod-builds-referenceerror-ngdevmode-is-not-defined) |
| Error on the server during the SSR render | **Server-side federation** | [SSR](#ssr) | [ssr.md](references/ssr.md#failure-modes) |

## Scripts

Paste into the page's console after init, or run through a browser tool. All of them are read-only.

| Script | Prints |
|---|---|
| [detect-runtime.js](scripts/detect-runtime.js) | Which runtime is on the page, with the signals behind the verdict (Step 2) |
| [dump-import-map.js](scripts/dump-import-map.js) | Every import map in the DOM, plus the shim's effective map (Step 5) |
| [dump-orchestrator-storage.js](scripts/dump-orchestrator-storage.js) | The orchestrator's cache per storage namespace, and one verdict row per shared copy (Step 6) |
| [dump-classic-state.js](scripts/dump-classic-state.js) | The classic runtime's externals (with copy counts) and registered remotes |
| [nf-capture.mjs](scripts/nf-capture.mjs), [serve.mjs](scripts/serve.mjs) | Node: capture console, network and all of the above for a URL; serve local builds ([repro.md](references/repro.md)) |

## References

| File | Read when |
|---|---|
| [references/orchestrator.md](references/orchestrator.md) | The page runs the orchestrator: logging, storage (`__NF_ORCHESTRATOR__`), verdicts, cache rules, the DevTools extension, failure modes |
| [references/pooling.md](references/pooling.md) | Any `pool` label or `poolName` is present, or a framework runs twice with no range violated |
| [references/classic-runtime.md](references/classic-runtime.md) | The page runs the classic runtime |
| [references/angular.md](references/angular.md) | The app is Angular |
| [references/build-output.md](references/build-output.md) | A `remoteEntry.json` looks wrong, or a specifier isn't mapped |
| [references/ssr.md](references/ssr.md) | The failure happens during the server render |
| [references/repro.md](references/repro.md) | You need to serve, capture, reproduce or bisect |
