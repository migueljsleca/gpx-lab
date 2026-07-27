# GPX Lab

A Next.js-first GPX workspace for creating, importing, inspecting, and editing
tracks on a clear, detailed map.

## Current slice

- Responsive editor shell based on the GPX Lab Figma prototype
- Real MapLibre map using MapTiler's Dataviz Dark basemap
- Project-style sidebar with folders, active tracks, visibility, and search
- GPX import in the browser with automatic map fitting
- GPX export for the active track
- Provisional select, draw, split, crop, simplify, clean, and merge toolbar
- Collapsible elevation profile with computed distance, ascent, and descent

The advanced edit buttons currently establish the editor interaction model; the
geometry algorithms are the next implementation phase.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Quality checks:

```bash
npm run typecheck
npm run lint
npm run build
```

## Stack

- Next.js 16 App Router
- React 19 and TypeScript
- Tailwind CSS 4
- shadcn/ui using preset `b2fA` (Radix Nova, neutral)
- MapLibre GL for the interactive map

See [docs/architecture.md](docs/architecture.md) for the Next.js-first boundary
and planned fallbacks.
