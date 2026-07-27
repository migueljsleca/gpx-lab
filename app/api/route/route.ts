import type { TrackCoordinate } from "@/lib/gpx"

const graphHopperRouteUrl = "https://graphhopper.gpx.studio/route"
const routeTimeoutMs = 15_000

type RouteRequest = {
  from: TrackCoordinate
  to: TrackCoordinate
}

function isCoordinate(value: unknown): value is TrackCoordinate {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item)) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  )
}

export async function POST(request: Request) {
  let body: RouteRequest

  try {
    body = (await request.json()) as RouteRequest
  } catch {
    return Response.json({ error: "Invalid routing request" }, { status: 400 })
  }

  if (!isCoordinate(body.from) || !isCoordinate(body.to)) {
    return Response.json(
      { error: "The route endpoints are invalid" },
      { status: 400 }
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), routeTimeoutMs)

  try {
    const response = await fetch(graphHopperRouteUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        points: [
          [body.from[0], body.from[1]],
          [body.to[0], body.to[1]],
        ],
        profile: "foot",
        elevation: true,
        points_encoded: false,
        details: [],
        custom_model: {
          priority: [
            {
              if: "foot_road_access == PRIVATE",
              multiply_by: "0.0",
            },
          ],
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    })

    const result = (await response.json()) as {
      message?: string
      paths?: {
        points?: {
          coordinates?: unknown[]
        }
      }[]
    }

    if (!response.ok) {
      return Response.json(
        { error: result.message || "No route could be found" },
        { status: 502 }
      )
    }

    const coordinates = result.paths?.[0]?.points?.coordinates
      ?.filter(isCoordinate)
      .map(
        ([longitude, latitude, elevation]) =>
          [longitude, latitude, elevation] as TrackCoordinate
      )

    if (!coordinates || coordinates.length < 2) {
      return Response.json(
        { error: "The routing service returned an empty route" },
        { status: 502 }
      )
    }

    return Response.json({ coordinates })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError"
    return Response.json(
      {
        error: timedOut
          ? "Auto-routing took too long"
          : "The routing service is unavailable",
      },
      { status: timedOut ? 504 : 502 }
    )
  } finally {
    clearTimeout(timeout)
  }
}
