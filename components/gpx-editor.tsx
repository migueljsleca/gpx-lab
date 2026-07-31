"use client"

import * as React from "react"
import {
  ChevronDown,
  ChevronUp,
  Combine,
  Copy,
  Crop,
  Download,
  Eye,
  EyeOff,
  FileUp,
  Folder,
  FolderOpen,
  FolderPlus,
  Map as MapIcon,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Plus,
  Redo2,
  RotateCcw,
  Route,
  Ruler,
  Scissors,
  Settings,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trash2,
  Undo2,
  Waypoints,
  X,
} from "lucide-react"
import { AlertDialog, ContextMenu, Popover } from "radix-ui"

import { MapCanvas } from "@/components/map-canvas"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  defaultMapStyle,
  defaultRouteLineWeight,
  mapStyleDefaultsVersion,
  mapStyleIds,
  mapStyleLabels,
  routeLineWeights,
  routeLineWeightLabels,
  type MapStyleId,
  type RouteLineWeight,
} from "@/lib/editor-preferences"
import {
  calculateTrackStats,
  cleanTrackCoordinates,
  getTrackAnchorIndices,
  parseGpx,
  serializeTrackToGpx,
  simplifyTrackCoordinateIndices,
  trackColors,
  type EditorTool,
  type GpxTrack,
  type TrackCoordinate,
} from "@/lib/gpx"
import { getAutoRoute } from "@/lib/routing"
import {
  convertDistance,
  convertElevation,
  defaultUnitSystem,
  elevationUnitName,
  formatDistance,
  formatElevation,
  unitSystemLabels,
  unitSystems,
  type UnitSystem,
} from "@/lib/units"
import { cn } from "@/lib/utils"
import {
  loadWorkspace,
  saveWorkspace,
  type WorkspaceSnapshot,
} from "@/lib/workspace-storage"

const editorTools: {
  id: EditorTool
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "draw", label: "Draw route", icon: PencilLine },
  { id: "split", label: "Split", icon: Scissors },
  { id: "crop", label: "Crop", icon: Crop },
  { id: "simplify", label: "Simplify", icon: SlidersHorizontal },
  { id: "clean", label: "Clean", icon: Sparkles },
  { id: "merge", label: "Merge", icon: Combine },
]

const trackDragType = "application/x-gpx-lab-track"
const trackContextItemClass =
  "flex h-8 select-none items-center gap-2 rounded-md px-2 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-white/[0.08] data-[highlighted]:text-foreground"
const floatingControlFrameClass =
  "h-10 rounded-[8px] border border-white/[0.08] bg-[#101010] p-1 backdrop-blur-md"
const pillControlButtonClass =
  "hover:bg-white/[0.1] active:bg-white/[0.1] dark:hover:bg-white/[0.1] dark:active:bg-white/[0.1]"
const sidebarMinWidth = 260
const sidebarMaxWidth = 320
const workspaceSaveDelayMs = 400
const trackColorLabels: Record<string, string> = {
  "#FF7470": "Coral",
  "#FF8F5B": "Orange",
  "#FFD45E": "Yellow",
  "#31CA84": "Green",
  "#2AA5FB": "Blue",
  "#B588F5": "Purple",
  "#FF97C5": "Pink",
}

function BrandLogo() {
  return (
    <div className="flex shrink-0 items-baseline gap-1.5">
      <span className="text-[19px] font-black tracking-[-0.045em] italic">
        GPX
      </span>
      <span className="text-[16px] font-semibold tracking-[-0.02em]">Lab</span>
    </div>
  )
}

function clampSidebarWidth(width: number) {
  return Math.min(sidebarMaxWidth, Math.max(sidebarMinWidth, width))
}

function cloneTracks(tracks: GpxTrack[]) {
  return tracks.map((track) => ({
    ...track,
    coordinates: track.coordinates.map(
      (coordinate) => [...coordinate] as TrackCoordinate
    ),
    anchorIndices: track.anchorIndices?.slice(),
  }))
}

function mergeCoordinates(tracks: GpxTrack[]) {
  const [first, ...remainingTracks] = tracks
  if (!first) {
    return []
  }

  let merged = first.coordinates.slice()
  const remaining = remainingTracks.map((track) => track.coordinates.slice())

  while (remaining.length > 0) {
    const mergedEnd = merged.at(-1)
    if (!mergedEnd) {
      merged = remaining.shift() ?? []
      continue
    }

    let closestTrackIndex = 0
    let reverseClosestTrack = false
    let closestDistance = Number.POSITIVE_INFINITY

    remaining.forEach((coordinates, index) => {
      const start = coordinates[0]
      const end = coordinates.at(-1)
      if (!start || !end) {
        return
      }

      const startDistance = distanceBetweenTrackCoordinates(mergedEnd, start)
      const endDistance = distanceBetweenTrackCoordinates(mergedEnd, end)
      if (startDistance < closestDistance) {
        closestDistance = startDistance
        closestTrackIndex = index
        reverseClosestTrack = false
      }
      if (endDistance < closestDistance) {
        closestDistance = endDistance
        closestTrackIndex = index
        reverseClosestTrack = true
      }
    })

    const [nextCoordinates] = remaining.splice(closestTrackIndex, 1)
    const orientedCoordinates = reverseClosestTrack
      ? nextCoordinates.slice().reverse()
      : nextCoordinates
    merged = [...merged, ...orientedCoordinates]
  }

  return cleanTrackCoordinates(merged)
}

export function GpxEditor() {
  const [tracks, setTracks] = React.useState<GpxTrack[]>([])
  const [folders, setFolders] = React.useState<string[]>([])
  const [activeTrackId, setActiveTrackId] = React.useState("")
  const [activeTool, setActiveTool] = React.useState<EditorTool>("select")
  const [sidebarOpen, setSidebarOpen] = React.useState(true)
  const [sidebarTransitioning, setSidebarTransitioning] = React.useState(false)
  const [sidebarWidth, setSidebarWidth] = React.useState(sidebarMinWidth)
  const [compactViewport, setCompactViewport] = React.useState(false)
  const [elevationOpen, setElevationOpen] = React.useState(false)
  const [hoveredElevationPoint, setHoveredElevationPoint] = React.useState<{
    trackId: string
    index: number
  } | null>(null)
  const [autoRouting, setAutoRouting] = React.useState(true)
  const [mapStyle, setMapStyle] = React.useState<MapStyleId>(defaultMapStyle)
  const [routeLineWeight, setRouteLineWeight] = React.useState<RouteLineWeight>(
    defaultRouteLineWeight
  )
  const [unitSystem, setUnitSystem] =
    React.useState<UnitSystem>(defaultUnitSystem)
  const [fileDragActive, setFileDragActive] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [undoStack, setUndoStack] = React.useState<GpxTrack[][]>([])
  const [redoStack, setRedoStack] = React.useState<GpxTrack[][]>([])
  const [workspaceReady, setWorkspaceReady] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const fileDragDepthRef = React.useRef(0)
  const persistenceDisabledRef = React.useRef(false)
  const pointDragSnapshotRef = React.useRef<GpxTrack[] | null>(null)
  const tracksRef = React.useRef<GpxTrack[]>([])
  const undoStackRef = React.useRef<GpxTrack[][]>([])
  const redoStackRef = React.useRef<GpxTrack[][]>([])
  const routingRequestRef = React.useRef<AbortController | null>(null)

  const activeTrack =
    tracks.find((track) => track.id === activeTrackId) ?? tracks[0]
  const hoveredElevationPointIndex =
    hoveredElevationPoint && hoveredElevationPoint.trackId === activeTrack?.id
      ? hoveredElevationPoint.index
      : null
  const stats = React.useMemo(
    () => (activeTrack ? calculateTrackStats(activeTrack) : null),
    [activeTrack]
  )
  const groupedTracks = React.useMemo(
    () =>
      folders.map((folder) => ({
        name: folder,
        tracks: tracks.filter((track) => track.folder === folder),
      })),
    [folders, tracks]
  )

  React.useEffect(() => {
    tracksRef.current = tracks
  }, [tracks])

  React.useEffect(() => {
    let cancelled = false
    let restoreTimedOut = false
    const restoreTimeout = window.setTimeout(() => {
      restoreTimedOut = true
      persistenceDisabledRef.current = true
      setNotice("This browser could not restore or save your workspace")
      setWorkspaceReady(true)
    }, 3500)

    loadWorkspace()
      .then((workspace) => {
        if (cancelled || restoreTimedOut || !workspace) {
          return
        }

        const restoredTracks = workspace.tracks.map((track) =>
          track.folder
            ? track
            : {
                ...track,
                folder: track.id.startsWith("import-") ? "Imported" : "Routes",
              }
        )
        const restoredFolders = Array.from(
          new Set([
            ...workspace.folders.filter(Boolean),
            ...restoredTracks.map((track) => track.folder),
          ])
        )
        const restoredActiveTrackId = restoredTracks.some(
          (track) => track.id === workspace.activeTrackId
        )
          ? workspace.activeTrackId
          : (restoredTracks[0]?.id ?? "")

        tracksRef.current = restoredTracks
        setTracks(restoredTracks)
        setFolders(restoredFolders)
        setActiveTrackId(restoredActiveTrackId)
        setSidebarOpen(
          window.matchMedia("(max-width: 639px)").matches
            ? false
            : workspace.sidebarOpen
        )
        setSidebarWidth(
          clampSidebarWidth(workspace.sidebarWidth ?? sidebarMinWidth)
        )
        setElevationOpen(workspace.elevationOpen)
        setAutoRouting(workspace.autoRouting ?? true)
        setMapStyle(
          workspace.mapStyleDefaultsVersion === mapStyleDefaultsVersion
            ? (workspace.mapStyle ?? defaultMapStyle)
            : defaultMapStyle
        )
        setRouteLineWeight(workspace.routeLineWeight ?? defaultRouteLineWeight)
        setUnitSystem(workspace.unitSystem ?? defaultUnitSystem)
      })
      .catch((error) => {
        persistenceDisabledRef.current = true
        console.error("[Workspace] Could not restore saved state", error)
        if (!cancelled && !restoreTimedOut) {
          setNotice("This browser could not restore or save your workspace")
        }
      })
      .finally(() => {
        window.clearTimeout(restoreTimeout)
        if (!cancelled && !restoreTimedOut) {
          setWorkspaceReady(true)
        }
      })

    return () => {
      cancelled = true
      window.clearTimeout(restoreTimeout)
    }
  }, [])

  React.useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)")
    const updateViewport = () => {
      setCompactViewport(media.matches)
      if (media.matches) {
        setSidebarOpen(false)
        setSidebarTransitioning(false)
      }
    }

    updateViewport()
    media.addEventListener("change", updateViewport)
    return () => media.removeEventListener("change", updateViewport)
  }, [])

  React.useEffect(() => {
    if (!workspaceReady || persistenceDisabledRef.current) {
      return
    }

    const workspace: WorkspaceSnapshot = {
      version: 1,
      tracks,
      folders,
      activeTrackId,
      sidebarOpen,
      sidebarWidth,
      elevationOpen,
      autoRouting,
      mapStyle,
      mapStyleDefaultsVersion,
      routeLineWeight,
      unitSystem,
    }

    const saveTimeout = window.setTimeout(() => {
      void saveWorkspace(workspace).catch((error) => {
        persistenceDisabledRef.current = true
        console.error("[Workspace] Could not save state", error)
        setNotice("Changes could not be saved in this browser")
      })
    }, workspaceSaveDelayMs)

    return () => window.clearTimeout(saveTimeout)
  }, [
    activeTrackId,
    autoRouting,
    elevationOpen,
    folders,
    mapStyle,
    routeLineWeight,
    sidebarOpen,
    sidebarWidth,
    tracks,
    unitSystem,
    workspaceReady,
  ])

  React.useEffect(
    () => () => {
      routingRequestRef.current?.abort()
    },
    []
  )

  React.useEffect(() => {
    if (!notice) {
      return
    }

    const timeout = window.setTimeout(() => setNotice(null), 2800)
    return () => window.clearTimeout(timeout)
  }, [notice])

  function commitTracks(nextTracks: GpxTrack[]) {
    const nextUndoStack = [
      ...undoStackRef.current.slice(-39),
      cloneTracks(tracksRef.current),
    ]
    undoStackRef.current = nextUndoStack
    redoStackRef.current = []
    tracksRef.current = nextTracks
    setUndoStack(nextUndoStack)
    setRedoStack(redoStackRef.current)
    setTracks(nextTracks)
  }

  function undo() {
    cancelPendingRouting()
    const previous = undoStackRef.current.at(-1)
    if (!previous) {
      return
    }

    const nextTracks = cloneTracks(previous)
    undoStackRef.current = undoStackRef.current.slice(0, -1)
    redoStackRef.current = [
      ...redoStackRef.current.slice(-39),
      cloneTracks(tracksRef.current),
    ]
    tracksRef.current = nextTracks
    setUndoStack(undoStackRef.current)
    setRedoStack(redoStackRef.current)
    setTracks(nextTracks)
    setActiveTrackId((currentId) =>
      previous.some((track) => track.id === currentId)
        ? currentId
        : (previous[0]?.id ?? "")
    )
    setNotice("Undid last edit")
  }

  function redo() {
    cancelPendingRouting()
    const next = redoStackRef.current.at(-1)
    if (!next) {
      return
    }

    const nextTracks = cloneTracks(next)
    undoStackRef.current = [
      ...undoStackRef.current.slice(-39),
      cloneTracks(tracksRef.current),
    ]
    redoStackRef.current = redoStackRef.current.slice(0, -1)
    tracksRef.current = nextTracks
    setUndoStack(undoStackRef.current)
    setRedoStack(redoStackRef.current)
    setTracks(nextTracks)
    setActiveTrackId((currentId) =>
      next.some((track) => track.id === currentId)
        ? currentId
        : (next[0]?.id ?? "")
    )
    setNotice("Redid last edit")
  }

  function cancelPendingRouting() {
    routingRequestRef.current?.abort()
    routingRequestRef.current = null
  }

  function changeAutoRouting(enabled: boolean) {
    cancelPendingRouting()
    setAutoRouting(enabled)
    setNotice(null)
  }

  function createNewRoute() {
    cancelPendingRouting()
    const folder = "Routes"
    const baseName = "New route"
    let name = baseName
    let suffix = 2

    while (
      tracks.some(
        (track) =>
          track.folder === folder &&
          track.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      name = `${baseName} ${suffix}`
      suffix += 1
    }

    const route: GpxTrack = {
      id: `route-${crypto.randomUUID()}`,
      name,
      folder,
      color: trackColors[tracks.length % trackColors.length],
      visible: true,
      coordinates: [],
      anchorIndices: [],
    }

    commitTracks([...tracks, route])
    setFolders((current) =>
      current.includes(folder) ? current : [...current, folder]
    )
    setActiveTrackId(route.id)
    setActiveTool("draw")
    setElevationOpen(false)
    setNotice(null)
  }

  function simplifyActiveTrack() {
    if (!activeTrack || activeTrack.coordinates.length < 3) {
      setNotice("This route does not have enough points to simplify")
      return
    }

    const currentAnchorIndices = getTrackAnchorIndices(activeTrack)
    const keptIndices = simplifyTrackCoordinateIndices(
      activeTrack.coordinates,
      10,
      currentAnchorIndices
    )
    const coordinates = keptIndices.map(
      (index) => activeTrack.coordinates[index]
    )
    if (coordinates.length === activeTrack.coordinates.length) {
      setNotice("This route is already simple")
      return
    }
    const nextIndexByCurrentIndex = new Map(
      keptIndices.map((currentIndex, nextIndex) => [currentIndex, nextIndex])
    )
    const anchorIndices = currentAnchorIndices.flatMap((index) => {
      const nextIndex = nextIndexByCurrentIndex.get(index)
      return nextIndex === undefined ? [] : [nextIndex]
    })

    commitTracks(
      tracks.map((track) =>
        track.id === activeTrack.id
          ? { ...track, coordinates, anchorIndices }
          : track
      )
    )
    setNotice(
      `Simplified ${activeTrack.name}: removed ${
        activeTrack.coordinates.length - coordinates.length
      } points`
    )
  }

  function cleanActiveTrack() {
    if (!activeTrack) {
      return
    }

    const coordinates = cleanTrackCoordinates(activeTrack.coordinates)
    if (coordinates.length === activeTrack.coordinates.length) {
      setNotice("No duplicate or invalid points found")
      return
    }

    const currentAnchorIndices = getTrackAnchorIndices(activeTrack)
    const nextIndexByCoordinate = new Map(
      coordinates.map((coordinate, index) => [coordinate, index])
    )
    const anchorIndices = currentAnchorIndices.flatMap((index) => {
      const nextIndex = nextIndexByCoordinate.get(
        activeTrack.coordinates[index]
      )
      return nextIndex === undefined ? [] : [nextIndex]
    })

    commitTracks(
      tracks.map((track) =>
        track.id === activeTrack.id
          ? { ...track, coordinates, anchorIndices }
          : track
      )
    )
    setNotice(
      `Cleaned ${activeTrack.name}: removed ${
        activeTrack.coordinates.length - coordinates.length
      } points`
    )
  }

  function mergeVisibleTracks() {
    if (!activeTrack) {
      return
    }

    const mergeTracks = [
      activeTrack,
      ...tracks.filter(
        (track) =>
          track.id !== activeTrack.id &&
          track.visible &&
          track.coordinates.length > 0
      ),
    ]

    if (mergeTracks.length < 2) {
      setNotice("Show at least one other route to merge with this one")
      return
    }

    const mergedTrackIds = new Set(mergeTracks.map((track) => track.id))
    const mergedTrack: GpxTrack = {
      ...activeTrack,
      name: `${activeTrack.name} merged`,
      coordinates: mergeCoordinates(mergeTracks),
      anchorIndices: undefined,
    }
    const activeIndex = tracks.findIndex((track) => track.id === activeTrack.id)
    const nextTracks = tracks.filter((track) => !mergedTrackIds.has(track.id))
    nextTracks.splice(Math.min(activeIndex, nextTracks.length), 0, mergedTrack)
    commitTracks(nextTracks)
    setNotice(`Merged ${mergeTracks.length} visible routes`)
  }

  function getToolUnavailableReason(tool: EditorTool) {
    if (tool === "draw") {
      return null
    }
    if (!activeTrack) {
      return "Create or import a route first"
    }
    if (
      (tool === "split" || tool === "crop" || tool === "simplify") &&
      activeTrack.coordinates.length < 3
    ) {
      return `Add at least three route points to ${tool}`
    }
    if (tool === "clean" && activeTrack.coordinates.length === 0) {
      return "Add route points to clean"
    }
    if (
      tool === "merge" &&
      (activeTrack.coordinates.length === 0 ||
        !tracks.some(
          (track) =>
            track.id !== activeTrack.id &&
            track.visible &&
            track.coordinates.length > 0
        ))
    ) {
      return "Show another route with points to merge"
    }

    return null
  }

  function chooseTool(tool: EditorTool) {
    const unavailableReason = getToolUnavailableReason(tool)
    if (unavailableReason) {
      setNotice(unavailableReason)
      return
    }

    if (tool !== "draw") {
      cancelPendingRouting()
    }

    if (tool === "simplify") {
      simplifyActiveTrack()
      setActiveTool("select")
      return
    }
    if (tool === "clean") {
      cleanActiveTrack()
      setActiveTool("select")
      return
    }
    if (tool === "merge") {
      mergeVisibleTracks()
      setActiveTool("select")
      return
    }
    if (tool === "draw" && !activeTrack) {
      createNewRoute()
      return
    }
    setActiveTool(tool)
    setNotice(null)
  }

  async function addRoutePoint(coordinate: TrackCoordinate) {
    if (!activeTrack) {
      return
    }

    const targetTrackId = activeTrack.id
    const start = activeTrack.coordinates.at(-1)

    if (!autoRouting || !start) {
      const currentTracks = tracksRef.current
      commitTracks(
        currentTracks.map((track) =>
          track.id === targetTrackId
            ? {
                ...track,
                coordinates: [...track.coordinates, coordinate],
                anchorIndices: [
                  ...getTrackAnchorIndices(track),
                  track.coordinates.length,
                ],
              }
            : track
        )
      )
      return
    }

    if (routingRequestRef.current) {
      setNotice("Wait for auto-routing to finish")
      return
    }

    const controller = new AbortController()
    routingRequestRef.current = controller
    setNotice(null)

    try {
      const routeCoordinates = await getAutoRoute(
        start,
        coordinate,
        controller.signal
      )
      if (controller.signal.aborted) {
        return
      }

      const currentTracks = tracksRef.current
      const targetTrack = currentTracks.find(
        (track) => track.id === targetTrackId
      )
      if (!targetTrack) {
        return
      }

      commitTracks(
        currentTracks.map((track) =>
          track.id === targetTrackId
            ? {
                ...track,
                coordinates: [
                  ...track.coordinates.slice(0, -1),
                  ...routeCoordinates,
                ],
                anchorIndices: Array.from(
                  new Set([
                    ...getTrackAnchorIndices(track),
                    track.coordinates.length + routeCoordinates.length - 2,
                  ])
                ),
              }
            : track
        )
      )
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }

      setNotice(
        error instanceof Error
          ? `${error.message}. Turn off Auto-route to draw directly.`
          : "Auto-route failed. Turn it off to draw directly."
      )
    } finally {
      if (routingRequestRef.current === controller) {
        routingRequestRef.current = null
      }
    }
  }

  function beginPointMove() {
    if (!pointDragSnapshotRef.current) {
      pointDragSnapshotRef.current = cloneTracks(tracks)
    }
  }

  function moveRoutePoint(pointIndex: number, coordinate: TrackCoordinate) {
    if (!activeTrack) {
      return
    }

    setTracks((current) => {
      const nextTracks = current.map((track) => {
        if (track.id !== activeTrack.id) {
          return track
        }

        const coordinates = track.coordinates.slice()
        coordinates[pointIndex] = coordinate
        return { ...track, coordinates }
      })
      tracksRef.current = nextTracks
      return nextTracks
    })
  }

  function finishPointMove() {
    const snapshot = pointDragSnapshotRef.current
    if (!snapshot) {
      return
    }

    undoStackRef.current = [...undoStackRef.current.slice(-39), snapshot]
    redoStackRef.current = []
    setUndoStack(undoStackRef.current)
    setRedoStack(redoStackRef.current)
    pointDragSnapshotRef.current = null
  }

  function splitActiveTrack(pointIndex: number) {
    if (
      !activeTrack ||
      pointIndex <= 0 ||
      pointIndex >= activeTrack.coordinates.length - 1
    ) {
      setNotice("Choose a point away from the start or finish")
      return
    }

    const first: GpxTrack = {
      ...activeTrack,
      name: `${activeTrack.name} 1`,
      coordinates: activeTrack.coordinates.slice(0, pointIndex + 1),
      anchorIndices: Array.from(
        new Set([
          ...getTrackAnchorIndices(activeTrack).filter(
            (index) => index <= pointIndex
          ),
          pointIndex,
        ])
      ),
    }
    const second: GpxTrack = {
      ...activeTrack,
      id: `split-${crypto.randomUUID()}`,
      name: `${activeTrack.name} 2`,
      coordinates: activeTrack.coordinates.slice(pointIndex),
      anchorIndices: Array.from(
        new Set([
          0,
          ...getTrackAnchorIndices(activeTrack)
            .filter((index) => index >= pointIndex)
            .map((index) => index - pointIndex),
        ])
      ),
    }
    const trackIndex = tracks.findIndex((track) => track.id === activeTrack.id)
    const nextTracks = tracks.filter((track) => track.id !== activeTrack.id)
    nextTracks.splice(trackIndex, 0, first, second)
    commitTracks(nextTracks)
    setActiveTrackId(second.id)
    setActiveTool("select")
    setNotice(`Split ${activeTrack.name} into two routes`)
  }

  function cropActiveTrack(startIndex: number, endIndex: number) {
    if (!activeTrack) {
      return
    }

    const firstIndex = Math.min(startIndex, endIndex)
    const lastIndex = Math.max(startIndex, endIndex)
    if (lastIndex - firstIndex < 1) {
      setNotice("Choose two different points")
      return
    }

    const coordinates = activeTrack.coordinates.slice(firstIndex, lastIndex + 1)
    const anchorIndices = Array.from(
      new Set([
        0,
        lastIndex - firstIndex,
        ...getTrackAnchorIndices(activeTrack)
          .filter((index) => index >= firstIndex && index <= lastIndex)
          .map((index) => index - firstIndex),
      ])
    ).sort((first, second) => first - second)
    commitTracks(
      tracks.map((track) =>
        track.id === activeTrack.id
          ? { ...track, coordinates, anchorIndices }
          : track
      )
    )
    setActiveTool("select")
    setNotice(`Kept ${coordinates.length} points from ${activeTrack.name}`)
  }

  function finishDrawing() {
    if (routingRequestRef.current) {
      setNotice("Wait for auto-routing to finish")
      return
    }

    if (!activeTrack || activeTrack.coordinates.length < 2) {
      setNotice("Add at least two points to finish the route")
      return
    }

    setActiveTool("select")
    setNotice(`Finished ${activeTrack.name}`)
  }

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        if (event.shiftKey) {
          redo()
        } else {
          undo()
        }
      } else if (event.key === "Escape" && activeTool !== "select") {
        cancelPendingRouting()
        setActiveTool("select")
        setNotice("Editing cancelled")
      } else if (event.key === "Enter" && activeTool === "draw") {
        finishDrawing()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  })

  function closeSidebar() {
    setSidebarTransitioning(true)
    setSidebarOpen(false)
  }

  function openSidebar() {
    setSidebarTransitioning(true)
    setSidebarOpen(true)
  }

  function selectTrack(trackId: string) {
    cancelPendingRouting()
    setActiveTrackId(trackId)
    setActiveTool("select")
    if (compactViewport) {
      closeSidebar()
    }
  }

  function toggleTrackVisibility(trackId: string) {
    setTracks((current) =>
      current.map((track) =>
        track.id === trackId ? { ...track, visible: !track.visible } : track
      )
    )
  }

  function changeTrackColor(trackId: string, color: string) {
    if (!trackColors.some((trackColor) => trackColor === color)) {
      return
    }

    setTracks((current) =>
      current.map((track) =>
        track.id === trackId ? { ...track, color } : track
      )
    )
  }

  function renameTrack(trackId: string, name: string) {
    const track = tracks.find((item) => item.id === trackId)
    const normalizedName = name.trim().replace(/\s+/g, " ")
    if (!track || !normalizedName) {
      setNotice("Track names cannot be empty")
      return false
    }

    if (
      tracks.some(
        (item) =>
          item.id !== trackId &&
          item.folder === track.folder &&
          item.name.toLowerCase() === normalizedName.toLowerCase()
      )
    ) {
      setNotice(`${track.folder} already has a track named ${normalizedName}`)
      return false
    }

    if (track.name === normalizedName) {
      return true
    }

    setTracks((current) =>
      current.map((item) =>
        item.id === trackId ? { ...item, name: normalizedName } : item
      )
    )
    setNotice(`Renamed ${track.name} to ${normalizedName}`)
    return true
  }

  function duplicateTrack(trackId: string) {
    const sourceIndex = tracks.findIndex((track) => track.id === trackId)
    const source = tracks[sourceIndex]
    if (!source) {
      return
    }

    const copyLabel = `${source.name} copy`
    let copyName = copyLabel
    let copyNumber = 2

    while (
      tracks.some(
        (track) =>
          track.folder === source.folder &&
          track.name.toLowerCase() === copyName.toLowerCase()
      )
    ) {
      copyName = `${copyLabel} ${copyNumber}`
      copyNumber += 1
    }

    const duplicate: GpxTrack = {
      ...source,
      id: `duplicate-${crypto.randomUUID()}`,
      name: copyName,
      coordinates: source.coordinates.slice(),
      anchorIndices: source.anchorIndices?.slice(),
    }
    const nextTracks = [...tracks]
    nextTracks.splice(sourceIndex + 1, 0, duplicate)
    setTracks(nextTracks)
    setActiveTrackId(duplicate.id)
    setNotice(`Duplicated ${source.name}`)
  }

  function deleteTrack(trackId: string) {
    const trackIndex = tracks.findIndex((track) => track.id === trackId)
    const track = tracks[trackIndex]
    if (!track) {
      return
    }

    const nextTracks = tracks.filter((item) => item.id !== trackId)
    setTracks(nextTracks)

    if (activeTrackId === trackId) {
      setActiveTrackId(
        nextTracks[Math.min(trackIndex, nextTracks.length - 1)]?.id ?? ""
      )
    }
    setNotice(`Deleted ${track.name}`)
  }

  async function importGpxFiles(files: File[]) {
    const gpxFiles = files.filter((file) =>
      file.name.toLowerCase().endsWith(".gpx")
    )

    if (gpxFiles.length === 0) {
      setNotice("Drop a .gpx file to import it")
      return
    }

    const results = await Promise.allSettled(
      gpxFiles.map(async (file) => parseGpx(await file.text(), file.name))
    )
    const importedTracks = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    )

    if (importedTracks.length > 0) {
      setTracks((current) => [...current, ...importedTracks])
      setFolders((current) =>
        current.includes("Imported") ? current : [...current, "Imported"]
      )
      setActiveTrackId(importedTracks.at(-1)!.id)
      setActiveTool("select")
    }

    const failedResult = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    )

    if (failedResult) {
      const message =
        failedResult.reason instanceof Error
          ? failedResult.reason.message
          : "Could not import GPX"
      setNotice(
        importedTracks.length > 0
          ? `Imported ${importedTracks.length}; some files could not be read`
          : message
      )
      return
    }

    setNotice(
      importedTracks.length === 1
        ? `Imported ${importedTracks[0].name}`
        : `Imported ${importedTracks.length} GPX files`
    )
  }

  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    await importGpxFiles(files)
  }

  function handleFileDragEnter(event: React.DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) {
      return
    }

    event.preventDefault()
    fileDragDepthRef.current += 1
    setFileDragActive(true)
  }

  function handleFileDragOver(event: React.DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }

  function handleFileDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) {
      return
    }

    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1)
    if (fileDragDepthRef.current === 0) {
      setFileDragActive(false)
    }
  }

  function handleFileDrop(event: React.DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) {
      return
    }

    event.preventDefault()
    fileDragDepthRef.current = 0
    setFileDragActive(false)
    void importGpxFiles(Array.from(event.dataTransfer.files))
  }

  function exportActiveTrack() {
    if (!activeTrack || activeTrack.coordinates.length < 2) {
      setNotice("Add at least two points before exporting")
      return
    }

    const blob = new Blob([serializeTrackToGpx(activeTrack)], {
      type: "application/gpx+xml",
    })
    const href = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = href
    link.download = `${activeTrack.name.replaceAll(/\s+/g, "-").toLowerCase()}.gpx`
    link.click()
    URL.revokeObjectURL(href)
    setNotice(`Exported ${activeTrack.name}.gpx`)
  }

  function createFolder(name: string) {
    const normalizedName = name.trim().replace(/\s+/g, " ")
    if (!normalizedName) {
      return false
    }

    if (
      folders.some(
        (folder) => folder.toLowerCase() === normalizedName.toLowerCase()
      )
    ) {
      setNotice(`A folder named ${normalizedName} already exists`)
      return false
    }

    setFolders((current) => [...current, normalizedName])
    setNotice(`Created ${normalizedName}`)
    return true
  }

  function renameFolder(name: string, nextName: string) {
    const normalizedName = nextName.trim().replace(/\s+/g, " ")
    if (!normalizedName) {
      setNotice("Folder names cannot be empty")
      return false
    }

    if (
      folders.some(
        (folder) =>
          folder !== name &&
          folder.toLowerCase() === normalizedName.toLowerCase()
      )
    ) {
      setNotice(`A folder named ${normalizedName} already exists`)
      return false
    }

    if (name === normalizedName) {
      return true
    }

    setFolders((current) =>
      current.map((folder) => (folder === name ? normalizedName : folder))
    )
    setTracks((current) =>
      current.map((track) =>
        track.folder === name ? { ...track, folder: normalizedName } : track
      )
    )
    setNotice(`Renamed ${name} to ${normalizedName}`)
    return true
  }

  function deleteFolder(name: string) {
    const folderTracks = tracks.filter((track) => track.folder === name)
    const remainingTracks = tracks.filter((track) => track.folder !== name)

    setFolders((current) => current.filter((folder) => folder !== name))

    if (folderTracks.length > 0) {
      setTracks(remainingTracks)
      if (folderTracks.some((track) => track.id === activeTrackId)) {
        setActiveTrackId(remainingTracks[0]?.id ?? "")
      }
    }

    setNotice(
      folderTracks.length === 0
        ? `Deleted ${name}`
        : `Deleted ${name} and ${folderTracks.length} ${
            folderTracks.length === 1 ? "track" : "tracks"
          }`
    )
  }

  function resetSettings() {
    cancelPendingRouting()
    setMapStyle(defaultMapStyle)
    setRouteLineWeight(defaultRouteLineWeight)
    setUnitSystem(defaultUnitSystem)
    setAutoRouting(true)
    setNotice("Settings reset to defaults")
  }

  function clearWorkspace() {
    cancelPendingRouting()
    tracksRef.current = []
    undoStackRef.current = []
    redoStackRef.current = []
    pointDragSnapshotRef.current = null
    fileDragDepthRef.current = 0
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }

    setTracks([])
    setFolders([])
    setActiveTrackId("")
    setActiveTool("select")
    setElevationOpen(false)
    setHoveredElevationPoint(null)
    setFileDragActive(false)
    setUndoStack([])
    setRedoStack([])
    setNotice("Workspace cleared")
  }

  function moveTrackToFolder(trackId: string, folder: string) {
    const movingTrack = tracks.find((track) => track.id === trackId)
    if (!movingTrack || movingTrack.folder === folder) {
      return
    }

    setTracks((current) => {
      const track = current.find((item) => item.id === trackId)
      if (!track) {
        return current
      }

      const remaining = current.filter((item) => item.id !== trackId)
      const lastFolderTrackIndex = remaining.findLastIndex(
        (item) => item.folder === folder
      )
      const nextTrack = { ...track, folder }

      if (lastFolderTrackIndex === -1) {
        return [...remaining, nextTrack]
      }

      const next = [...remaining]
      next.splice(lastFolderTrackIndex + 1, 0, nextTrack)
      return next
    })
    setNotice(`Moved ${movingTrack.name} to ${folder}`)
  }

  function moveTrackRelative(
    trackId: string,
    targetTrackId: string,
    position: "before" | "after"
  ) {
    if (trackId === targetTrackId) {
      return
    }

    const movingTrack = tracks.find((track) => track.id === trackId)
    const targetTrack = tracks.find((track) => track.id === targetTrackId)
    if (!movingTrack || !targetTrack) {
      return
    }

    setTracks((current) => {
      const track = current.find((item) => item.id === trackId)
      const target = current.find((item) => item.id === targetTrackId)
      if (!track || !target) {
        return current
      }

      const remaining = current.filter((item) => item.id !== trackId)
      const targetIndex = remaining.findIndex(
        (item) => item.id === targetTrackId
      )
      const next = [...remaining]
      next.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, {
        ...track,
        folder: target.folder,
      })
      return next
    })

    if (movingTrack.folder !== targetTrack.folder) {
      setNotice(`Moved ${movingTrack.name} to ${targetTrack.folder}`)
    }
  }

  const collapsedControlReady = !sidebarOpen && !sidebarTransitioning
  const controlUsesCollapsedLayout = collapsedControlReady
  const closingSidebar = !sidebarOpen && sidebarTransitioning

  return (
    <TooltipProvider delayDuration={280}>
      <main className="relative flex h-svh w-full overflow-hidden bg-background text-foreground">
        <h1 className="sr-only">GPX Lab route editor</h1>
        <input
          ref={fileInputRef}
          type="file"
          name="gpx-file"
          aria-label="Import GPX file"
          tabIndex={-1}
          className="sr-only"
          accept=".gpx,application/gpx+xml,application/xml,text/xml"
          onChange={importFile}
        />

        <div
          className="absolute top-3 left-3 z-50 flex h-10 items-center gap-2 border border-transparent p-1 pr-1 pl-2"
          style={{
            paddingLeft: 8,
            ...(!controlUsesCollapsedLayout
              ? { width: sidebarWidth - 21 }
              : {}),
          }}
        >
          <span
            aria-hidden="true"
            className={cn(
              floatingControlFrameClass,
              "pointer-events-none absolute -inset-px transform-gpu transition-[opacity,transform]",
              collapsedControlReady
                ? "scale-100 opacity-100 delay-50 duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
                : "scale-[0.985] opacity-0 delay-0 duration-75 ease-out"
            )}
          />
          <div className="relative z-10">
            <BrandLogo />
          </div>
          <Button
            aria-label={sidebarOpen ? "Collapse sidebar" : "Open sidebar"}
            variant="ghost"
            size="icon-sm"
            className={cn(
              "relative z-10 text-muted-foreground transition-opacity hover:text-foreground",
              !controlUsesCollapsedLayout && "ml-auto",
              closingSidebar
                ? "opacity-0 delay-0 duration-75 ease-out"
                : sidebarOpen
                  ? "opacity-100 delay-0 duration-75 ease-out"
                  : "opacity-100 delay-50 duration-125 ease-[cubic-bezier(0.23,1,0.32,1)]"
            )}
            onClick={sidebarOpen ? closeSidebar : openSidebar}
          >
            {sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
        </div>

        <Sidebar
          open={sidebarOpen}
          width={sidebarWidth}
          tracks={tracks}
          groupedTracks={groupedTracks}
          activeTrackId={activeTrackId}
          mapStyle={mapStyle}
          routeLineWeight={routeLineWeight}
          unitSystem={unitSystem}
          autoRouting={autoRouting}
          onLayoutTransitionEnd={() => setSidebarTransitioning(false)}
          onWidthChange={setSidebarWidth}
          onNewRoute={createNewRoute}
          onImport={() => fileInputRef.current?.click()}
          onSelectTrack={selectTrack}
          onToggleTrack={toggleTrackVisibility}
          onChangeTrackColor={changeTrackColor}
          onRenameTrack={renameTrack}
          onDuplicateTrack={duplicateTrack}
          onDeleteTrack={deleteTrack}
          onCreateFolder={createFolder}
          onRenameFolder={renameFolder}
          onDeleteFolder={deleteFolder}
          onMoveTrackToFolder={moveTrackToFolder}
          onMoveTrackRelative={moveTrackRelative}
          onMapStyleChange={setMapStyle}
          onRouteLineWeightChange={setRouteLineWeight}
          onUnitSystemChange={setUnitSystem}
          onAutoRoutingChange={changeAutoRouting}
          onResetSettings={resetSettings}
          onClearWorkspace={clearWorkspace}
        />

        {sidebarOpen && compactViewport && (
          <button
            type="button"
            aria-label="Close sidebar"
            className="absolute inset-0 z-30 bg-black/45 sm:hidden"
            onClick={closeSidebar}
          />
        )}

        <section
          className="map-shell relative min-w-0 flex-1 overflow-hidden"
          style={
            {
              "--sidebar-offset": sidebarOpen ? `${sidebarWidth}px` : "0px",
            } as React.CSSProperties
          }
          onDragEnter={handleFileDragEnter}
          onDragOver={handleFileDragOver}
          onDragLeave={handleFileDragLeave}
          onDrop={handleFileDrop}
        >
          <MapCanvas
            tracks={tracks}
            activeTrackId={activeTrackId}
            activeTool={activeTool}
            mapStyle={mapStyle}
            routeLineWeight={routeLineWeight}
            unitSystem={unitSystem}
            hoveredElevationPointIndex={hoveredElevationPointIndex}
            onSelectTrack={selectTrack}
            onAddPoint={addRoutePoint}
            onMovePoint={moveRoutePoint}
            onMovePointStart={beginPointMove}
            onMovePointEnd={finishPointMove}
            onSplit={splitActiveTrack}
            onCrop={cropActiveTrack}
            onFinishDrawing={finishDrawing}
            onToolMessage={setNotice}
          />

          {fileDragActive && (
            <div
              role="status"
              className="pointer-events-none absolute inset-3 z-50 grid place-items-center rounded-2xl border-2 border-dashed border-white/45 bg-[#111419]/80 shadow-[inset_0_0_80px_rgba(255,255,255,0.05)] backdrop-blur-sm"
            >
              <div className="flex flex-col items-center text-center">
                <span className="grid size-11 place-items-center rounded-xl border border-white/15 bg-white/10">
                  <FileUp className="size-5" />
                </span>
                <p className="mt-3 text-sm font-semibold">Drop GPX to import</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  It will open and save automatically
                </p>
              </div>
            </div>
          )}

          {!activeTrack && (
            <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center p-6">
              <div className="sidebar-aware-shift pointer-events-auto relative flex w-full max-w-[320px] flex-col items-center rounded-2xl border border-white/[0.1] bg-[#181b20]/95 px-7 py-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl">
                <span className="grid size-10 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.05] text-muted-foreground">
                  <Route className="size-4" />
                </span>
                <h2 className="mt-4 text-sm font-semibold">No GPX files yet</h2>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                  Import your first GPX file to view and edit it on the map.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-5"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUp />
                  Import GPX file
                </Button>
                <button
                  type="button"
                  className="mt-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={createNewRoute}
                >
                  Draw a new route
                </button>
              </div>
            </div>
          )}

          {(activeTrack || undoStack.length > 0 || redoStack.length > 0) && (
            <MapHeader
              hasActiveTrack={Boolean(activeTrack)}
              activeTool={activeTool}
              onChooseTool={chooseTool}
              canUndo={undoStack.length > 0}
              canRedo={redoStack.length > 0}
              getUnavailableReason={getToolUnavailableReason}
              onUndo={undo}
              onRedo={redo}
              onExport={exportActiveTrack}
            />
          )}

          {activeTrack && activeTool !== "select" && !notice && (
            <ToolHint
              tool={activeTool}
              autoRouting={autoRouting}
              onAutoRoutingChange={changeAutoRouting}
            />
          )}

          <div
            role="status"
            aria-live="polite"
            className={cn(
              "sidebar-aware-center absolute top-[108px] left-1/2 z-30 -translate-x-1/2 rounded-lg border border-white/10 bg-[#181b20]/95 px-3 py-2 text-xs backdrop-blur-md transition-[opacity,transform] sm:top-16",
              notice
                ? "translate-y-0 opacity-100"
                : "pointer-events-none -translate-y-1 opacity-0"
            )}
          >
            {notice ?? ""}
          </div>

          {activeTrack && activeTrack.coordinates.length > 1 && stats && (
            <ElevationPanel
              track={activeTrack}
              stats={stats}
              unitSystem={unitSystem}
              open={elevationOpen}
              hoveredPointIndex={hoveredElevationPointIndex}
              onHoveredPointChange={(pointIndex) =>
                setHoveredElevationPoint(
                  pointIndex === null
                    ? null
                    : { trackId: activeTrack.id, index: pointIndex }
                )
              }
              onOpenChange={(open) => {
                setElevationOpen(open)
                if (!open) {
                  setHoveredElevationPoint(null)
                }
              }}
            />
          )}
        </section>
      </main>
    </TooltipProvider>
  )
}

type SidebarProps = {
  open: boolean
  width: number
  tracks: GpxTrack[]
  groupedTracks: { name: string; tracks: GpxTrack[] }[]
  activeTrackId: string
  mapStyle: MapStyleId
  routeLineWeight: RouteLineWeight
  unitSystem: UnitSystem
  autoRouting: boolean
  onLayoutTransitionEnd: () => void
  onWidthChange: (width: number) => void
  onNewRoute: () => void
  onImport: () => void
  onSelectTrack: (trackId: string) => void
  onToggleTrack: (trackId: string) => void
  onChangeTrackColor: (trackId: string, color: string) => void
  onRenameTrack: (trackId: string, name: string) => boolean
  onDuplicateTrack: (trackId: string) => void
  onDeleteTrack: (trackId: string) => void
  onCreateFolder: (name: string) => boolean
  onRenameFolder: (name: string, nextName: string) => boolean
  onDeleteFolder: (name: string) => void
  onMoveTrackToFolder: (trackId: string, folder: string) => void
  onMapStyleChange: (mapStyle: MapStyleId) => void
  onRouteLineWeightChange: (weight: RouteLineWeight) => void
  onUnitSystemChange: (unitSystem: UnitSystem) => void
  onAutoRoutingChange: (enabled: boolean) => void
  onResetSettings: () => void
  onClearWorkspace: () => void
  onMoveTrackRelative: (
    trackId: string,
    targetTrackId: string,
    position: "before" | "after"
  ) => void
}

function Sidebar({
  open,
  width,
  tracks,
  groupedTracks,
  activeTrackId,
  mapStyle,
  routeLineWeight,
  unitSystem,
  autoRouting,
  onLayoutTransitionEnd,
  onWidthChange,
  onNewRoute,
  onImport,
  onSelectTrack,
  onToggleTrack,
  onChangeTrackColor,
  onRenameTrack,
  onDuplicateTrack,
  onDeleteTrack,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveTrackToFolder,
  onMoveTrackRelative,
  onMapStyleChange,
  onRouteLineWeightChange,
  onUnitSystemChange,
  onAutoRoutingChange,
  onResetSettings,
  onClearWorkspace,
}: SidebarProps) {
  const [creatingFolder, setCreatingFolder] = React.useState(false)
  const [folderName, setFolderName] = React.useState("")
  const [resizing, setResizing] = React.useState(false)
  const resizeOriginRef = React.useRef<{
    pointerX: number
    width: number
  } | null>(null)
  const bodyStyleRef = React.useRef<{
    cursor: string
    userSelect: string
  } | null>(null)

  const restoreBodyAfterResize = React.useCallback(() => {
    if (!bodyStyleRef.current) {
      return
    }

    document.body.style.cursor = bodyStyleRef.current.cursor
    document.body.style.userSelect = bodyStyleRef.current.userSelect
    bodyStyleRef.current = null
  }, [])

  React.useEffect(
    () => () => {
      restoreBodyAfterResize()
    },
    [restoreBodyAfterResize]
  )

  function beginResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeOriginRef.current = {
      pointerX: event.clientX,
      width,
    }
    bodyStyleRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    }
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    setResizing(true)
  }

  function resize(event: React.PointerEvent<HTMLDivElement>) {
    const origin = resizeOriginRef.current
    if (!origin) {
      return
    }

    onWidthChange(
      clampSidebarWidth(origin.width + event.clientX - origin.pointerX)
    )
  }

  function finishResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    resizeOriginRef.current = null
    restoreBodyAfterResize()
    setResizing(false)
  }

  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 16 : 8

    if (event.key === "ArrowLeft") {
      event.preventDefault()
      onWidthChange(clampSidebarWidth(width - step))
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      onWidthChange(clampSidebarWidth(width + step))
    } else if (event.key === "Home") {
      event.preventDefault()
      onWidthChange(sidebarMinWidth)
    } else if (event.key === "End") {
      event.preventDefault()
      onWidthChange(sidebarMaxWidth)
    }
  }

  function submitFolder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (onCreateFolder(folderName)) {
      setFolderName("")
      setCreatingFolder(false)
    }
  }

  const sidebarCssWidth = `min(${width}px, calc(100vw - 56px))`

  return (
    <aside
      inert={!open}
      className={cn(
        "absolute inset-y-0 left-0 z-40 h-svh overflow-hidden border-r border-white/[0.06] bg-[#101010]",
        resizing
          ? "transition-none"
          : "transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
        !open && "pointer-events-none -translate-x-full"
      )}
      style={{ width: sidebarCssWidth }}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) {
          onLayoutTransitionEnd()
        }
      }}
    >
      <div
        className="flex h-full flex-col px-3 py-5"
        style={{ width: sidebarCssWidth }}
      >
        <nav aria-label="Main actions" className="mt-11 space-y-1">
          <SidebarAction icon={Plus} label="New route" onClick={onNewRoute} />
          <SidebarAction
            icon={FileUp}
            label="Import GPX file"
            onClick={onImport}
          />
        </nav>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-0.5">
          <div>
            <div className="flex h-7 items-center justify-between pl-2">
              <p className="text-xs text-muted-foreground">Your routes</p>
              <button
                type="button"
                aria-label="Create folder"
                title="New folder"
                className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                onClick={() => setCreatingFolder(true)}
              >
                <FolderPlus className="size-4" />
              </button>
            </div>

            {creatingFolder && (
              <form
                className="mx-1 mt-1 flex items-center gap-1 rounded-lg border border-white/[0.1] bg-black/20 p-1"
                onSubmit={submitFolder}
              >
                <Folder className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={folderName}
                  maxLength={48}
                  placeholder="Folder name"
                  aria-label="Folder name"
                  className="h-8 min-w-0 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground/60 sm:h-7 sm:text-xs"
                  onChange={(event) => setFolderName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setCreatingFolder(false)
                      setFolderName("")
                    }
                  }}
                />
                <button
                  type="button"
                  aria-label="Cancel folder"
                  className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                  onClick={() => {
                    setCreatingFolder(false)
                    setFolderName("")
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </form>
            )}

            <div className="mt-2 space-y-3">
              {groupedTracks.map((folder) => (
                <TrackFolder
                  key={folder.name}
                  name={folder.name}
                  tracks={folder.tracks}
                  trackCount={
                    tracks.filter((track) => track.folder === folder.name)
                      .length
                  }
                  activeTrackId={activeTrackId}
                  onSelectTrack={onSelectTrack}
                  onToggleTrack={onToggleTrack}
                  onChangeTrackColor={onChangeTrackColor}
                  onRenameTrack={onRenameTrack}
                  onDuplicateTrack={onDuplicateTrack}
                  onDeleteTrack={onDeleteTrack}
                  onRenameFolder={onRenameFolder}
                  onDeleteFolder={onDeleteFolder}
                  onMoveTrackToFolder={onMoveTrackToFolder}
                  onMoveTrackRelative={onMoveTrackRelative}
                />
              ))}
              {tracks.length === 0 && groupedTracks.length === 0 && (
                <div className="mx-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-3">
                  <p className="text-xs font-medium">No GPX files yet</p>
                  <button
                    type="button"
                    className="mt-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                    onClick={onImport}
                  >
                    Import GPX file
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <SettingsMenu
          mapStyle={mapStyle}
          routeLineWeight={routeLineWeight}
          unitSystem={unitSystem}
          autoRouting={autoRouting}
          hasWorkspaceContent={tracks.length > 0 || groupedTracks.length > 0}
          onMapStyleChange={onMapStyleChange}
          onRouteLineWeightChange={onRouteLineWeightChange}
          onUnitSystemChange={onUnitSystemChange}
          onAutoRoutingChange={onAutoRoutingChange}
          onResetSettings={onResetSettings}
          onClearWorkspace={onClearWorkspace}
        />
      </div>
      <div
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemin={sidebarMinWidth}
        aria-valuemax={sidebarMaxWidth}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        className={cn(
          "sidebar-resizer absolute inset-y-0 right-0 z-50 hidden w-1.5 cursor-col-resize touch-none outline-none focus-visible:bg-route sm:block",
          resizing && "bg-white/[0.06]"
        )}
        onDoubleClick={() => onWidthChange(sidebarMinWidth)}
        onKeyDown={resizeWithKeyboard}
        onPointerDown={beginResize}
        onPointerMove={resize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onLostPointerCapture={finishResize}
      />
    </aside>
  )
}

function SettingsMenu({
  mapStyle,
  routeLineWeight,
  unitSystem,
  autoRouting,
  hasWorkspaceContent,
  onMapStyleChange,
  onRouteLineWeightChange,
  onUnitSystemChange,
  onAutoRoutingChange,
  onResetSettings,
  onClearWorkspace,
}: {
  mapStyle: MapStyleId
  routeLineWeight: RouteLineWeight
  unitSystem: UnitSystem
  autoRouting: boolean
  hasWorkspaceContent: boolean
  onMapStyleChange: (mapStyle: MapStyleId) => void
  onRouteLineWeightChange: (weight: RouteLineWeight) => void
  onUnitSystemChange: (unitSystem: UnitSystem) => void
  onAutoRoutingChange: (enabled: boolean) => void
  onResetSettings: () => void
  onClearWorkspace: () => void
}) {
  const [clearDialogOpen, setClearDialogOpen] = React.useState(false)
  const menuItemClass = "h-8 px-2 text-xs"

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] leading-4 font-[450] text-foreground/90 transition-[color,background-color] outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/30 data-[state=open]:bg-white/[0.08]"
          >
            <Settings className="size-4" />
            <span>Settings</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-[min(252px,calc(100vw-24px))] rounded-xl border border-white/[0.1] bg-[#1b1e22] p-1.5 shadow-none"
        >
          <DropdownMenuLabel className="px-2 py-1.5 text-xs leading-4 font-medium text-white/45">
            Settings
          </DropdownMenuLabel>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={menuItemClass}>
              <MapIcon className="size-4 text-muted-foreground" />
              <span>Map style</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              sideOffset={7}
              className="min-w-[124px] rounded-xl border border-white/[0.1] bg-[#1b1e22] p-1.5 shadow-none sm:min-w-40"
            >
              <DropdownMenuRadioGroup
                value={mapStyle}
                onValueChange={(value) => onMapStyleChange(value as MapStyleId)}
              >
                {mapStyleIds.map((styleId) => (
                  <DropdownMenuRadioItem
                    key={styleId}
                    value={styleId}
                    className={menuItemClass}
                  >
                    {mapStyleLabels[styleId]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={menuItemClass}>
              <Route className="size-4 text-muted-foreground" />
              <span>Route line</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              sideOffset={7}
              className="min-w-[124px] rounded-xl border border-white/[0.1] bg-[#1b1e22] p-1.5 shadow-none sm:min-w-36"
            >
              <DropdownMenuRadioGroup
                value={routeLineWeight}
                onValueChange={(value) =>
                  onRouteLineWeightChange(value as RouteLineWeight)
                }
              >
                {routeLineWeights.map((weight) => (
                  <DropdownMenuRadioItem
                    key={weight}
                    value={weight}
                    className={menuItemClass}
                  >
                    {routeLineWeightLabels[weight]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={menuItemClass}>
              <Ruler className="size-4 text-muted-foreground" />
              <span>Units</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              sideOffset={7}
              className="min-w-[124px] rounded-xl border border-white/[0.1] bg-[#1b1e22] p-1.5 shadow-none sm:min-w-36"
            >
              <DropdownMenuRadioGroup
                value={unitSystem}
                onValueChange={(value) =>
                  onUnitSystemChange(value as UnitSystem)
                }
              >
                {unitSystems.map((system) => (
                  <DropdownMenuRadioItem
                    key={system}
                    value={system}
                    className={menuItemClass}
                  >
                    {unitSystemLabels[system]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuCheckboxItem
            checked={autoRouting}
            className={cn(
              menuItemClass,
              "[&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden"
            )}
            onCheckedChange={(checked) => onAutoRoutingChange(checked === true)}
            onSelect={(event) => event.preventDefault()}
          >
            <Waypoints className="size-4 text-muted-foreground" />
            <span>Auto-route</span>
            <span
              aria-hidden="true"
              className={cn(
                "relative ml-auto h-3.5 w-6 overflow-hidden rounded-full ring-1 transition-colors duration-150 ring-inset",
                autoRouting
                  ? "bg-[#f1f2f3] ring-white/90"
                  : "bg-[#30343a] ring-white/10"
              )}
            >
              <span
                className={cn(
                  "absolute top-1/2 left-0.5 size-2.5 -translate-y-1/2 rounded-full transition-[transform,background-color] duration-150",
                  autoRouting
                    ? "translate-x-2.5 bg-[#3b3f45]"
                    : "translate-x-0 bg-white/65"
                )}
              />
            </span>
          </DropdownMenuCheckboxItem>

          <DropdownMenuSeparator className="my-1.5 bg-white/[0.08]" />

          <DropdownMenuItem
            className={menuItemClass}
            onSelect={onResetSettings}
          >
            <RotateCcw className="size-4 text-muted-foreground" />
            <span>Reset settings</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={!hasWorkspaceContent}
            className={menuItemClass}
            onSelect={() => setClearDialogOpen(true)}
          >
            <Trash2 className="size-4" />
            <span>Clear workspace…</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog.Root
        open={clearDialogOpen}
        onOpenChange={setClearDialogOpen}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[80] w-[min(360px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/[0.1] bg-[#1b1e22] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.55)] outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
            <AlertDialog.Title className="text-sm font-semibold">
              Clear workspace?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-xs leading-5 text-muted-foreground">
              This deletes every imported and drawn route, along with your
              folders. Your settings will stay the same. This can&apos;t be
              undone.
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center rounded-lg bg-[#d84a4a] px-3 text-xs font-medium text-white transition-[background-color,transform] outline-none hover:bg-[#e05555] focus-visible:ring-2 focus-visible:ring-white/35 active:scale-[0.96]"
                  onClick={onClearWorkspace}
                >
                  Clear workspace
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  )
}

function SidebarAction({
  icon: Icon,
  label,
  active = false,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] leading-4 font-[450] transition-[color,background-color] outline-none focus-visible:ring-2 focus-visible:ring-white/30",
        active
          ? "bg-white/[0.08] text-foreground"
          : "text-foreground/90 hover:bg-white/[0.06]"
      )}
      onClick={onClick}
    >
      <Icon className="size-4" />
      <span>{label}</span>
    </button>
  )
}

function TrackFolder({
  name,
  tracks,
  trackCount,
  activeTrackId,
  onSelectTrack,
  onToggleTrack,
  onChangeTrackColor,
  onRenameTrack,
  onDuplicateTrack,
  onDeleteTrack,
  onRenameFolder,
  onDeleteFolder,
  onMoveTrackToFolder,
  onMoveTrackRelative,
}: {
  name: string
  tracks: GpxTrack[]
  trackCount: number
  activeTrackId: string
  onSelectTrack: (trackId: string) => void
  onToggleTrack: (trackId: string) => void
  onChangeTrackColor: (trackId: string, color: string) => void
  onRenameTrack: (trackId: string, name: string) => boolean
  onDuplicateTrack: (trackId: string) => void
  onDeleteTrack: (trackId: string) => void
  onRenameFolder: (name: string, nextName: string) => boolean
  onDeleteFolder: (name: string) => void
  onMoveTrackToFolder: (trackId: string, folder: string) => void
  onMoveTrackRelative: (
    trackId: string,
    targetTrackId: string,
    position: "before" | "after"
  ) => void
}) {
  const [open, setOpen] = React.useState(true)
  const [renaming, setRenaming] = React.useState(false)
  const [draftName, setDraftName] = React.useState(name)
  const renameInputRef = React.useRef<HTMLInputElement>(null)
  const renameAfterMenuCloseRef = React.useRef(false)

  React.useEffect(() => {
    if (!renaming) {
      return
    }

    const timeout = window.setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [renaming])

  function commitRename() {
    if (onRenameFolder(name, draftName)) {
      setRenaming(false)
      return
    }
    window.requestAnimationFrame(() => renameInputRef.current?.focus())
  }

  return (
    <div
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(trackDragType)) {
          event.preventDefault()
          event.dataTransfer.dropEffect = "move"
        }
      }}
      onDrop={(event) => {
        event.preventDefault()
        const trackId = event.dataTransfer.getData(trackDragType)
        if (trackId) {
          onMoveTrackToFolder(trackId, name)
          setOpen(true)
        }
      }}
    >
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          {renaming ? (
            <form
              className="flex h-7 w-full items-center gap-2 rounded-md px-2"
              onSubmit={(event) => {
                event.preventDefault()
                commitRename()
              }}
            >
              {open ? (
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Folder className="size-4 shrink-0 text-muted-foreground" />
              )}
              <input
                ref={renameInputRef}
                value={draftName}
                maxLength={48}
                aria-label={`Rename ${name}`}
                className="h-8 min-w-0 flex-1 rounded border border-white/[0.14] bg-black/25 px-1.5 text-base outline-none focus:border-white/25 focus:ring-2 focus:ring-white/[0.08] sm:h-6 sm:text-[13px] sm:leading-4 sm:font-[450]"
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault()
                    setDraftName(name)
                    setRenaming(false)
                  }
                }}
              />
            </form>
          ) : (
            <button
              type="button"
              aria-expanded={open}
              className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] leading-4 font-[450] transition-colors hover:bg-white/[0.04]"
              onClick={() => setOpen((current) => !current)}
            >
              {open ? (
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Folder className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{name}</span>
            </button>
          )}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            className="z-50 min-w-48 overflow-hidden rounded-lg border border-white/[0.1] bg-[#181b20]/98 p-1 text-xs text-muted-foreground shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-xl outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
            collisionPadding={8}
            onCloseAutoFocus={(event) => {
              if (!renameAfterMenuCloseRef.current) {
                return
              }

              event.preventDefault()
              renameAfterMenuCloseRef.current = false
              setDraftName(name)
              setRenaming(true)
            }}
          >
            <ContextMenu.Item
              className={trackContextItemClass}
              onSelect={() => {
                renameAfterMenuCloseRef.current = true
              }}
            >
              <PencilLine className="size-3.5" />
              Rename folder
            </ContextMenu.Item>
            <ContextMenu.Separator className="my-1 h-px bg-white/[0.08]" />
            <ContextMenu.Item
              className={cn(
                trackContextItemClass,
                "text-[#ff7470] data-[highlighted]:bg-[#ff7470]/10 data-[highlighted]:text-[#ff8a86]"
              )}
              onSelect={() => onDeleteFolder(name)}
            >
              <Trash2 className="size-3.5" />
              {trackCount === 0
                ? "Delete folder"
                : `Delete folder and ${trackCount} ${
                    trackCount === 1 ? "track" : "tracks"
                  }`}
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      <div
        className={cn(
          "grid transition-[grid-template-rows] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
          open ? "grid-rows-[1fr] duration-200" : "grid-rows-[0fr] duration-150"
        )}
      >
        <div
          aria-hidden={!open}
          inert={!open}
          className="min-h-0 overflow-hidden"
        >
          <div className="mt-0.5 space-y-0.5">
            {tracks.map((track, index) => (
              <div
                key={track.id}
                className={cn(
                  "transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transform-none motion-reduce:transition-none",
                  open
                    ? "translate-y-0 opacity-100"
                    : "-translate-y-1 opacity-0"
                )}
                style={{
                  transitionDelay: open
                    ? `${Math.min(index, 4) * 18}ms`
                    : "0ms",
                }}
              >
                <TrackRow
                  track={track}
                  active={track.id === activeTrackId}
                  onSelect={() => onSelectTrack(track.id)}
                  onToggle={() => onToggleTrack(track.id)}
                  onChangeColor={(color) => onChangeTrackColor(track.id, color)}
                  onRename={(nextName) => onRenameTrack(track.id, nextName)}
                  onDuplicate={() => onDuplicateTrack(track.id)}
                  onDelete={() => onDeleteTrack(track.id)}
                  onMoveRelative={(movingTrackId, position) =>
                    onMoveTrackRelative(movingTrackId, track.id, position)
                  }
                />
              </div>
            ))}
            {tracks.length === 0 && (
              <div
                className={cn(
                  "mx-1 rounded-md border border-dashed border-white/[0.09] px-3 py-2 text-xs leading-4 text-muted-foreground/70 transition-opacity duration-150 motion-reduce:transition-none",
                  open ? "opacity-100" : "opacity-0"
                )}
              >
                Drop tracks here
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function TrackRow({
  track,
  active,
  showFolder = false,
  onSelect,
  onToggle,
  onChangeColor,
  onRename,
  onDuplicate,
  onDelete,
  onMoveRelative,
}: {
  track: GpxTrack
  active: boolean
  showFolder?: boolean
  onSelect: () => void
  onToggle: () => void
  onChangeColor: (color: string) => void
  onRename: (name: string) => boolean
  onDuplicate: () => void
  onDelete: () => void
  onMoveRelative: (movingTrackId: string, position: "before" | "after") => void
}) {
  const [dragPosition, setDragPosition] = React.useState<
    "before" | "after" | null
  >(null)
  const [renaming, setRenaming] = React.useState(false)
  const [draftName, setDraftName] = React.useState(track.name)
  const renameInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!renaming) {
      return
    }

    const timeout = window.setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [renaming])

  function commitRename() {
    if (onRename(draftName)) {
      setRenaming(false)
      return
    }
    window.requestAnimationFrame(() => renameInputRef.current?.focus())
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          draggable={!renaming}
          className={cn(
            "group relative flex h-[30px] items-center rounded-lg pl-2 transition-[background-color,opacity]",
            active ? "bg-white/[0.09]" : "hover:bg-white/[0.045]",
            !track.visible && "text-[#777d87]",
            dragPosition && "bg-white/[0.07]"
          )}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move"
            event.dataTransfer.setData(trackDragType, track.id)
            event.dataTransfer.setData("text/plain", track.id)
          }}
          onDragEnd={() => setDragPosition(null)}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(trackDragType)) {
              return
            }

            event.preventDefault()
            event.stopPropagation()
            const bounds = event.currentTarget.getBoundingClientRect()
            setDragPosition(
              event.clientY < bounds.top + bounds.height / 2
                ? "before"
                : "after"
            )
            event.dataTransfer.dropEffect = "move"
          }}
          onDragLeave={() => setDragPosition(null)}
          onDrop={(event) => {
            event.preventDefault()
            event.stopPropagation()
            const movingTrackId = event.dataTransfer.getData(trackDragType)
            if (movingTrackId && movingTrackId !== track.id) {
              const position = dragPosition ?? "after"
              onMoveRelative(movingTrackId, position)
            }
            setDragPosition(null)
          }}
        >
          {dragPosition && (
            <span
              className={cn(
                "pointer-events-none absolute right-1 left-1 z-10 h-0.5 rounded-full bg-white/60",
                dragPosition === "before" ? "-top-px" : "-bottom-px"
              )}
            />
          )}
          <TrackColorPicker
            trackName={track.name}
            color={track.color}
            muted={!track.visible}
            onChange={onChangeColor}
          />
          {renaming ? (
            <form
              className="ml-2 flex min-w-0 flex-1 items-center pr-1"
              onSubmit={(event) => {
                event.preventDefault()
                commitRename()
              }}
            >
              <input
                ref={renameInputRef}
                value={draftName}
                maxLength={80}
                aria-label={`Rename ${track.name}`}
                className="h-8 min-w-0 flex-1 rounded border border-white/[0.14] bg-black/25 px-1.5 text-base outline-none focus:border-white/25 focus:ring-2 focus:ring-white/[0.08] sm:h-6 sm:text-[13px] sm:leading-4 sm:font-[450]"
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault()
                    setDraftName(track.name)
                    setRenaming(false)
                  }
                }}
              />
            </form>
          ) : (
            <button
              type="button"
              className="ml-2 flex min-w-0 flex-1 items-center py-1 pr-1 text-left text-[13px] leading-4 font-[450]"
              onClick={onSelect}
              onDoubleClick={(event) => {
                event.preventDefault()
                onSelect()
                setDraftName(track.name)
                setRenaming(true)
              }}
            >
              <span className="truncate">
                {showFolder ? `${track.folder} / ${track.name}` : track.name}
              </span>
            </button>
          )}
          <button
            type="button"
            aria-label={`${track.visible ? "Hide" : "Show"} ${track.name}`}
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-md opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none",
              track.visible
                ? "text-muted-foreground hover:text-foreground"
                : "text-inherit"
            )}
            onClick={onToggle}
          >
            {track.visible ? (
              <Eye className="size-3.5" />
            ) : (
              <EyeOff className="size-3.5" />
            )}
          </button>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="z-50 min-w-40 overflow-hidden rounded-lg border border-white/[0.1] bg-[#181b20]/98 p-1 text-xs text-muted-foreground shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-xl outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            if (renameInputRef.current) {
              event.preventDefault()
            }
          }}
        >
          <ContextMenu.Item
            className={trackContextItemClass}
            onSelect={() => {
              setDraftName(track.name)
              setRenaming(true)
            }}
          >
            <PencilLine className="size-3.5" />
            Rename track
          </ContextMenu.Item>
          <ContextMenu.Item
            className={trackContextItemClass}
            onSelect={onDuplicate}
          >
            <Copy className="size-3.5" />
            Duplicate track
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-white/[0.08]" />
          <ContextMenu.Item
            className={cn(
              trackContextItemClass,
              "text-[#ff7470] data-[highlighted]:bg-[#ff7470]/10 data-[highlighted]:text-[#ff8a86]"
            )}
            onSelect={onDelete}
          >
            <Trash2 className="size-3.5" />
            Delete track
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

function TrackColorPicker({
  trackName,
  color,
  muted,
  onChange,
}: {
  trackName: string
  color: string
  muted: boolean
  onChange: (color: string) => void
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          draggable={false}
          aria-label={`Change color for ${trackName}`}
          title="Change track color"
          className="grid size-7 shrink-0 place-items-center rounded-md transition-colors outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/30"
        >
          <Route className="size-4" style={muted ? undefined : { color }} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="center"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex items-center gap-1 rounded-[9px] border border-white/[0.1] bg-[#181b20]/98 p-1 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-xl outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <Popover.Title className="sr-only">
            Choose a color for {trackName}
          </Popover.Title>
          {trackColors.map((trackColor) => {
            const selected = trackColor === color

            return (
              <Popover.Close asChild key={trackColor}>
                <button
                  type="button"
                  aria-label={trackColorLabels[trackColor]}
                  aria-pressed={selected}
                  title={trackColorLabels[trackColor]}
                  className={cn(
                    "grid size-7 place-items-center rounded-full transition-transform outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-white/35",
                    selected &&
                      "ring-2 ring-white/90 ring-offset-1 ring-offset-[#181b20]"
                  )}
                  onClick={() => onChange(trackColor)}
                >
                  <span
                    aria-hidden="true"
                    className="size-3.5 rounded-full"
                    style={{ backgroundColor: trackColor }}
                  />
                </button>
              </Popover.Close>
            )
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function MapHeader({
  hasActiveTrack,
  activeTool,
  onChooseTool,
  canUndo,
  canRedo,
  getUnavailableReason,
  onUndo,
  onRedo,
  onExport,
}: {
  hasActiveTrack: boolean
  activeTool: EditorTool
  onChooseTool: (tool: EditorTool) => void
  canUndo: boolean
  canRedo: boolean
  getUnavailableReason: (tool: EditorTool) => string | null
  onUndo: () => void
  onRedo: () => void
  onExport: () => void
}) {
  return (
    <header className="pointer-events-none absolute top-14 right-3 left-3 z-20 flex h-10 items-start justify-end gap-3 sm:top-3">
      <div
        className={cn(
          floatingControlFrameClass,
          "sidebar-aware-center pointer-events-auto absolute left-1/2 flex -translate-x-1/2 items-center"
        )}
      >
        {editorTools.map(({ id, label, icon: Icon }) => {
          const unavailableReason = getUnavailableReason(id)

          return (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <Button
                  aria-label={label}
                  aria-pressed={activeTool === id}
                  aria-disabled={unavailableReason ? true : undefined}
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-lg text-muted-foreground hover:bg-white/[0.1] hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-35 aria-disabled:hover:bg-transparent aria-pressed:bg-white/[0.1] aria-pressed:text-foreground dark:hover:bg-white/[0.1]"
                  onClick={() => {
                    if (!unavailableReason) {
                      onChooseTool(id)
                    }
                  }}
                >
                  <Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                {unavailableReason ?? label}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      <div
        className={cn(
          floatingControlFrameClass,
          "pointer-events-auto absolute -top-11 right-0 flex items-center sm:static"
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Undo"
              variant="ghost"
              size="icon-sm"
              className={pillControlButtonClass}
              disabled={!canUndo}
              onClick={onUndo}
            >
              <Undo2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            Undo
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Redo"
              variant="ghost"
              size="icon-sm"
              className={pillControlButtonClass}
              disabled={!canRedo}
              onClick={onRedo}
            >
              <Redo2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            Redo
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Export active GPX"
              variant="ghost"
              size="icon-sm"
              className={pillControlButtonClass}
              disabled={!hasActiveTrack}
              onClick={onExport}
            >
              <Download />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            Export GPX
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

function ToolHint({
  tool,
  autoRouting,
  onAutoRoutingChange,
}: {
  tool: EditorTool
  autoRouting: boolean
  onAutoRoutingChange: (enabled: boolean) => void
}) {
  const messages: Partial<Record<EditorTool, string>> = {
    split: "Click the route where you want to split it",
    crop: "Click both ends of the section you want to keep",
  }
  const message = messages[tool]
  if (tool !== "draw" && !message) {
    return null
  }

  return (
    <div
      className={cn(
        "sidebar-aware-center pointer-events-auto absolute left-1/2 z-20 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-2 border border-white/[0.1] bg-[#101010] p-1.5 text-xs leading-4 text-foreground/85 backdrop-blur-md",
        tool === "draw"
          ? "top-[96px] rounded-[10px] sm:top-[52px] sm:rounded-t-[4px] sm:rounded-b-[10px] sm:border-t-0"
          : "top-[108px] rounded-[10px] sm:top-16",
        message && "pl-3"
      )}
    >
      {message && <span className="whitespace-nowrap">{message}</span>}
      {tool === "draw" && (
        <button
          type="button"
          role="switch"
          aria-checked={autoRouting}
          aria-label="Auto-route"
          className="flex h-7 items-center gap-1.5 rounded-md px-2 font-medium text-foreground focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:outline-none"
          onClick={() => onAutoRoutingChange(!autoRouting)}
        >
          <Waypoints className="size-3.5 text-muted-foreground" />
          <span>Auto-route</span>
          <span
            aria-hidden="true"
            className={cn(
              "relative h-3.5 w-6 overflow-hidden rounded-full ring-1 transition-colors duration-150 ring-inset",
              autoRouting
                ? "bg-[#f1f2f3] ring-white/90"
                : "bg-[#30343a] ring-white/10"
            )}
          >
            <span
              className={cn(
                "absolute top-1/2 left-0.5 size-2.5 -translate-y-1/2 rounded-full shadow-sm transition-[transform,background-color] duration-150",
                autoRouting
                  ? "translate-x-2.5 bg-[#3b3f45]"
                  : "translate-x-0 bg-white/65"
              )}
            />
          </span>
        </button>
      )}
      {tool !== "draw" && (
        <span className="whitespace-nowrap text-muted-foreground">
          Esc to cancel
        </span>
      )}
    </div>
  )
}

function ElevationPanel({
  track,
  stats,
  unitSystem,
  open,
  hoveredPointIndex,
  onHoveredPointChange,
  onOpenChange,
}: {
  track: GpxTrack
  stats: ReturnType<typeof calculateTrackStats>
  unitSystem: UnitSystem
  open: boolean
  hoveredPointIndex: number | null
  onHoveredPointChange: (pointIndex: number | null) => void
  onOpenChange: (open: boolean) => void
}) {
  if (!open) {
    return (
      <button
        type="button"
        aria-label="Open elevation profile"
        className={cn(
          floatingControlFrameClass,
          "sidebar-aware-center absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center text-xs whitespace-nowrap"
        )}
        onClick={() => onOpenChange(true)}
      >
        <span className="flex h-8 min-w-0 items-center gap-2 rounded-[6px] px-2">
          <span className="hidden min-w-0 items-center gap-2 min-[520px]:flex">
            <Route className="size-4 shrink-0" style={{ color: track.color }} />
            <span className="max-w-[150px] truncate font-medium">
              {track.folder} / {track.name}
            </span>
          </span>
          <span
            aria-hidden="true"
            className="hidden h-4 w-px shrink-0 self-center bg-white/10 min-[520px]:block"
          />
          <Metric
            icon={Ruler}
            value={formatDistance(stats.distanceKm, unitSystem)}
          />
          <Metric
            icon={TrendingUp}
            value={formatElevation(stats.ascentM, unitSystem)}
          />
          <Metric
            icon={TrendingDown}
            value={formatElevation(stats.descentM, unitSystem)}
          />
          <span
            aria-hidden="true"
            className="h-4 w-px shrink-0 self-center bg-white/10"
          />
          <span className="text-muted-foreground">Profile</span>
          <ChevronUp className="size-3.5" />
        </span>
      </button>
    )
  }

  return (
    <section
      aria-label={`Elevation profile for ${track.name}`}
      className="sidebar-aware-center absolute bottom-3 left-1/2 z-20 h-[172px] w-[min(760px,calc(100%-24px))] -translate-x-1/2 overflow-hidden rounded-xl border border-white/[0.1] bg-[#101316]/96 backdrop-blur-md"
    >
      <header className="flex h-10 items-center justify-between border-b border-white/[0.06] px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Route className="size-4 shrink-0" style={{ color: track.color }} />
          <span className="truncate text-xs font-medium">
            {track.folder} / {track.name}
          </span>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-3 min-[560px]:flex">
            <Metric
              icon={Ruler}
              value={formatDistance(stats.distanceKm, unitSystem)}
            />
            <Metric
              icon={TrendingUp}
              value={formatElevation(stats.ascentM, unitSystem)}
            />
            <Metric
              icon={TrendingDown}
              value={formatElevation(stats.descentM, unitSystem)}
            />
          </div>
          <button
            type="button"
            aria-label="Collapse elevation profile"
            className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-white/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-white/30"
            onClick={() => onOpenChange(false)}
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      </header>
      <ElevationChart
        track={track}
        stats={stats}
        unitSystem={unitSystem}
        hoveredPointIndex={hoveredPointIndex}
        onHoveredPointChange={onHoveredPointChange}
      />
    </section>
  )
}

function Metric({
  icon: Icon,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  value: string
}) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-xs leading-4 whitespace-nowrap">
      <Icon className="size-3.5 text-muted-foreground" />
      {value}
    </span>
  )
}

function distanceBetweenTrackCoordinates(
  first: GpxTrack["coordinates"][number],
  second: GpxTrack["coordinates"][number]
) {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const earthRadiusKm = 6371
  const latitudeDelta = toRadians(second[1] - first[1])
  const longitudeDelta = toRadians(second[0] - first[0])
  const latitudeA = toRadians(first[1])
  const latitudeB = toRadians(second[1])
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(longitudeDelta / 2) ** 2

  return (
    earthRadiusKm *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  )
}

function smoothElevationPath(points: readonly (readonly [number, number])[]) {
  if (points.length === 0) return ""
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`

  return points.reduce((path, point, index) => {
    if (index === 0) return `M ${point[0]} ${point[1]}`

    const previous = points[index - 1]
    const beforePrevious = points[index - 2] ?? previous
    const next = points[index + 1] ?? point
    const firstControlX = previous[0] + (point[0] - beforePrevious[0]) / 6
    const firstControlY = previous[1] + (point[1] - beforePrevious[1]) / 6
    const secondControlX = point[0] - (next[0] - previous[0]) / 6
    const secondControlY = point[1] - (next[1] - previous[1]) / 6

    return `${path} C ${firstControlX} ${firstControlY}, ${secondControlX} ${secondControlY}, ${point[0]} ${point[1]}`
  }, "")
}

function getElevationChartSampleIndices(
  coordinates: readonly TrackCoordinate[],
  maxPoints = 1200
) {
  if (coordinates.length <= maxPoints) {
    return coordinates.map((_, index) => index)
  }

  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 2))
  const bucketSize = (coordinates.length - 2) / bucketCount
  const sampledIndices = [0]

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const startIndex = 1 + Math.floor(bucket * bucketSize)
    const endIndex = Math.min(
      coordinates.length - 1,
      1 + Math.floor((bucket + 1) * bucketSize)
    )
    if (startIndex >= endIndex) {
      continue
    }

    let lowestIndex = startIndex
    let highestIndex = startIndex
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      if (coordinates[index][2] < coordinates[lowestIndex][2]) {
        lowestIndex = index
      }
      if (coordinates[index][2] > coordinates[highestIndex][2]) {
        highestIndex = index
      }
    }

    if (lowestIndex < highestIndex) {
      sampledIndices.push(lowestIndex, highestIndex)
    } else if (highestIndex < lowestIndex) {
      sampledIndices.push(highestIndex, lowestIndex)
    } else {
      sampledIndices.push(lowestIndex)
    }
  }

  sampledIndices.push(coordinates.length - 1)
  return sampledIndices
}

function ElevationChart({
  track,
  stats,
  unitSystem,
  hoveredPointIndex,
  onHoveredPointChange,
}: {
  track: GpxTrack
  stats: ReturnType<typeof calculateTrackStats>
  unitSystem: UnitSystem
  hoveredPointIndex: number | null
  onHoveredPointChange: (pointIndex: number | null) => void
}) {
  const plotRef = React.useRef<HTMLDivElement>(null)
  const hoverFrameRef = React.useRef<number | null>(null)
  const pendingHoverIndexRef = React.useRef<number | null>(null)
  const lastHoverIndexRef = React.useRef<number | null>(null)
  const activePointIndex = hoveredPointIndex ?? 0
  const width = 1000
  const height = 84
  const displayedHighestElevation = convertElevation(stats.highestM, unitSystem)
  const displayedLowestElevation = convertElevation(stats.lowestM, unitSystem)
  const rawTickStep = Math.max(
    1,
    (displayedHighestElevation - displayedLowestElevation) / 2
  )
  const tickScale = 10 ** Math.floor(Math.log10(rawTickStep))
  const tickStep = Math.ceil(rawTickStep / tickScale) * tickScale
  let chartMaximum = Math.ceil(displayedHighestElevation / tickStep) * tickStep
  let chartMinimum = chartMaximum - tickStep * 2

  if (chartMinimum > displayedLowestElevation) {
    chartMinimum = Math.floor(displayedLowestElevation / tickStep) * tickStep
    chartMaximum = chartMinimum + tickStep * 2
  }

  const chartMinimumValue = chartMinimum
  const chartMaximumValue = chartMaximum
  const range = Math.max(1, chartMaximumValue - chartMinimumValue)
  const { linePath, areaPath } = React.useMemo(() => {
    const points = getElevationChartSampleIndices(track.coordinates).map(
      (index) => {
        const coordinate = track.coordinates[index]
        const x =
          track.coordinates.length > 1
            ? (index / (track.coordinates.length - 1)) * width
            : 0
        const y =
          height -
          ((convertElevation(coordinate[2], unitSystem) - chartMinimumValue) /
            range) *
            height
        return [x, y] as const
      }
    )
    const nextLinePath = smoothElevationPath(points)
    return {
      linePath: nextLinePath,
      areaPath: `${nextLinePath} L ${width} ${height} L 0 ${height} Z`,
    }
  }, [chartMinimumValue, range, track.coordinates, unitSystem])
  const distances = React.useMemo(() => {
    const values = new Array<number>(track.coordinates.length)
    let total = 0

    for (let index = 0; index < track.coordinates.length; index += 1) {
      if (index > 0) {
        total += distanceBetweenTrackCoordinates(
          track.coordinates[index - 1],
          track.coordinates[index]
        )
      }
      values[index] = total
    }

    return values
  }, [track.coordinates])
  const activeCoordinate =
    hoveredPointIndex === null ? null : track.coordinates[activePointIndex]
  const activePoint = activeCoordinate
    ? ([
        track.coordinates.length > 1
          ? (activePointIndex / (track.coordinates.length - 1)) * width
          : 0,
        height -
          ((convertElevation(activeCoordinate[2], unitSystem) -
            chartMinimumValue) /
            range) *
            height,
      ] as const)
    : ([0, height] as const)
  const activeDistance = distances[activePointIndex] ?? 0
  const activePercent =
    track.coordinates.length > 1
      ? (activePointIndex / (track.coordinates.length - 1)) * 100
      : 0
  const tooltipPercent = Math.min(92, Math.max(8, activePercent))
  const yTicks = [
    chartMaximumValue,
    chartMaximumValue - tickStep,
    chartMinimumValue,
  ]
  const xTicks = [0, 0.5, 1]
  const distanceFractionDigits =
    convertDistance(stats.distanceKm, unitSystem) < 10 ? 1 : 0
  const lowestElevation = Math.round(displayedLowestElevation)
  const highestElevation = Math.round(displayedHighestElevation)

  React.useEffect(
    () => () => {
      if (hoverFrameRef.current !== null) {
        window.cancelAnimationFrame(hoverFrameRef.current)
      }
    },
    []
  )

  const scheduleHoveredPoint = (pointIndex: number | null) => {
    pendingHoverIndexRef.current = pointIndex
    if (hoverFrameRef.current !== null) {
      return
    }

    hoverFrameRef.current = window.requestAnimationFrame(() => {
      hoverFrameRef.current = null
      const nextPointIndex = pendingHoverIndexRef.current
      if (lastHoverIndexRef.current === nextPointIndex) {
        return
      }

      lastHoverIndexRef.current = nextPointIndex
      onHoveredPointChange(nextPointIndex)
    })
  }

  const updateHoveredPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = plotRef.current?.getBoundingClientRect()
    if (!bounds || track.coordinates.length === 0) return

    const relativeX = Math.min(
      1,
      Math.max(0, (event.clientX - bounds.left) / bounds.width)
    )
    scheduleHoveredPoint(
      Math.round(relativeX * Math.max(0, track.coordinates.length - 1))
    )
  }

  return (
    <div className="relative h-[132px] bg-[#101316]">
      <div
        ref={plotRef}
        className="absolute top-[30px] right-4 bottom-7 left-12 touch-none"
        onPointerEnter={updateHoveredPoint}
        onPointerMove={updateHoveredPoint}
        onPointerLeave={() => scheduleHoveredPoint(null)}
      >
        {[0, 1, 2].map((lineIndex) => (
          <div
            key={lineIndex}
            className="absolute right-0 left-0 border-t border-white/[0.07]"
            style={{ top: `${lineIndex * 50}%` }}
          />
        ))}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
          role="img"
          aria-label={`Elevation ranges from ${lowestElevation} to ${highestElevation} ${elevationUnitName(unitSystem)}`}
        >
          <path d={areaPath} fill={`${track.color}18`} />
          <path
            d={linePath}
            fill="none"
            stroke={track.color}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {activeCoordinate && (
            <>
              <line
                x1={activePoint[0]}
                x2={activePoint[0]}
                y1={0}
                y2={height}
                stroke={track.color}
                strokeOpacity="0.45"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={activePoint[0]}
                cy={activePoint[1]}
                r="4"
                fill="#101316"
                stroke={track.color}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
        {xTicks.map((fraction, index) => (
          <span
            key={fraction}
            className={cn(
              "absolute top-[calc(100%+6px)] font-mono text-[10px] text-white/55 tabular-nums",
              index === 0
                ? "left-0"
                : index === xTicks.length - 1
                  ? "right-0"
                  : "-translate-x-1/2"
            )}
            style={
              index > 0 && index < xTicks.length - 1
                ? { left: `${fraction * 100}%` }
                : undefined
            }
          >
            {formatDistance(
              stats.distanceKm * fraction,
              unitSystem,
              fraction === 0 ? 0 : distanceFractionDigits
            )}
          </span>
        ))}
        {activeCoordinate && (
          <div
            className="pointer-events-none absolute -top-6 z-10 flex h-6 -translate-x-1/2 items-center rounded-md border border-white/10 bg-[#25282d] px-2 font-mono text-[10px] font-medium whitespace-nowrap text-[#f2f3f5] tabular-nums"
            style={{ left: `${tooltipPercent}%` }}
          >
            {formatDistance(activeDistance, unitSystem)}
            <span className="mx-2 text-white/55">·</span>
            {formatElevation(activeCoordinate[2], unitSystem)}
          </div>
        )}
      </div>
      {yTicks.map((tick, index) => (
        <span
          key={`${tick}-${index}`}
          className="absolute left-3 -translate-y-1/2 font-mono text-[10px] text-white/55 tabular-nums"
          style={{ top: `${30 + index * 37}px` }}
        >
          {Math.round(tick)}
        </span>
      ))}
    </div>
  )
}
