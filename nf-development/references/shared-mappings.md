# Shared mappings (monorepo libraries)

Live docs: [Sharing Dependencies](https://native-federation.com/docs/v4/core/sharing.md) · [federation.config.mjs](https://native-federation.com/docs/v4/core/configuration.md) · [Component Libs](https://native-federation.com/docs/v4/component-libs.md)

## What they are

Path aliases in `tsconfig.json` (`@org/utils` → `libs/utils/src/index.ts`) are picked up by the
core and shared like npm packages. This lets every remote in the monorepo use one instance of an
internal lib at runtime.

## Versioning

With `features.mappingVersion` (default on), the version of a shared mapping comes from the lib's
own `package.json`, so it can take part in version negotiation.

TODO: behaviour without a package.json, and how that interacts with `requiredVersion`.

## Opting out

Use `skip` for mappings that shouldn't be shared (e.g. app-local aliases).
TODO: v3 `sharedMappings` option vs the v4 behaviour.

## Pitfalls

TODO: deep imports into a mapped lib, mappings pointing to folders vs files, Nx-specific setups,
mapped libs that are themselves Angular libs (see [ngtsc-synthetic-imports.md](ngtsc-synthetic-imports.md)).
