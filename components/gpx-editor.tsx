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
  MousePointer2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Plus,
  Redo2,
  Route,
  Ruler,
  Scissors,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trash2,
  Undo2,
  X,
} from "lucide-react"
import { ContextMenu, Popover } from "radix-ui"

import { MapCanvas } from "@/components/map-canvas"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  calculateTrackStats,
  parseGpx,
  serializeTrackToGpx,
  trackColors,
  type GpxTrack,
} from "@/lib/gpx"
import { cn } from "@/lib/utils"
import {
  loadWorkspace,
  saveWorkspace,
  type WorkspaceSnapshot,
} from "@/lib/workspace-storage"

type EditorTool =
  "select" | "draw" | "split" | "crop" | "simplify" | "clean" | "merge"

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
  "h-10 rounded-[8px] border border-white/[0.08] bg-[#181b20]/94 p-1 shadow-2xl backdrop-blur-md"
const pillControlButtonClass =
  "hover:bg-white/[0.1] active:bg-white/[0.1] dark:hover:bg-white/[0.1] dark:active:bg-white/[0.1]"
const sidebarMinWidth = 260
const sidebarMaxWidth = 320
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
      <span className="text-[19px] font-black tracking-[-0.07em] italic">
        GPX
      </span>
      <span className="text-[16px] font-semibold tracking-[-0.04em]">
        Lab
      </span>
    </div>
  )
}

function clampSidebarWidth(width: number) {
  return Math.min(sidebarMaxWidth, Math.max(sidebarMinWidth, width))
}

export function GpxEditor() {
  const [tracks, setTracks] = React.useState<GpxTrack[]>([])
  const [folders, setFolders] = React.useState<string[]>([])
  const [activeTrackId, setActiveTrackId] = React.useState("")
  const [activeTool, setActiveTool] = React.useState<EditorTool>("select")
  const [sidebarOpen, setSidebarOpen] = React.useState(true)
  const [sidebarTransitioning, setSidebarTransitioning] = React.useState(false)
  const [sidebarWidth, setSidebarWidth] = React.useState(sidebarMinWidth)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [elevationOpen, setElevationOpen] = React.useState(false)
  const [fileDragActive, setFileDragActive] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [workspaceReady, setWorkspaceReady] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const fileDragDepthRef = React.useRef(0)
  const persistenceDisabledRef = React.useRef(false)

  const activeTrack =
    tracks.find((track) => track.id === activeTrackId) ?? tracks[0]
  const stats = React.useMemo(
    () => (activeTrack ? calculateTrackStats(activeTrack) : null),
    [activeTrack]
  )
  const groupedTracks = React.useMemo(
    () =>
      folders.flatMap((folder) => {
        const normalizedQuery = query.trim().toLowerCase()
        const folderMatches = folder.toLowerCase().includes(normalizedQuery)
        const folderTracks = tracks.filter(
          (track) =>
            track.folder === folder &&
            (folderMatches ||
              track.name.toLowerCase().includes(normalizedQuery))
        )

        if (normalizedQuery && !folderMatches && folderTracks.length === 0) {
          return []
        }

        return [{ name: folder, tracks: folderTracks }]
      }),
    [folders, query, tracks]
  )

  React.useEffect(() => {
    let cancelled = false

    loadWorkspace()
      .then((workspace) => {
        if (cancelled || !workspace) {
          return
        }

        const restoredFolders = Array.from(
          new Set([
            ...workspace.folders,
            ...workspace.tracks.map((track) => track.folder),
          ])
        )
        const restoredActiveTrackId = workspace.tracks.some(
          (track) => track.id === workspace.activeTrackId
        )
          ? workspace.activeTrackId
          : (workspace.tracks[0]?.id ?? "")

        setTracks(workspace.tracks)
        setFolders(restoredFolders)
        setActiveTrackId(restoredActiveTrackId)
        setSidebarOpen(workspace.sidebarOpen)
        setSidebarWidth(
          clampSidebarWidth(workspace.sidebarWidth ?? sidebarMinWidth)
        )
        setSearchOpen(workspace.searchOpen)
        setElevationOpen(workspace.elevationOpen)
      })
      .catch((error) => {
        persistenceDisabledRef.current = true
        console.error("[Workspace] Could not restore saved state", error)
        if (!cancelled) {
          setNotice("This browser could not restore or save your workspace")
        }
      })
      .finally(() => {
        if (!cancelled) {
          setWorkspaceReady(true)
        }
      })

    return () => {
      cancelled = true
    }
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
      searchOpen,
      elevationOpen,
    }

    void saveWorkspace(workspace).catch((error) => {
      persistenceDisabledRef.current = true
      console.error("[Workspace] Could not save state", error)
      setNotice("Changes could not be saved in this browser")
    })
  }, [
    activeTrackId,
    elevationOpen,
    folders,
    searchOpen,
    sidebarOpen,
    sidebarWidth,
    tracks,
    workspaceReady,
  ])

  React.useEffect(() => {
    if (!notice) {
      return
    }

    const timeout = window.setTimeout(() => setNotice(null), 2800)
    return () => window.clearTimeout(timeout)
  }, [notice])

  function chooseTool(tool: EditorTool) {
    setActiveTool(tool)
  }

  function closeSidebar() {
    setSidebarTransitioning(true)
    setSidebarOpen(false)
  }

  function openSidebar() {
    setSidebarTransitioning(true)
    setSidebarOpen(true)
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
    if (!activeTrack) {
      setNotice("Import a track before exporting")
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

  if (!workspaceReady) {
    return (
      <main className="grid h-svh w-full place-items-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">Restoring workspace…</p>
      </main>
    )
  }

  const collapsedControlReady = !sidebarOpen && !sidebarTransitioning
  const controlUsesCollapsedLayout = collapsedControlReady
  const closingSidebar = !sidebarOpen && sidebarTransitioning

  return (
    <TooltipProvider delayDuration={280}>
      <main className="relative flex h-svh w-full overflow-hidden bg-background text-foreground">
        <input
          ref={fileInputRef}
          type="file"
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
              "pointer-events-none absolute -inset-px transition-[opacity,transform] transform-gpu",
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
          query={query}
          searchOpen={searchOpen}
          tracks={tracks}
          groupedTracks={groupedTracks}
          activeTrackId={activeTrackId}
          onLayoutTransitionEnd={() => setSidebarTransitioning(false)}
          onWidthChange={setSidebarWidth}
          onOpenSearch={() => setSearchOpen((current) => !current)}
          onQueryChange={setQuery}
          onNewRoute={() => chooseTool("draw")}
          onImport={() => fileInputRef.current?.click()}
          onSelectTrack={setActiveTrackId}
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
        />

        <section
          className="map-shell relative min-w-0 flex-1 overflow-hidden"
          onDragEnter={handleFileDragEnter}
          onDragOver={handleFileDragOver}
          onDragLeave={handleFileDragLeave}
          onDrop={handleFileDrop}
        >
          <MapCanvas
            tracks={tracks}
            activeTrackId={activeTrackId}
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
              <div className="pointer-events-auto flex w-full max-w-[320px] flex-col items-center rounded-2xl border border-white/[0.1] bg-[#181b20]/95 px-7 py-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl">
                <span className="grid size-10 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.05] text-muted-foreground">
                  <Route className="size-4" />
                </span>
                <h1 className="mt-4 text-sm font-semibold">
                  No GPX files yet
                </h1>
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
              </div>
            </div>
          )}

          {activeTrack && (
            <MapHeader
              activeTool={activeTool}
              onChooseTool={chooseTool}
              onExport={exportActiveTrack}
            />
          )}

          {notice && (
            <div
              role="status"
              className="absolute top-16 left-1/2 z-30 -translate-x-1/2 animate-in rounded-lg border border-white/10 bg-[#181b20]/95 px-3 py-2 text-xs shadow-2xl backdrop-blur-md fade-in slide-in-from-top-1"
            >
              {notice}
            </div>
          )}

          {activeTrack && stats && (
            <ElevationPanel
              track={activeTrack}
              stats={stats}
              open={elevationOpen}
              onOpenChange={setElevationOpen}
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
  searchOpen: boolean
  query: string
  tracks: GpxTrack[]
  groupedTracks: { name: string; tracks: GpxTrack[] }[]
  activeTrackId: string
  onLayoutTransitionEnd: () => void
  onWidthChange: (width: number) => void
  onOpenSearch: () => void
  onQueryChange: (query: string) => void
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
  onMoveTrackRelative: (
    trackId: string,
    targetTrackId: string,
    position: "before" | "after"
  ) => void
}

function Sidebar({
  open,
  width,
  searchOpen,
  query,
  tracks,
  groupedTracks,
  activeTrackId,
  onLayoutTransitionEnd,
  onWidthChange,
  onOpenSearch,
  onQueryChange,
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

  return (
    <aside
      className={cn(
        "absolute inset-y-0 left-0 z-40 h-svh overflow-hidden border-r border-white/[0.06] bg-[#101010]",
        resizing
          ? "transition-none"
          : "transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
        !open && "pointer-events-none -translate-x-full"
      )}
      style={{ width }}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) {
          onLayoutTransitionEnd()
        }
      }}
    >
      <div className="flex h-full flex-col px-3 py-5" style={{ width }}>
        <nav aria-label="Main actions" className="mt-11 space-y-1">
          <SidebarAction
            icon={Search}
            label="Search"
            active={searchOpen}
            onClick={onOpenSearch}
          />
          {searchOpen && (
            <div className="px-1 pb-1">
              <label className="relative block">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder="Find a track"
                  className="h-8 w-full rounded-lg border border-input bg-black/20 pr-8 pl-8 text-xs transition outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => onQueryChange("")}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </label>
            </div>
          )}
          <SidebarAction icon={Plus} label="New route" onClick={onNewRoute} />
          <SidebarAction icon={FileUp} label="Import GPX" onClick={onImport} />
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
                  className="h-7 min-w-0 flex-1 bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground/60"
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
                    Import your first GPX file
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <SidebarAction
          icon={Settings}
          label="Settings"
          onClick={() => undefined}
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
          "absolute inset-y-0 right-0 z-50 w-1.5 touch-none cursor-col-resize outline-none focus-visible:bg-white/[0.08]",
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
        "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors",
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
              <Folder className="size-4 shrink-0" />
              <input
                ref={renameInputRef}
                value={draftName}
                maxLength={48}
                aria-label={`Rename ${name}`}
                className="h-6 min-w-0 flex-1 rounded border border-white/[0.14] bg-black/25 px-1.5 text-[13px] outline-none focus:border-white/25 focus:ring-2 focus:ring-white/[0.08]"
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
              className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] transition-colors hover:bg-white/[0.04]"
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
              if (renameInputRef.current) {
                event.preventDefault()
              }
            }}
          >
            <ContextMenu.Item
              className={trackContextItemClass}
              onSelect={() => {
                setDraftName(name)
                setRenaming(true)
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
          open
            ? "grid-rows-[1fr] duration-200"
            : "grid-rows-[0fr] duration-150"
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
                  "mx-1 rounded-md border border-dashed border-white/[0.09] px-3 py-2 text-[11px] text-muted-foreground/70 transition-opacity duration-150 motion-reduce:transition-none",
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
                className="h-6 min-w-0 flex-1 rounded border border-white/[0.14] bg-black/25 px-1.5 text-[13px] outline-none focus:border-white/25 focus:ring-2 focus:ring-white/[0.08]"
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
              className="ml-2 flex min-w-0 flex-1 items-center py-1 pr-1 text-left text-[13px]"
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
              "grid size-7 shrink-0 place-items-center rounded-md",
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
          className="grid h-7 w-3.5 shrink-0 place-items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-white/25"
        >
          <Route
            className="size-4"
            style={muted ? undefined : { color }}
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="center"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex items-center rounded-[7px] border border-white/[0.1] bg-[#181b20]/98 p-1 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-xl outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
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
                    "grid size-5 place-items-center rounded-full outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-white/35",
                    selected &&
                      "ring-2 ring-white/90 ring-offset-1 ring-offset-[#181b20]"
                  )}
                  onClick={() => onChange(trackColor)}
                >
                  <span
                    aria-hidden="true"
                    className="size-3 rounded-full"
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
  activeTool,
  onChooseTool,
  onExport,
}: {
  activeTool: EditorTool
  onChooseTool: (tool: EditorTool) => void
  onExport: () => void
}) {
  return (
    <header className="pointer-events-none absolute top-3 right-3 left-3 z-20 flex h-10 items-start justify-end gap-3">
      <div
        className={cn(
          floatingControlFrameClass,
          "pointer-events-auto absolute left-1/2 flex -translate-x-1/2 items-center"
        )}
      >
        {editorTools.map(({ id, label, icon: Icon }) => (
          <React.Fragment key={id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={label}
                  aria-pressed={activeTool === id}
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-lg text-muted-foreground hover:bg-white/[0.1] hover:text-foreground aria-pressed:bg-white/[0.1] aria-pressed:text-foreground dark:hover:bg-white/[0.1]"
                  onClick={() => onChooseTool(id)}
                >
                  <Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                {label}
              </TooltipContent>
            </Tooltip>
          </React.Fragment>
        ))}
      </div>

      <div
        className={cn(
          floatingControlFrameClass,
          "pointer-events-auto flex items-center"
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Undo"
              variant="ghost"
              size="icon-sm"
              className={pillControlButtonClass}
              disabled
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
              disabled
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
              onClick={onExport}
            >
              <Download />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            Export GPX
          </TooltipContent>
        </Tooltip>
        <Button
          aria-label="More actions"
          variant="ghost"
          size="icon-sm"
          className={pillControlButtonClass}
        >
          <MoreHorizontal />
        </Button>
      </div>
    </header>
  )
}

function ElevationPanel({
  track,
  stats,
  open,
  onOpenChange,
}: {
  track: GpxTrack
  stats: ReturnType<typeof calculateTrackStats>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!open) {
    return (
      <button
        type="button"
        className={cn(
          floatingControlFrameClass,
          "absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center text-xs whitespace-nowrap"
        )}
        onClick={() => onOpenChange(true)}
      >
        <span className="flex h-8 min-w-0 items-center gap-3 rounded-[6px] px-2">
          <span className="flex min-w-0 items-center gap-2">
            <Route
              className="size-4 shrink-0"
              style={{ color: track.color }}
            />
            <span className="max-w-[180px] truncate font-medium">
              {track.folder} / {track.name}
            </span>
          </span>
          <span
            aria-hidden="true"
            className="h-4 w-px shrink-0 self-center bg-white/10"
          />
          <Metric icon={Ruler} value={`${stats.distanceKm.toFixed(1)} km`} />
          <Metric icon={TrendingUp} value={`${Math.round(stats.ascentM)} m`} />
          <Metric
            icon={TrendingDown}
            value={`${Math.round(stats.descentM)} m`}
          />
          <span
            aria-hidden="true"
            className="h-4 w-px shrink-0 self-center bg-white/10"
          />
          <span className="text-muted-foreground">View more</span>
          <ChevronUp className="size-3.5" />
        </span>
      </button>
    )
  }

  return (
    <section className="absolute bottom-4 left-1/2 z-20 h-[236px] w-[min(920px,calc(100%-32px))] -translate-x-1/2 animate-in overflow-hidden rounded-xl border border-[#3a4149] bg-[#101316]/98 shadow-[0_24px_80px_rgba(0,0,0,0.58)] backdrop-blur-md duration-300 fade-in slide-in-from-bottom-3">
      <header className="flex h-11 items-center justify-between pr-3 pl-4">
        <div className="flex min-w-0 items-center gap-2">
          <Route
            className="size-4 shrink-0"
            style={{ color: track.color }}
          />
          <span className="truncate text-xs font-medium">
            {track.folder} / {track.name}
          </span>
        </div>
        <div className="ml-4 flex shrink-0 items-center gap-2">
          <div className="hidden h-11 items-center gap-3 px-2 sm:flex">
            <Metric
              icon={Ruler}
              value={`${stats.distanceKm.toFixed(1)} km`}
            />
            <span className="h-4 w-px bg-white/10" />
            <Metric
              icon={TrendingUp}
              value={`${Math.round(stats.ascentM)} m`}
            />
            <span className="h-4 w-px bg-white/10" />
            <Metric
              icon={TrendingDown}
              value={`${Math.round(stats.descentM)} m`}
            />
          </div>
          <button
            type="button"
            aria-label="Collapse elevation profile"
            className="grid size-7 place-items-center rounded-lg bg-[#2d2d2d] text-[#d6dbe0] transition-colors hover:bg-[#383838] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            onClick={() => onOpenChange(false)}
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      </header>
      <ElevationChart track={track} stats={stats} />
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
    <span className="flex items-center gap-1.5 font-mono text-[11px] whitespace-nowrap">
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

function ElevationChart({
  track,
  stats,
}: {
  track: GpxTrack
  stats: ReturnType<typeof calculateTrackStats>
}) {
  const plotRef = React.useRef<HTMLDivElement>(null)
  const defaultPointIndex = Math.floor((track.coordinates.length - 1) / 2)
  const [hoveredPointIndex, setHoveredPointIndex] = React.useState<number | null>(
    null
  )
  const activePointIndex = hoveredPointIndex ?? defaultPointIndex
  const width = 1000
  const height = 126
  const rawTickStep = Math.max(1, (stats.highestM - stats.lowestM) / 3)
  const tickScale = 10 ** Math.floor(Math.log10(rawTickStep))
  const tickStep = Math.ceil(rawTickStep / tickScale) * tickScale
  let chartMaximum = Math.ceil(stats.highestM / tickStep) * tickStep
  let chartMinimum = chartMaximum - tickStep * 3

  if (chartMinimum > stats.lowestM) {
    chartMinimum = Math.floor(stats.lowestM / tickStep) * tickStep
    chartMaximum = chartMinimum + tickStep * 3
  }

  const range = Math.max(1, chartMaximum - chartMinimum)
  const points = track.coordinates.map((coordinate, index) => {
    const x =
      track.coordinates.length > 1
        ? (index / (track.coordinates.length - 1)) * width
        : 0
    const y = height - ((coordinate[2] - chartMinimum) / range) * height
    return [x, y] as const
  })
  const linePath = smoothElevationPath(points)
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`
  const distances = React.useMemo(
    () =>
      track.coordinates.reduce(
        (result, coordinate, index) => {
          const total =
            index === 0
              ? 0
              : result.total +
                distanceBetweenTrackCoordinates(
                  track.coordinates[index - 1],
                  coordinate
                )

          return {
            total,
            values: [...result.values, total],
          }
        },
        { total: 0, values: [] as number[] }
      ).values,
    [track.coordinates]
  )
  const activePoint = points[activePointIndex] ?? [0, height]
  const activeCoordinate = track.coordinates[activePointIndex]
  const activeDistance = distances[activePointIndex] ?? 0
  const activePercent =
    track.coordinates.length > 1
      ? (activePointIndex / (track.coordinates.length - 1)) * 100
      : 0
  const tooltipPercent = Math.min(92, Math.max(8, activePercent))
  const yTicks = [chartMaximum, chartMaximum - tickStep, chartMaximum - tickStep * 2, chartMinimum]
  const xTicks = [0, 0.25, 0.5, 0.75, 1]

  const updateHoveredPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = plotRef.current?.getBoundingClientRect()
    if (!bounds || track.coordinates.length === 0) return

    const relativeX = Math.min(
      1,
      Math.max(0, (event.clientX - bounds.left) / bounds.width)
    )
    setHoveredPointIndex(
      Math.round(relativeX * Math.max(0, track.coordinates.length - 1))
    )
  }

  return (
    <div className="relative h-[192px] bg-[#101316]">
      <div
        ref={plotRef}
        className="absolute top-[34px] right-6 bottom-8 left-16 touch-none"
        onPointerEnter={updateHoveredPoint}
        onPointerMove={updateHoveredPoint}
        onPointerLeave={() => setHoveredPointIndex(null)}
      >
        {[0, 1, 2, 3].map((lineIndex) => (
          <div
            key={lineIndex}
            className="absolute right-0 left-0 border-t border-[#2e333b]/70"
            style={{ top: `${lineIndex * 33.333}%` }}
          />
        ))}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
          role="img"
          aria-label={`Elevation ranges from ${Math.round(stats.lowestM)} to ${Math.round(stats.highestM)} meters`}
        >
          <path d={areaPath} fill={`${track.color}1f`} />
          <path
            d={linePath}
            fill="none"
            stroke={track.color}
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <line
            x1={activePoint[0]}
            x2={activePoint[0]}
            y1={0}
            y2={height}
            stroke={track.color}
            strokeOpacity="0.5"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={activePoint[0]}
            cy={activePoint[1]}
            r="6"
            fill="#101316"
            stroke={track.color}
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={activePoint[0]}
            cy={activePoint[1]}
            r="2"
            fill={track.color}
          />
        </svg>
        {xTicks.map((fraction, index) => (
          <span
            key={fraction}
            className={cn(
              "absolute top-[calc(100%+8px)] font-mono text-xs text-[#737d8a]",
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
            {(stats.distanceKm * fraction).toFixed(0)} km
          </span>
        ))}
        {activeCoordinate && (
          <div
            className="pointer-events-none absolute -top-[30px] z-10 flex h-7 -translate-x-1/2 items-center rounded-[7px] border border-white/10 bg-[#2d2d2d] px-2.5 font-mono text-[11px] font-medium whitespace-nowrap text-[#ebedf2] shadow-sm"
            style={{ left: `${tooltipPercent}%` }}
          >
            {activeDistance.toFixed(1)} km
            <span className="mx-2 text-white/55">·</span>
            {Math.round(activeCoordinate[2])} m
          </div>
        )}
      </div>
      {yTicks.map((tick, index) => (
        <span
          key={`${tick}-${index}`}
          className="absolute left-5 -translate-y-1/2 font-mono text-xs text-[#737d8a]"
          style={{ top: `${34 + index * 42}px` }}
        >
          {Math.round(tick)}
        </span>
      ))}
    </div>
  )
}
