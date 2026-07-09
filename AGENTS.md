# AGENTS.md

## Cursor Cloud specific instructions

`axii` is a frontend framework **library**, not a standalone app. `npm start` launches Vite but there is no root `index.html`, so it does not serve a meaningful page — the way to "run" this repo is its test suite, and the sibling `benchmark` repo is the runnable UI that consumes it.

Services / commands (see `package.json` scripts):
- Tests run in a **real browser** via Vitest + Playwright (chromium, headless). One-shot: `npx vitest run` (the default `vitest.config.ts` always enables browser mode + coverage). `npm test` starts watch mode.
- Node-environment tests (a separate config): `npx vitest run --config vitest.node.config.ts`.
- Build: `npm run build` → emits `dist/` (bundle + `.d.ts`). The sibling `benchmark` repo imports `../axii/dist/axii.js` by default, so **rebuild after changing `src/` for the benchmark to pick up changes** (or run the benchmark with `AXII_BENCHMARK_SOURCE_AXII=true` to consume `src/` directly).

Gotchas:
- Browser tests need the Playwright chromium browser **and** its system libraries. The update script runs `npx playwright install chromium`, but the OS libraries (`--with-deps`, needs sudo) are part of the base image, not the update script.
- There is no lint script. `npx tsc --noEmit -p tsconfig.json` reports **pre-existing** errors in `__tests__/*.typespec.tsx` and a few spec files; it is not wired into `build` (which uses `vite-plugin-dts`) or CI. Rely on `npm run build` + `npx vitest run` as the quality gates.
- `data0` (the reactive core) resolves from the npm-installed package unless a sibling `../data0/src` checkout exists (see `vite.config.ts`); no sibling checkout is present here.

## Bug-fixing & review discipline

Six deep-review rounds (see `prompt/output/README.md`) showed that fatal bugs here cluster in input-shape corners and cross-layer assumptions, and that fixing only the crash site leaves siblings alive. When working on this repo:

- **Fix the class, not the instance.** When a fix invalidates an assumption (e.g. "keys starting with `on` are events", "this value is always a plain object"), grep the whole repo for every other site sharing that assumption before finishing. Keep classification predicates (like `isEventName`) defined in exactly one place.
- **Contracts before consumption.** Anything that depends on data0 *behavior* (not documented API) must be pinned by `__tests__/data0Contract.spec.tsx`. Extend it when relying on a new triggerInfo shape.
- **Fuzz list/range logic.** After touching `RxListHost`, host region semantics, or DOM anchor logic, run `npx vitest run __tests__/rxListFuzz.spec.tsx` (deterministic seeds; failures print `seed/step/op` for exact replay). Consider adding an op/shape to the fuzz instead of a one-off unit test.
- **Dev invariants over silent wrongness.** RxList rendering self-checks order/count after every patch batch when diagnostics are on (`AXII_LIST_ORDER_BROKEN`). Prefer extending runtime invariants (see `src/diagnostics.ts`) over adding ad-hoc assertions when a bug class is "silently wrong DOM".
- **Repro before fix.** Every bug fix lands with a regression test confirmed to fail on the unfixed code (the `prompt/output/` review docs index all of them).
