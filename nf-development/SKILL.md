---
name: nf-development
description: Native Federation development guide — terminology, configuration, dependency sharing and architecture for ESM + import-map based micro frontends (@softarc/native-federation, @angular-architects/native-federation, the native-federation orchestrator). Use this skill whenever the user sets up, configures, optimizes or migrates a federated app: hosts/remotes, remoteEntry.json, federation.config.(m)js, shared dependencies, shared mappings, the orchestrator, Angular or React integration, v3→v4 migration, or mixing Native and webpack Module Federation — even if they don't say "Native Federation" explicitly. For runtime failures in the browser, use the nf-debugging skill.
license: MIT
metadata:
  author: Copyright 2026 The native-federation team
  version: '1.0'
---

# Native Federation

## Start with the live docs

Native Federation moves fast, and this skill can lag behind. Before answering anything
version-specific, fetch the docs index and follow the link for the topic at hand:

- v4 (current): https://native-federation.com/llms.txt
- v3 (legacy): https://native-federation.com/docs/v3/llms.txt

Every link in those indexes points to a plain markdown page, so fetching them is cheap. Treat the
docs as the source of truth. Use this skill for orientation, the gotchas that aren't in the docs,
and pointers to which reference file to read next.

First, work out which major version the user is on (check `package.json` for
`@softarc/native-federation*` / `@angular-architects/native-federation` and whether the
orchestrator is installed). A lot of advice differs between v3 and v4. See
[references/v3-vs-v4.md](references/v3-vs-v4.md).

## Terminology

Native Federation re-expresses the Module Federation model (host, remote, shared) on top of
browser standards: ESM and import maps. If you understand these terms, most problems become a
question of "which artifact is wrong?"

### Actors

| Term | What it means |
|---|---|
| **Host** (shell) | The app that loads remotes at runtime. It is built like any other app but doesn't know its remotes at compile time. It has its own federation config (without `exposes`) and also produces a `remoteEntry.json`. |
| **Remote** / **MFE** | A separately built and deployed app that *exposes* ES modules. Usually one per team or bounded context. A remote can also act as a host for other remotes. |
| **Core** (`@softarc/native-federation`) | The bundler-agnostic builder. It reads the federation config and emits `remoteEntry.json`, an import map and the shared bundles. |
| **Build adapter** | Connects the core to a bundler (esbuild, Angular CLI, Vite, …) via the `NFBuildAdapter` contract (`setup`/`build`/`dispose`). |
| **Orchestrator** (`@softarc/native-federation-orchestrator`) | The v4 host runtime. It handles semver negotiation across remotes, caching of remote entries in browser storage, SRI, dependency pooling, the event registry and SSR via `/node`. |
| **Runtime** (`@softarc/native-federation-runtime`) | The classic v3 host runtime. It is end-of-life and replaced by the orchestrator. |

### Artifacts

| Term | What it means |
|---|---|
| **`remoteEntry.json`** | The public contract of one build: its `name`, `exposes`, `shared` (with versions and flags) and optionally `chunks`. It lives **on the remote**. |
| **Manifest** | A JSON file (or inline object) **on the host** that maps remote names to their `remoteEntry.json` URLs. To switch environments, swap the manifest. No rebuild is needed. |
| **Import map** | A W3C standard that maps bare specifiers (`@angular/core`) to URLs. Each build emits an `importmap.json`. At runtime the orchestrator merges these into the single map injected into the page. After that, the *browser* resolves every import. |
| **Chunk** (`@nf-internal/chunk-*`) | Code that the bundler split out of several shared externals. With `features.denseChunking` it moves into a dedicated `chunks` section. |

### Sharing concepts

| Term | What it means |
|---|---|
| **Shared dependency** | A package that host and remotes agree to load once. Declare it under `shared`, usually with `share()` or `shareAll()`. "Shared" means "the runtime picks one copy that everyone accepts". It does **not** mean "same version everywhere". |
| **External** | The same thing seen from the bundler's side: a specifier left as a bare `import` and resolved by the import map at runtime. |
| **Exposed module** | An entry under `exposes`. The key (`./Component`) is the public specifier and the value is the source file. Load it with `loadRemoteModule({ remoteName, exposedModule })`. |
| **Secondary entry point** | A package subpath such as `@angular/core/rxjs-interop`. By default each one gets its own shared bundle, controlled by `includeSecondaries`. |
| **Shared mapping** | A `tsconfig` path alias (monorepo lib) that the core shares automatically. See [references/shared-mappings.md](references/shared-mappings.md). |
| **singleton** | Only one instance may load. Use it for stateful libraries (framework cores, `zone.js`, stores). |
| **requiredVersion** | The semver range a consumer accepts. Use `'auto'` to read it from the nearest `package.json`. |
| **strictVersion** | Throw on an incompatible version instead of warning and falling back. |
| **Share scope** | A named bucket. Packages are only shared within the same scope. It is rarely needed. |
| **Skip list** | Packages excluded from *sharing*. Skipped packages are still bundled into the app, just not as a shared external. |
| **Feature flags** | `features.ignoreUnusedDeps` (default on), `features.mappingVersion` (default on), `features.denseChunking` (opt-in). |
| **Build mode** | Per-shared-entry grouping: `'default'`, `'separate'` or `'package'`. |
| **Federation cache** | Shared-bundle cache in `node_modules/.cache/native-federation/<project>`, keyed by package names and versions. |

### How the pieces line up at runtime

1. Every project builds and publishes its `remoteEntry.json`, `importmap.json` and bundles.
2. The host calls `initFederation(manifest)`. The orchestrator fetches each remote entry (or
   reads it from its storage cache).
3. It merges the shared declarations, resolves versions and injects one import map.
4. `loadRemoteModule` becomes a plain dynamic `import()`, resolved by that map.

Most bugs show up as a mismatch between two of these steps. Typical examples: a specifier that is
in the code but not in the import map, a stale cached remote entry, or two copies of a singleton.

## Recommendations

- **Be deliberate about what you share.** Prefer explicit `share({...})` for the framework and
  stateful libs over a blanket `shareAll()`. Every shared package is a separate,
  non-tree-shakeable bundle and an extra request. See
  [references/sharing-libraries.md](references/sharing-libraries.md).
- **Mark stateful libraries `singleton: true`**, use `requiredVersion: 'auto'`, and decide
  consciously about `strictVersion`. Failing fast in production is sometimes better than a subtle
  dual-instance bug.
- **Keep the framework version aligned across remotes.** The orchestrator can negotiate, but
  framework singletons tolerate very little drift.
- **Use a manifest, not hard-coded URLs.** That way environments differ by a JSON file, not by a
  build.
- **On v4, use the orchestrator.** The classic runtime is end-of-life.
- **Debug from the artifacts outward.** Inspect the injected import map, the remote's
  `remoteEntry.json` and browser storage before touching code. For hands-on browser
  debugging, use the **nf-debugging** skill.
- TODO: more recommendations to collect (deployment/caching headers, CI checks for version drift, …)

## Reference files

Read only the file that matches the question. Each one starts with the matching live-docs links.
For runtime failures in the browser, switch to the **nf-debugging** skill instead.

| Topic | File | Read when… |
|---|---|---|
| Browser storage | [references/browser-storage.md](references/browser-storage.md) | Stale remotes, changes not showing up after deploy, cache configuration |
| Angular | [references/angular.md](references/angular.md) | Angular CLI builder, schematics, SSR, i18n/locales, zone.js |
| React | [references/react.md](references/react.md) | React or other CJS-heavy ecosystems with the esbuild/Vite adapter |
| ngtsc synthetic imports | [references/ngtsc-synthetic-imports.md](references/ngtsc-synthetic-imports.md) | Angular remotes fail on imports that don't appear in the source code |
| Shared mappings | [references/shared-mappings.md](references/shared-mappings.md) | Monorepo libs via tsconfig paths, versioning of internal libs |
| Sharing vs not sharing (performance vs robustness) | [references/sharing-libraries.md](references/sharing-libraries.md) | Deciding what goes into `shared`, singleton/strictVersion, bundle size vs runtime safety |
| Module Federation integration | [references/module-federation-integration.md](references/module-federation-integration.md) | Mixing Native Federation with webpack/Rspack Module Federation |
| Optimizing `federation.config.mjs` | [references/optimizing-federation-config.md](references/optimizing-federation-config.md) | Build speed, bundle count, request count, feature flags |
| The orchestrator | [references/orchestrator.md](references/orchestrator.md) | Host runtime setup, version resolution, pooling, event registry, SRI, SSR |
| v3 vs v4 | [references/v3-vs-v4.md](references/v3-vs-v4.md) | Identifying the version, migrating, version-specific advice |
| Quirks in older versions | [references/older-version-quirks.md](references/older-version-quirks.md) | The user is on v3 or earlier, or on an older Angular/adapter release |
