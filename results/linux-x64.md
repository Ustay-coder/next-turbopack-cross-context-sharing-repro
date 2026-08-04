# Next.js canary cross-context sharing result

Decision: **PROCEED_TO_PHASE_3**

Next.js: `16.3.1-canary.0`
Next.js tag commit: `5005bd083874d366f95fd34da7a5d27837cbd5fa`
React: `19.2.8`
Node: `v22.23.2`
pnpm: `9.0.0`
Platform: `linux x64`

Primary metric: sum of level-9 gzip bytes for each JavaScript file under `.next/server`.
The 24 primary builds use the default Next.js configuration without enabling `experimental.serverSourceMaps`.
Source identity is measured in one separate Turbopack `both` diagnostic build with that option enabled.

| Bundler | Baseline | Route increment | Action increment | Both increment | Second-context cost | Duplication ratio | Max deviation | Runtime |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| turbopack | 159.85 KiB | 177.25 KiB | 178.91 KiB | 356.16 KiB | **177.25 KiB** | **1.000** | 0.0014% | pass |
| webpack | 170.34 KiB | 177.32 KiB | 177.49 KiB | 176.47 KiB | **-1.02 KiB** | **-0.006** | 0.0008% | pass |

## Gates

- PASS: turbopackSecondCopy
- PASS: webpackShares
- PASS: treatmentSourceOverlap
- PASS: overallContentByteOverlap
- PASS: stable
- PASS: runtimeVerified

## Treatment source identity

- Shared treatment paths: 2
- Source overlap: 100.00%
- Content identity: 100.00%
- Identical source-content bytes: 402313
- Overall identical source-content byte overlap: 95.63%
- Source-map parse failures: 0
