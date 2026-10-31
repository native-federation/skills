# Dependency pooling (orchestrator)

Live docs: [Dependency Pooling](https://native-federation.com/docs/v4/orchestrator/pooling.md). The full
internals are in [docs/version-resolver.md §Dependency Pooling](https://github.com/native-federation/orchestrator/blob/main/docs/version-resolver.md#dependency-pooling).
Source: `src/lib/core/1.domain/pooling/` and `src/lib/core/2.app/steps/pooling/`.

Pooling is orchestrator-only and opt-in through `pool` labels. The classic runtime has nothing like it.
This file describes **orchestrator ≥ 4.8**. For older versions see [Before 4.8](#before-48) at the end.

## Terms

| Term | Meaning |
|---|---|
| label | The `pool` field on one shared entry in a `remoteEntry.json`. It is pooling's input and is stored as declared |
| pool | The externals of one share scope that labels connect. Named by the most-declared label and stored as `poolName` |
| family | A pool's members seen as one unit. A remote's family is the members it ships |
| build | Everything one remote ships in the pool, as `specifier → tag`. These are the candidates in the election |
| serves | Build B serves remote R when B ships every specifier R imports, at tags R's `requiredVersion` accepts (whether or not R is strict) |
| agrees | R agrees with B when every specifier both ship is at the same tag. A specifier B doesn't ship is compared through its package's tag |
| winner | The build round 1 elects. Stored as `poolWinner` |
| global map | The pool's specifiers in `imports`. In a named share scope, the files the member scopes map |
| subpool | Remotes off the global map that run one remote's build through their scopes. Named after that remote, and recorded as `servedBy` |
| self-served / island | A remote that runs its own build for its whole family. *Island* means its range rejects a tag of the winner (`poolCause: incompatible`). Otherwise the cause is `uncovered` |

## The problem it solves

The per-package resolver picks every shared package on its own. Families are coupled more tightly than
their declared ranges say (`@angular/router@22.1.0` truly needs `@angular/core@22.1.0` but declares `^22.0.0`),
and the import map binds a file's imports **by the URL of that file**. Two failures follow:

1. **Family split.** Each member's winner is optimal on its own, but the set is one no build shipped
   (`ui@3.4.0` from mfe-b with `tokens@3.2.0` from mfe-a). Symptom: a missing export, or a wrong value from a peer's
   module state, which appears after some remote deploys a new minor.
2. **A second framework runtime through an intermediary.** The framework splits by version (mfe-a is scoped to
   `core@15`, the global map has `core@16`), while a design system at one version is shared from **mfe-a's URL**.
   Its own `import '@framework/core'` resolves in mfe-a's scope, so mfe-b runs two cores. No range is violated
   and no line is logged. Symptom: `NG0203`/injector errors, React "Invalid hook call", `instanceof` failing.

Pooling's promise: within a pool, every specifier a remote resolves, and every specifier those files import in
turn, comes from **one build that shipped them together**.

## How pools form

- A remote sets `pool: '<label>'` on a shared package in `federation.config` (core ≥ 4.3.0 passes it through
  unchanged). With dense externals there is one label per package record; flat builds label each entry point separately.
- A pool is a connected component of a graph. Every external is a node, every label is a node, and a remote that
  labels an external links the two. **A secondary entry point is always linked to its package**, so a label on
  one entry point pools the whole package (≥ 4.8). With no label anywhere, that link forms no pool.
- Remotes need not label the same members. Different labels that touch one external merge. The pool is named after
  the most-declared label (ties alphabetical).
- **One remote's label pools the family for every remote**, including remotes that never labelled
  anything and remotes loaded later through `initRemoteEntry`. Membership is read from the committed record.
- The "package" is the one the resolver serves from one build: a dense record, or a flat entry together with its
  npm name. A library declared as its own package (core 4.9 `.package(prefix)`) joins no sibling under
  the same npm name.
- Pools form per share scope. The `strict` scope is never pooled.
- A label that joins nothing is logged at `debug` (a typo or a missing sibling) and pools nothing.

The orchestrator assigns no default `pool`; the label comes only from the remote entry. Neither Angular adapter emits
one by default either: the `ng add` template only patches `includeSecondaries: { keepAll: true }`
on `@angular/*`. `share()`/`shareAll()`/`fromPackageJson().patch()` pass `pool` through on the v4-bridge and 22.x with
core ≥ 4.3.0 (bridge 21.2.7+, 22.0.5+). `pool` is part of the externals cache key (core ≥ 4.4.0).

## The election (init)

Pooling runs per share scope, after the remote entries are stored and **before** the per-package resolver,
which never sees a pooled external (init flow: fetch → store → **pool** → resolve → pick serving builds → import map → commit).
Everything is compared **by specifier**, never by external name, so flat and dense builds compare correctly.
Tags are compared for identity and for range acceptance only, never for distance.

1. **Round 1 elects the global map.** When the host ships any member, **the host's build is the only
   candidate** (its files are loaded anyway and can't be repointed). Otherwise every build is a candidate, ranked by:
   1. the newer build, but only under `profile.latestSharedExternal`;
   2. the most remotes served;
   3. the most remotes that agree without being served;
   4. the previously stored `poolWinner` (so a warm re-election on equal terms doesn't flip);
   5. the newer build, then the name.

   A candidate's coverage is **only what its own build ships**. An entry point another build ships at the same tag
   is never borrowed, because that file's imports would bind the other build's scope.
2. **Subpools.** Among the remotes round 1 doesn't serve, the remote whose own build serves the most waiting remotes
   (at least 2, itself included) forms a subpool. This repeats until no build serves two. Ties go to the newer build,
   then the name. A stored winner plays no part here.
3. **Extension.** A package the winner doesn't ship at all can still go global when every agreeing remote that would
   resolve globally ships it at one tag. A remote then moves onto the global map only if **one build shipped the
   exact combination it would resolve**. A pair from two builds (the winner's `core@18.0.1` next to another
   build's `common@18.0.1`) is never assembled. The map then *settles*: remotes that are no longer served leave the global map again.
4. **A group off the map takes nothing from it**, not even a file at its own version, because that file's
   imports would bind the global peers one hop in.
5. **Everyone left serves their own family**, gets a warning, and has `poolCause` recorded.

Rules that follow, and that you will see in evidence:
- **All or nothing per remote.** A remote runs its whole family from exactly one build.
- **The host never gives way.** A remote whose range rejects the host's tag is islanded. A remote that imports an
  entry point the host lacks (`@angular/core/rxjs-interop`) runs on a subpool's or its own runtime.
- **Coherent per remote, not per page.** A remote off the host's build runs another framework instance.
  Rendering its components inside the host's tree (shared DI) then fails with `NG0203`. That is the expected cost,
  not a pooling defect.
- **Strict.** Under `strict.strictExternalCompatibility`, init throws when a `strictVersion` range rejects a tag of the
  elected build. A coverage miss never throws.
- Round 1 is greedy. It is not a global optimum. The preference order is: on the host's runtime, then fewer duplicate
  instances, then fewer self-served copies, then fewer builds.

## How verdicts land in the record and the import map

Pooling rewrites every member of a re-elected pool as one `versions` row per `(tag, action)`. Within a tag
the order is `share`, `skip`, `scope`.

| Row | Who is in it | Import-map effect |
|---|---|---|
| `share` | The winner's copy first (`remotes[0]` is the *basis*), plus copies that resolve globally at that tag | The basis file goes in `imports` (global scope) or in each member's scope (named scope) |
| `skip` | Copies that resolve globally at another accepted tag, plus subpool copies (`servedBy: <subpool build>`) | Nothing of their own. Subpool members get the subpool build's files under their own scope |
| `scope` | Copies of a self-served remote, each with `poolCause` | That remote's own files under `scopes[<its scopeUrl>]` |

- A subpool's build carries `servedBy: <itself>` on its own copies and maps its **whole family into its own scope**.
  Without that, its `router` would bind the global `core` one hop in.
- On pooled copies, `cached: true` means "the current map serves this file". It does **not** mean HTTP-cached.
- `servingBuild` on the external is the one build every specifier of that package is served from in this scope.
  It is set for unpooled packages too.
- The host is stored as `__NF-HOST__`.

Example (orchestrator 4.9, verified): the host ships `@angular/core` 22.1.0 without `rxjs-interop`. mfe1 ships
22.1.0 *with* `rxjs-interop`. mfe2 ships 21.2.15 with a strict `~21.2.0` range. All are labelled `angular`.

```jsonc
"@angular/core": { "poolName": "angular", "poolWinner": "__NF-HOST__", "servingBuild": "__NF-HOST__",
  "versions": [
    { "tag": "22.1.0", "action": "share", "host": true,  "remotes": [{ "name": "__NF-HOST__", "pool": "angular" }] },
    { "tag": "22.1.0", "action": "scope", "host": false, "remotes": [{ "name": "mfe1", "poolCause": "uncovered" }] },
    { "tag": "21.2.15", "action": "scope", "host": false, "remotes": [{ "name": "mfe2", "poolCause": "incompatible" }] } ] }
```

So mfe1 runs its own Angular **at the same version as the host**, because the host's build lacks `rxjs-interop`.
mfe2 runs its own Angular because its range rejects 22.1.0.

## Re-election, warm pages and dissolution

- Re-election is **per scope**: if any external in a scope is dirty (a remote was added, redeployed or removed),
  every pool of that scope is re-elected. A warm init with nothing dirty does no pooling work and writes nothing,
  so the page keeps the stored verdicts. If those verdicts look wrong, test cold first (Step 8).
- A warm re-election matches a cold one, except on exact ties, which it breaks toward the stored `poolWinner`.
- When a pool **dissolves** (the remote whose label formed it redeployed without the label), its former members lose
  `poolName`, `poolWinner`, `servedBy` and `poolCause` and become dirty, and the per-package resolver takes over again.
  A `debug` line says `N external(s) left every pool; cleared their pool state for re-election.`

## Dynamic init (`initRemoteEntry`)

The committed import map is immutable, so a load **holds no election**. It judges only the newly loaded remote
against the committed record, and committed remotes keep exactly what they have.

1. Before pooling, `update-cache` takes each package the remote shares **whole**. If the map serves none of it,
   the remote opens it (`share`). If the map serves everything the remote ships from one build at a tag no strict range
   rejects, the remote follows that build (`skip`). Otherwise the remote runs the whole package from its own build (`scope`).
2. The pooling **gate**, per pool: the remote resolves through the committed global map only when no range rejects a
   map tag, and either it agrees with the map, or the map serves everything it imports in a combination one committed
   build shipped. Every file it would reach must also resolve each specifier to the same file it would use itself. Otherwise
   it serves its own family. It **never joins a committed subpool**.
3. A load can put a second copy of one version on the page (filling a free `imports` key at a tag another remote
   runs scoped). This is accepted: pooling guarantees no tear, not one instance per version.
4. **The next init re-elects** with the remote included, because the load marks its pooled members dirty. Under
   `strictExternalCompatibility` nothing is marked, and the next page keeps the gate's verdicts.

So **the first page after a lazy load and the next full page can differ**. To reproduce a dynamic-init report,
replay the same navigation, and don't just reload.

## What it costs

Coherence first, then downloads. Expected by design:
- A remote that would mix builds downloads its own family (more files, more `scopes`).
- A remote off the host's build runs a second framework instance. That is fine standalone and fails with `NG0203` when it is composed into the host's tree.
- The global version of a pooled family can move to an **older** build that serves more remotes (new in 4.8).
- The opposite also happens: where per-package resolution split a family, pooling can save files (one portfolio
  measured `@angular/*` drop from 75 to 63).

The fixes are build-side, which is the nf-development skill's job. The usual ones: align versions and ranges with the host,
ship the gap entry point in the elected build (or stop importing it), label the whole family, or drop the label.
There is no per-portfolio knob.

## What it stores

Read it with [scripts/dump-orchestrator-storage.js](../scripts/dump-orchestrator-storage.js): its `verdicts` rows carry every field below.

| On | Field | Meaning |
|---|---|---|
| external | `poolName` | The pool this external resolves in |
| external | `poolWinner` | Round 1's build. Also used as the tie-breaker on the next election |
| external | `servingBuild` | The single build serving every specifier of the package in this scope |
| copy | `pool` | The label this remote declared, never rewritten |
| copy | `servedBy` | The subpool build this copy runs. Set to the remote itself on the subpool build's own copies |
| copy | `poolCause` | `incompatible` (a range rejects a winner tag) or `uncovered` (the winner doesn't serve every specifier it imports) |

`poolCause` is the only thing that tells a range-violation `scope` apart from a coverage `scope`. The gap and the
closest build are **only in the warn line**. Read islands from the record, never from the log text.

## Log lines

Pooling logs in phases `[NF][3]` (init), `[NF][8]` (dynamic init) and `[NF][4]` (import map). **They are hidden at the
default level `error`** ([turn on logging](orchestrator.md#turn-on-logging-step-3)). Init lines about one pool are prefixed
`[NF][3]: [<scope>][pool:<name>]`. Dynamic lines are prefixed `[NF][8]: [<scope>]`.

Every init warning ends with where the copies now come from: `All N of its entrypoints are scoped for it.`
(self-served), `It runs in subpool '<b>' for all N of its entrypoints.`, or
`Its build serves subpool '<self>': its N entrypoints and K other remote(s).`

| Level | Line | Meaning, and the next check |
|---|---|---|
| warn 3 | `'<r>' is islanded: its range rejects '<member>@<tag>' of the elected build '<winner>'.` | A real version conflict. Compare `<r>`'s `requiredVersion` with `<tag>` in both remote entries |
| warn 3 | `'<r>' serves its own family: no elected build offers every entrypoint it imports at a version it accepts (gap '<gap>', closest '<winner>').` | Coverage. Is `<gap>` missing from `<winner>`'s `remoteEntry.json`? Usually yes (the host lacks `rxjs-interop`, `animations/async`, …) |
| warn 3 | `'<r>' serves its own family: no build shipped its entrypoints together at the elected versions (gap …)` | Witness. Every tag is acceptable, but no single build has this combination |
| warn 3 | `'<b>' keeps subpool '<b>': the elected build would serve it, but K other remote(s) in it need its build.` | Nothing to fix on `<b>`. Align the other subpool members |
| warn 8 | `… is islanded: its range rejects '<spec>@<tag>' of the committed map.` / `no committed build offers …` / `no committed build shipped the map's combination for it.` | The same findings for a late remote, judged against the committed map |
| warn 8 | `'<r>' serves its own family: committed build '<b>', whose files it would reach, resolves '<spec>' to another file than it would.` | Ship `<spec>` in `<r>` at the map's tag, or stop importing it |
| warn 8 | `[<scope>][<r>] '<b>' is not in the cache, so its files cannot be mapped.` | Named scope only. The build the map uses is gone from the cache, so `<r>` serves itself |
| warn 4 | `[<scope>][<pkg>][<consumer>] '<servedBy>' does not serve '<spec>'.` | A stale or inconsistent `servedBy` in the record. Test cold. If it persists cold, suspect a defect: make a repro |
| error 3 | `version-incompatible remotes cannot be pooled: {…}.` → `Could not pool '<pool>' in scope <scope>.` | `strictExternalCompatibility` refused an island. Init rejects |
| error 3 | `[<scope>] failed to pool shared externals.` → `Could not pool shared externals in scope <scope>.` | Unexpected: suspect a defect. Make a repro and check the orchestrator's issue tracker |
| debug 3 | `re-electing N pool(s): K dirty external(s).` | An election ran. If it is absent on a warm page, the verdicts are the stored ones |
| debug 3 | `'<external>' has a 'pool' label that joins no other external; …` | Typo or missing sibling. No pool formed |
| debug 3 | `N external(s) left every pool; cleared their pool state for re-election.` | A pool dissolved |

## Failure modes

**Is pooling active?** It is if any of these holds: a `pool` field in any participant's `remoteEntry.json` (Step 7), `poolName` in
`shared-externals` (Step 6), or `[pool:` in a warn-level console.

**Without labels nothing pools, and nothing is logged.** A remote then still gets a **scoped copy** in the cases listed under
[Scoped copy](orchestrator.md#scoped-copy-a-framework-or-library-runs-twice-no-warning), and a cold init logs none of them. In the same 4.9
setup without labels, mfe2 (strict range) and mfe1 (coverage) were both scoped to their own Angular with **no log
line at any level**. So "no pooling warnings" means "no labels", not "no problem". Read the `scope` rows instead.
With labels, pooling is one of the four reasons for a scoped copy, and the only one that records `poolCause` and warns.

Then classify the failing remote from its copies of the family:

| Evidence on the failing remote's copies | Means | Points to |
|---|---|---|
| `share`/`skip`, no `servedBy`, same build as the host | On the host's runtime. Pooling isn't the cause | Look elsewhere (app code, an unpooled package) |
| `servedBy: <b>` | Runs subpool `<b>`'s framework instance | Composed into the host tree? Then `NG0203` is the expected cost. Align with the host |
| `poolCause: incompatible` | Islanded by its own range | A version or range conflict. Find the matching warn line for the member and tag |
| `poolCause: uncovered` | The winner lacks an entry point this remote imports | The warn line's `gap`. Ship it in the winner, usually the host |
| `scope`, no `poolCause`, family unlabelled | Scoped copy decided per package (strict range or coverage), unpooled | Two cores possible (own `core` + shared `common`). **Pooling should be involved**: labels are missing |
| Members of one family resolve to files under different remotes' URLs for one remote, and no `servedBy` explains it | A tear the promise forbids | **Suspected defect**: cold test, then repro with 2–3 remotes ([repro.md](repro.md)) |

To confirm a duplicate instance by hand: take the failing file's URL, resolve its import of the family root
through the import map (most specific scope first, then `imports`), and compare with what the host's file resolves to.
Two URLs means two instances.

## Before 4.8

Enough to explain an older setup. The fix for every case below is to upgrade to ≥ 4.8, and then
expect one cold init, because 4.8 stamps the cache with the orchestrator version (`cache-state`) and clears it once.

| Version | Model | Why an older setup misbehaves |
|---|---|---|
| 4.5–4.6 | First pooling. Pools formed from `pool` labels **or automatically by npm scope** (opt-in `feature.useAutoExternalPooling`, default `false`). The resolver picked each member's version, then pooling reconciled the result onto an "anchor" remote | Because members were elected one by one and repaired afterwards, a family could still reach a remote from more than one build. Expect pooling verdicts that differ from the 4.8 election described above |
| 4.7.0 | **Breaking:** auto-pooling removed, so only explicit labels pool. Stores `poolName` and `poolCause` (`incompatible`/`uncovered`/`torn`/`unshared`). Pool names in logs changed (`[pool:@angular/core]` → `[pool:angular]`) | A setup that relied on `useAutoExternalPooling` silently **stops pooling** after upgrading to 4.7. Members are still resolved one by one, and a package's entry points can be served from two builds at one tag, so `NG0203` appears only once a borrowed entry point such as `rxjs-interop`/`toSignal()` runs |
| ≥ 4.8.0 | Current: each pool is elected as one family, there is one build per package (no stitching), and `poolWinner`, `servedBy` (as now) and `servingBuild` are stored. `poolCause` is reduced to two values, warnings were reworded, and `strictEntryPointCoverage`/`scopeUncoveredEntrypoints` became no-ops | After upgrading: a global version may move to an older build, more downloads and `scopes` appear, and remotes that never labelled anything get pooling warnings (one label pools the whole package) |

// TODO: are any production portfolios still on 4.5–4.7 with pooling? If not, shrink this section to the first column.
