---
name: nf-debugging
description: Step-by-step debugging of Native Federation micro frontends in the browser (ESM + import maps, @softarc/native-federation, @angular-architects/native-federation, the native-federation orchestrator). Use this skill whenever a federated app fails at runtime — "Failed to resolve module specifier", a remote that won't load, loadRemoteModule/initFederation errors, duplicate framework instances (Angular injector errors, React "Invalid hook call"), version mismatch warnings, or changes that don't show up after a deploy — even if the user only pastes a console error and doesn't mention Native Federation.
license: MIT
metadata:
  author: Copyright 2026 The native-federation team
  version: '1.0'
---

# Debugging Native Federation

Before giving version-specific advice, fetch the live docs:
https://native-federation.com/llms.txt (v4) or https://native-federation.com/docs/v3/llms.txt (v3).
Use the **nf-development** skill for terminology and for the configuration fix once you've found
the cause. This skill is about finding the cause.

## Why browser debugging is different here

Native Federation does most of its work at runtime, in the browser. The bundler leaves shared
packages as bare imports. The host's runtime fetches every remote's `remoteEntry.json`, negotiates
versions and injects one merged import map. After that, the browser resolves every import. So the
source code is usually *not* where the bug is visible. The bug shows up in what the browser
received: the import map, the remote entries, browser storage and the network requests. Look at
those first and the code second.

## Triage workflow

Go in this order. Each step rules out a whole class of causes.

1. **Pin down the version and the setup.** Find out whether this is v3 (classic runtime) or v4
   (orchestrator), which adapter is used (Angular, esbuild, Vite), and whether this is the dev
   server or a production build. Check `package.json` in the host and in the failing remote.
2. **Read the exact error.** Get the full console message, including the specifier or the remote
   name. Look it up in the symptom table below.
3. **Inspect the injected import map.** Run [scripts/dump-import-map.js](scripts/dump-import-map.js)
   in the page. Is the failing specifier there? Does it point to the expected remote or host and
   version?
4. **Fetch the remote's `remoteEntry.json` directly.** Check that the `exposes` key matches what
   the host passes to `loadRemoteModule`, and check the `shared` entries (versions, `singleton`,
   `strictVersion`, `requiredVersion`).
5. **Check browser storage (v4).** The orchestrator may be using a cached remote entry. Clear site
   data and reload. If the problem disappears, it was stale state. See
   nf-development `references/browser-storage.md`.
6. **Check the network tab.** Look for 404s on bundles and CORS errors, and check which origin each
   shared package was loaded from.
7. **Narrow it down to a reproduction.** If the cause is still unclear, see
   [references/repro.md](references/repro.md).

When you can drive a browser (e.g. Chrome automation tools), run steps 3–6 yourself instead of
asking the user to copy output. Otherwise, give the user the exact snippet or step to run and ask
for the result.

## Symptom → likely cause

| Symptom | Likely cause | Follow up in nf-development |
|---|---|---|
| `Failed to resolve module specifier "x"` | `x` is imported at runtime but is not in the import map: it was skipped, dropped by `ignoreUnusedDeps`, it is a secondary entry point that wasn't included, or (Angular) it is an ngtsc synthetic import | `ngtsc-synthetic-imports.md`, `optimizing-federation-config.md` |
| Remote doesn't load / 404 on `remoteEntry.json` | Wrong manifest URL, remote not deployed, CORS | `orchestrator.md` |
| Exposed module not found | The `exposedModule` key doesn't match `exposes` in the remote's config | — |
| Two instances of a framework or store (Angular injector/NG0 errors, React "Invalid hook call") | The singleton isn't shared, the versions are incompatible so a fallback copy loaded, or the package ended up in a different scope or pool | `sharing-libraries.md` |
| Version mismatch warning or error | `requiredVersion` ranges don't overlap. With `strictVersion` this throws. | `sharing-libraries.md`, `orchestrator.md` |
| Changes not visible after a deploy | Stale cached `remoteEntry.json` (orchestrator storage or HTTP cache) | `browser-storage.md` |
| Works in dev, fails in prod (or the other way round) | TODO | — |

For more error messages, see [references/error-catalogue.md](references/error-catalogue.md).

## Scripts

Paste these into the page's DevTools console, or run them through a browser-automation tool.

| Script | What it does |
|---|---|
| [scripts/dump-import-map.js](scripts/dump-import-map.js) | Prints every import map in the DOM as JSON |
| TODO: `dump-orchestrator-storage.js` | List (and optionally clear) the orchestrator's cached remote entries |
| TODO: `check-singleton.js` | Detect whether a shared package was loaded from more than one URL |
| TODO: `compare-remote-entries.js` | Fetch every remote entry from the manifest and diff the shared versions |

## References

| File | Read when… |
|---|---|
| [references/devtools-extension.md](references/devtools-extension.md) | The app is on the v4 orchestrator and the Chrome extension is available |
| [references/error-catalogue.md](references/error-catalogue.md) | The error isn't in the table above |
| [references/repro.md](references/repro.md) | The cause isn't clear after triage and you need to isolate it |
