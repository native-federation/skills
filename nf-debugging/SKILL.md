---
name: nf-debugging
description: Finds the cause of a Native Federation micro-frontend failure at runtime (ESM + import maps; `@softarc/native-federation*`, `@angular-architects/native-federation*`), in the browser or during SSR, on Native Federation v3 and v4. Use whenever a federated shell or remote fails: "Failed to resolve module specifier" / "Unable to resolve specifier", a remote or `remoteEntry.json` that won't load, initFederation / loadRemoteModule / initRemoteEntry errors, a framework running twice (NG0203, injector errors, "Invalid hook call"), version or pooling warnings, or a deploy that doesn't show up. Trigger on a pasted console error alone when the project uses Native Federation. Not for webpack Module Federation, build-time errors, or writing the fix (nf-development).
license: MIT
metadata:
  author: Copyright 2026 The native-federation team
  version: '0.1'
---

# Debugging Native Federation

This skill covers Native Federation **v3 and v4**: the orchestrator and the deprecated classic runtime, and the
Angular adapter lines (v3, the v4-bridge `@angular-architects/native-federation-v4` and v4). It finds the cause; the
fix belongs to **nf-development**. For version-specific API
details, fetch the live docs: https://native-federation.com/llms.txt (v4) or
https://native-federation.com/docs/v3/llms.txt (v3). Every page is also available as `.md`.

## The model in six lines

1. There is one host (shell): the only app that calls `initFederation`, and it has no `exposes`. Every app with
   `exposes` is a remote, even when it loads other remotes (with the shell's `loadRemoteModule`).
2. Bundlers leave shared packages as bare imports. The runtime in the shell reads every
   `remoteEntry.json`, decides which file serves each shared package, and writes one import map.
3. The browser resolves every bare import through that map, **by the URL of the importing file**:
   a file that lives under a remote's URL uses that remote's scope, whoever loaded it.
4. One URL is one module instance. The same package at two URLs is two singletons.
5. So the cause is usually visible in what the browser received (import map, remote entries, the
   runtime's cache, the network), not in the source. Read those first and the code second.
6. Classify every finding on two axes: the NF line of each participant (v3 / v4 / v4-bridge on
   Angular 20–21) and where it happens (orchestrator / classic runtime / build output / Angular).

## What Native Federation is for, and what it isn't

Micro frontends mean code duplication. Native Federation is damage control: sharing dependencies minimizes that
duplication. It is **not** a way to share state. Every remote, and the shell, must work on the assumption that it
shares no code, and therefore no instances, with any other app. Communication between remotes and the shell goes
through an event bus (for example DOM `CustomEvent`s or the orchestrator's event registry), not through a shared
store, service or singleton.

So when the cause is state that one app expected to reach through a shared package (a store, a root service, a
module-level variable) and found missing or duplicated, the **first** fix direction is always to decouple the apps:
move the exchange to events. Making the instance shared (aligning versions, `singleton`, pooling) comes second, and
only to save bytes, never so that state can flow through it.

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
shells: page A's cache drives page B), only in prod or only in dev, only with one remote.
Rules out: nothing yet, but it chooses the branch. Init-time errors point at entries, the manifest
or resolution. Errors on first navigation point at `loadRemoteModule`/`initRemoteEntry` and exposes.
Errors that start after a deploy, or only on reload, point at caches (Step 8).
Also note each app's role. If an app both calls `initFederation` and has `exposes`, that is the problem: split the
exposed part into its own remote.
If the error text matches a row in [Symptom routing](#symptom-routing), start at that row's step and read its
reference; otherwise continue.

### 2. Identify the browser runtime and versions

Run [scripts/detect-runtime.js](scripts/detect-runtime.js) after init. It prints the verdict and the signals behind
it ([how to read them](references/orchestrator.md#identify-the-runtime-step-2)). If it warns about more than one
orchestrator, or the classic runtime next to the orchestrator, that is unsupported and is the finding
([orchestrator.md](references/orchestrator.md#more-than-one-orchestrator-on-the-page-unpredictable-versions-or-maps)).

Then fetch each participant's `remoteEntry.json` (shell: `./remoteEntry.json`) and read its core line from
the [fingerprints](references/build-output.md#reading-the-evidence). The orchestrator loads v3 and v4 entries
alike, so **classify each participant separately**, not the page.
With repo access, confirm in `package.json`: `@angular-architects/native-federation-v4` means the
v4-bridge, `@angular-architects/native-federation@<22` means v3, and `@softarc/native-federation-orchestrator` is the orchestrator.

Rules out: the failure modes of the other runtime, and every orchestrator-only cause (semver
resolution, share scopes, storage cache, pooling, the DevTools extension) on the classic runtime.
`runtime: unknown` means no NF runtime state at all: init never ran (check `main.ts` and Step 4), an orchestrator older
than 4.7 whose init failed, or a shell that disabled the descriptor (where the version supports that).

Branch:
- **Classic runtime**: read [references/classic-runtime.md](references/classic-runtime.md), then continue at Step 3. Skip Step 6.
- **Orchestrator**: continue. Read [references/orchestrator.md](references/orchestrator.md) once you reach Step 3.
- **`vanilla-native-federation`** (the pre-4.x orchestrator): out of scope. Upgrade to `@softarc/native-federation-orchestrator` first.
- **Angular** at any point: also read [references/angular.md](references/angular.md).
- **The failure is on the server** (SSR render error, Node stack trace, `initNodeFederation`): see [SSR](#ssr) below.

### 3. Read the console, at the right log level

Gather: every error and warning, in order, with stacks.
- **The orchestrator prints nothing by default, not even errors** (no-op logger, level `error`; only a failed
  `initRemoteEntry` prints a bare warning). To see its `[NF]` lines, the shell
  passes a console logger at `logLevel: 'debug'` and rebuilds:
  [orchestrator.md](references/orchestrator.md#turn-on-logging-step-3). If you can't rebuild, read the same
  verdicts from storage in Step 6.
- **A clean console proves nothing.** A scoped copy outside a pool (Step 6) and a missing shared package log no
  `[NF]` line on a cold init, even at debug. Run Steps 5 and 6 regardless. With browser tools that attach after
  load, missing init-time lines are a tool limitation, not a clean console ([repro.md](references/repro.md#with-chrome-mcp-tools-instead)).
- **The earliest `[NF]` line is the cause; later lines are symptoms.** `Remote 'x' is not initialized.` on
  navigation is the consequence of an earlier `[NF][1]: Could not fetch remote 'x'.`
- The resolve error's wording identifies the loader: es-module-shims says `Unable to resolve specifier 'x' imported
  from <url>` (`<url>` is the importing file you need in Step 5); native Chrome says `Failed to resolve module specifier "x"`.

Rules out: framework-level errors that aren't about federation at all (the failing import resolves and
the error is inside app code), and tells init-time failures apart from load-time ones. What common
failures look like end to end: [orchestrator.md](references/orchestrator.md#what-common-failures-look-like).

### 4. Check the network

Gather: the manifest and every `remoteEntry.json` response (status, `content-type`, body; nf-capture's `entries`), 404s
on JS files, CORS failures, and which origin each copy of a shared package was fetched from.
Rules out: deploy and infra causes. Watch for a `remoteEntry.json` that returns `index.html`
(SPA fallback: `[NF][1]: Could not fetch remote 'x'. skipping init. NFError: Fetch of '<url>' returned Unexpected
token '<', "<!doctype "... is not valid JSON`; init continues), a CDN that serves an old entry, and files missing for the
hash an entry names. An SRI block on a 200 response shows only in the console, not among failed requests.

### 5. Inspect the effective import map

Run [scripts/dump-import-map.js](scripts/dump-import-map.js). In shim mode, trust
`importShim.getImportMap()` over the DOM.
Gather: is the failing specifier mapped, and from which scope? Resolve it by hand: take the URL of
the *importing file*, find the most specific scope prefix that has the specifier, else `imports`.
For a duplicate instance, list every URL a package is mapped to and which files resolve to each. To test one
specifier, probe it in the page ([build-output.md](references/build-output.md#reading-the-evidence)).
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
A `scope` row for a singleton is a second instance by design, with no log line:
[scoped copy](references/orchestrator.md#scoped-copy-a-framework-or-library-runs-twice-no-warning).
DevTools extension: if the user has it, ask for a screenshot of the relevant tab or its **Export JSON**.

### 7. Compare the remote entries

Gather: for the packages involved, put every participant's `shared` rows side by side (`version`,
`requiredVersion`, `strictVersion`, `singleton`, `shareScope`, `pool`, `entries`), and check
`exposes` keys against the `loadRemoteModule` call. Without a browser, use the one-liner in
[repro.md](references/repro.md#diff-two-builds). Ask for the build log of the build that produced the
failing entry, which may live in another repo ([build-output.md](references/build-output.md#reading-the-evidence)).
Rules out: build-output causes: a package that isn't shared, a secondary entry point one build
lacks, ranges that don't overlap, a scope mismatch, an expose key typo. See
[references/build-output.md](references/build-output.md).

### 8. Cold versus warm

Clear site data (or use a fresh profile), then reload twice.
Rules out: cache causes. If it fails only warm, the persisted cache is the suspect
([orchestrator.md](references/orchestrator.md#cache-rules-step-8)); the classic runtime caches nothing, so
there it's the HTTP cache. If it fails cold too, the cause is deterministic in the inputs you collected in Steps 4–7.
If the served files themselves are older than the sources (a rebuilt change doesn't show, cold and warm alike), purge
the build caches and rebuild ([build-output.md](references/build-output.md#build-caches-stale-output-files)).

### 9. Reproduce and bisect

When the evidence matches none of the failure modes, suspect a defect: build a reproduction
([references/repro.md](references/repro.md)) and check the issue tracker of the repo that owns the failing part.

## SSR

The browser steps above don't apply to errors raised during the server render. First decide which side fails:
`curl` the page and look for the remote's markup. Missing markup means the server-side federation failed: read
[references/ssr.md](references/ssr.md) (the orchestrator in Node). Markup that disappears on hydration is a browser problem: use the procedure.

## Report

Hand back the diagnosis in this shape, so nf-development (or the user) can act on it without redoing the work:
- **Cause:** the failure mode by name (the heading in the reference), in one sentence.
- **Where:** each participant involved, with its NF line (v3 / v4 / v4-bridge) and the layer
  (orchestrator / classic runtime / build output / Angular / SSR).
- **Evidence:** the artifact that proves it (import-map entry, storage verdict row, entry diff, console line),
  quoted.
- **Ruled out:** what the steps eliminated.
- **Fix direction:** the reference's fix direction. If the failure involves state crossing app boundaries, lead with
  decoupling through an event bus ([why](#what-native-federation-is-for-and-what-it-isnt)). To apply it, use the
  nf-development skill.

If no failure mode matches, say so and give the reproduction (Step 9) instead of a guess.

## Symptom routing

Each symptom maps to the NF concept that fails. The reference's **Failure modes** section explains the mechanism,
the evidence and the fix direction, per version line where behaviour differs by design.

| Symptom | Failure mode (concept) | Start at Step | Read |
|---|---|---|---|
| `Failed to resolve module specifier "x"` / `Unable to resolve specifier 'x' imported from …` | **Unmapped specifier**: `x` is in no build's `shared` | 5 → 7 | [build-output.md](references/build-output.md#declaration-a-sub-path-or-entry-point-isnt-declared) |
| A feature silently does nothing (e.g. Angular animations), no error | **Unmapped specifier** behind a swallowed dynamic `import()` | 5 → 7 | [build-output.md](references/build-output.md#pruning-ignoreunuseddeps-an-entry-point-the-app-doesnt-import-isnt-published) |
| A store, service or variable that one app sets is empty or different in another app | **State shared through code**: not supported by design. Decouple via an event bus first ([why](#what-native-federation-is-for-and-what-it-isnt)) | 1 | — |
| `NG0203`, `NG0201`/`NullInjectorError`, a root service created twice, "Invalid hook call", `instanceof` failing | **Scoped copy** (second instance by design); classic: **exact-version sharing** | 5 → 6 | [orchestrator.md](references/orchestrator.md#scoped-copy-a-framework-or-library-runs-twice-no-warning), [classic-runtime.md](references/classic-runtime.md#exact-version-sharing-a-shared-package-runs-twice-ng0203-nullinjector-services-not-singleton) |
| Same, and the duplicate is a workspace library or a component class | **Inlined and federated**: bundled into a chunk *and* shared | 5 → 7 | [angular.md](references/angular.md#workspace-lib-both-inlined-and-federated-ng0201-a-root-service-created-twice), [build-output.md](references/build-output.md#not-shared-skip-the-dependency-list-and-mappings-produce-a-bundled-copy) |
| `NG0203` only once a secondary entry point (`toSignal()`/`rxjs-interop`) runs | **Entry-point coverage**: the serving build lacks the secondary | 5 → 6 → 7 | [orchestrator.md](references/orchestrator.md#missing-entry-point-in-the-serving-build-ng0203-once-tosignal--rxjs-interop-runs), [build-output.md](references/build-output.md#pruning-ignoreunuseddeps-an-entry-point-the-app-doesnt-import-isnt-published) |
| `[NF][3]`/`[NF][8]` "is islanded" / "serves its own family" | **Pooling**: range conflict or coverage gap in a family | 6 | [pooling.md](references/pooling.md#failure-modes) |
| `Could not fetch remote 'x'`, JSON parse error, later `Remote 'x' is not initialized.` | **Remote entry not loaded**: wrong URL, CORS, or HTML fallback | 4 | [orchestrator.md](references/orchestrator.md#remote-absent-remote-r-is-not-initialized) |
| `Exposed module '…' … not found in storage.` / `Unknown exposed module` / `unknown remote` | **Remote registry**: name or key mismatch, or stale cached entry | 7 → 6 | [orchestrator.md](references/orchestrator.md#exposed-module-not-found-exposed-module-key-from-remote-r-not-found-in-storage), [classic-runtime.md](references/classic-runtime.md#registration-at-init-unknown-remote-permanent-fallback-a-second-import-map) |
| A deploy isn't visible, old files are requested, or `chunk-*.js` 404s after a deploy | **Cache**: warm init keeps a cached remote; or HTTP cache | 8 → 6 | [orchestrator.md](references/orchestrator.md#stale-cached-remote-a-deploy-doesnt-show-or-it-fails-only-on-reload), [build-output.md](references/build-output.md#dev-and-prod-builds-different-output-and-mixing-them) |
| `Expected a JavaScript module script but the server responded with a MIME type of "text/html"` | **HTML fallback**: wrong base URL, or the file is missing | 4 | [angular.md](references/angular.md#dev-server-serving-model-404-texthtml-or-stale-code-in-ng-serve), [orchestrator.md](references/orchestrator.md#remote-absent-remote-r-is-not-initialized) |
| `does not provide an export named 'X'` (often from a `blob:` URL) | **Module format or build cache**: CommonJS interop, or stale shared bundles | 5 → 7 | [build-output.md](references/build-output.md#commonjs-interop-named-exports-missing-or-require-at-runtime) / [externals cache](references/build-output.md#build-caches-stale-output-files) |
| CSP `Executing inline script violates …` / Trusted Types policy `nfo` refused | **Shim mode and page security**: missing CSP/Trusted Types allowances | 3 | [orchestrator.md](references/orchestrator.md#integrity-and-trusted-types-a-module-is-blocked), [angular.md](references/angular.md#shim-vs-native-mode-modules-fail-before-or-while-loading) |
| `loadRemoteModule` never settles or the remote never renders, no error, no failed request | **Loader instance and init order**: uninitialised loader, or called before init | 3 → 5 | [angular.md](references/angular.md#init-state-per-bundle-loadremotemodule-from-inside-a-remote-never-settles), [orchestrator.md](references/orchestrator.md#init-signal-missed-the-remote-never-mounts-no-error-no-failed-request) |
| `Failed to initialize remote entry, continuing anyway.` / `Already initialized from …` | **Late registration** (`initRemoteEntry`): additive only | 3 → 4 | [orchestrator.md](references/orchestrator.md#late-remote-initremoteentry-scoped-although-a-global-choice-would-fit-or-ignored) |
| App runs in the wrong mode (`ngDevMode` undefined, `ng` global missing) | **Singleton decides for everyone**: served core sets dev/prod mode | 7 | [angular.md](references/angular.md#mixed-dev-and-prod-builds-referenceerror-ngdevmode-is-not-defined) |
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
| [references/ssr.md](references/ssr.md) | The failure happens during the server render: the orchestrator in Node |
| [references/repro.md](references/repro.md) | You need to serve, capture, reproduce or bisect |
