"use client"

import * as React from "react"
import type {
  ExpressionSpecification,
  GeoJSONSourceDiff,
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  MapMouseEvent,
  StyleSpecification,
} from "maplibre-gl"

import { type MapStyleId, type RouteLineWeight } from "@/lib/editor-preferences"
import {
  getTrackAnchorIndices,
  type EditorTool,
  type GpxTrack,
  type TrackCoordinate,
} from "@/lib/gpx"
import { metersToFeet, type UnitSystem } from "@/lib/units"

const mapTilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY
const mountainPeakSourceUrl = mapTilerKey
  ? `https://api.maptiler.com/tiles/v3/tiles.json?key=${encodeURIComponent(mapTilerKey)}`
  : null
const mapTilerStyleIds: Record<MapStyleId, string> = {
  dark: "dataviz-v4-dark",
  topographic: "topo-v4-dark",
  outdoors: "outdoor-v4-dark",
  satellite: "hybrid",
}

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
const trackSourceId = "gpx-tracks"
const trackCasingLayerId = "gpx-track-casing"
const trackLineLayerId = "gpx-track-lines"
const trackHitLayerId = "gpx-track-hit-area"
const routeLineStrokeWidths: Record<
  RouteLineWeight,
  {
    inactive: number
    casing: number
    active: number
    preview: number
  }
> = {
  thin: { inactive: 1, casing: 4, active: 2, preview: 1.5 },
  standard: { inactive: 2.5, casing: 8, active: 4.5, preview: 3.5 },
  bold: { inactive: 5, casing: 14, active: 8, preview: 6 },
}

type TrackLineProperties = {
  id: string
  color: string
}

function createTrackFeature(
  track: GpxTrack
): GeoJSON.Feature<GeoJSON.LineString, TrackLineProperties> {
  return {
    type: "Feature",
    id: track.id,
    properties: {
      id: track.id,
      color: track.color,
    },
    geometry: {
      type: "LineString",
      coordinates: track.coordinates.map(([longitude, latitude]) => [
        longitude,
        latitude,
      ]),
    },
  }
}

function createTrackFeatureCollection(
  tracks: GpxTrack[]
): GeoJSON.FeatureCollection<GeoJSON.LineString, TrackLineProperties> {
  return {
    type: "FeatureCollection",
    features: tracks
      .filter((track) => track.visible && track.coordinates.length > 0)
      .map(createTrackFeature),
  }
}

function ensureTrackLayers(map: MapLibreMap) {
  if (!map.getSource(trackSourceId)) {
    map.addSource(trackSourceId, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [],
      },
    })
  }

  if (!map.getLayer(trackCasingLayerId)) {
    map.addLayer({
      id: trackCasingLayerId,
      type: "line",
      source: trackSourceId,
      filter: ["==", ["get", "id"], ""],
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0.65,
        "line-width": routeLineStrokeWidths.standard.casing,
      },
    })
  }

  if (!map.getLayer(trackLineLayerId)) {
    map.addLayer({
      id: trackLineLayerId,
      type: "line",
      source: trackSourceId,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": ["get", "color"],
        "line-opacity": 0.56,
        "line-width": routeLineStrokeWidths.standard.inactive,
      },
    })
  }

  if (!map.getLayer(trackHitLayerId)) {
    map.addLayer({
      id: trackHitLayerId,
      type: "line",
      source: trackSourceId,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#000000",
        "line-opacity": 0.001,
        "line-width": trackSelectionWidth,
      },
    })
  }
}

function updateTrackLayerAppearance(
  map: MapLibreMap,
  activeTrackId: string,
  routeLineWeight: RouteLineWeight
) {
  const strokeWidths = routeLineStrokeWidths[routeLineWeight]

  if (map.getLayer(trackCasingLayerId)) {
    map.setFilter(trackCasingLayerId, ["==", ["get", "id"], activeTrackId])
    map.setPaintProperty(trackCasingLayerId, "line-width", strokeWidths.casing)
  }

  if (map.getLayer(trackLineLayerId)) {
    const isActiveTrack: ExpressionSpecification = [
      "==",
      ["get", "id"],
      activeTrackId,
    ]
    map.setPaintProperty(trackLineLayerId, "line-width", [
      "case",
      isActiveTrack,
      strokeWidths.active,
      strokeWidths.inactive,
    ])
    map.setPaintProperty(trackLineLayerId, "line-opacity", [
      "case",
      isActiveTrack,
      1,
      0.56,
    ])
  }
}

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

function updateMountainPeakUnits(map: MapLibreMap, unitSystem: UnitSystem) {
  const layerId = "Mountain peak labels"
  if (!map.getLayer(layerId)) {
    return
  }

  const elevation =
    unitSystem === "imperial"
      ? ["round", ["*", ["to-number", ["get", "ele"]], metersToFeet]]
      : ["get", "ele"]

  map.setLayoutProperty(layerId, "text-field", [
    "concat",
    ["get", "name"],
    [
      "case",
      ["has", "ele"],
      [
        "concat",
        "\n",
        ["to-string", elevation],
        unitSystem === "imperial" ? " ft" : " m",
      ],
      "",
    ],
  ])
}

function addMountainPeakLabels(map: MapLibreMap, unitSystem: UnitSystem) {
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

  updateMountainPeakUnits(map, unitSystem)
}

function enhanceMapStyle(map: MapLibreMap, unitSystem: UnitSystem) {
  softenBasemapWater(map)
  enhanceBasemapLineContrast(map)
  enhanceBuildingFootprintContrast(map)
  enhanceSettlementLabelContrast(map)
  addMountainPeakLabels(map, unitSystem)
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

async function loadMapStyle(mapStyle: MapStyleId): Promise<StyleSpecification> {
  if (!mapTilerKey) {
    console.error(
      "[MapLibre] NEXT_PUBLIC_MAPTILER_KEY is not configured; falling back to OpenTopoMap"
    )
    return fallbackMapStyle
  }

  try {
    const styleUrl = `https://api.maptiler.com/maps/${mapTilerStyleIds[mapStyle]}/style.json?key=${encodeURIComponent(mapTilerKey)}`
    const styleResponse = await fetch(styleUrl)

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
  mapStyle: MapStyleId
  routeLineWeight: RouteLineWeight
  unitSystem: UnitSystem
  hoveredElevationPointIndex: number | null
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

type ProjectedActiveTrack = {
  color: string
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
  mapStyle,
  routeLineWeight,
  unitSystem,
  hoveredElevationPointIndex,
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
  const initialMapStyleRef = React.useRef(mapStyle)
  const initialUnitSystemRef = React.useRef(unitSystem)
  const unitSystemRef = React.useRef(unitSystem)
  const appliedMapStyleRef = React.useRef<MapStyleId | null>(null)
  const renderedTracksRef = React.useRef(new Map<string, GpxTrack>())
  const renderedStyleRevisionRef = React.useRef(-1)
  const [mapInstance, setMapInstance] = React.useState<MapLibreMap | null>(null)
  const [ready, setReady] = React.useState(false)
  const [styleRevision, setStyleRevision] = React.useState(0)
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
  const [projectedActiveTrack, setProjectedActiveTrack] =
    React.useState<ProjectedActiveTrack | null>(null)
  const hoveredTrack = tracks.find((track) => track.id === activeTrackId)
  const hoveredTrackCoordinate =
    hoveredElevationPointIndex === null
      ? null
      : hoveredTrack?.coordinates[hoveredElevationPointIndex]
  const hoveredTrackPoint =
    ready && mapInstance && hoveredTrackCoordinate && hoveredTrack
      ? {
          color: hoveredTrack.color,
          position: mapInstance.project([
            hoveredTrackCoordinate[0],
            hoveredTrackCoordinate[1],
          ]),
        }
      : null
  const routeStrokeWidths = routeLineStrokeWidths[routeLineWeight]
  const selectTrackFromMap = React.useEffectEvent(
    (event: MapLayerMouseEvent) => {
      if (activeTool !== "select") {
        return
      }

      const trackId = event.features?.[0]?.properties?.id
      if (typeof trackId === "string") {
        onSelectTrack(trackId)
      }
    }
  )
  const handleMapClickEvent = React.useEffectEvent((event: MapMouseEvent) => {
    const map = mapRef.current
    const activeTrack = tracks.find((track) => track.id === activeTrackId)

    if (activeTool === "draw") {
      if (event.originalEvent.detail > 1) {
        return
      }
      const elevation = activeTrack?.coordinates.at(-1)?.[2] ?? 0
      onAddPoint([event.lngLat.lng, event.lngLat.lat, elevation])
      return
    }

    if (
      !map ||
      (activeTool !== "split" && activeTool !== "crop") ||
      !activeTrack
    ) {
      return
    }

    const nearest = nearestTrackPointIndex(map, activeTrack, event.point)
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
  })
  const handleMapMouseMoveEvent = React.useEffectEvent(
    (event: MapMouseEvent) => {
      if (activeTool === "draw") {
        setDrawPreview({
          scope: interactionScope,
          position: [event.point.x, event.point.y],
        })
      }
    }
  )
  const handleMapMouseLeaveEvent = React.useEffectEvent(() => {
    setDrawPreview(null)
  })
  const handleMapDoubleClickEvent = React.useEffectEvent(
    (event: MapMouseEvent) => {
      if (activeTool === "draw") {
        event.preventDefault()
        onFinishDrawing()
      }
    }
  )

  React.useEffect(() => {
    unitSystemRef.current = unitSystem
  }, [unitSystem])

  React.useEffect(() => {
    let cancelled = false
    let resizeObserver: ResizeObserver | null = null

    async function createMap() {
      if (!containerRef.current || mapRef.current) {
        return
      }

      const [maplibre, style] = await Promise.all([
        import("maplibre-gl"),
        loadMapStyle(initialMapStyleRef.current),
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
          enhanceMapStyle(map, initialUnitSystemRef.current)
          setReady(true)
        }
      })

      mapRef.current = map
      appliedMapStyleRef.current = initialMapStyleRef.current
      setMapInstance(map)
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

  React.useEffect(() => {
    const map = mapInstance

    if (!map || appliedMapStyleRef.current === mapStyle) {
      return
    }

    let cancelled = false

    void loadMapStyle(mapStyle).then((style) => {
      if (cancelled || mapRef.current !== map) {
        return
      }

      map.once("style.load", () => {
        if (!cancelled && mapRef.current === map) {
          enhanceMapStyle(map, unitSystemRef.current)
          setStyleRevision((revision) => revision + 1)
          map.triggerRepaint()
        }
      })
      appliedMapStyleRef.current = mapStyle
      map.setStyle(style)
    })

    return () => {
      cancelled = true
    }
  }, [mapInstance, mapStyle])

  React.useEffect(() => {
    if (mapInstance && ready) {
      updateMountainPeakUnits(mapInstance, unitSystem)
    }
  }, [mapInstance, ready, unitSystem])

  React.useEffect(() => {
    const map = mapInstance

    if (!map || !ready) {
      return
    }

    ensureTrackLayers(map)
    const source = map.getSource(trackSourceId) as GeoJSONSource | undefined
    if (!source) {
      return
    }

    const visibleTracks = tracks.filter(
      (track) => track.visible && track.coordinates.length > 0
    )
    const nextTracksById = new Map(
      visibleTracks.map((track) => [track.id, track])
    )

    if (renderedStyleRevisionRef.current !== styleRevision) {
      void source.setData(createTrackFeatureCollection(visibleTracks))
      renderedTracksRef.current = nextTracksById
      renderedStyleRevisionRef.current = styleRevision
      return
    }

    const diff: GeoJSONSourceDiff = {}
    const removedTrackIds = Array.from(renderedTracksRef.current.keys()).filter(
      (trackId) => !nextTracksById.has(trackId)
    )
    const addedTracks: GeoJSON.Feature[] = []
    const updatedTracks: NonNullable<GeoJSONSourceDiff["update"]> = []

    for (const track of visibleTracks) {
      const previousTrack = renderedTracksRef.current.get(track.id)
      if (!previousTrack) {
        addedTracks.push(createTrackFeature(track))
        continue
      }

      const geometryChanged = previousTrack.coordinates !== track.coordinates
      const colorChanged = previousTrack.color !== track.color
      if (!geometryChanged && !colorChanged) {
        continue
      }

      updatedTracks.push({
        id: track.id,
        ...(geometryChanged
          ? { newGeometry: createTrackFeature(track).geometry }
          : {}),
        ...(colorChanged
          ? {
              addOrUpdateProperties: [{ key: "color", value: track.color }],
            }
          : {}),
      })
    }

    if (removedTrackIds.length > 0) {
      diff.remove = removedTrackIds
    }
    if (addedTracks.length > 0) {
      diff.add = addedTracks
    }
    if (updatedTracks.length > 0) {
      diff.update = updatedTracks
    }
    if (diff.remove || diff.add || diff.update) {
      void source.updateData(diff)
    }

    renderedTracksRef.current = nextTracksById
  }, [mapInstance, ready, styleRevision, tracks])

  React.useEffect(() => {
    const map = mapInstance

    if (!map || !ready) {
      return
    }

    ensureTrackLayers(map)
    updateTrackLayerAppearance(map, activeTrackId, routeLineWeight)
  }, [activeTrackId, mapInstance, ready, routeLineWeight, styleRevision])

  React.useEffect(() => {
    const map = mapInstance

    if (!map || !ready || !map.getLayer(trackHitLayerId)) {
      return
    }

    const canvas = map.getCanvas()
    const handleClick = (event: MapLayerMouseEvent) => {
      selectTrackFromMap(event)
    }
    const handleMouseEnter = () => {
      if (activeTool === "select") {
        canvas.style.cursor = "pointer"
      }
    }
    const handleMouseLeave = () => {
      if (activeTool === "select") {
        canvas.style.cursor = ""
      }
    }

    map.on("click", trackHitLayerId, handleClick)
    map.on("mouseenter", trackHitLayerId, handleMouseEnter)
    map.on("mouseleave", trackHitLayerId, handleMouseLeave)

    return () => {
      map.off("click", trackHitLayerId, handleClick)
      map.off("mouseenter", trackHitLayerId, handleMouseEnter)
      map.off("mouseleave", trackHitLayerId, handleMouseLeave)
    }
  }, [activeTool, mapInstance, ready, styleRevision])

  const updateProjectedActiveTrack = React.useCallback(() => {
    const map = mapRef.current

    if (!map) {
      return
    }

    const activeTrack = tracks.find((track) => track.id === activeTrackId)
    if (
      !activeTrack ||
      !activeTrack.visible ||
      activeTrack.coordinates.length === 0
    ) {
      setProjectedActiveTrack(null)
      return
    }

    const startCoordinate = activeTrack.coordinates[0]
    const endCoordinate = activeTrack.coordinates.at(-1)!
    const start = map.project([startCoordinate[0], startCoordinate[1]])
    const end = map.project([endCoordinate[0], endCoordinate[1]])
    const pointIndices =
      activeTool === "draw"
        ? getTrackAnchorIndices(activeTrack)
        : cropAnchorIndex === null
          ? []
          : [cropAnchorIndex]

    setProjectedActiveTrack({
      color: activeTrack.color,
      start: [start.x, start.y],
      end: [end.x, end.y],
      points: pointIndices.map((index) => {
        const coordinate = activeTrack.coordinates[index]
        const position = map.project([coordinate[0], coordinate[1]])
        return { index, position: [position.x, position.y] }
      }),
    })
  }, [activeTool, activeTrackId, cropAnchorIndex, tracks])

  React.useEffect(() => {
    const map = mapRef.current

    if (!map || !ready) {
      return
    }

    map.on("move", updateProjectedActiveTrack)
    map.on("resize", updateProjectedActiveTrack)
    updateProjectedActiveTrack()

    return () => {
      map.off("move", updateProjectedActiveTrack)
      map.off("resize", updateProjectedActiveTrack)
    }
  }, [ready, updateProjectedActiveTrack])

  React.useEffect(() => {
    const map = mapRef.current

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
      handleMapClickEvent(event)
    }

    function handleMouseMove(event: MapMouseEvent) {
      handleMapMouseMoveEvent(event)
    }

    function handleMouseLeave() {
      handleMapMouseLeaveEvent()
    }

    function handleDoubleClick(event: MapMouseEvent) {
      handleMapDoubleClickEvent(event)
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
  }, [activeTool, ready])

  React.useEffect(() => {
    const map = mapRef.current
    const maplibre = mapLibraryRef.current
    const activeTrack = tracks.find((track) => track.id === activeTrackId)

    if (!map || !maplibre || !ready || !activeTrack) {
      return
    }

    if (activeTrack.coordinates.length === 0) {
      lastFittedTrackIdRef.current = activeTrack.id
      return
    }

    if (lastFittedTrackIdRef.current === activeTrack.id) {
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
      <div ref={containerRef} className="size-full" />
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[2] size-full overflow-visible"
      >
        {projectedActiveTrack && (
          <g>
            <circle
              cx={projectedActiveTrack.start[0]}
              cy={projectedActiveTrack.start[1]}
              r="5"
              fill="#f4f4f5"
              stroke="#121418"
              strokeWidth="2"
            />
            <circle
              cx={projectedActiveTrack.end[0]}
              cy={projectedActiveTrack.end[1]}
              r="5"
              fill={projectedActiveTrack.color}
              stroke="#121418"
              strokeWidth="2"
            />
            {activeTool === "draw" &&
              projectedActiveTrack.points.map(({ index, position }) => (
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
              projectedActiveTrack.points
                .filter(({ index }) => index === cropAnchorIndex)
                .map(({ index, position }) => (
                  <circle
                    key={`crop-${index}`}
                    cx={position[0]}
                    cy={position[1]}
                    r="8"
                    fill={projectedActiveTrack.color}
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                ))}
          </g>
        )}
        {activeTool === "draw" &&
          drawPreviewPosition &&
          projectedActiveTrack && (
            <path
              d={`M ${projectedActiveTrack.end[0]} ${projectedActiveTrack.end[1]} L ${drawPreviewPosition[0]} ${drawPreviewPosition[1]}`}
              fill="none"
              stroke={projectedActiveTrack.color}
              strokeWidth={routeStrokeWidths.preview}
              strokeDasharray="5 5"
              strokeOpacity="0.8"
            />
          )}
        {hoveredTrackPoint && (
          <g
            data-elevation-hover-marker
            transform={`translate(${hoveredTrackPoint.position.x} ${hoveredTrackPoint.position.y})`}
          >
            <circle
              r="8"
              fill="#101316"
              fillOpacity="0.72"
              stroke="#ffffff"
              strokeWidth="2.5"
              className="drop-shadow-md"
            />
            <circle r="4" fill={hoveredTrackPoint.color} />
          </g>
        )}
      </svg>
    </div>
  )
}
