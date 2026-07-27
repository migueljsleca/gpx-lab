"use client"

import * as React from "react"
import type {
  Map as MapLibreMap,
  MapMouseEvent,
  StyleSpecification,
} from "maplibre-gl"

import type { EditorTool, GpxTrack, TrackCoordinate } from "@/lib/gpx"

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
const trackSelectionWidth = 20

function softenBasemapWater(map: MapLibreMap) {
  if (map.getLayer("Water")) {
    map.setPaintProperty("Water", "fill-color", "#1e1e1e")
  }
}

function enhanceBasemapLineContrast(map: MapLibreMap) {
  for (const [layerId, color] of Object.entries(enhancedBasemapLineColors)) {
    if (map.getLayer(layerId)) {
      map.setPaintProperty(layerId, "line-color", color)
    }
  }

  if (map.getLayer("Pathway outline")) {
    map.setLayerZoomRange("Pathway outline", 10, 24)
    map.setPaintProperty("Pathway outline", "line-color", "#181b1e")
    map.setPaintProperty("Pathway outline", "line-opacity", [
      "interpolate",
      ["linear"],
      ["zoom"],
      10,
      0.7,
      18,
      0.85,
    ])
    map.setPaintProperty("Pathway outline", "line-width", [
      "interpolate",
      ["linear"],
      ["zoom"],
      10,
      1.6,
      14,
      2,
      18,
      3.2,
      22,
      5,
    ])
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
    map.setPaintProperty("Pathway", "line-width", [
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
    ])
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
        "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.7, 14, 0.92],
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
  activeTool: EditorTool
  onSelectTrack: (trackId: string) => void
  onAddPoint: (coordinate: TrackCoordinate) => void
  onMovePoint: (pointIndex: number, coordinate: TrackCoordinate) => void
  onMovePointStart: () => void
  onMovePointEnd: () => void
  onSplit: (pointIndex: number) => void
  onCrop: (startIndex: number, endIndex: number) => void
  onFinishDrawing: () => void
  onToolMessage: (message: string) => void
}

type ProjectedTrack = {
  id: string
  color: string
  active: boolean
  path: string
  start: [number, number]
  end: [number, number]
  points: { index: number; position: [number, number] }[]
}

function nearestTrackPointIndex(
  map: MapLibreMap,
  track: GpxTrack,
  point: { x: number; y: number }
) {
  let nearestIndex = -1
  let nearestDistance = Number.POSITIVE_INFINITY

  track.coordinates.forEach(([longitude, latitude], index) => {
    const projected = map.project([longitude, latitude])
    const distance = Math.hypot(projected.x - point.x, projected.y - point.y)

    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  })

  return { index: nearestIndex, distance: nearestDistance }
}

export function MapCanvas({
  tracks,
  activeTrackId,
  activeTool,
  onSelectTrack,
  onAddPoint,
  onMovePoint,
  onMovePointStart,
  onMovePointEnd,
  onSplit,
  onCrop,
  onFinishDrawing,
  onToolMessage,
}: MapCanvasProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<MapLibreMap | null>(null)
  const mapLibraryRef = React.useRef<typeof import("maplibre-gl") | null>(null)
  const lastFittedTrackIdRef = React.useRef("")
  const [ready, setReady] = React.useState(false)
  const interactionScope = `${activeTrackId}:${activeTool}`
  const [cropAnchor, setCropAnchor] = React.useState<{
    scope: string
    index: number
  } | null>(null)
  const [drawPreview, setDrawPreview] = React.useState<{
    scope: string
    position: [number, number]
  } | null>(null)
  const cropAnchorIndex =
    cropAnchor?.scope === interactionScope ? cropAnchor.index : null
  const drawPreviewPosition =
    drawPreview?.scope === interactionScope ? drawPreview.position : null
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
          softenBasemapWater(map)
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
        .filter((track) => track.visible && track.coordinates.length > 0)
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
            points: points
              .map((position, index) => ({ index, position }))
              .filter(
                ({ index }) =>
                  index === 0 ||
                  index === points.length - 1 ||
                  (track.id === activeTrackId && index === cropAnchorIndex) ||
                  index % Math.max(1, Math.ceil(points.length / 400)) === 0
              ),
          }
        })
    )
  }, [activeTrackId, cropAnchorIndex, tracks])

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
    const activeTrack = tracks.find((track) => track.id === activeTrackId)

    if (!map || !ready) {
      return
    }

    const canvas = map.getCanvas()
    const previousCursor = canvas.style.cursor
    canvas.style.cursor =
      activeTool === "draw"
        ? "crosshair"
        : activeTool === "split" || activeTool === "crop"
          ? "cell"
          : ""

    if (activeTool === "draw") {
      map.doubleClickZoom.disable()
    }

    function handleClick(event: MapMouseEvent) {
      if (activeTool === "draw") {
        if (event.originalEvent.detail > 1) {
          return
        }
        const elevation = activeTrack?.coordinates.at(-1)?.[2] ?? 0
        onAddPoint([event.lngLat.lng, event.lngLat.lat, elevation])
        return
      }

      if ((activeTool !== "split" && activeTool !== "crop") || !activeTrack) {
        return
      }

      const nearest = nearestTrackPointIndex(map!, activeTrack, event.point)
      if (nearest.index === -1 || nearest.distance > 36) {
        onToolMessage("Click closer to the active route")
        return
      }

      if (activeTool === "split") {
        onSplit(nearest.index)
        return
      }

      if (cropAnchorIndex === null) {
        setCropAnchor({ scope: interactionScope, index: nearest.index })
        onToolMessage("Now click the other end of the section to keep")
      } else {
        onCrop(cropAnchorIndex, nearest.index)
        setCropAnchor(null)
      }
    }

    function handleMouseMove(event: MapMouseEvent) {
      if (activeTool === "draw") {
        setDrawPreview({
          scope: interactionScope,
          position: [event.point.x, event.point.y],
        })
      }
    }

    function handleMouseLeave() {
      setDrawPreview(null)
    }

    function handleDoubleClick(event: MapMouseEvent) {
      if (activeTool === "draw") {
        event.preventDefault()
        onFinishDrawing()
      }
    }

    map.on("click", handleClick)
    map.on("mousemove", handleMouseMove)
    map.on("mouseout", handleMouseLeave)
    map.on("dblclick", handleDoubleClick)

    return () => {
      canvas.style.cursor = previousCursor
      map.off("click", handleClick)
      map.off("mousemove", handleMouseMove)
      map.off("mouseout", handleMouseLeave)
      map.off("dblclick", handleDoubleClick)
      if (activeTool === "draw") {
        map.doubleClickZoom.enable()
      }
    }
  }, [
    activeTool,
    activeTrackId,
    cropAnchorIndex,
    interactionScope,
    onAddPoint,
    onCrop,
    onFinishDrawing,
    onSplit,
    onToolMessage,
    ready,
    tracks,
  ])

  React.useEffect(() => {
    const map = mapRef.current
    const maplibre = mapLibraryRef.current
    const activeTrack = tracks.find((track) => track.id === activeTrackId)

    if (
      !map ||
      !maplibre ||
      !ready ||
      !activeTrack?.coordinates.length ||
      lastFittedTrackIdRef.current === activeTrack.id
    ) {
      return
    }

    lastFittedTrackIdRef.current = activeTrack.id
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

  function beginPointDrag(event: React.PointerEvent<SVGCircleElement>) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    mapRef.current?.dragPan.disable()
    onMovePointStart()
  }

  function movePoint(
    event: React.PointerEvent<SVGCircleElement>,
    pointIndex: number
  ) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return
    }

    const map = mapRef.current
    const container = containerRef.current
    const activeTrack = tracks.find((track) => track.id === activeTrackId)
    const elevation = activeTrack?.coordinates[pointIndex]?.[2] ?? 0
    if (!map || !container) {
      return
    }

    const bounds = container.getBoundingClientRect()
    const coordinate = map.unproject([
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    ])
    onMovePoint(pointIndex, [coordinate.lng, coordinate.lat, elevation])
  }

  function finishPointDrag(event: React.PointerEvent<SVGCircleElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    mapRef.current?.dragPan.enable()
    onMovePointEnd()
  }

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
            <g key={track.id}>
              <path
                d={track.path}
                fill="none"
                stroke="transparent"
                strokeWidth={trackSelectionWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  pointerEvents: activeTool === "select" ? "stroke" : "none",
                  cursor: activeTool === "select" ? "pointer" : undefined,
                }}
                onClick={() => onSelectTrack(track.id)}
              />
              <path
                d={track.path}
                fill="none"
                stroke={track.color}
                strokeWidth="2"
                strokeOpacity="0.56"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ))}
        {projectedTracks
          .filter((track) => track.active)
          .map((track) => (
            <g key={track.id}>
              <path
                d={track.path}
                fill="none"
                stroke="transparent"
                strokeWidth={trackSelectionWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  pointerEvents: activeTool === "select" ? "stroke" : "none",
                  cursor: activeTool === "select" ? "pointer" : undefined,
                }}
                onClick={() => onSelectTrack(track.id)}
              />
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
              {activeTool === "draw" &&
                track.points.map(({ index, position }) => (
                  <circle
                    key={index}
                    cx={position[0]}
                    cy={position[1]}
                    r="4"
                    fill="#181b20"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    className="pointer-events-auto cursor-grab drop-shadow-md active:cursor-grabbing"
                    onPointerDown={beginPointDrag}
                    onPointerMove={(event) => movePoint(event, index)}
                    onPointerUp={finishPointDrag}
                    onPointerCancel={finishPointDrag}
                  />
                ))}
              {activeTool === "crop" &&
                cropAnchorIndex !== null &&
                track.points
                  .filter(({ index }) => index === cropAnchorIndex)
                  .map(({ index, position }) => (
                    <circle
                      key={`crop-${index}`}
                      cx={position[0]}
                      cy={position[1]}
                      r="8"
                      fill={track.color}
                      stroke="#ffffff"
                      strokeWidth="2"
                    />
                  ))}
            </g>
          ))}
        {activeTool === "draw" &&
          drawPreviewPosition &&
          projectedTracks
            .filter((track) => track.active)
            .map((track) => (
              <path
                key={`preview-${track.id}`}
                d={`M ${track.end[0]} ${track.end[1]} L ${drawPreviewPosition[0]} ${drawPreviewPosition[1]}`}
                fill="none"
                stroke={track.color}
                strokeWidth="3"
                strokeDasharray="5 5"
                strokeOpacity="0.8"
              />
            ))}
      </svg>
    </div>
  )
}
