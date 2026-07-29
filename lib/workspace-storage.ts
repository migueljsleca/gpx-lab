import type { GpxTrack, TrackCoordinate } from "@/lib/gpx"
import {
  isMapStyleId,
  isRouteLineWeight,
  type MapStyleId,
  type RouteLineWeight,
} from "@/lib/editor-preferences"
import { isUnitSystem, type UnitSystem } from "@/lib/units"

const databaseName = "gpx-lab"
const databaseVersion = 1
const workspaceStore = "workspaces"
const currentWorkspaceKey = "current"
const databaseOpenTimeoutMs = 3000
const databaseOperationTimeoutMs = 3000

export type WorkspaceSnapshot = {
  version: 1
  tracks: GpxTrack[]
  folders: string[]
  activeTrackId: string
  sidebarOpen: boolean
  sidebarWidth?: number
  elevationOpen: boolean
  autoRouting?: boolean
  mapStyle?: MapStyleId
  mapStyleDefaultsVersion?: number
  routeLineWeight?: RouteLineWeight
  unitSystem?: UnitSystem
}

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB is not supported"))
  }

  if (databasePromise) {
    return databasePromise
  }

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, databaseVersion)
    let settled = false
    const timeout = window.setTimeout(() => {
      settled = true
      databasePromise = null
      reject(new Error("Workspace storage did not respond"))
    }, databaseOpenTimeoutMs)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(workspaceStore)) {
        database.createObjectStore(workspaceStore)
      }
    }

    request.onsuccess = () => {
      window.clearTimeout(timeout)
      if (settled) {
        request.result.close()
        return
      }
      settled = true
      const database = request.result
      database.onversionchange = () => database.close()
      resolve(database)
    }

    request.onerror = () => {
      window.clearTimeout(timeout)
      if (settled) {
        return
      }
      settled = true
      databasePromise = null
      reject(request.error ?? new Error("Could not open workspace storage"))
    }

    request.onblocked = () => {
      window.clearTimeout(timeout)
      if (settled) {
        return
      }
      settled = true
      databasePromise = null
      reject(new Error("Workspace storage is blocked"))
    }
  })

  return databasePromise
}

function isCoordinate(value: unknown): value is TrackCoordinate {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  )
}

function isTrack(value: unknown): value is GpxTrack {
  if (!value || typeof value !== "object") {
    return false
  }

  const track = value as Partial<GpxTrack>
  return (
    typeof track.id === "string" &&
    typeof track.name === "string" &&
    typeof track.folder === "string" &&
    typeof track.color === "string" &&
    typeof track.visible === "boolean" &&
    Array.isArray(track.coordinates) &&
    track.coordinates.every(isCoordinate) &&
    (track.anchorIndices === undefined ||
      (Array.isArray(track.anchorIndices) &&
        track.anchorIndices.every(
          (index) =>
            Number.isInteger(index) &&
            index >= 0 &&
            index < track.coordinates!.length
        )))
  )
}

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  if (!value || typeof value !== "object") {
    return false
  }

  const workspace = value as Partial<WorkspaceSnapshot>
  return (
    workspace.version === 1 &&
    Array.isArray(workspace.tracks) &&
    workspace.tracks.every(isTrack) &&
    Array.isArray(workspace.folders) &&
    workspace.folders.every((folder) => typeof folder === "string") &&
    typeof workspace.activeTrackId === "string" &&
    typeof workspace.sidebarOpen === "boolean" &&
    (workspace.sidebarWidth === undefined ||
      (typeof workspace.sidebarWidth === "number" &&
        Number.isFinite(workspace.sidebarWidth))) &&
    typeof workspace.elevationOpen === "boolean" &&
    (workspace.autoRouting === undefined ||
      typeof workspace.autoRouting === "boolean") &&
    (workspace.mapStyle === undefined || isMapStyleId(workspace.mapStyle)) &&
    (workspace.mapStyleDefaultsVersion === undefined ||
      (typeof workspace.mapStyleDefaultsVersion === "number" &&
        Number.isFinite(workspace.mapStyleDefaultsVersion))) &&
    (workspace.routeLineWeight === undefined ||
      isRouteLineWeight(workspace.routeLineWeight)) &&
    (workspace.unitSystem === undefined ||
      isUnitSystem(workspace.unitSystem))
  )
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot | null> {
  const database = await openDatabase()

  return new Promise((resolve, reject) => {
    let settled = false
    const transaction = database.transaction(workspaceStore, "readonly")
    const request = transaction
      .objectStore(workspaceStore)
      .get(currentWorkspaceKey)
    const timeout = window.setTimeout(() => {
      settled = true
      reject(new Error("Workspace restore did not respond"))
    }, databaseOperationTimeoutMs)

    request.onsuccess = () => {
      window.clearTimeout(timeout)
      if (settled) {
        return
      }
      settled = true
      resolve(isWorkspaceSnapshot(request.result) ? request.result : null)
    }
    request.onerror = () => {
      window.clearTimeout(timeout)
      if (settled) {
        return
      }
      settled = true
      reject(request.error ?? new Error("Could not restore the workspace"))
    }
  })
}

export async function saveWorkspace(workspace: WorkspaceSnapshot) {
  const database = await openDatabase()

  return new Promise<void>((resolve, reject) => {
    let settled = false
    const transaction = database.transaction(workspaceStore, "readwrite")
    transaction.objectStore(workspaceStore).put(workspace, currentWorkspaceKey)
    const timeout = window.setTimeout(() => {
      settled = true
      reject(new Error("Workspace save did not respond"))
    }, databaseOperationTimeoutMs)

    transaction.oncomplete = () => {
      window.clearTimeout(timeout)
      if (settled) {
        return
      }
      settled = true
      resolve()
    }
    transaction.onerror = () => {
      window.clearTimeout(timeout)
      if (settled) {
        return
      }
      settled = true
      reject(transaction.error ?? new Error("Could not save the workspace"))
    }
    transaction.onabort = () => {
      window.clearTimeout(timeout)
      if (settled) {
        return
      }
      settled = true
      reject(transaction.error ?? new Error("Workspace save was cancelled"))
    }
  })
}
