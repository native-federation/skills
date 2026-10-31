# Sharing vs not sharing libraries (performance vs robustness)

Live docs: [Sharing Dependencies](https://native-federation.com/docs/v4/core/sharing.md) · [Version Resolver](https://native-federation.com/docs/v4/orchestrator/version-resolver.md) · [Dependency Pooling](https://native-federation.com/docs/v4/orchestrator/pooling.md) · [Component Libs](https://native-federation.com/docs/v4/component-libs.md) · [Mental Model](https://native-federation.com/docs/v4/mental-model.md)

## The trade-off

Sharing is not free. For each library you trade between two things:

| | Share it | Don't share it (bundle it) |
|---|---|---|
| Download size across MFEs | Loaded once | Duplicated per remote |
| Tree-shaking | Lost: the whole shared entry is built | Kept |
| Requests | One or more extra module requests | Inlined in app chunks |
| Runtime robustness | One instance, but a version negotiation that can go wrong | Each remote gets exactly what it was built and tested with |
| Required for | Stateful/singleton libs (framework, router, stores, DI-based libs) | Stateless utilities, small libs, libs with version drift |

## Rules of thumb

- **Must share (singleton):** framework runtimes and anything that holds global state or uses
  identity checks (`instanceof`, injection tokens, context objects).
- **Probably share:** large libraries that every remote uses on the same version.
- **Probably don't share:** small or stateless utilities, and libs that only one remote uses.
- `shareAll()` is a convenient start but shares everything in `dependencies`. Narrow it down once
  the app works.

TODO: concrete measurements (requests, KB) from a real app.

## Version negotiation flags

TODO: worked examples of `singleton` / `strictVersion` / `requiredVersion` combinations and
what the orchestrator picks.

## Pooling and share scopes

TODO: when to isolate dependencies into pools or scopes instead of not sharing them.

## Component libraries

TODO: sharing a design-system lib, and secondary entry points.
