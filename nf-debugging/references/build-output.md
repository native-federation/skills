# Build output

Live docs: [Build Artifacts](https://native-federation.com/docs/v4/core/artifacts.md),
[Sharing Dependencies](https://native-federation.com/docs/v4/core/sharing.md),
[federation.config.mjs](https://native-federation.com/docs/v4/core/configuration.md),
[Caching](https://native-federation.com/docs/v4/core/caching.md), v3: https://native-federation.com/docs/v3/llms.txt.

A runtime can only map what `remoteEntry.json` declares, and an import map has only **exact keys**. The bundler,
though, keeps every *subpath* of an external as a bare import. So an entry point that a bundle imports but that the
entry doesn't declare is a runtime "unable to resolve" error after a successful build. A package that isn't shared
at all is bundled into each app and runs once per app. Core decides what gets declared: `shared`/`skip`,
`includeSecondaries` (`keepAll`, `resolveGlob`), `sharedMappings` (tsconfig `paths`), `ignoreUnusedDeps` (on by
default: it keeps only what the app's import graph reaches) and the externals cache. Every participant is built on
its own, so compare entries **per participant** (Step 7).

## Reading the evidence

Fetch each participant's `remoteEntry.json` directly (Steps 4 and 7).

**Which core line built it**

| Fingerprint | Means |
|---|---|
| `"$version": "v4"` as first key | v4 core ≥ 4.3.1 (earlier 4.x has no marker) |
| `chunks`, `integrity`, `bundle`, `shareScope`, `pool`, or a `shared` row with `entries` | v4 core |
| Only `name`, `exposes`, `shared` (each row has `outFileName`), optional `buildNotificationsEndpoint` | v3 core (2.x–3.x), or v4 < 4.3.1 with default features |
| `@nf-internal/chunk-*` rows in `shared` (`version`/`requiredVersion` `"0.0.0"`) | Chunks published flat: v3 ≥ adapter 20.0.7, or v4 without `denseChunking` |
| `entries` / `bundle` + top-level `chunks` / `integrity` | `denseExternals` / `denseChunking` / `integrityHashes` is on |
| `outFileName` ending in `-dev.js`, `exposes[].dev.entryPoint`, `buildNotificationsEndpoint` | A hint of a dev build (`ng serve` or `dev: true`), not proof. For the Angular mode itself, `typeof ngDevMode` decides; the two can differ. <!-- TODO: prefer the remoteEntry "dev" stamp once core adds it --> |

**Shape (v4)**

```
{ $version, name,
  exposes: [{ key, outFileName, element? }],
  shared:  [ SharedInfo | DenseSharedInfo ],
  chunks?: { <bundle>: [file, …] },          // features.denseChunking
  integrity?: { <file>: <hash> },            // features.integrityHashes
  buildNotificationsEndpoint? }              // dev only
SharedInfo      = { packageName, outFileName, version, requiredVersion, singleton, strictVersion,
                    shareScope?, pool?, bundle? }
DenseSharedInfo = SharedInfo without outFileName, plus entries: { <specifier>: <file> }   // features.denseExternals
```

Core defaults: `ignoreUnusedDeps`, `mappingVersion` and `synthesizeCjsExports` on; `denseChunking`, `denseExternals`,
`integrityHashes` and `strictImports` off; `chunks: true`. The Angular `ng add` template may turn on `denseChunking` and `denseExternals`. Each flag is per build, so one page can mix flat and dense
entries. Chunk bundle names: `browser-shared`/`node-shared` (shared externals), `browser-<pkg>` (`build: 'package'`),
`mapping-bundle` or `mapping-<name>` (shared mappings, core ≥ 4.7), `mapping-or-exposed` (exposes; mappings too
before 4.7).

**Which field answers which question**

| Question | Look at |
|---|---|
| Is specifier `x` declared? | The exact `x` as a flat `shared[].packageName`, or as a key of some `shared[].entries`. A declared `pkg` doesn't cover `pkg/sub`. Mappings appear in `shared` too. |
| Is chunk `@nf-internal/chunk-X` declared? | Dense: `chunk-X.js` in `chunks[<bundle>]`, where `<bundle>` is the `bundle` of the row that imports it. Flat: a `shared` row named `@nf-internal/chunk-X`. |
| Does `loadRemoteModule` name a real expose? | `exposes[].key` (with the `./`), and that `outFileName` exists next to `remoteEntry.json` (Step 4). |
| Why two copies of a package? | Across participants: `version` (the *installed* version), `requiredVersion`, `singleton`, `strictVersion`, `shareScope`, `pool`, which entry points each side declares, and dense vs flat. Within one entry, every specifier of a package must carry the same `version`. |
| Stale code? | `version` vs the installed version (`npm ls <pkg>`), and whether `outFileName`'s hash changed. |
| SRI block? | `integrity[<file>]` vs the served file. |

**Build-log evidence.** Ask for the build log first, from the build that produced the failing `remoteEntry.json`. In a
polyrepo that build may belong to another repo or team: ask its owners. Suggest `features.strictImports: true` (core ≥ 4.8;
older core ignores the key) while debugging, and
`"verbose": true` on the `esbuild` target in `angular.json` for more detail.
- `'<x>' will not resolve (imported by <files>). <reason>` (core ≥ 4.8): predicts the runtime error exactly.
  It checks only what the federation build emits; the app's own bundles can still fail.
  `features.strictImports: true` turns it into a build failure.
- `Checksum of <bundle> matched, re-using cached externals.`: the shared bundles came from the externals cache.
  `Cached <bundle> externals are stale (<reason>), rebuilding.`: the cache noticed a change.
- `Could not enumerate named exports of "<entry>" at build time (…); falling back to default-only.`: CommonJS interop
  failed for that package.
- `Sharing mapped paths with wildcards (*) needs either the ignoreUnusedDeps feature or 'includeSecondaries: { resolveGlob: true }'. Dropped: <keys>.`
- `No shared mapping is reachable from the entry points, so remoteEntry.json will ship without this workspace's libraries.`
- `'<importer>' imports '<x/sub>', a subpath of the shared mapping '<x>'. … the import map cannot resolve it.`
- Angular adapter (recent versions): `Shared externals are published flat. Since orchestrator 4.8.0 …` and
  `@angular/<x> … shared without 'includeSecondaries: { keepAll: true }' … Remotes that import others load their own Angular instead.`

**Diff two states** of the same entry to localise a cause: cold vs warm externals cache, before vs after a watch
rebuild, dev vs prod.

**A/B levers and their traps:** `features.ignoreUnusedDeps: false` (wildcard `sharedMappings` then vanish unless
`includeSecondaries: { resolveGlob: true }` is also set), `includeSecondaries: { keepAll: true }` on one package,
`features.strictImports: true`, purging the build caches ([Build caches](#build-caches-stale-output-files)).

**Probe one specifier in the page.** Default to `import('<x>')`; it can't take an importer and executes the module. If
es-module-shims is loaded, check its mode first (`esmsInitOptions.shimMode`, the `<script type="esms-options">` JSON, or
any `importmap-shim`/`module-shim` tag): in shim mode only the shim sees the map, so use
`importShim.resolve('<x>', '<importer URL>')`. It resolves without fetching and throws the es-module-shims wording when
`<x>` isn't mapped. Pass the URL of the file that fails to import `<x>` (from the error's "imported from"): remotes
resolve through their own scope, and without it you only test the top-level `imports`. A shell can supply its own
importer or resolve hook, so this covers most setups, not all.

## Failure modes

Angular-only causes are in [angular.md](angular.md): compiler-generated relative imports into a shared mapping, locale
data, shim mode, and the chunk optimizer. How the runtime picks a serving build is in
[orchestrator.md](orchestrator.md) and [pooling.md](pooling.md).

### Declaration: a sub-path or entry point isn't declared
- **Mechanism:** core declares only the entry points it discovers. For npm packages that's the `exports` keys (other
  than `.`) and sub-folders with their own `package.json`. Wildcard `exports` keys (`./*`) are expanded only with
  `includeSecondaries: { resolveGlob: true }`. Deep file imports into a package that declares neither are never
  declared. For workspace libs it's the tsconfig `paths` keys in `sharedMappings`. Externality still covers every
  subpath of a declared name, so the bundle keeps the import bare and nothing maps it.
- **Symptoms:** `Unable to resolve specifier '<pkg>/<sub>' imported from <url>` (es-module-shims), or
  `TypeError: Failed to resolve module specifier "<pkg>/<sub>". Relative references must start with…` (native Chrome),
  or `… was a bare specifier, but was not remapped` (Firefox). Usually a blank page at boot. A `?import` suffix on the
  specifier means the Vite dev server served the importer.
- **Evidence:** Step 3: the `imported from` URL names the bundle that holds the import. Step 7: the exact specifier is
  missing from that participant's `shared`/`entries`. Read the package's `package.json` `exports`. On core ≥ 4.8 the
  build log already says `'<x>' will not resolve`.
- **Applies to:** all lines. v3 adapter ≥ 21.0.4 and v4 both need `resolveGlob` for wildcard `exports`.
- **Fix direction:** import the declared entry point (the barrel, not a deep file), share the sub-path explicitly,
  set `resolveGlob`, or `skip` the whole family.

### Pruning (`ignoreUnusedDeps`): an entry point the app doesn't import isn't published
- **Mechanism:** with `ignoreUnusedDeps` (the default), each build keeps only the shared entry points its import
  graph reaches. The scan starts at the build's `exposes` and falls back to `main.ts` only when there are no exposes.
  It follows the imports of every used package, but it can't see imports it can't parse statically (computed
  `import()`, compiler-synthesised imports, Angular's locale imports). Pruning is per entry point unless the package
  has `includeSecondaries: { keepAll: true }`. So two builds of the same package can publish different subsets.
- **Symptoms:**
  - The build's own bundle imports a pruned entry point: the "not declared" errors above, sometimes **silent** (a
    framework that catches a failed lazy `import()`, e.g. Angular animations that just don't apply).
  - A shell that lacks an entry point a remote imports (typical: `@angular/core/rxjs-interop`): orchestrator ≥ 4.8
    runs the remote's whole package from the remote's own build. That means a second framework instance for that
    remote, and it's silent unless the package is pooled (`[NF][3] … serves its own family … (gap '<entry>')`).
    Orchestrator ≤ 4.7 mixes the shell's core with the remote's secondary instead: `NG0203: toSignal() can only be used
    within an injection context` appears only once that code runs.
  - A shell meant to provide every workspace lib advertises almost none of them.
- **Evidence:** Step 7: put shell and remote `shared`/`entries` keys for one package side by side and look for an entry
  point only one side declares. Step 5/6: which build serves the package for that remote (`scopes`, verdict
  `poolCause: 'uncovered'`). Confirm by rebuilding with `keepAll` on that package, or with `ignoreUnusedDeps: false`
  (plus `resolveGlob: true` if you use wildcard mappings).
- **Applies to:** v3 scanned `main.ts` only (deps used only by exposes were dropped). v4 scans exposes. The
  serving-build behaviour differs by orchestrator version as above. On the classic runtime the mismatch shows up as two
  copies keyed by version ([classic-runtime.md](classic-runtime.md)).
- **Fix direction:** `includeSecondaries: { keepAll: true }` on framework packages in every build (the v4 Angular
  template does this for `@angular/*`), or import the entry point where it's provided. For a provider shell, let each
  remote publish what it imports. The shell is the only app that calls `initFederation`, and it has no `exposes`; an
  app with `exposes` is a remote, even if it loads other remotes. An app that calls `initFederation` and has `exposes`
  is the problem: its own `main.ts` isn't scanned, so what only that app imports isn't shared. Split the exposed part
  into its own remote.

### Not shared: `skip`, the dependency list and mappings produce a bundled copy
- **Mechanism:** whatever isn't declared as shared is bundled into each build that imports it, so it runs once per
  build. `skip` doesn't remove a package from the page: it inlines it. `shareAll`/`fromPackageJson` read only
  `dependencies`, so packages in `devDependencies`/`peerDependencies` aren't shared. A workspace lib is shared only if
  its tsconfig `paths` key is in the `paths` the build actually uses. Skipping part of a family breaks two ways.
  Skipping a secondary that another shared bundle imports leaves a bare, undeclared import. Skipping a root whose
  secondaries stay shared inlines the root into every secondary's bundle.
- **Symptoms:** duplicated state. Angular `NG0201`/`NullInjectorError` for a token, "service not singleton",
  `instanceof` failing across remotes, React "Invalid hook call". After skipping part of a family:
  `Unable to resolve specifier '<pkg>/<sub>' imported from …/<shared-bundle>.js`, or errors from the inlined copies
  (e.g. `TypeError: Cannot read properties of null (reading 'getBaseHref')`). A missing `skip` on a Node-only package
  makes the shared build fail, and then its files 404.
- **Evidence:** Step 7: the package is absent from `shared` in one participant. Grep that participant's app or exposed
  bundles for a constructor string of the duplicated thing (for example `new InjectionToken("X")`). Two hits in two
  files prove the copy. Check `skip`, the package's section in `package.json`, and the build tsconfig's `paths`.
- **Fix direction:** share the whole family or skip the whole family. Put runtime deps in `dependencies` and Node-only
  ones in `devDependencies` or `skip`. Keep `paths` where the build tsconfig sees them.

### Version stamps: `version`, ranges and flags decide whether copies merge
- **Mechanism:** each shared row carries the **installed** `version` plus `requiredVersion`, `singleton`,
  `strictVersion`, `shareScope` and `pool`. The orchestrator merges copies when the ranges allow it, and gives a remote
  its own **scoped copy** only in the cases listed under [Scoped copy](orchestrator.md#scoped-copy-a-framework-or-library-runs-twice-no-warning). Copies in
  different share scopes are elected separately. The classic runtime merges only identical `name@version`.
  Workspace libs take their version from the nearest `package.json` (`features.mappingVersion`).
- **Symptoms:** two instances of a framework with no error, or `[NF][3]` range warnings at `logLevel: 'warn'`. Two
  `version`s for one package inside one entry, or an empty `version` on a workspace lib.
- **Evidence:** Step 7: compare those fields for the package across participants. Step 5/6: `scopes` entries or
  storage `action: "scope"` for it.
- **Applies to:** classic runtime vs orchestrator, as above.
- **Fix direction:** align installed versions or widen ranges, and drop `strictVersion` where exact matches aren't
  needed. Give workspace libs a consistent version. See [orchestrator.md](orchestrator.md), [pooling.md](pooling.md).

### Chunks and dense output: identity inside a chunk is per remote
- **Mechanism:** the bundler splits shared code into chunks, published as `@nf-internal/chunk-<hash>`. Since core 4.7
  chunk names are content hashes. Chunks belong to a build, not a dependency, so the runtime maps them in each remote's
  own scope. Two remotes that emit identical chunk bytes still load them twice. `denseChunking` only moves the chunk
  list into `chunks[<bundle>]`. `denseExternals` groups a package's entry points under one record. The orchestrator
  (≥ 4.8) uses that record to treat them as one package, inferred at `@scope/name` unless a mapping declares a deeper
  package with `mappingsFromWorkspace().package(prefix)`. Shared mappings build apart from exposes since core 4.7, so
  no chunk mixes the two.
- **Symptoms:**
  - State that lives in a lazily split chunk of a shared lib (a token, a service) exists once per remote: `NG0201`, or
    a component silently using its own default provider.
  - A 404 or unresolved `@nf-internal/chunk-*`: the entry and its chunks come from different deploys, or a file was
    excluded from the shim (`esmsInitOptions.skip`) and natively imports an `@nf-internal` id.
  - Domain-style mapping keys (`@shared/components/*`) grouped into one package: libraries loaded twice and far more
    `scopes` entries than expected, with no error.
- **Evidence:** Step 5: the same `@nf-internal/chunk-<hash>` id under two scopes. For grouping, check per entry point of
  one prefix which remote's URL serves it. Step 4: the 404's URL and which entry referenced it.
- **Applies to:** content naming and separate mapping builds from core 4.7. Package grouping from orchestrator 4.8;
  deeper declared packages honoured from orchestrator 4.9 with `denseExternals` on; flat entries keep the
  `@scope/name` rule.
- **Fix direction:** keep identity (tokens, services) in a library's entry point, not behind a lazy `import()`. Turn on
  `denseExternals`, declare packages with `.package(prefix)`, and couple
  dependent packages with a `pool`.

### CommonJS interop: named exports missing, or `require` at runtime
- **Mechanism:** shared packages are bundled to ESM. For a CommonJS package the bundler can't always see named
  exports that are assigned at runtime. v4 core `require()`s such a package at build time and re-exports the keys it
  finds (`features.synthesizeCjsExports`, default on since core 4.3.2). A `require()` of a Node built-in or of another
  external survives bundling either way.
- **Symptoms:** `SyntaxError: The requested module 'blob:…' does not provide an export named 'X'` (Chrome under the
  shim, where the module is a `blob:` URL) or `import not found: X` (Firefox). A different default-export shape
  (`x.default.fn`). `Error: Dynamic require of "<x>" is not supported`. In the build log:
  `Could not enumerate named exports of "<entry>" …`.
- **Evidence:** Step 3: map the `blob:` module to its package through the stack frame. The package has no ESM `module`
  or `exports` entry. If the build's bare-import check is silent, don't rule out a runtime `require()`.
- **Applies to:** all lines. Named-export recovery is v4 ≥ 4.3.2 only.
- **Fix direction:** use the default import, a per-function entry point or an ESM variant of the package. Or `skip` it,
  or point `packageInfo` at its ESM file, then purge the build caches.

### Build caches: stale output files
- **Mechanism:** shared bundles are cached in `node_modules/.cache/native-federation/<project>/` and reused when a
  checksum matches (builder option `cacheExternalArtifacts`, alias `cache`; `cachePath` moves it). Angular keeps its own
  cache in `.angular/cache`. A cache key can't see every input, so a build can reuse output that no longer matches the
  sources.
- **Symptoms:** a change (to a dependency, a shared lib, an exposed component, or the federation config) that doesn't show
  up in the served files, only on machines with a warm cache. CI is usually fine because it starts from a clean checkout.
- **Evidence:** build log `Checksum of <bundle> matched, re-using cached externals.` right after the change. The served
  file's hash in `remoteEntry.json` didn't change. Purging the caches and rebuilding fixes it.
- **Fix direction:** whenever stale output is a suspect, purge the build caches (`node_modules/.cache/native-federation`,
  `.angular/cache`, `dist`) and rebuild before digging further.

### Dev and prod builds: different output, and mixing them
- **Mechanism:** a dev build names shared entries by build metadata, not content (`<name>.<hash>-dev.js`), leaves
  exposes and mappings unhashed, builds shared packages in dev mode, adds
  `dev.entryPoint` and `buildNotificationsEndpoint`, and is cached separately. Prod hashes every shared entry by its
  final content. The runtime serves each shared package from **one** build. If participants mix dev and prod builds,
  code compiled for one mode can run against the other mode's framework build. In dev, a statically served remote's copy of a
  library can win over the dev-served one ([orchestrator.md](orchestrator.md#serving-build-choice-in-dev-the-static-builds-copy-wins-over-the-dev-served-one)).
- **Symptoms:** works in dev, fails in prod (or the other way round). Angular `ReferenceError: ngDevMode is not
  defined` ([angular.md](angular.md)). In dev, stale library code although the dev server rebuilt.
- **Evidence:** the dev fingerprints in the table above, per participant. Step 4: which origin each shared
  package's file came from. Diff the dev and prod entries of the same app.
- **Fix direction:** serve all participants in the same mode while debugging. Make sure deployed remotes are prod
  builds. Send `no-cache` for `remoteEntry.json` .

If the evidence matches none of these failure modes, suspect a defect: build a reproduction ([repro.md](repro.md)) and
check the repo's issue tracker.
