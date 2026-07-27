import type { GpxTrack, TrackCoordinate } from "@/lib/gpx"

const databaseName = "gpx-lab"
const databaseVersion = 1
const workspaceStore = "workspaces"
const currentWorkspaceKey = "current"

export type WorkspaceSnapshot = {
  version: 1
  tracks: GpxTrack[]
  folders: string[]
  activeTrackId: string
  sidebarOpen: boolean
  sidebarWidth?: number
  searchOpen: boolean
  elevationOpen: boolean
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

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(workspaceStore)) {
        database.createObjectStore(workspaceStore)
      }
    }

    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      resolve(database)
    }

    request.onerror = () => {
      databasePromise = null
      reject(request.error ?? new Error("Could not open workspace storage"))
    }

    request.onblocked = () => {
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
    track.coordinates.length >= 2 &&
    track.coordinates.every(isCoordinate)
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
    typeof workspace.searchOpen === "boolean" &&
    typeof workspace.elevationOpen === "boolean"
  )
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot | null> {
  const database = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(workspaceStore, "readonly")
    const request = transaction
      .objectStore(workspaceStore)
      .get(currentWorkspaceKey)

    request.onsuccess = () => {
      resolve(isWorkspaceSnapshot(request.result) ? request.result : null)
    }
    request.onerror = () => {
      reject(request.error ?? new Error("Could not restore the workspace"))
    }
  })
}

export async function saveWorkspace(workspace: WorkspaceSnapshot) {
  const database = await openDatabase()

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(workspaceStore, "readwrite")
    transaction.objectStore(workspaceStore).put(workspace, currentWorkspaceKey)

    transaction.oncomplete = () => resolve()
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("Could not save the workspace"))
    }
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("Workspace save was cancelled"))
    }
  })
}
