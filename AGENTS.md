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
- `data0` (the reactive core) resolves from the npm-installed package unless a sibling `../data0/src` checkout exists (see the alias logic in `vitest.config.ts`). In this workspace the sibling `../data0` repo **is** checked out, so the test suite compiles `data0` from `../data0/src` — no separate `data0` install is required for axii's tests. The production build (`vite.prod.config.ts`) still externalizes `data0` and pulls its bundled types from the npm-installed copy in `node_modules`.
