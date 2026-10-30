# The orchestrator

Live docs: [Overview](https://native-federation.com/docs/v4/orchestrator/index.md) · [Getting Started](https://native-federation.com/docs/v4/orchestrator/getting-started.md) · [Architecture](https://native-federation.com/docs/v4/orchestrator/architecture.md) · [Configuration](https://native-federation.com/docs/v4/orchestrator/configuration.md) · [Version Resolver](https://native-federation.com/docs/v4/orchestrator/version-resolver.md) · [Pooling](https://native-federation.com/docs/v4/orchestrator/pooling.md) · [Event Registry](https://native-federation.com/docs/v4/orchestrator/event-registry.md) · [Node.js / SSR](https://native-federation.com/docs/v4/orchestrator/node.md) · [Module Federation](https://native-federation.com/docs/v4/orchestrator/module-federation.md) · [Security & SRI](https://native-federation.com/docs/v4/orchestrator/security.md) · [Legacy Runtime](https://native-federation.com/docs/v4/runtime/index.md)

## Role

`@softarc/native-federation-orchestrator` is the v4 host runtime. It replaces the end-of-life
`@softarc/native-federation-runtime`. It reads the same `remoteEntry.json` contract and adds:

- semver-range resolution of shared dependencies across many remotes
- persistent caching of remote entries (see [browser-storage.md](browser-storage.md))
- SRI verification of remote entries and chunks
- dependency pooling (isolated sets of shared deps)
- an event registry (`window.__NF_REGISTRY__`) for race-free init and cross-MFE communication
- SSR support through its `/node` entry (`initNodeFederation`)

## Setup

TODO: a minimal host setup, and the config options that matter most.

## Version resolution

TODO: how the winner is picked for singletons vs non-singletons, and how to read its decisions.

## Event registry

TODO: usage patterns.

## SSR

TODO

## Security / SRI

TODO
