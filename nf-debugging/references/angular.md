# Angular

Live docs: https://native-federation.com/docs/v4/angular-adapter/runtime.md ·
https://native-federation.com/docs/v4/angular-adapter/migration-v4.md ·
https://native-federation.com/docs/v3/llms.txt (v3 adapter). SSR is in [ssr.md](ssr.md).

- Three adapter lines. **v3**: `@angular-architects/native-federation` ≤ 21.x, classic runtime, core 1.x–3.x.
  **v4-bridge**: `@angular-architects/native-federation-v4` 20.4.x (ng20) / 21.x (ng21). **v4**:
  `@angular-architects/native-federation` ≥ 22. Both v4 lines run the orchestrator.
- Active support covers the two latest majors; older adapter lines are frozen. If the cause is a defect in a frozen
  line, the fix direction is upgrading.
- The v4 adapter's `initFederation` wraps the orchestrator with `useShimImportMap({ shimMode: true })` (or
  `useDefaultImportMap()` with `shimMode: false`), the console logger at level `error`, and
  `hostRemoteEntry: './remoteEntry.json'`. Other orchestrator options pass through. To see warnings, raise
  `logLevel` to `'warn'` or `'debug'` (the Angular 20 bridge and adapters ≤ 21.2.7 / ≤ 22.0.5 differ: [logging](orchestrator.md#turn-on-logging-step-3)).
- Angular DI compares tokens and classes **by object identity**. Two module instances of one file are two tokens. So
  `NG0201`/`NG0203` almost always mean "one file, two copies", not a provider bug.
- `@angular/core` is a singleton. Whichever build's copy is served decides dev mode, `ngServerMode` and
  compiled-API compatibility for the shell **and** every remote.
- The adapter package is never shared (it's on its own skip list), so every app bundles its own copy of it. A custom
  `skipList` passed to `shareAll` replaces the Angular skip list instead of extending it.
- The builder wraps `@angular/build`, so Angular's own build behaviour (chunk optimizer, Vite dev server, HMR,
  `index.html` processing) shows up in federated output.

## Version map

| Adapter line | core `@softarc/native-federation` | runtime |
|---|---|---|
| v3: `@angular-architects/native-federation` ≤ 21 | 1.x–3.x | classic runtime |
| v4-bridge: `@angular-architects/native-federation-v4` (Angular 20/21) | 4.x | orchestrator |
| v4: `@angular-architects/native-federation` ≥ 22 | 4.x | orchestrator |

Core and orchestrator are ranges, so always read the installed versions (`npm ls @softarc/native-federation
@softarc/native-federation-orchestrator @angular/build es-module-shims`). Ask for the **build log** too ([what to look for](build-output.md#reading-the-evidence)).

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
  from es-module-shims rewriting a module. How to probe one specifier in either mode: [build-output.md](build-output.md#reading-the-evidence).
- **Angular chunk optimizer ran** (v4 on Angular 22, prod): `dist` has chunk names in a different style from esbuild's
  upper-case `chunk-XXXXXXXX.js` (e.g. mixed case, `chunk-La6B0kZ_.js`).
- **Vite dev server**: `/@id/<pkg>` in a URL means Vite rewrote a bare import that should have gone through the import
  map. A `?import` suffix on a specifier means Vite's import analysis saw it. A `text/html` MIME error on a module
  script means a 404 behind the SPA fallback.
- **Dev mode**: `typeof ngDevMode` (`'object'` = dev) and `typeof ng?.getComponent` tell which `@angular/core` build
  won. That is the authority for Angular's mode; `-dev` in file names is only a hint about the NF build, and the two
  can differ.
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
  secondaries from the shell (`includeSecondaries: { keepAll: true }`, as the `ng add` template does). A secondary
  pruned from the shell's build is a build-output failure mode: see [build-output.md](build-output.md). For
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
  Console on v4: `[<remote>][<lib>] Version '' is not a valid version.`, or an empty `version` in `shared[]` (Step 7).
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
- **Mechanism:** es-module-shims decides its mode once, at load: shim mode if `shimMode` is set (in the
  `<script type="esms-options">` JSON or the `esmsInitOptions` global) or any `module-shim`/`importmap-shim`/
  `modulepreload-shim` tag exists. Loading es-module-shims doesn't by itself mean shim mode, and this applies to any
  orchestrator shell, not only Angular. In shim mode it reads only `importmap-shim` and runs `module-shim`
  scripts, rewriting every module's `import(` to `importShim(`. Native mode needs the three markers to agree: the
  build's `esms-options` JSON, the main tag's `type`, and the map tag the orchestrator writes (runtime
  `initFederation({ shimMode })`).
- **Symptoms:**
  - build shim, runtime `shimMode: false`: `Unable to resolve specifier '@angular/core' imported from …/main-*.js`
    while DevTools shows a native `<script type="importmap">` containing that key.
  - build native, runtime shim: `Failed to resolve module specifier "@angular/core". Relative references must start
    with…` while DevTools shows an `importmap-shim` containing the key.
  - side effects of the shim rewrite: `SyntaxError: Unexpected string` at `importShim(data, …, '<url>')` (a library
    method named `import`, e.g. DevExtreme); breakpoints or `debugger` lines that don't match the
    source (shim mode runs rewritten code); strict CSP (`script-src 'self'`) errors from
    `polyfills.js` before `Unable to resolve specifier`.
- **Evidence:** [dump-import-map.js](../scripts/dump-import-map.js) marks the `effective` map and warns when shim
  mode meets native maps (then `importShim()`, `importShim.resolve` and any loader built on them fail while `import()`
  works); the served
  `index.html` (`esms-options`, main tag `type`) and the map tag in the live DOM; for
  rewrite side effects, the served source at the error position.
- **Applies to:** on the v4-bridge, es-module-shims always runs in shim mode; native mode needs adapter 22.0.3+ (build option and
  runtime `shimMode`) and a browser that supports multiple import maps. v3 is shim-only.
- **Fix direction:** make all three markers agree; use native mode when the shim's rewrite breaks code.

### Dev-server serving model: 404, `text/html` or stale code in `ng serve`
- **Mechanism:** the NF dev middleware serves a request only if the file **exists on disk** in the dev output path
  at that moment (URL minus `baseHref` and query). Otherwise Vite handles it: 404, or `index.html` through the SPA
  fallback. Federation artefacts are rebuilt by a separate watcher, not by Angular's.
- **Symptoms:** `GET …/remoteRoutes.js 404`; `Failed to load module script: Expected a JavaScript module script but
  the server responded with a MIME type of "text/html"`; an edit that never shows up although the build log says it
  rebuilt (or `No output file changes`).
- **Evidence:** Step 4: request the failing URL directly and compare with the file in the dev output folder (exists?
  same bytes?). Compare manifest URLs with the dev-server banner (port, `baseHref` with both slashes). Diff served
  bytes before and after an edit. If the bytes changed but the page runs old code, check which remote's URL serves the
  lib (Step 5; [orchestrator.md](orchestrator.md)).
- **Fix direction:** one `serve` target that runs the NF builder; port, SSL and allowed hosts set on the wrapped
  `serve-original` target (CLI flags aren't forwarded); in v3, `skip` a workspace lib while editing it.

### Angular's chunk optimizer: prod-only `t.ɵɵdefineComponent is not a function`
- **Mechanism:** with Native Federation, Angular's chunk optimizer is disabled and unsupported: the adapter sets
  `NG_BUILD_OPTIMIZE_CHUNKS=0` when it is unset. If the optimizer runs anyway (an explicit value wins), it re-bundles
  the shell's lazy chunks after esbuild and can give the namespace import of the external `@angular/core` and a class
  the same short name. It only touches Angular's own app chunks; `remoteEntry.json`, shared and exposed bundles stay
  identical. Seeing its fingerprints is the finding.
- **Symptoms:** a clean build, then a blank page: `TypeError: t.ɵɵdefineComponent is not a function at
  <static_initializer> (chunk-XXXXXXXX.js)` (or `ɵɵdefineService`). The build log may say the optimizer setting couldn't be applied
  (common under Nx, which loads `@angular/build` first).
- **Evidence:** the optimizer fingerprint in `dist`; `NG_BUILD_OPTIMIZE_CHUNKS` in the build environment; rebuild
  with `NG_BUILD_OPTIMIZE_CHUNKS=0`.
- **Applies to:** v4 on Angular 22 (default on); Angular 20/21 only with `NG_BUILD_OPTIMIZE_CHUNKS=1`. The v3 adapter
  never sets it.
- **Fix direction:** turn the optimizer off (unset `NG_BUILD_OPTIMIZE_CHUNKS`, or set it to `0`).

### Mixed dev and prod builds: `ReferenceError: ngDevMode is not defined`
- **Mechanism:** Angular's compiled code can reference `ngDevMode` directly. A dev-mode core
  defines the global at runtime; a prod core has `ngDevMode` inlined as `false` and never defines it. Since
  `@angular/core` is shared, a remote built unoptimised can run on the shell's prod core, which the orchestrator
  allows at the same version. On v4, dev mode and minification of shared and exposed bundles follow
  `optimization.scripts`, like Angular's own build.
- **Symptoms:** `ReferenceError: ngDevMode is not defined` in a dev remote inside a prod shell; or the reverse: no
  dev-mode checks or `ng` global although the remote was built unoptimised.
- **Evidence:** `typeof ngDevMode` on the page (the authority); which build's `_angular_core.*.js` is served (Step 5;
  a `-dev` suffix is a hint only).
- **Applies to:** v4 never defines `ngDevMode: 'true'` itself. v3 21.2.3+ defines it in dev builds.
- **Fix direction:** build all participants in the same mode when they share Angular, or serve the shell in dev mode
  while developing a remote.

### Init state per bundle: `loadRemoteModule()` from inside a remote never settles
- **Mechanism:** the v4 adapter keeps its init promise at module level, and the adapter is never shared, so each app
  bundles its own copy. Only the shell's copy is resolved by `initFederation()`. A remote that calls the top-level
  `loadRemoteModule` waits on its own, never-resolved copy. (The v3 classic runtime kept state on `globalThis`, so
  this worked there.) The top-level `loadRemoteModule` is deprecated in favour of the one `initFederation()` returns.
- **Symptoms:** silent: the promise neither resolves nor rejects; no log.
- **Evidence:** the same call works from shell code; the hang starts at the first call made from remote code (Step 1).
- **Applies to:** v4 and v4-bridge. Not v3.
- **Fix direction:** the official pattern: the remote's bootstrap function accepts (at least) `loadRemoteModule` from
  the shell as a parameter or prop, and the remote uses that. Don't call `initFederation` again in the remote: that
  replaces the shell's import map.

### Locale data Angular injects: `Failed to resolve module specifier "@angular/common/locales/global/<code>"`
- **Mechanism:** with `i18n.sourceLocale` set (not en-US) and translations not inlined (no `localize`,
  e.g. `ng serve`), Angular's application builder adds an import of `@angular/common/locales/global/<code>` to
  `polyfills.js`, outside the micro frontend. `@angular/common` is
  external, so the import stays bare, and the unused-deps scan never sees it: locale data that Angular injects has to
  be shared and mapped like any other entry point.
- **Symptoms:** `Failed to resolve module specifier "@angular/common/locales/global/de-CH"…` (Chrome) / `…was a bare
  specifier, but was not remapped to anything` (Firefox), often only in `ng serve` or a build without `localize`.
- **Evidence:** Step 5: the specifier is absent; the importer is `polyfills.js` or `main.js`.
- **Fix direction:** if the adapter doesn't map it, share it explicitly (`shareAngularLocales(['global/<code>'])`).

Failure modes with their home elsewhere:
- A shared package's secondary pruned from one build (`rxjs-interop`, Material internals, `Unable to resolve specifier
  '<pkg>/<sub>'`): [build-output.md](build-output.md).
- Stale or mismatched shared bundles from the externals cache: [build-output.md](build-output.md).

If the evidence matches none of these failure modes, suspect a defect: build a reproduction ([repro.md](repro.md))
and check the repo's issue tracker.
