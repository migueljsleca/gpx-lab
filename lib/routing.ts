import type { TrackCoordinate } from "@/lib/gpx"

export async function getAutoRoute(
  from: TrackCoordinate,
  to: TrackCoordinate,
  signal?: AbortSignal
) {
  const response = await fetch("/api/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
    signal,
  })
  const result = (await response.json()) as {
    coordinates?: TrackCoordinate[]
    error?: string
  }

  if (!response.ok || !result.coordinates) {
    throw new Error(result.error || "No route could be found")
  }

  return result.coordinates
}
