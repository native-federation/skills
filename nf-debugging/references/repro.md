# Reproducing and isolating a failure

Live docs: [Tutorial](https://native-federation.com/docs/v4/tutorial.md) · [Orchestrator configuration](https://native-federation.com/docs/v4/orchestrator/configuration.md)

Build a reproduction when Steps 1–8 don't name a cause, when you have the repo but no access to the
user's browser, or when the bug looks like it's in Native Federation itself. Reproduce the user's
symptom first. Evidence from a setup that doesn't fail the same way proves nothing.
For what common failures look like once reproduced, see [orchestrator.md](orchestrator.md#what-common-failures-look-like).

## Serve a build

A workspace's `dist/` after `ng serve` is **not** servable. The dev server writes only the federation
artifacts there (`remoteEntry.json`, shared bundles), with no `index.html` or `main.js`. Build into a
copy so the user's workspace and `.angular/` cache stay untouched:

```bash
rsync -a --exclude node_modules --exclude dist --exclude .angular <workspace>/ <scratch>/ws/
ln -s <workspace>/node_modules <scratch>/ws/node_modules     # read-only use; never write into it
cd <scratch>/ws && npx ng build <project> --configuration development   # Angular; a development build per shell and remote
node <skill>/scripts/serve.mjs 4200:dist/host/browser 4201:dist/mfe1/browser &
```

- Serve every participant on the port its manifest URL names. Manifests are often inline in the
  shell's `main.ts`: `grep -o 'https\?://[^"]*remoteEntry.json' dist/host/browser/main.js`.
- `serve.mjs` sends CORS headers and `Cache-Control: no-store`, and falls back to `index.html` for
  routes without an extension. Kill it when you're done.
- A dev build with `sse: true` logs `EventSource's response has a MIME type ("text/html")` and
  `[NF][0]: [SSE] Connection error` on a static server. That's noise. It can also put `…:build-notifications` (`net::ERR_ABORTED`) in
  `failedRequests`.
- Set `logLevel: 'debug'` in the copy's `initFederation` options before building. Several failures
  are silent at the default level (Step 3).

## Capture

```bash
npm i --prefix <scratch>/pw playwright-core      # only if neither playwright nor playwright-core resolves
cd <scratch>/pw && node <skill>/scripts/nf-capture.mjs <url> [--wait 3000] [--profile <dir>] [--headed] > report.json
jq '.failedRequests, [.console[] | select(.type=="error" or .type=="warning")], .pageErrors, .sharedLoads.duplicates' report.json
```

`nf-capture` launches the installed Chrome (set `PW_CHANNEL=chromium` to use a Playwright browser)
and prints one JSON report:

| Field | Holds |
|---|---|
| `console[]` | Every message. For errors and warnings, `args` holds the expanded `NFError` stacks that the console's preview truncates |
| `pageErrors[]` | Uncaught errors and rejections |
| `failedRequests[]` | Network failures and status ≥ 400. An SRI block on a 200 response appears only in `console` |
| `importMaps[]` | Every DOM map, plus `importShim.getImportMap()` in shim mode |
| `runtime` | Output of `detect-runtime.js` |
| `orchestratorStorage` | Output of `dump-orchestrator-storage.js`: per namespace, the raw `values` and the `verdicts` rows |
| `classicState` | Output of `dump-classic-state.js` (classic runtime only) |
| `sharedLoads` | `bySpecifier`: each import-map specifier → the URLs actually fetched. `duplicates`: specifiers fetched from more than one URL, meaning two copies ran |

Lazy remotes load on navigation, so capture the route's URL (e.g. `/mfe3`), not just `/`.

**Stale cache:** run twice with the same `--profile`. Between the runs, change or redeploy the remote.
Without `--profile` every run is cold, which hides cache bugs. Redeploy at the **same** URL, because a
changed URL is refetched by default ([cache rules](orchestrator.md#cache-rules-step-8)). Expect
`Found remote '<name>' in storage, omitting fetch.` on the warm run.

## Bisect

1. Remove remotes from the manifest one at a time until the failure disappears. The last one
   removed is involved.
2. Edit a *copy* of that remote's served `remoteEntry.json` (a `shared` row's `version`,
   `requiredVersion` or `strictVersion`, a `pool` label, an `exposes` key) until you find the smallest
   edit that switches between working and broken. No rebuild is needed. When you rename a file, rename
   its `integrity` key too, or SRI blocks the load.
3. For a regression (version bump, v3 → v4, feature flag), build both variants and diff them as below.

## Diff two builds

Without a browser, put every participant's shared declarations side by side:

```bash
for u in <every remoteEntry.json URL>; do curl -s "$u" | jq -r '.name as $n | .shared[] |
  [.packageName, $n, .version, .requiredVersion, (if .strictVersion then "strict" else "loose" end),
   (if .singleton then "singleton" else "scoped" end), (.shareScope // "-"), (.pool // "-")] | @tsv'
done | sort | column -t
curl -s <remoteEntry.json URL> | jq -c '.exposes | map(.key)'
```

Look for a `version` outside another row's `requiredVersion` for the same package and share scope.
This finds version conflicts and expose-key typos. It can't find a missing specifier, stale storage or SRI
failures. Those need a capture.

Between a working and a broken capture:

```bash
diff <(jq -S '.importMaps' good.json) <(jq -S '.importMaps' bad.json)
diff <(jq -S '.orchestratorStorage[].values["shared-externals"]' good.json) <(jq -S '.orchestratorStorage[].values["shared-externals"]' bad.json)
diff <(curl -s <good>/remoteEntry.json | jq -S .) <(curl -s <bad>/remoteEntry.json | jq -S .)
```

## With Chrome MCP tools instead

- Call `read_console_messages` and `read_network_requests` once **before** loading the page: tracking starts on the
  first call.
- Network requests from the page load are then captured, but init-time console messages may still be missing.
  Messages logged after the tool attached are returned. If init-time lines are missing, use `nf-capture.mjs`, ask the
  user for the console (Preserve log), or re-trigger the failure from `javascript_tool`:
  `await importShim('<remote>/<key>').catch((e) => e.message)` (or `import()` in native mode) returns the same error text.
- Run a console script with `javascript_tool` (paste the file; it is one expression). Read its output with
  `read_console_messages` (pattern: a key you expect), not from the tool's return value, which may redact values such
  as bare version strings. Or return `JSON.stringify(...)` yourself.
- Cold run: `localStorage.clear(); sessionStorage.clear(); location.reload()`.

## Reporting upstream

Include:
- Exact versions of core, adapter, and orchestrator or classic runtime, and whether it's the v4-bridge
- The `nf-capture` report, or the DevTools extension's **Export JSON** (v4 only)
- Every `remoteEntry.json` and the manifest
- The shell's `initFederation` options
- The smallest edit from Bisect that switches working and broken

Report where the defect lives: Angular- or bundler-specific behaviour goes to that adapter's repo, bundler-agnostic
build output (`remoteEntry.json`, shared bundles) to native-federation-core, and runtime behaviour to the
orchestrator. v3 and the classic runtime (any version) are deprecated: don't file issues for them; advise migrating
to v4 and the orchestrator.

