# axii site

The official axii website — documentation and runnable examples, rendered with
axii itself. This is a self-contained sub-project inside the axii repository.

## dev / build / preview

```bash
# from the site/ directory
npm install            # install site dependencies (vite, shiki, playwright, data0)
npm run dev            # start the Vite dev server (http://localhost:5173)
npm run build          # production build → site/dist/
npm run preview        # preview the production build (http://localhost:4173)
npm run check          # run the full machine-checkable gate suite (see below)
```

The site consumes the library source directly during development via a Vite
alias (`axii` → `../src/index.ts`), so changes to `src/` are reflected
immediately — no rebuild of the library `dist/` is needed.

## Directory structure

```
site/
├── index.html                 # SPA entry (empty #root, loads main.tsx)
├── package.json               # site-only dependencies (data0, shiki, vite, playwright)
├── tsconfig.json              # site-only TypeScript config (does not touch library tsconfig)
├── vite.config.ts             # Vite config: axii alias, data0 alias, __DEV__ define, shiki plugin
├── vite-shiki-plugin.ts       # build-time Shiki tokenize plugin (?shiki import suffix)
├── src/
│   ├── main.tsx               # SPA bootstrap: createRoot().render(<App/>)
│   ├── router.tsx             # self-built lightweight history-API router (DR-03)
│   ├── version.ts             # site version (from ../package.json)
│   ├── theme/
│   │   ├── tokens.css         # design tokens (colors, fonts, spacing, radii, shadow)
│   │   └── global.css         # global styles + component styles
│   ├── components/
│   │   ├── Layout.tsx         # page shell (TopNav + main + footer)
│   │   ├── TopNav.tsx         # minimal top navigation
│   │   ├── Button.tsx         # primary/secondary button
│   │   ├── FeatureCard.tsx    # homepage feature card
│   │   ├── CodeBlock.tsx      # terminal-style code block with copy button
│   │   ├── Example.tsx        # <Example> — code + live demo from the same file
│   │   └── DocSection.tsx     # docs section helper
│   ├── pages/
│   │   ├── HomePage.tsx       # Hero + feature cards + CTA
│   │   ├── DocsPage.tsx       # three-column docs (sidebar + content + TOC)
│   │   └── ExamplesPage.tsx   # examples index (renders all <Example> entries)
│   ├── docs/
│   │   ├── docSections.ts     # docs content registry (concepts → snippets)
│   │   └── snippets/          # one .ts per documented concept (imported ?raw + ?shiki)
│   └── examples/
│       ├── registry.ts        # examples registry (id → raw + highlighted + render)
│       └── *.tsx              # one example per file, each exports render(container): () => void
├── scripts/                   # machine-checkable gate scripts (see below)
└── dist/                      # build output (gitignored)
```

## How to add a new docs page / concept

1. Create a snippet file under `src/docs/snippets/<concept>.ts` (or `.tsx`).
   This file is pure illustrative code — it does not need to run.
2. Register it in `src/docs/docSections.ts`: add an entry to the appropriate
   `DocGroup` with `raw` and `html` imported via the `?raw` and `?shiki`
   suffixes from the same snippet file:
   ```ts
   import myRaw from './snippets/my-concept.ts?raw'
   import myHtml from './snippets/my-concept.ts?shiki'
   ```
3. The docs page picks it up automatically from the registry.

## How to add a new example

1. Create `src/examples/MyExample.tsx`. It must export a `render(container)`
   function that creates an axii `createRoot(container)`, renders an `App`
   into it, and **returns a destroy handle**. `<Example>` calls the handle when
   the example is unmounted (e.g. on route change) so the inner reactive graph
   and DOM are torn down — axii roots are not garbage-collected, so the handle
   is mandatory:
   ```tsx
   /** @jsx createElement */
   import { createElement, createRoot } from 'axii'
   import { atom } from 'data0'

   export function render(container: HTMLElement): () => void {
     const value = atom('hello')
     function App() {
       return <div>{value}</div>
     }
     const root = createRoot(container)
     root.render(<App />)
     return () => root.destroy()
   }
   ```
2. Register it in `src/examples/registry.ts` — import the same file three ways
   (`?raw`, `?shiki`, and normal import for `render`), then add an `ExampleEntry`:
   ```ts
   import myRaw from './MyExample.tsx?raw'
   import myHtml from './MyExample.tsx?shiki'
   import { render as myRender } from './MyExample.tsx'
   // ...add to the examples array
   ```
   The three imports resolve to the same physical file, so the displayed code
   cannot drift from the running instance (C-19).
3. The examples index page renders it automatically. The machine-checkable
   coverage gate (`check-examples-coverage.mjs`) reads example IDs from the
   registry.

## Relationship to the library `src/`

The site is a **consumer** of the library, not part of it:

- `site/vite.config.ts` aliases `axii` → `../src/index.ts`, so the site always
  reflects the current library source during development.
- `data0` (the reactive core, a peerDependency of axii) is resolved the same
  way the library's `vitest.config.ts` resolves it: a sibling `../../data0/src`
  checkout takes precedence when present, otherwise the npm-installed `data0`
  is used. `AXII_DATA0_FORCE_NPM=1` forces the npm branch (used only by the
  `check-data0-fallback.mjs` gate script).
- The site has its **own** `tsconfig.json` and `package.json`. The library's
  `tsconfig.json` `include` does not cover `site/`, so the site never affects
  the library's `tsc` or `vite-plugin-dts` build.
- The site's build output (`site/dist/`) is completely separate from the
  library's `dist/`. Nothing the site does touches the library build.

## Machine-checkable gates

The `scripts/` directory contains gate scripts that verify the site meets its
design constraints. Run them all with `npm run check` (which calls
`check-all.mjs`). Individual scripts:

| Script | Gate | What it checks |
|---|---|---|
| `check-preview.mjs` | D-02 | preview server starts, #root has real rendered children (no runtime crash) |
| `check-examples.mjs` | D-09 | each example page has a code block AND a non-empty live demo root |
| `check-exports.mjs` | D-12, D-14 | doc/example symbols match `src/index.ts` exports; unexported symbols are annotated |
| `check-antipatterns.mjs` | D-15 | no anti-patterns in example source (dynamic handler swap, etc.) |
| `check-structure.mjs` | D-08, D-11 | page structure (TopNav, Hero, feature cards) |
| `check-routes.mjs` | D-10 | history router navigates to /, /docs, /examples |
| `check-doc-coverage.mjs` | D-23 | all C-27 concepts are covered in the docs |
| `check-examples-coverage.mjs` | D-24 | all C-31 example categories exist and pass D-09 |
| `check-cleanup.mjs` | D-25 | example live roots (incl. Portal's body portal) are destroyed on navigation away |
| `check-data0-fallback.mjs` | D-21 | npm data0 fallback branch resolves (no sibling needed) |
| `check-dev-flag.mjs` | D-22 | production bundle has no `debugger` / dev diagnostic strings |
| `mutation-check.mjs` | D-13 | each example's source, when mutated, produces an observable failure |
| `check-all.mjs` | D-20 | runs all of the above (except D-13/D-21/D-22, which are run separately) |
