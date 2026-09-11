# H2D Local Importer v0.40 — implementation audit

## Core import checklist

| # | Area | Status | Implementation |
|---|---|---|---|
| 1 | Auto Layout | Improved | Safe geometry inference, fixed/hug rules, absolute-child preservation and fallback diagnostics |
| 2 | Re-import mapping | Improved | Stable source IDs, per-layer geometry and transactional Update selected |
| 3 | Crash recovery | Added | Partial nodes/pages roll back on error or cancel |
| 4 | SVG fidelity | Supported | Editable `createNodeFromSvg`, source mapping and per-layer warnings |
| 5 | Typography fidelity | Supported | Font mapping, fractional metrics, local styles and variable-backed styles |
| 6 | Large-file performance | Improved | Chunked yielding, progress/cancel and image deduplication |
| 7 | Image handling | Improved | Embedded media conversion, complete background stacks and cached images |
| 8 | Layer/z-index ordering | Added | Stable explicit-z sorting with DOM-order tie breaking |
| 9 | Masks | Supported | Editable alpha-mask groups for captured mask gradients |
| 10 | Gradients | Improved | Multi-layer order, aspect-aware transforms and transparent-stop normalization |
| 11 | Shadows | Supported | Multiple inset/drop shadows, spread and isolated translucent glow shapes |
| 12 | Transforms | Improved | Rotate, translate, scale and 2D matrix; skew/perspective diagnosed as fallback |
| 13 | Responsive sizing | Added | CSS anchor detection creates Figma constraints |
| 14 | Component detection | Supported | Repeated and complete design-system modes |
| 15 | Component variants | Supported | State-name grouping and `combineAsVariants` when compatible |
| 16 | Icon fonts | Supported | Font fallback plus optional vector outlining |
| 17 | CSS Grid | Improved | Native Figma Grid (`layoutMode: "GRID"`) for regular multi-row/column grids via geometry clustering; spanning/irregular grids safely stay pixel-perfect |
| 18 | Pseudo-elements | Improved | Preserved source nodes and semantic Before/After names |
| 19 | Advanced filters | Guarded | Blur, drop-shadow and blend modes native; unsupported filters explicitly warned |
| 20 | Semantic naming | Improved | DOM, accessibility, IDs/classes and pseudo context |
| 21 | Advanced diagnostics | Added | Preflight fidelity counts, warnings, accuracy score and layer inspector |
| 22 | Regression tests | Added | Executable Node suite with parser, geometry, ordering and mapping checks |

## Product utilities delivered in this build

- Clean My Import (conservative visual-safe cleanup)
- Pixel Accuracy Score
- Browser ↔ Figma geometry inspector
- Detect Design System summary
- Smart semantic naming
- Responsive constraints
- Why Is This Different?
- Repair Selected Layer
- Transactional re-import / Update selected

## Intentionally not faked

Perspective/3D transforms, full browser filter rasterization, automated image palette extraction, global asset replacement, DOM tree UI and Figma→H2D round-trip export require dedicated follow-up engines. v0.41 reports or safely preserves these cases instead of applying destructive guesses. Two-dimensional CSS Grid is now natively converted for regular, fully-clustered layouts (see #17); grids with spanning cells or irregular geometry still fall back to pixel-perfect with a diagnostic, since guessing a span from geometry alone risks a silently wrong layout.
