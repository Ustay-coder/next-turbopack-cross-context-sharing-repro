# Turbopack cross-context server sharing reproduction

This repository isolates a Next.js production-build output difference between Turbopack and Webpack.

The same context-neutral ESM/JSON graph is imported by:

- one App Router Route Handler (`app-route`), and
- one Server Action in an RSC entry (`app-rsc`).

The four factorial cells keep the same page, Route Handler, Server Action, and lightweight baseline. Only the heavy static import is enabled or disabled in each context.

No OpenNext adapter, Cloudflare tooling, auth library, database, environment variable, credential, or network request is involved in the build.

## Current canary result

The primary result was measured on a GitHub-hosted Ubuntu 24.04 x64 runner on 2026-08-04 with:

- Next.js `16.3.1-canary.0`
- upstream tag commit `5005bd083874d366f95fd34da7a5d27837cbd5fa`
- React / React DOM `19.2.8`
- Node `22.23.2`
- pnpm `9.0.0`
- Ubuntu 24.04 x64

Primary metric: the sum of level-9 gzip bytes for every JavaScript file under `.next/server`. Values are three-run means.

| Bundler | Baseline | Route increment | Action increment | Both increment | Second-context cost | Duplication ratio | Max deviation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Turbopack | 163,685 B | 181,505 B | 183,202 B | 364,706 B | **181,504 B** | **0.999994** | 0.0014% |
| Webpack | 174,426 B | 181,574 B | 181,745 B | 180,702 B | **-1,043 B** | **-0.005744** | 0.0008% |

The negative Webpack value is small build/compression variation around zero. Turbopack's `both` output contains the sentinel in two emitted files; Webpack contains it in one.

The same matrix was also measured on macOS arm64. Turbopack's second-context cost was exactly `181,504 B` on both platforms, with duplication ratios of `0.999994` on Linux and `1.000028` on macOS. Webpack remained near zero at `-1,043 B` on Linux and `-1,033 B` on macOS.

The 24 primary builds use the default Next.js configuration without enabling `experimental.serverSourceMaps`. Source identity is collected in one separate Turbopack `both` diagnostic build with that option enabled, so the diagnostic option does not affect the primary size matrix.

Source-map evidence from that diagnostic build:

- treatment paths shared across server and SSR contexts: `2/2`
- treatment source-path overlap: `100%`
- shared treatment content identity: `100%`
- identical treatment source-content bytes: `402,313`
- overall identical source-content byte overlap: `95.63%`
- source-map parse failures: `0`

Both the Route Handler and Server Action were executed successfully after production builds with each bundler.

Full platform results are in:

- [`results/linux-x64.md`](results/linux-x64.md) and [`results/linux-x64.json`](results/linux-x64.json)
- [`results/darwin-arm64.md`](results/darwin-arm64.md) and [`results/darwin-arm64.json`](results/darwin-arm64.json)

The `results/canary.*` files point to the primary Linux result committed in this repository.

## Reproduce

Use Node 22.23.2, then run:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm repro
```

`pnpm repro` performs 24 clean primary builds: four context cells, two bundlers, and three counterbalanced runs. It then performs one separate source-identity diagnostic build. It writes path-independent summaries to `results/canary.*` and a platform-specific `results/<platform>-<arch>.*` pair.

For a quick one-run signal:

```bash
pnpm repro:pilot
```

To build the `both` cell with each bundler and execute both runtime paths:

```bash
pnpm verify
```

## Factorial calculation

For a measured size `M`:

```text
routeIncrement    = M(route-only)  - M(neither)
actionIncrement   = M(action-only) - M(neither)
bothIncrement     = M(both)        - M(neither)
secondContextCost = M(both) - max(M(route-only), M(action-only))
duplicationRatio  = secondContextCost / min(routeIncrement, actionIncrement)
```

A ratio near zero means the second consumer mostly shares the graph. A ratio near one means adding the second compilation context retains nearly another complete copy.

## Interpretation boundary

The reproduction does not argue that the `app-route` and `app-rsc` compilation contexts should be merged. Their separation may be intentional and semantically required.

It shows that, for this context-neutral graph, Turbopack emits nearly one additional copy while Webpack shares the graph under the same application topology. Whether this is classified as a bug, a known limitation, or an accepted tradeoff remains an upstream maintainer decision.

## Relevant files

- `scripts/generate-cell.mjs`: creates the four static-import cells.
- `scripts/run-matrix.mjs`: clean build order, evidence capture, and decision gates.
- `scripts/analyze-output.mjs`: `.next/server` size, sentinel, and source-map analysis.
- `scripts/verify-bundlers.mjs`: production runtime verification for both bundlers.
- `lib/pure-heavy.ts`: pure treatment entry.
- `data/seed.json`: deterministic public payload specification.
