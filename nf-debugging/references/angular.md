# Angular

Live docs: https://native-federation.com/docs/v4/angular-adapter/runtime.md ·
https://native-federation.com/docs/v4/angular-adapter/migration-v4.md ·
https://native-federation.com/docs/v3/llms.txt (v3 adapter). SSR is in [ssr.md](ssr.md).

- Three adapter lines. **v3**: `@angular-architects/native-federation` ≤ 21.x, classic runtime, core 2.x/3.x.
  **v4-bridge**: `@angular-architects/native-federation-v4` 20.4.x (ng20) / 21.x (ng21). **v4**:
  `@angular-architects/native-federation` 22.x. Both v4 lines run the orchestrator.
- The v4 adapter's `initFederation` wraps the orchestrator with `useShimImportMap({ shimMode: true })` (or
  `useDefaultImportMap()` with `shimMode: false`), the console logger at level `error`, and
  `hostRemoteEntry: './remoteEntry.json'`. Other orchestrator options pass through. To see warnings, raise
  `logLevel` to `'warn'` or `'debug'`.
- Angular DI compares tokens and classes **by object identity**. Two module instances of one file are two tokens. So
  `NG0201`/`NG0203` almost always mean "one file, two copies", not a provider bug.
- `@angular/core` is a singleton. Whichever build's copy is served decides dev mode, `ngServerMode` and
  compiled-API compatibility for the host **and** every remote.
- The adapter package is never shared (it's on its own skip list), so every app bundles its own copy of it. A custom
  `skipList` passed to `shareAll` replaces the Angular skip list instead of extending it.
- The builder wraps `@angular/build`, so Angular's own build behaviour (chunk optimizer, Vite dev server, HMR,
  `index.html` processing) shows up in federated output.

## Version map

| Adapter | core `@softarc/native-federation` | runtime |
|---|---|---|
| v3 17.x – 19.0.x | 2.0.x | classic 2.x |
| v3 19.0.19 – 20.0.x | 3.0.x – 3.3.x | classic 3.x |
| v3 20.1 – 21.2.5 (last) | 3.3.6 – 3.5.x | classic 3.x |
| v4-bridge 20.3.x / 21.1.x (RC) | 4.0 RCs | orchestrator 4.0 |
| v4-bridge 21.2.0–21.2.6 · 22.0.0–22.0.5 | 4.0 – 4.3 | orchestrator ^4.0 / ^4.2.2 |
| 22.0.6 · 21.2.8 | 4.3.2 | ^4.5.2 |
| 22.1.0–22.1.1 · 21.2.9–21.2.10 | 4.4 | ^4.5.2 |
| 22.1.2 · 21.2.11 | 4.5 | ^4.5.2 |
| 22.1.3 · 21.2.12 | 4.6 | ^4.6.0 |
| 22.2.0–22.2.1 · 21.2.13–21.2.14 | 4.7.0 | ^4.6.0 |
| 22.2.2 · 21.2.15 | 4.7.1 | ^4.6.0 |
| 22.2.3 · 21.2.16 | 4.8 | ^4.6.0 |
| 22.2.4 · 21.2.17 | 4.9 | ^4.9.0 |

Core and orchestrator are ranges, so always read the installed versions (`npm ls @softarc/native-federation
@softarc/native-federation-orchestrator @angular/build es-module-shims`). Ask for the **build log** too: v4 adapters
warn there about flat externals and missing `keepAll`, and log the chunk-optimizer and cache decisions.

## Reading the evidence

### NG0203 vs NG0201 vs NG0200

| Error | Means | Confirm |
|---|---|---|
| `NG0203: inject() must be called from an injection context…`, `toSignal() can only be used within an injection context`, `JIT compilation failed for injectable` | Two `@angular/core` instances, **or** core and one of its secondaries (`rxjs-interop`, `primitives/*`) from different builds | Step 5: list the URL of `@angular/core` *and every* `@angular/core/*` for the failing importer. All must come from one build. A stack trace with two core file names proves it. v3: two `@angular/core@…` keys in `__NATIVE_FEDERATION__.externals` |
| `NG0201: No provider found for <token>` / `NullInjectorError: No provider for InjectionToken X`, or a `providedIn:'root'` service with diverging state | (a) The token's module exists twice (a lib inlined into a chunk **and** published as `_lib.js`, or a lib served from two builds), or (b) the provider is registered only in the remote's `main.ts`/`app.config.ts`, which never runs inside the shell | Log `new Error().stack` in the service constructor, or grep the served/dist files for the token (`new InjectionToken("X")`). Two files → (a). One file → (b) |
| `NG0200: Circular dependency`, `No provider for XhrFactory` / `_DomRendererFactory2`, `NG0912 … collision`, `unknown Portal type` | Angular or CDK internals split across separately bundled entry points | Steps 5 and 7: entry points of one package served from different bundles |

### Fingerprints

- **Shim mode**: `<script type="esms-options">{"shimMode":true}</script>`, main as `type="module-shim"`, map as
  `importmap-shim`, `typeof importShim === 'function'`. `blob:` URLs and `importShim(` in errors or served source come
  from es-module-shims rewriting a module. In shim mode only `importShim('<x>')` (or `importShim.resolve('<x>')`)
  sees the map; a plain `import('<x>')` in the console doesn't.
- **Angular chunk optimizer ran** (v4 on Angular 22, prod): `dist` has rollup/rolldown-style mixed-case chunk names
  (`chunk-La6B0kZ_.js`) next to esbuild's upper-case ones (`chunk-LTVOGC3Y.js`).
- **Vite dev server**: `/@id/<pkg>` in a URL means Vite rewrote a bare import that should have gone through the import
  map. A `?import` suffix on a specifier means Vite's import analysis saw it. A `text/html` MIME error on a module
  script means a 404 behind the SPA fallback.
- **Dev mode**: `typeof ngDevMode` (`'object'` = dev) and `typeof ng?.getComponent` tell which `@angular/core` build
  won. v3 dev bundles have `-dev` in the file name.
- **Which file actually serves**: in dev, diff the bytes served over HTTP before and after an edit.

## Failure modes

### Two Angular instances: `NG0203` / `JIT compilation failed` after loading a remote
- **Mechanism:** a remote gets its own copy of a shared package (a **scoped copy**) only in the cases listed under
  [Scoped copy](orchestrator.md#scoped-copy-a-framework-or-library-runs-twice-no-warning). On v4, `requiredVersion: 'auto'` copies the `package.json`
  value as written. A range (`^20.3.0`) lets the orchestrator share one core across patches. An exact pin plus
  `strictVersion: true` (the `ng add` default) gives the remote a scoped `@angular/core`, so its components run on
  a second core. A secondary entry point served from another build than its primary has the same effect, because
  `@angular/core` and `@angular/core/rxjs-interop` share module state.
- **Symptoms:** `NG0203: inject() must be called from an injection context…`, `toSignal() / takeUntilDestroyed()
  can only be used within an injection context` (only in the remote), `JIT compilation failed for injectable`. A
  cold init doesn't log the scoping; with `logLevel: 'warn'` a coverage gap logs `[NF][3] … serves its own family …
  (gap '<spec>')`.
- **Evidence:** Step 5: two URLs for `@angular/core` (`scopes` entry under the remote's URL). Step 6: `action:
  "scope"` for `@angular/core`, or the serving build lacks the secondary the remote imports. Step 7: compare
  `version`/`requiredVersion` of `@angular/core` across the entries.
- **Applies to:** v3 shares only an exact `name@version`, so any patch drift loads a second core
  ([classic-runtime.md](classic-runtime.md)). v4 shares by semver per the rules above.
- **Fix direction:** align Angular (maintainers advise equal versions up to the minor, even when one core is shared,
  because compiled code calls private Angular API), use ranges instead of exact pins, and publish all Angular
  secondaries from the host (`includeSecondaries: { keepAll: true }`, as the `ng add` template does). A secondary
  pruned from the host's build is a build-output failure mode: see [build-output.md](build-output.md). For
  intentional multi-version setups, use scopes or web components.

### Workspace lib both inlined and federated: `NG0201`, a root service created twice
- **Mechanism:** code is shared only when every importer reaches it through its **shared specifier** (`@org/lib`). An
  import that resolves to the lib's file path instead (Angular's compiler emits such imports for template
  dependencies; app code can do it with relative paths) bypasses esbuild's `external`, so the lib is bundled into the
  app or exposed chunk **and** loaded from the federated `_org_lib.js`. The same symptom appears when a mapping is
  served from two builds (since NF22, `features.mappingVersion` gives each mapping the version of its nearest
  `package.json`; mixed or empty versions split it), or when a mapping was pruned from `remoteEntry.json`.
- **Symptoms:** `NG0201: No provider found for InjectionToken X`, `NullInjectorError`, two constructor logs from
  different files (`_somelib.js` and `chunk-*.js`/`bootstrap-*.js`), state that doesn't sync. Often no error at all.
  Console on v4: `[<remote>][<lib>] Version '' is not a valid version.`
- **Evidence:** grep `dist` (or the served files) for the token or class. In `_lib.*.js` **and** an app chunk = inlined.
  Step 7: is the lib in every relevant `shared[]`, with equal versions? Step 5: one URL or two?
- **Fix direction:** import workspace libs only through their mapping name; give each shared lib a `package.json`
  with a `version`, or set versions explicitly in `sharedMappings`. A/B builds: `features.mappingVersion: false`
  (fixes it → version split), `features.ignoreUnusedDeps: false` (fixes it → pruning). If neither helps and the
  lib is inlined, suspect the adapter (see the last line).

### Remote bootstrap never runs: provider or styles missing only inside the shell
- **Mechanism:** loading an exposed module is lazy loading to Angular. The remote's `main.ts`, `bootstrap.ts`,
  `app.config.ts` and global `styles.css` never run in the shell.
- **Symptoms:** `NullInjectorError: R3InjectorError(…)[… -> InjectionToken X]` only in the shell; a theme or Tailwind
  utilities missing in the remote's UI. The remote works standalone.
- **Evidence:** the provider or style lives only in the remote's bootstrap path; the token's class has **one** URL
  (Step 5). Two URLs → the previous failure mode.
- **Fix direction:** provide in the shell or in the exposed routes' `providers`; or bootstrap the remote as its own
  application (web component). Styles: let the shell's Tailwind scan the remote's sources, or import base styles into
  exposed components (ShadowDom encapsulation avoids leaks).

### Shim vs native mode: modules fail before or while loading
- **Mechanism:** es-module-shims decides its mode once, at load: shim mode if `esmsInitOptions.shimMode` is set or
  any `module-shim`/`importmap-shim` tag exists. In shim mode it reads only `importmap-shim` and runs `module-shim`
  scripts, rewriting every module's `import(` to `importShim(`. Native mode needs the three markers to agree: the
  build's `esms-options` JSON, the main tag's `type`, and the map tag the orchestrator writes (runtime
  `initFederation({ shimMode })`).
- **Symptoms:**
  - build shim, runtime `shimMode: false`: `Unable to resolve specifier '@angular/core' imported from …/main-*.js`
    while DevTools shows a native `<script type="importmap">` containing that key.
  - build native, runtime shim: `Failed to resolve module specifier "@angular/core". Relative references must start
    with…` while DevTools shows an `importmap-shim` containing the key.
  - side effects of the shim rewrite: `SyntaxError: Unexpected string` at `importShim(data, …, '<url>')` (a library
    method named `import`, e.g. DevExtreme); breakpoints and `debugger` stopping a few lines off in `ng serve` (Angular
    HMR's multi-line `import(` block loses its line breaks); strict CSP (`script-src 'self'`) errors from
    `polyfills.js` before `Unable to resolve specifier`.
- **Evidence:** the served `index.html` (`esms-options`, main tag `type`) and the map tag in the live DOM; for
  rewrite side effects, the served source at the error position. `"hmr": false` realigns breakpoints.
- **Applies to:** runtime `shimMode: false` exists on v4 (bridge ≥ 21.2.6, 22.x ≥ 22.0.3). The build side honours
  `esmsInitOptions.shimMode: false` only on 22.x ≥ 22.1.0; the v4-bridge always writes main as `module-shim`, so there
  native mode works only if the runtime stays in shim mode too. Native mode needs browsers with multiple import maps
  (Chrome/Edge 133+, Safari 18.4+).
- **Fix direction:** make all three markers agree; use native mode when the shim's rewrite breaks code.
  // TODO: does es-module-shims fix the multi-line `import(` rewrite? Until then, `hmr: false` on the serve target.

### Dev-server serving model: 404, `text/html`, corrupted assets or stale code in `ng serve`
- **Mechanism:** the NF dev middleware serves a request only if the file **exists on disk** in the dev output path
  at that moment (URL minus `baseHref` and query). Otherwise Vite handles it: 404, or `index.html` through the SPA
  fallback. The middleware reads files as UTF-8 text, so binary files come out corrupted. Federation artefacts are
  rebuilt by a separate watcher, not by Angular's. Live reload across dev servers needs `buildNotifications` in the
  remote's builder options **and** `sse: true` in the host's `initFederation`.
- **Symptoms:** `GET …/remoteRoutes.js 404`; `Failed to load module script: Expected a JavaScript module script but
  the server responded with a MIME type of "text/html"`; `Failed to decode downloaded font`; an edit that never shows
  up although the build log says it rebuilt (or `No output file changes`); the host not reloading after a remote rebuilds.
- **Evidence:** Step 4: request the failing URL directly and compare with the file in the dev output folder (exists?
  same bytes?). Compare manifest URLs with the dev-server banner (port, `baseHref` with both slashes). Diff served
  bytes before and after an edit. If the bytes changed but the page runs old code, check which remote's URL serves the
  lib (Step 5; [orchestrator.md](orchestrator.md)).
- **Fix direction:** one `serve` target that runs the NF builder; port, SSL and allowed hosts set on the wrapped
  `serve-original` target (CLI flags aren't forwarded); assets that must be binary served from `public/` or a static
  server; in v3, `skip` a workspace lib while editing it.

### Angular's chunk optimizer: prod-only `t.ɵɵdefineComponent is not a function`
- **Mechanism:** Angular ≥ 22 re-bundles the host's lazy chunks after esbuild (≥ 3 lazy chunks). The re-bundler can
  give the namespace import of the external `@angular/core` and a class the same short name. It only touches Angular's
  own app chunks; `remoteEntry.json`, shared and exposed bundles stay identical. The adapter sets
  `NG_BUILD_OPTIMIZE_CHUNKS=0` when it is unset; an explicit value wins.
- **Symptoms:** a clean build, then a blank page: `TypeError: t.ɵɵdefineComponent is not a function at
  <static_initializer> (chunk-XXXXXXXX.js)` (or `ɵɵdefineService`). Build log under Nx: `@angular/build was already
  loaded … re-applied optimizeChunksThreshold=Infinity.` or `Could not re-apply … Builds may re-bundle federated chunks.`
- **Evidence:** the optimizer fingerprint in `dist`; `NG_BUILD_OPTIMIZE_CHUNKS` in the build environment; rebuild
  with `NG_BUILD_OPTIMIZE_CHUNKS=0`.
- **Applies to:** v4 on Angular 22. The v3 adapter never sets it.
- **Fix direction:** keep the optimizer off; if it's turned on, test the prod build in a browser on every release.

### `index.html` entry-script rewrite: blank page, app rendered twice, main not a module
- **Mechanism:** the builder rewrites the built `index.html`: one `<script type="esms-options">` right after `<body…>`,
  the **first** `<script>` whose `src` contains `polyfills` becomes `type="module"`, and the **first** whose `src`
  contains `main` becomes `module-shim` (or `module` in native mode).
- **Symptoms:** blank page; `Cannot use import statement outside a module (at main.js:2:1)`; `Failed to resolve module
  specifier "@angular/platform-browser"`; two apps rendered in `<app-root>`.
- **Evidence:** the served `index.html`: exactly one `esms-options`, and `type="module-shim"` on the app's own
  `main-*.js`, not on another script (a CDN `…/js/main.min.js` placed before it gets rewritten instead).
- **Applies to:** v3's rewrite only matched `<script src="…">` with `src` first, and older releases broke on global
  `scripts`, `<body>` attributes and `deployUrl`. v4 matches any attribute order and URL prefix.
- **Fix direction:** keep other scripts whose URL contains `main` or `polyfills` after the app's scripts or out of
  `index.html`; move global scripts to assets.

### Mixed dev and prod builds: `ReferenceError: ngDevMode is not defined`
- **Mechanism:** Angular ≥ 20 compiles bare `ngDevMode` references (signal and input debug names). A dev-mode core
  defines the global at runtime; a prod core has `ngDevMode` inlined as `false` and never defines it. Since
  `@angular/core` is shared, a remote built unoptimised can run on the host's prod core, which the orchestrator
  allows at the same version. On v4, dev mode and minification of shared and exposed bundles follow
  `optimization.scripts`, like Angular's own build.
- **Symptoms:** `ReferenceError: ngDevMode is not defined` in a dev remote inside a prod shell; or the reverse: no
  dev-mode checks or `ng` global although the remote was built unoptimised.
- **Evidence:** `typeof ngDevMode` on the page; which build's `_angular_core.*.js` is served (Step 5; v3: `-dev` suffix).
- **Applies to:** v4 never defines `ngDevMode: 'true'` itself. v3 21.2.3+ defines it in dev builds.
- **Fix direction:** build all participants in the same mode when they share Angular, or serve the host in dev mode
  while developing a remote.

### Init state per bundle: `loadRemoteModule()` from inside a remote never settles
- **Mechanism:** the v4 adapter keeps its init promise at module level, and the adapter is never shared, so each app
  bundles its own copy. Only the host's copy is resolved by `initFederation()`. A remote that calls the top-level
  `loadRemoteModule` waits on its own, never-resolved copy. (The v3 classic runtime kept state on `globalThis`, so
  this worked there.) The top-level `loadRemoteModule` is deprecated in favour of the one `initFederation()` returns.
- **Symptoms:** silent: the promise neither resolves nor rejects; no log.
- **Evidence:** the same call works from host code; the hang starts at the first call made from remote code (Step 1).
- **Applies to:** v4 and v4-bridge. Not v3.
- **Fix direction:** pass the host's loader into the remote (a bootstrap parameter or an `InjectionToken`). Don't call
  `initFederation` again in the remote: that replaces the host's import map.
  // TODO: confirm this is the official pattern.

### Locale data Angular injects: `Failed to resolve module specifier "@angular/common/locales/global/<code>"`
- **Mechanism:** with `i18n.sourceLocale` set (not en-US), Angular injects an import of
  `@angular/common/locales/global/<code>` into `polyfills.js`, outside the micro frontend. `@angular/common` is
  external, so the import stays bare; the unused-deps scan never sees it.
- **Symptoms:** `Failed to resolve module specifier "@angular/common/locales/global/de-CH"…` (Chrome) / `…was a bare
  specifier, but was not remapped to anything` (Firefox), often only in `ng serve` or a localized build.
- **Evidence:** Step 5: the specifier is absent; the importer is `polyfills.js` or `main.js`.
- **Applies to:** v3 21.2.4+ injects it automatically. No released v4 adapter does.
- **Fix direction:** share it explicitly (`shareAngularLocales(['global/<code>'])`).

Failure modes with their home elsewhere:
- A shared package's secondary pruned from one build (`rxjs-interop`, Material internals, `Unable to resolve specifier
  '<pkg>/<sub>'`): [build-output.md](build-output.md).
- Stale or mismatched shared bundles from the externals cache: [build-output.md](build-output.md).

If the evidence matches none of these failure modes, suspect a defect: build a reproduction ([repro.md](repro.md))
and check the repo's issue tracker.

## Questions for the maintainer

1. Is "pass the host's loader into the remote" the official pattern, or will the adapter share init state again?
2. Is `NG_BUILD_OPTIMIZE_CHUNKS=0` the permanent default? Is Angular's rolldown optimizer (≥ 22.1) considered safe?
3. Should the `index.html` rewrite match the app's own entry script exactly, and should the dev middleware serve raw bytes?
4. Should the v4-bridge honour `esmsInitOptions.shimMode: false`, and should the builder warn when build and runtime
   shim modes can disagree?
5. Will v4 inject the `locales/global/<code>` data like v3 21.2.4 did?
6. Should a host reload when a remote's dev server rebuilds, across servers?
7. Could `remoteEntry.json` record the adapter version and dev/optimised mode? Several checks would become one lookup.
