# Module Federation integration

Live docs: [Native & Module Federation](https://native-federation.com/docs/v4/native-and-module-federation.md) · [Orchestrator: Module Federation](https://native-federation.com/docs/v4/orchestrator/module-federation.md)

## How they relate

Native Federation keeps the Module Federation mental model (host, remote, shared, exposes) but
implements it with ESM and import maps instead of webpack's runtime. The two are not
wire-compatible by default. A webpack remote is not an ES module served via an import map.

## Bridging shared singletons

The orchestrator provides `createGetShared`. It feeds the singletons the orchestrator resolved
into webpack Module Federation's `shared` config, so both worlds can use one instance.

TODO: a worked example and its limitations.

## Migration paths

TODO: gradual migration from webpack MF to NF (or co-existence), and which side should be the host.

## Pitfalls

TODO
