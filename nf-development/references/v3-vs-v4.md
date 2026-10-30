# v3 vs v4

Live docs: [v3 vs v4](https://native-federation.com/docs/v4/v3-vs-v4.md) · [Migration to v4](https://native-federation.com/docs/v4/migration.md) · [Angular Migration to v4](https://native-federation.com/docs/v4/angular-adapter/migration-v4.md) · [v3 docs index](https://native-federation.com/docs/v3/llms.txt)

## Identifying the version

Check `package.json`:

- `@softarc/native-federation-orchestrator` present → v4 host runtime.
- `@softarc/native-federation-runtime` → the classic (v3-style) runtime.
- TODO: exact version ranges of the core, the adapters and `@angular-architects/native-federation`
  per major.

## Main differences

| Area | v3 | v4 |
|---|---|---|
| Host runtime | `@softarc/native-federation-runtime` | Orchestrator |
| Remote-entry caching | none | localStorage / sessionStorage |
| Version resolution | TODO | semver-range negotiation across remotes |
| Config file | TODO (`.js`) | TODO (`.mjs`?) |
| Feature flags | TODO | `ignoreUnusedDeps`, `mappingVersion`, `denseChunking` |

TODO: verify and complete this table against the live v3-vs-v4 page.

## Migration

TODO: summary of the steps and the gotchas found in practice.

## Mixed fleets

TODO: can v3 remotes run under a v4 host (and the other way round)? What breaks?
