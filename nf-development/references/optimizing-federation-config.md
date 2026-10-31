# Optimizing `federation.config.mjs`

Live docs: [federation.config.mjs](https://native-federation.com/docs/v4/core/configuration.md) · [Sharing Dependencies](https://native-federation.com/docs/v4/core/sharing.md) · [Build Process](https://native-federation.com/docs/v4/core/build-process.md) · [Caching](https://native-federation.com/docs/v4/core/caching.md) · [Build Artifacts](https://native-federation.com/docs/v4/core/artifacts.md)

## Levers

| Lever | Effect |
|---|---|
| `share({...})` instead of `shareAll()` | Fewer shared bundles. See [sharing-libraries.md](sharing-libraries.md). |
| `skip` | Removes packages or mappings from sharing. They are still bundled into the app. |
| `includeSecondaries: false` (or an explicit list) | Avoids a bundle per secondary entry point. |
| `features.ignoreUnusedDeps` (default on) | Only shares what the code actually imports. Beware of [ngtsc synthetic imports](ngtsc-synthetic-imports.md). |
| `features.denseChunking` | Groups the `@nf-internal` chunks in `remoteEntry.json`. |
| Build mode (`default` / `separate` / `package`) | Trades build passes and cache granularity against chunk sharing. |
| Federation cache | Shared bundles are cached by package+version. Keep `node_modules/.cache` between CI runs. |

## Checklist

TODO: a step-by-step review for an existing config (measure first: count shared bundles and
requests on a cold load).

## Build time

TODO: cache hits, watch mode, monorepos with many remotes.

## Runtime / load performance

TODO: request waterfall, preloading, HTTP/2 considerations.
