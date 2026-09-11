# H2D Local Importer — v0.41.1

Offline Figma importer for `.h2d` / JSON captures.

## v0.41.1 — Auto Layout crash fix

- Fixed a real crash path in the new v0.41.0 Grid conversion: if Figma rejected a native Grid layout mid-setup, the fallback recovery code (`frame.layoutMode = "NONE"`) was itself unguarded — on some rejected/partial Grid states that fallback write could throw a second, uncaught error and abort the entire import (surfacing as "Auto Layout crashes, file doesn't import").
- The whole Grid conversion path (`gridLayoutSpec()` call, every Grid API write, and the failure-path fallback) is now wrapped defense-in-depth so a rejected grid can never escape and crash the surrounding import — it always degrades to pixel-positioned with a `CSS_GRID` warning instead.

## v0.41.0 — native 2D CSS Grid support

- **Regular CSS Grids now convert to native Figma Grid frames** (`layoutMode: "GRID"`, available in the Plugin API since mid-2025) instead of always staying pixel-positioned. Row/column tracks, gaps, and padding are detected by clustering the browser's own rendered child coordinates — not by re-parsing `grid-template-columns` syntax, which avoids re-implementing CSS Grid's placement algorithm.
- **Safety-first detection:** a grid only converts when every child lands cleanly on one detected row and one detected column with no overlap. Any child whose box swallows a neighboring track's start position (a colspan/rowspan, or genuinely irregular geometry) is treated as unrecognized and the whole container safely falls back to pixel-positioned with a `CSS_GRID` warning — the same fallback contract Auto Layout has used since v0.35.2.
- **Fixes a latent gap in the existing Auto Layout heuristic:** `autoLayoutSpec` assumes any `display: grid` container flows vertically. That happens to be correct for single-column grids but silently fails (returns null → pixel-positioned) for single-row horizontal grids and all true multi-row/column grids. Both cases are now picked up by the new grid path instead.
- **Preflight diagnostics split `Grid` into `native Grid` vs `complex Grid`** so the pre-import panel reflects what will actually convert, matching the existing safe/complex Flex split.
- **`Repair selected layer` is now defensive** against nodes whose position is computed by Auto Layout/Grid rather than stored directly — it reports a clear message instead of throwing a raw API error if a direct x/y/resize write is rejected.

## v0.40.2 icon hierarchy & naming fix

- Collapses redundant visual-neutral HTML/icon/SVG wrapper frames while preserving the outer icon bounds and vectors.
- Converts repetitive names such as `Icon / report icon → Icon → icon-flag → Vector` into `Icon / Report → Vector` when the wrappers are safe to remove.
- Semantic icon names now use accessibility labels, IDs and classes such as `report-icon`, `icon-close` and `icon-flag`.

## v0.40.1 hotfix

- Fixes completed artboards disappearing from the viewport when optional component/variant post-processing fails.
- Crash rollback now applies only while the visual render transaction is incomplete.
- Component generation errors are isolated and reported as warnings; the imported design remains intact.

## v0.40.0 reliability, fidelity & utility release

- Transactional re-import builds the replacement first and only swaps it into the selected artboard after a successful render.
- Crash/cancel rollback removes partial artboards/pages and restores the original page.
- Deterministic source IDs and per-layer browser geometry power re-import mapping, inspection and repair.
- Complete CSS background stacks preserve color, multiple gradients and embedded images in browser/Figma paint order.
- Embedded foreground and background images share one deduplicated image cache.
- Explicit CSS `z-index` uses stable paint ordering; equal values preserve DOM order.
- Absolute/fixed elements receive responsive Figma constraints from captured CSS anchors.
- Added practical Pixel Accuracy score (position/size plus fidelity warnings).
- Added **Why is this different?**, **Repair selected layer**, **Clean my import**, and **Detect design system** utilities.
- Safe cleanup removes empty frames and flattens only visually neutral, identical-bounds generic wrappers.
- Design-system scan reports colors, typography, spacing, radii, shadows and images.
- Pseudo-elements get semantic `Pseudo / Before` and `Pseudo / After` names.
- Added editable translate/scale/matrix transform coverage, with explicit diagnostics for skew/perspective fallbacks.
- Added a Node-based regression suite covering transparent gradient colors, radial fades, aspect-ratio gradient geometry, nested filter parsing, pseudo names, z-index and stable source IDs.

Run regression checks with:

```bash
node tests/regression.mjs
```

### Capability status

| Area | v0.40 status |
|---|---|
| Auto Layout | Safe flex/block/grid geometry conversion with pixel fallback diagnostics |
| Re-import / recovery | Transactional update, rollback and stable source mapping |
| SVG / typography / images | Editable SVG, font/style mapping, embedded image conversion and deduplication |
| Ordering / masks / gradients / shadows | Stable z-index, alpha masks, multi-layer paints and editable effects |
| Transforms / responsive sizing | Rotation, translate, scale, matrix approximation and CSS-anchor constraints |
| Components / variants / icon fonts | Semantic components, state variant grouping and optional glyph outlining |
| CSS Grid | Native Grid frames for regular multi-row/column layouts; spanning/irregular grids remain pixel-perfect with diagnostics |
| Pseudo-elements / filters | Semantic pseudo layers; blur/drop-shadow/blend modes native, unsupported filters reported |
| Diagnostics / tests | Warning inspector, accuracy score, layer inspector, design-system scan and regression suite |

## v0.36.0 fidelity & workflow improvements

- **Visible warning detail:** the warnings the backend already collected (font fallbacks, unsupported filters, failed images, Auto Layout fallbacks, etc.) are no longer hidden behind a bare count. A collapsible panel lists every warning code, message, and repeat count after import.
- **`mix-blend-mode` support:** captured CSS blend modes (`multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity`) now map onto the Figma node's native `blendMode`.
- **`border-style: dashed / dotted`:** frames with a dashed or dotted border now get a matching Figma `dashPattern` instead of always rendering as a solid stroke.
- **`filter: drop-shadow()` support:** drop-shadow filter functions are parsed with the same shadow geometry/color logic as `box-shadow` and added as an editable `DROP_SHADOW` effect instead of being silently dropped.
- **Fixed nested-paren filter parsing bug found during this pass:** the previous filter tokenizer used a regex (`[^)]*`) that broke on any filter value containing a nested function call, such as `drop-shadow(... rgba(0,0,0,.5))` — the color argument was truncated and silently discarded. Replaced with a paren-depth-aware tokenizer (mirrors the existing `splitCssList` technique already used for multi-shadow `box-shadow` parsing) so nested `rgb()`/`rgba()` colors inside filter functions parse correctly.
- **Resilient AVIF/WEBP asset conversion:** if a single embedded image fails to decode client-side (e.g. an older Figma build without AVIF canvas support), only that asset is skipped with a reported `IMAGE_MEDIA`/`IMAGE_BACKGROUND` warning — the whole import no longer aborts on one bad image.
- **Friendlier error messages:** decode failures (corrupt file, unsupported Figma build, invalid JSON) now show a plain-language explanation instead of a raw JS stack trace.
- **Remembered import settings:** Pixel Perfect/Auto Layout mode, style matching, component generation mode, semantic names, icon vectorization, and page organization are now persisted via `figma.clientStorage` and restored automatically next time the plugin opens — no more re-ticking the same options for every capture.
- **Warning payload cap raised** from 30 to 200 entries per import so large, noisy captures don't silently truncate the report.

## v0.35.5 stability strategy

- **Auto Layout engine restored from v0.34.0:** the Auto Layout implementation itself is intentionally unchanged from the provided v0.34.0 build, as requested, rather than layering the v0.35.x experimental Auto Layout changes on top of it.
- **Everything else stays on the v0.35.3 track:** progress/cancel, structured warnings, fractional typography, async local-style/variable APIs, SVG/image diagnostics and UI improvements remain.
- **No experimental Auto Layout crash-guard/reflow changes:** the v0.35.1–v0.35.3 deferred/conservative Auto Layout code is not used in this build.

## v0.35.3 Auto Layout safety fix

- **Root canvas stays Pixel Perfect:** the viewport/capture root is never converted to Auto Layout.
- **One-child wrappers stay Pixel Perfect:** only multi-child Flex containers are converted, avoiding wrapper collapse.
- **Wrapped Flex stays Pixel Perfect:** `flex-wrap` layouts are not guessed as one-dimensional Auto Layout.
- **Safer child stretch:** text/vector nodes are not forced into cross-axis `STRETCH`.
- **Conservative distributed spacing:** `space-around` and `space-evenly` remain geometry-based until semantic support is implemented.

## v0.35.2 stability improvements

- **Fixed Auto Layout import crash:** Auto Layout is now finalized only after the complete child subtree has been created. Partial-tree Figma layout mutations are no longer performed during child creation.
- **Safe Auto Layout fallback:** if Figma rejects a layout/sizing combination, that container falls back to normal pixel positioning and the import continues with a warning instead of aborting.
- **Deferred child sizing:** `layoutGrow`, `layoutAlign`, and absolute/fixed `layoutPositioning` are applied after the parent enters Auto Layout.
- **Stable source-to-Figma child mapping:** child layout settings use the original H2D node reference rather than matching nodes by display name.

## v0.35.0 improvements

- **Separated Pixel Perfect and Auto Layout behavior:** Pixel Perfect keeps captured browser coordinates; Auto Layout no longer re-applies absolute browser coordinates to normal flow children.
- **Preserved fractional font sizes:** browser values such as `9.5px` and `12.6px` are no longer rounded before creating Figma text, reducing wrapping and vertical drift.
- **Better text geometry tolerance:** fractional text width/height is preserved with only a small Figma-safe tolerance.
- **Import progress:** reports layer progress while rendering large captures.
- **Cancel import:** long imports can be cancelled between rendering chunks.
- **Structured warnings:** image, SVG, font fallback, local text-style, complex Auto Layout and CSS Grid limitations are reported instead of being silently hidden.
- **CSS Grid diagnostics:** Grid is explicitly reported as pixel-positioned rather than pretending it was converted to Auto Layout.
- **Distributed Flex diagnostics:** `space-between`, `space-around` and `space-evenly` are reported as geometry approximations.
- **Complex Auto Layout diagnostics:** unsupported/complex flow containers are identified as pixel-positioned fallbacks.
- **Dynamic-page compatible async Figma APIs:** retained for local styles and variables.
- **No network access:** all `.h2d` decoding and asset preparation remains local.
- **Improved UI:** versioned as v0.35.0 and includes live progress/cancel behavior.

## What remains

### P0 / architecture

- Grids with spanning cells or geometry that doesn't cluster into a clean row/column grid intentionally stay pixel-positioned rather than guessing a span.
- Complex overlapping Flex layouts intentionally fall back to Pixel Perfect geometry.
- CSS distributed alignment is approximated from captured geometry rather than represented as a fully semantic Figma layout model.
- CSS transforms beyond rotate/translate/scale/2D matrix are not fully represented as editable Figma transforms (skew/perspective/matrix3d are diagnosed and kept as captured geometry).

### P1 / fidelity

- Browser and Figma font metrics can still differ, especially with missing/custom fonts.
- `line-height: normal` remains an approximation because browser line-box metrics are font-dependent.
- Some CSS background-image combinations and advanced masks may not have a one-to-one Figma representation.
- Component generation remains heuristic and should be validated on complex nested component sets.
- Very large captures can still be expensive because Figma node creation itself is synchronous/heavy.

### P2 / product

- Preview is a lightweight geometry preview, not a full browser renderer.
- No persistent import history or retry-per-layer UI.
- No batch/multi-file import — one `.h2d` capture is decoded and configured at a time.

## Recommended usage

- **Pixel Perfect:** use for visual fidelity and browser-to-Figma comparison.
- **Auto Layout:** use for simple flex/block layouts where editability matters more than exact captured coordinates.
- **Components:** enable only when the capture contains repeated, semantically consistent UI patterns.

## Install

Figma → Plugins → Development → Import plugin from manifest → select `manifest.json`.
