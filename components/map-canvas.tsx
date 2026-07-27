"use client"

import * as React from "react"
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl"

import type { GpxTrack } from "@/lib/gpx"

const mapTilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY
const mapTilerStyleUrl = mapTilerKey
  ? `https://api.maptiler.com/maps/dataviz-v4-dark/style.json?key=${encodeURIComponent(mapTilerKey)}`
  : null
const mountainPeakSourceUrl = mapTilerKey
  ? `https://api.maptiler.com/tiles/v3/tiles.json?key=${encodeURIComponent(mapTilerKey)}`
  : null

const fallbackMapStyle: StyleSpecification = {
  version: 8,
  sources: {
    "open-topo-map": {
      type: "raster",
      tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 17,
      attribution:
        '&copy; <a href="https://www.opentopomap.org">OpenTopoMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [
    {
      id: "open-topo-map",
      type: "raster",
      source: "open-topo-map",
    },
  ],
}

const enhancedBasemapLineColors = {
  Tunnel: "#41464b",
  "Road network": "#484d52",
  "Road bridge": "#4a4f54",
} as const

function enhanceBasemapLineContrast(map: MapLibreMap) {
  for (const [layerId, color] of Object.entries(enhancedBasemapLineColors)) {
    if (map.getLayer(layerId)) {
      map.setPaintProperty(layerId, "line-color", color)
    }
  }

  if (map.getLayer("Pathway outline")) {
    map.setLayerZoomRange("Pathway outline", 10, 24)
    map.setPaintProperty("Pathway outline", "line-color", "#181b1e")
    map.setPaintProperty(
      "Pathway outline",
      "line-opacity",
      ["interpolate", ["linear"], ["zoom"], 10, 0.7, 18, 0.85]
    )
    map.setPaintProperty(
      "Pathway outline",
      "line-width",
      ["interpolate", ["linear"], ["zoom"], 10, 1.6, 14, 2, 18, 3.2, 22, 5]
    )
  }

  if (map.getLayer("Pathway")) {
    map.setLayerZoomRange("Pathway", 10, 24)
    map.setPaintProperty("Pathway", "line-color", [
      "match",
      ["get", "class"],
      ["cycleway"],
      "#718895",
      ["footway", "path", "pedestrian", "track"],
      "#786f5a",
      "#62696f",
    ])
    map.setPaintProperty("Pathway", "line-dasharray", [1, 1.35])
    map.setPaintProperty("Pathway", "line-opacity", 0.95)
    map.setPaintProperty(
      "Pathway",
      "line-width",
      [
        "interpolate",
        ["linear"],
        ["zoom"],
        10,
        0.8,
        14,
        1.1,
        18,
        1.6,
        22,
        2.6,
      ]
    )
  }

  if (map.getLayer("Tunnel pathway")) {
    map.setLayerZoomRange("Tunnel pathway", 12, 24)
    map.setPaintProperty("Tunnel pathway", "line-color", "#655f52")
    map.setPaintProperty("Tunnel pathway", "line-dasharray", [1, 1.6])
  }
}

function enhanceBuildingFootprintContrast(map: MapLibreMap) {
  if (map.getLayer("Building")) {
    map.setPaintProperty("Building", "fill-color", [
      "interpolate",
      ["linear"],
      ["zoom"],
      12,
      "#292923",
      13,
      "#302f28",
      16,
      "#38362e",
    ])
    map.setPaintProperty("Building", "fill-opacity", [
      "interpolate",
      ["linear"],
      ["zoom"],
      12,
      0.5,
      13,
      0.75,
      15,
      0.85,
    ])
    map.setPaintProperty("Building", "fill-outline-color", "#444035")
  }

  if (map.getLayer("Building top")) {
    map.setPaintProperty("Building top", "fill-color", "#333129")
    map.setPaintProperty("Building top", "fill-outline-color", "#494438")
    map.setPaintProperty("Building top", "fill-opacity", [
      "interpolate",
      ["linear"],
      ["zoom"],
      13,
      0,
      14,
      0.3,
      15,
      0.6,
      16,
      0.8,
    ])
  }
}

function enhanceSettlementLabelContrast(map: MapLibreMap) {
  const settlementLabelColors = {
    "Place labels": "#8e9397",
    "Village labels": "#a3a8ac",
    "Town labels": "#a3a8ac",
    "City labels": "#a3a8ac",
    "Capital city labels": "#a8adb1",
  } as const

  for (const [layerId, color] of Object.entries(settlementLabelColors)) {
    if (map.getLayer(layerId)) {
      map.setPaintProperty(layerId, "text-color", color)
    }
  }
}

function addMountainPeakLabels(map: MapLibreMap) {
  if (!mountainPeakSourceUrl) {
    return
  }

  const sourceId = "mountain-peaks"
  const layerId = "Mountain peak labels"

  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: "vector",
      url: mountainPeakSourceUrl,
    })
  }

  if (!map.getLayer(layerId)) {
    map.addLayer({
      id: layerId,
      type: "symbol",
      source: sourceId,
      "source-layer": "mountain_peak",
      minzoom: 9,
      filter: [
        "all",
        ["==", "$type", "Point"],
        ["in", "class", "peak", "volcano"],
        ["has", "name"],
      ],
      layout: {
        "icon-image": "triangle",
        "icon-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          9,
          0.7,
          14,
          0.92,
        ],
        "symbol-avoid-edges": true,
        "symbol-sort-key": ["to-number", ["get", "rank"]],
        "text-anchor": "top",
        "text-field": [
          "concat",
          ["get", "name"],
          [
            "case",
            ["has", "ele"],
            ["concat", "\n", ["to-string", ["get", "ele"]], " m"],
            "",
          ],
        ],
        "text-font": ["Roboto Condensed Regular", "Noto Sans Regular"],
        "text-letter-spacing": 0.01,
        "text-max-width": 8,
        "text-offset": [0, 0.75],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          9,
          10,
          13,
          11.5,
          16,
          13,
        ],
      },
      paint: {
        "icon-color": "#d7c8a8",
        "icon-halo-color": "#171a1d",
        "icon-halo-width": 1.2,
        "text-color": "#e4ddcf",
        "text-halo-blur": 0.4,
        "text-halo-color": "#171a1d",
        "text-halo-width": 2,
      },
    })
  }
}

function resizeMapToContainer(map: MapLibreMap) {
  const container = map.getContainer()
  const canvas = map.getCanvas()

  if (
    canvas.clientWidth === container.clientWidth &&
    canvas.clientHeight === container.clientHeight
  ) {
    return
  }

  map.resize()
}

async function loadMapStyle(): Promise<StyleSpecification> {
  if (!mapTilerStyleUrl) {
    console.error(
      "[MapLibre] NEXT_PUBLIC_MAPTILER_KEY is not configured; falling back to OpenTopoMap"
    )
    return fallbackMapStyle
  }

  try {
    const styleResponse = await fetch(mapTilerStyleUrl)

    if (!styleResponse.ok) {
      throw new Error(
        `Could not load the MapTiler map style (${styleResponse.status})`
      )
    }

    return (await styleResponse.json()) as StyleSpecification
  } catch (error) {
    console.error("[MapLibre] Falling back to OpenTopoMap", error)
    return fallbackMapStyle
  }
}

type MapCanvasProps = {
  tracks: GpxTrack[]
  activeTrackId: string
}

type ProjectedTrack = {
  id: string
  color: string
  active: boolean
  path: string
  start: [number, number]
  end: [number, number]
}

export function MapCanvas({
  tracks,
  activeTrackId,
}: MapCanvasProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<MapLibreMap | null>(null)
  const mapLibraryRef = React.useRef<typeof import("maplibre-gl") | null>(null)
  const [ready, setReady] = React.useState(false)
  const [projectedTracks, setProjectedTracks] = React.useState<
    ProjectedTrack[]
  >([])

  React.useEffect(() => {
    let cancelled = false
    let resizeObserver: ResizeObserver | null = null

    async function createMap() {
      if (!containerRef.current || mapRef.current) {
        return
      }

      const [maplibre, style] = await Promise.all([
        import("maplibre-gl"),
        loadMapStyle(),
      ])

      if (cancelled || !containerRef.current) {
        return
      }

      maplibre.setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs")
      mapLibraryRef.current = maplibre
      const map = new maplibre.Map({
        container: containerRef.current,
        style,
        center: [-17.19286, 32.81078],
        zoom: 10.7,
        minZoom: 3,
        maxZoom: 19,
        attributionControl: false,
        trackResize: false,
      })

      map.addControl(
        new maplibre.NavigationControl({
          showCompass: true,
          showZoom: true,
          visualizePitch: true,
        }),
        "bottom-right"
      )
      map.on("error", (event) => {
        console.error("[MapLibre]", event.error)
      })

      map.once("load", () => {
        if (!cancelled) {
          enhanceBasemapLineContrast(map)
          enhanceBuildingFootprintContrast(map)
          enhanceSettlementLabelContrast(map)
          addMountainPeakLabels(map)
          setReady(true)
        }
      })

      mapRef.current = map
      resizeObserver = new ResizeObserver(() => {
        resizeMapToContainer(map)
      })
      resizeObserver.observe(containerRef.current)
      if (process.env.NODE_ENV === "development") {
        ;(window as Window & { __gpxLabMap?: MapLibreMap }).__gpxLabMap = map
      }
    }

    void createMap()

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      mapRef.current?.remove()
      mapRef.current = null
      mapLibraryRef.current = null
      if (process.env.NODE_ENV === "development") {
        delete (window as Window & { __gpxLabMap?: MapLibreMap }).__gpxLabMap
      }
    }
  }, [])

  const updateProjectedTracks = React.useCallback(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    setProjectedTracks(
      tracks
        .filter((track) => track.visible && track.coordinates.length > 1)
        .map((track) => {
          const points = track.coordinates.map(([longitude, latitude]) => {
            const point = map.project([longitude, latitude])
            return [point.x, point.y] as [number, number]
          })

          return {
            id: track.id,
            color: track.color,
            active: track.id === activeTrackId,
            path: points
              .map(
                ([x, y], index) =>
                  `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`
              )
              .join(" "),
            start: points[0],
            end: points.at(-1)!,
          }
        })
    )
  }, [activeTrackId, tracks])

  React.useEffect(() => {
    const map = mapRef.current

    if (!map || !ready) {
      return
    }

    map.on("move", updateProjectedTracks)
    map.on("resize", updateProjectedTracks)
    updateProjectedTracks()

    return () => {
      map.off("move", updateProjectedTracks)
      map.off("resize", updateProjectedTracks)
    }
  }, [ready, updateProjectedTracks])

  React.useEffect(() => {
    const map = mapRef.current
    const maplibre = mapLibraryRef.current
    const activeTrack = tracks.find((track) => track.id === activeTrackId)

    if (!map || !maplibre || !ready || !activeTrack?.coordinates.length) {
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      if (
        !containerRef.current ||
        containerRef.current.clientWidth === 0 ||
        containerRef.current.clientHeight === 0
      ) {
        return
      }

      map.resize()
      const bounds = new maplibre.LngLatBounds()
      activeTrack.coordinates.forEach(([longitude, latitude]) => {
        bounds.extend([longitude, latitude])
      })
      map.fitBounds(bounds, {
        padding: { top: 110, right: 110, bottom: 190, left: 110 },
        duration: 700,
        maxZoom: 12.5,
      })
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [activeTrackId, ready, tracks])

  return (
    <div className="absolute inset-0 bg-[#202326]">
      <div
        ref={containerRef}
        className="size-full"
        aria-label="Interactive map of the active GPX track"
      />
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[2] size-full overflow-visible"
      >
        {projectedTracks
          .filter((track) => !track.active)
          .map((track) => (
            <path
              key={track.id}
              d={track.path}
              fill="none"
              stroke={track.color}
              strokeWidth="2"
              strokeOpacity="0.56"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        {projectedTracks
          .filter((track) => track.active)
          .map((track) => (
            <g key={track.id}>
              <path
                d={track.path}
                fill="none"
                stroke="white"
                strokeWidth="8"
                strokeOpacity="0.65"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={track.path}
                fill="none"
                stroke={track.color}
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle
                cx={track.start[0]}
                cy={track.start[1]}
                r="5"
                fill="#f4f4f5"
                stroke="#121418"
                strokeWidth="2"
              />
              <circle
                cx={track.end[0]}
                cy={track.end[1]}
                r="5"
                fill={track.color}
                stroke="#121418"
                strokeWidth="2"
              />
            </g>
          ))}
      </svg>
    </div>
  )
}
