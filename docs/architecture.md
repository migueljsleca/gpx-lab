# Architecture

## Principle

Use Next.js and TypeScript for the product shell and GPX workflows whenever they
are a good fit. Add another runtime only where it produces a measurable benefit
or unlocks a browser capability that React cannot provide cleanly.

## Current boundaries

| Concern | Current choice | Reason |
| --- | --- | --- |
| Application shell | Next.js App Router | Routing, persistence endpoints, auth, and deployment can stay in one stack |
| Editor UI and state | React client components | Map and edit interactions require browser state and pointer events |
| Map | MapLibre GL | Mature pan/zoom/projection engine without a required paid token |
| GPX import/export | Browser TypeScript | Fast enough for normal files and keeps the first slice offline-friendly |
| Elevation/statistics | Browser TypeScript | Derived locally from the active track |

## Planned fallbacks

1. Move parsing, simplification, cleaning, splitting, and statistics into a Web
   Worker when large tracks begin to block the interface.
2. Prefer the existing TypeScript GPX algorithms in the cloned `gpx.studio/gpx`
   package as behavioral reference while writing APIs that suit this product.
3. Consider WASM only if profiling shows that worker-based TypeScript cannot
   meet the target for very large files.
4. Put third-party routing, elevation enrichment, and persistence behind Next.js
   route handlers so provider details do not leak into editor components.
5. Introduce native shells only if a later mobile product needs offline file
   access, background location, or platform-specific sharing.

## Next implementation phase

- Editable track-point model with undo/redo history
- Draw and drag points on the map
- Split and crop operations
- Simplify and clean algorithms in a worker
- Multi-track selection and merge
- IndexedDB local persistence before adding accounts or a hosted database
