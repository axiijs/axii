# SSR design experiments (2026-08-06)

## Node
- No document/Comment/HTMLElement/CSSStyleSheet in stock Node.
- Import-only Node safety already covered by vitest.node.config.ts (6 tests pass at baseline).

## Adjudication d1 (`adjudication-d1-facts.json`)
- Duck `{ id }` is not `HTMLElement`.
- Adjacent Text nodes merge on HTML round-trip; comment wrappers preserve separate texts.
- `textarea.value` property → empty outerHTML; parse value comes from **children**, not `value` attr.
- `select.value` / `option.selected` IDL → no `selected` attr in outerHTML; parse needs `selected="true"`.
- Radio/checkbox `checked` property-only → no attr in outerHTML.

## Adjudication d2 (`adjudication-d2-facts.json`)
- After claim, removing boundary comments keeps adjacent Texts separate (no live merge).
- Removing only Texts leaves orphan boundary comments.
- Keeping boundaries + moving Text-only ranges (RxList ownership) mis-pairs markers.
- `Text + Comment + Text` HTML round-trip keeps texts separate (list-shaped separators).
- Design closes marker renamed to `axii:/t` (experiment used `/`); lifecycle conclusions unchanged.

## Browser (Playwright Chromium)
- Comments preserved; comments split adjacent text nodes (Solid-style markers viable).
- Whitespace in text nodes preserved inside elements.
- HTML parser inserts implicit TBODY; createElement(append tr to table) does NOT.
- Comments as direct table children can be moved into TBODY on parse (marker placement fragile).
- Comments inside explicit TBODY are preserved in order with TR.
- p>div and table>div get repaired (structure changes).
- createElement tree vs identical innerHTML parse: equal for comment+text+span shape.
- disabled="true" | "" | presence → all .disabled===true; attr string differs ("true" vs "").
- adoptedStyleSheets vs <style> computed style equivalent; keep both during migrate → no computed flash.
- Form IDL table: input `value` attr; textarea **child text**; option `selected`; checkbox/radio `checked` — see design §3.6.2.
- SVG a / foreignObject namespaces correct when xmlns present.

## data0 (npm peer)
- computed evaluates eagerly on create; destroy API not on computed return in this check (cleanup via ManualCleanup / effect paths in framework).
- No data0 internal change required for SSR design based on this sampling; pin any new assumptions in contract tests during implementation.

## Review d3 (`review-d3-empty-text-facts.json`, `review-d3-rcdata-facts.json`)
- Empty Text (`''`, including CSR atom null/undefined/boolean→`''`) does **not** survive HTML round-trip; `<!--axii:t--><!--axii:/t-->` parses to two Comments with **no** Text between — breaks design §3.2.1 B1 (pre-d3).
- Empty Text before a CSR list Comment also disappears from `innerHTML`.
- Inside `textarea` / `style` (RCDATA/RAWTEXT), `<!--axii:t-->…<!--axii:/t-->` is literal character data, not Comment nodes.

## Adjudication d3 (`adjudication-d3-facts.json`)
- Confirms empty open/close has no Text; adopts `<!--axii:0-->` sentinel: round-trips as one Comment; hydrate inserts `Text('')`, removes sentinel; two sentinels → two updatable Texts; empty+list Comment shape OK; destroy leaves no orphans; mixed non-empty wraps + sentinel hydrates cleanly.
- `textarea`/`style`: both `axii:t` and `axii:0` become character data; empty `<textarea></textarea>` has 0 children / value `''`; child-text path for value remains correct.
- Omitting a marker for empty NORMAL text leaves no claim slot.
- Non-empty `axii:t` claim+remove path still holds (regression check).

## Review d4 (`review-d4-facts.json`)
- Comment-placeholder empty text (list-row CSR): empty Text drops from `innerHTML`; structure Comment alone remains.
- Hydrate E4 as Text-only (ignore structure Comment) + Text-only reorder → comments mis-paired; claiming Text+structure Comment and moving that range stays paired.
- RAWTEXT: literal `</style>` / `</script>` closes early; `&lt;/…>` avoids close but entities are **not** decoded in RAWTEXT. RCDATA textarea still decodes entities.
- StaticArrayHost-like adjacent raw strings merge on HTML round-trip.

## Adjudication d4 (`adjudication-d4-facts.json`)
- Confirms Comment-ph empty: CSR `innerHTML` is structure Comments only; wrong Text-only reorder mis-pairs; correct `element…placeholder` reorder keeps pairs.
- Omitting `axii:0` for Comment-ph empty (SSR = structure Comment only) + insert Text on hydrate + range move stays paired — adopted as contract (no `axii:0` on Comment-ph empty).
- Non-empty Comment-ph `Text+Comment` HTML round-trips.
- RAWTEXT terminator / entity facts reconfirmed; `</STYLE>` (case-insensitive) also closes.
- RCDATA textarea entity decode reconfirmed.

## Review d5 (`review-d5-facts.json`)
- StaticArrayHost `['hello','world']`: CSR two Texts + `unhandledChild`; `innerHTML` merges to one Text; A2 `axii:t` wrap + strip restores two Texts + structure Comment — claim target is `directNodes`, not AtomHost.
- Style breakout: `insertRule` rejects `width:100px} body{…}`; same string in `<style>` yields 2 cssRules and affects `body` outline — SSR style text channel ≠ CSR insertRule safety.
- RxList string rows: Comment-ph `Text`+`rx list item` (+ list tail `unhandledChild`); HTML round-trip preserves separators.

## Adjudication d5 (`adjudication-d5-facts.json`)
- Reconfirms adjacent DirectNodes merge/strip; empty DirectNodes (`['']`, `['','world']`) drop empty Text from HTML — requires `axii:0` (not Comment-ph F14).
- Style gate: omit rules rejected by `insertRule` before writing `<style>` → no `body` injection; quoted `content:"a}b"` still accepted by insertRule.
- Design: §3.2.1 DirectNodes complete subtable + §3.6.1 CSS rule-escape gate (omit parity with CSR skip).

## Review d6 (`review-d6-facts.json`)
- `createElement` multi-child static strings are element `childNodes` only: no Host, no `directNodes`, `unhandledCount===0`.
- Adjacent static texts merge on HTML round-trip; A2 wrap + strip restores separate Texts still owned by the element.
- Empty static among siblings drops from `innerHTML` (needs `axii:0`) but is not Comment-ph / Text-ph / DirectNodes; single-child `''` via `textContent` fast path → 0 child nodes.
- Path contrast: `['hello','world']` args vs `[['hello','world']]` array child (StaticArrayHost) vs `static-` + function (Text-ph) are distinct.

## Adjudication d6 (`adjudication-d6-facts.json`)
- Confirms ElementChildText adjacent merge/strip; empty sibling needs `axii:0`; single empty `textContent` → 0 nodes / no sentinel.
- M-01 `static-`+atom: after strip, AtomHost.destroy leaves static Text on element (static half is not a Host).
- DirectNodes contrast retains trailing `unhandledChild`.
- Design: §3.2.1 four-kind exhaustive set (Text-ph / Comment-ph / DirectNodes / ElementChildText); A1e / BE / EE; M-01/M-02 wording.

## Review d7 (`review-d7-compact-facts.json`)
- RxList element rows use CompactElementHost: CSR shape has **no** per-row `rx list item`; atom rows keep Comment-ph; function-returning-element rows are non-Compact (`computed node` + `rx list item`).
- Emitting `rx list item` for Compact rows yields a parse tree that does not match CSR.

## Adjudication d7 (`adjudication-d7-facts.json`)
- Reconfirms Compact vs Comment-ph / Function / Fragment shapes; Compact reorder still has zero row `rx list item`.
- `detachStyledChildren` on an HTMLElement forces non-Compact for that row only (mixed list → exactly one `rx list item`).
- Wrong SSR emitting per-row comments: `compactEqualsWrong: false`.
- Design: §3.2.3 complete finite RxList row-host contract (G1–G4 + Compact hydrate); M-03 Compact acceptance.

## Review d8 (`review-d8-checkbox-facts.json`)
- Checkbox `value={true}` CSR outerHTML includes both `value="true"` and `checked="true"`; `.value==='true'`.
- Design pre-d8 “same as checked row” HTML (`checked="true"` only) parses to `.value==='on'` — IDL mismatch.
- Emitting both attributes matches CSR IDL; falsy/`0`/`''`/`null` matrix keeps value attr without checked.

## Adjudication d8 (`adjudication-d8-facts.json`)
- Reconfirms mismatch vs dual-channel match; full CB scalar matrix; CK-only leaves default `.value==='on'` and no value attr.
- Deferred `value`+`checked` order: later prop wins for `.checked`; value attr always present when value prop exists.
- Radio `value={true}` does **not** set checked (checkbox-only branch).
- Design: §3.6.2 rewritten as complete finite form-IDL contract (IV/CK/CB/TA/SO); M-02 CB assertions.

## Review d9 (`review-d9-functionhost-textph-structure-facts.json`)
- FunctionHost + Text placeholder structure path: CSR `[span, computed node, Text('')]`; `innerHTML` drops trailing empty Text.
- Emitting `<!--axii:0-->` after `computed node` + hydrate insert Text matches CSR; omitting sentinel loses placeholder slot.
- Comment-ph structure (`computed` + `rx list item`) round-trips — cannot substitute for Text-ph structure.

## Adjudication d9 (`adjudication-d9-facts.json`)
- Reconfirms Text-ph structure loss / hydrate-with-sentinel / omit failure; Fragment path same trailing-empty loss.
- Destroy after hydrate leaves no orphans; structure→text reuses inserted Text as placeholder.
- Design: §3.2.4 FTS complete finite contract; emit-site table + M-02 FTS acceptance.

## Review d10 (`review-d10-root-placeholder-facts.json`)
- Root function structure `computed`+`root` round-trips; FTS loses trailing empty Text.
- Omitting `<!--root-->` ≠ CSR; wrong FTS on root yields trailing Text ≠ CSR.
- StaticArray function item uses `array item`; emitting `rx list item` mismatches CSR.

## Adjudication d10 (`adjudication-d10-facts.json`)
- Independent Chromium reconfirm of review-d10; nested `computed` as placeholder preserved; root empty text loses Text.
- Design: §3.2.5 FCS + Root scheme A; abolish H4⇒G3 universal; M-01/M-02 root & non-RxList FCS acceptance.

## Review d11 (`review-d11-emptyhost-facts.json`)
- Real `createRoot` shapes: `render(null)` / Component→null → `<!--empty--><!--root-->` (EmptyHost.element); `() => null` is FunctionHost text path (not EmptyHost).
- RxList `[null,null]` → `<!--empty--><!--rx list item-->` pairs; A1c-only or FCS-`computed` SSR both ≠ CSR; correct empty+placeholder matches.
- Component / Fragment list rows have **no** `computed node` — G3≠ wholesale FCS.
- Atom empty list row (A1c) ≠ null EmptyHost row.

## Adjudication d11 (`adjudication-d11-facts.json`)
- Independent Vitest browser reconfirm of review-d11; adds Function-structure list row **has** `computed node` (G3-F only).
- Design: abolish G3=wholesale FCS; G3-F/C/Fr/A/E finite subtable; §3.2.6 EmptyHost complete contract; fix F24 (`empty` not FunctionHost placeholder); M-01/M-03/M-05 EmptyHost coverage.

## Review d12 (`review-d12-facts.json`)
- Function→null as RxList item: `#text:""` + `<!--rx list item-->`; HTML only structure Comments; **no** `empty`, **no** `computed` — Comment-ph A1c, not EmptyHost/FCS.
- Fragment adjacent ElementChildText merge / A2 strip; `false` vs `null` child; option preserves `axii:*` Comments (implementation notes).

## Adjudication d12 (`adjudication-d12-facts.json`)
- Independent Chromium reconfirm: Function→null/false/string list rows are Comment-ph; wrong G3-E / FCS HTML `equalCsr===false`; A1c HTML matches CSR for Function→null.
- Design: §3.2.3 **G4-F** finite row (Function text snapshot → Comment-ph); Function must evaluate snapshot before G3-F vs G4-F; M-03 G4-F acceptance.

## Peer frameworks (background only)
- Solid: comment + data-hk markers; hydrate reuses server DOM; mismatch when JSX produces nodes not inserted.
- Svelte 5: comment anchors; mismatch falls back to recreate (flicker); invalid HTML nesting → mismatch.
