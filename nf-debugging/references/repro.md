# Building a minimal reproduction

Live docs: [Tutorial](https://native-federation.com/docs/v4/tutorial.md) · [esbuild Getting Started](https://native-federation.com/docs/v4/adapters/esbuild/getting-started.md)

## When to build one

When triage doesn't point to a clear cause, or when the bug looks like it's in Native Federation
itself and should be reported upstream.

## Strategy

TODO: start from a minimal host+remote, add the failing remote's shared config, bisect.

## Comparing builds

TODO: diff `remoteEntry.json` and `importmap.json` between a working and a broken build (feature
flag on vs off, old vs new version).

## Reporting upstream

TODO: what to include in an issue.
