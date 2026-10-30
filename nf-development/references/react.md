# React (and other CJS-heavy ecosystems)

Live docs: [esbuild Adapter](https://native-federation.com/docs/v4/adapters/esbuild/index.md) · [React & CJS Interop](https://native-federation.com/docs/v4/adapters/esbuild/react-interop.md) · [Adapters Overview](https://native-federation.com/docs/v4/adapters/index.md)

## Adapter choice

React apps usually use the esbuild adapter (or a Vite-based one), not the Angular builder.

TODO: recommended adapter per setup (plain esbuild, Vite), with minimal build scripts.

## CommonJS interop

`react` and `react-dom` ship as CommonJS. Native Federation shares ES modules, so these packages
must be converted, and named exports have to survive that conversion.

TODO: summarise the documented approach and the pitfalls (default vs named exports, `react/jsx-runtime`).

## Singletons

`react`, `react-dom` and `react/jsx-runtime` must resolve to the same instance across host
and remotes. Otherwise you get "Invalid hook call" errors.

TODO: recommended `shared` block for React.

## Mixing frameworks

TODO: hosting a React remote in an Angular shell (and the other way round), e.g. via web components.
