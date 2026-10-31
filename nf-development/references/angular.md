# Angular

Live docs: [Angular Adapter](https://native-federation.com/docs/v4/angular-adapter/index.md) · [Getting Started](https://native-federation.com/docs/v4/angular-adapter/getting-started.md) · [Builder](https://native-federation.com/docs/v4/angular-adapter/builder.md) · [Configuration](https://native-federation.com/docs/v4/angular-adapter/configuration.md) · [Runtime](https://native-federation.com/docs/v4/angular-adapter/runtime.md) · [SSR](https://native-federation.com/docs/v4/angular-adapter/ssr.md) · [I18N](https://native-federation.com/docs/v4/angular-adapter/i18n.md) · [Localization](https://native-federation.com/docs/v4/angular-adapter/localization.md) · [Custom Builder](https://native-federation.com/docs/v4/angular-adapter/custom-builder.md) · [Migration to v4](https://native-federation.com/docs/v4/angular-adapter/migration-v4.md)

## Setup

The Angular integration is a CLI builder plus `ng add` schematics, which scaffold a host or a remote.
The builder wraps the application builder (esbuild-based), so the regular Angular build runs
alongside federation.

TODO: exact package names and versions per Angular major, and what `ng add` changes in `angular.json` and `main.ts`.

## Bootstrapping

TODO: the `main.ts` → `bootstrap.ts` split, and where `initFederation` goes.

## Routing to remotes

TODO: `loadRemoteModule` in `loadChildren` / `loadComponent`, standalone vs NgModule remotes.

## Sharing Angular

- `@angular/*` packages should be singletons with `requiredVersion: 'auto'`.
- Angular compiles templates into imports that aren't in your source code. See
  [ngtsc-synthetic-imports.md](ngtsc-synthetic-imports.md).
- Locale data: `shareAngularLocales`. See the Localization docs.

TODO: zone.js vs zoneless, polyfills.

## SSR & hydration

TODO

## i18n

TODO

## Dev server quirks

TODO: `ng serve` behaviour, rebuilds, ports, CORS.
