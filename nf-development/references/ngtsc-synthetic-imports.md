# ngtsc synthetic imports

Live docs: [Sharing Dependencies](https://native-federation.com/docs/v4/core/sharing.md) · [federation.config.mjs (feature flags)](https://native-federation.com/docs/v4/core/configuration.md)

## The problem

The Angular compiler (ngtsc) emits imports that don't exist in your TypeScript source. When it
compiles a template, it adds imports for the components, directives and pipes the template uses,
sometimes from secondary entry points or library-internal paths. Native Federation decides what
to share and what to keep in the import map by analysing dependencies. If that analysis sees the
source, not the compiled output, it can miss these imports. At runtime the browser then fails
with `Failed to resolve module specifier`.

TODO: confirm exactly which analysis step is affected (e.g. `ignoreUnusedDeps`) and in which versions.

## How to recognise it

- The failing specifier isn't imported anywhere in your `.ts` files.
- It belongs to an Angular (component) library, often a secondary entry point.
- TODO: concrete examples.

## Workarounds

TODO: explicitly sharing the entry point, `includeSecondaries`, turning off `ignoreUnusedDeps`
for the package, and the status of the upstream fix.

## Background

TODO: how ngtsc decides on the import path (`exports` / the re-export resolution in the compiler).
