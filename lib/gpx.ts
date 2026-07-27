export type TrackCoordinate = [
  longitude: number,
  latitude: number,
  elevation: number,
]

export type EditorTool =
  | "select"
  | "draw"
  | "split"
  | "crop"
  | "simplify"
  | "clean"
  | "merge"

export type GpxTrack = {
  id: string
  name: string
  folder: string
  color: string
  visible: boolean
  coordinates: TrackCoordinate[]
}

export type TrackStats = {
  distanceKm: number
  ascentM: number
  descentM: number
  highestM: number
  lowestM: number
}

export const trackColors = [
  "#FF7470",
  "#FF8F5B",
  "#FFD45E",
  "#31CA84",
  "#2AA5FB",
  "#B588F5",
  "#FF97C5",
] as const

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

function distanceBetween(a: TrackCoordinate, b: TrackCoordinate) {
  const earthRadiusKm = 6371
  const latitudeDelta = toRadians(b[1] - a[1])
  const longitudeDelta = toRadians(b[0] - a[0])
  const latitudeA = toRadians(a[1])
  const latitudeB = toRadians(b[1])
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

function distanceToSegmentMeters(
  point: TrackCoordinate,
  start: TrackCoordinate,
  end: TrackCoordinate
) {
  const latitudeScale = 111_320
  const longitudeScale =
    Math.cos(toRadians((start[1] + end[1]) / 2)) * latitudeScale
  const pointX = (point[0] - start[0]) * longitudeScale
  const pointY = (point[1] - start[1]) * latitudeScale
  const endX = (end[0] - start[0]) * longitudeScale
  const endY = (end[1] - start[1]) * latitudeScale
  const segmentLengthSquared = endX * endX + endY * endY

  if (segmentLengthSquared === 0) {
    return Math.hypot(pointX, pointY)
  }

  const progress = Math.max(
    0,
    Math.min(1, (pointX * endX + pointY * endY) / segmentLengthSquared)
  )

  return Math.hypot(pointX - progress * endX, pointY - progress * endY)
}

export function simplifyTrackCoordinates(
  coordinates: TrackCoordinate[],
  toleranceMeters = 10
) {
  if (coordinates.length <= 2) {
    return coordinates.slice()
  }

  const keep = new Uint8Array(coordinates.length)
  keep[0] = 1
  keep[coordinates.length - 1] = 1
  const ranges: [number, number][] = [[0, coordinates.length - 1]]

  while (ranges.length > 0) {
    const [startIndex, endIndex] = ranges.pop()!
    let furthestIndex = -1
    let furthestDistance = toleranceMeters

    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = distanceToSegmentMeters(
        coordinates[index],
        coordinates[startIndex],
        coordinates[endIndex]
      )

      if (distance > furthestDistance) {
        furthestDistance = distance
        furthestIndex = index
      }
    }

    if (furthestIndex !== -1) {
      keep[furthestIndex] = 1
      ranges.push([startIndex, furthestIndex], [furthestIndex, endIndex])
    }
  }

  return coordinates.filter((_, index) => keep[index] === 1)
}

export function cleanTrackCoordinates(coordinates: TrackCoordinate[]) {
  return coordinates.reduce<TrackCoordinate[]>((cleaned, coordinate) => {
    if (
      !coordinate.every(Number.isFinite) ||
      coordinate[0] < -180 ||
      coordinate[0] > 180 ||
      coordinate[1] < -90 ||
      coordinate[1] > 90
    ) {
      return cleaned
    }

    const previous = cleaned.at(-1)
    if (previous && distanceBetween(previous, coordinate) < 0.0005) {
      return cleaned
    }

    cleaned.push(coordinate)
    return cleaned
  }, [])
}

export function calculateTrackStats(track: GpxTrack): TrackStats {
  let distanceKm = 0
  let ascentM = 0
  let descentM = 0

  for (let index = 1; index < track.coordinates.length; index += 1) {
    const previous = track.coordinates[index - 1]
    const current = track.coordinates[index]
    distanceKm += distanceBetween(previous, current)

    const elevationDelta = current[2] - previous[2]
    if (elevationDelta > 0) {
      ascentM += elevationDelta
    } else {
      descentM += Math.abs(elevationDelta)
    }
  }

  const elevations = track.coordinates.map((coordinate) => coordinate[2])

  return {
    distanceKm,
    ascentM,
    descentM,
    highestM: elevations.length ? Math.max(...elevations) : 0,
    lowestM: elevations.length ? Math.min(...elevations) : 0,
  }
}

function getElementsByLocalName(parent: ParentNode, name: string) {
  return Array.from(parent.querySelectorAll("*")).filter(
    (element) => element.localName === name
  )
}

export function parseGpx(text: string, fallbackName: string): GpxTrack {
  const document = new DOMParser().parseFromString(text, "application/xml")

  if (document.querySelector("parsererror")) {
    throw new Error("The selected file is not valid GPX XML.")
  }

  const trackPoints = [
    ...getElementsByLocalName(document, "trkpt"),
    ...getElementsByLocalName(document, "rtept"),
  ]

  const coordinates = trackPoints.flatMap<TrackCoordinate>((point) => {
    const latitude = Number(point.getAttribute("lat"))
    const longitude = Number(point.getAttribute("lon"))
    const elevationElement = Array.from(point.children).find(
      (child) => child.localName === "ele"
    )
    const elevation = Number(elevationElement?.textContent ?? 0)

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return []
    }

    return [[longitude, latitude, Number.isFinite(elevation) ? elevation : 0]]
  })

  if (coordinates.length < 2) {
    throw new Error("This GPX file does not contain a usable track or route.")
  }

  const trackElement = getElementsByLocalName(document, "trk")[0]
  const routeElement = getElementsByLocalName(document, "rte")[0]
  const owner = trackElement ?? routeElement
  const nameElement = owner
    ? Array.from(owner.children).find((child) => child.localName === "name")
    : undefined
  const name =
    nameElement?.textContent?.trim() || fallbackName.replace(/\.gpx$/i, "")
  const randomValue = crypto.getRandomValues(new Uint32Array(1))[0]

  return {
    id: `import-${crypto.randomUUID()}`,
    name,
    folder: "Imported",
    color: trackColors[randomValue % trackColors.length],
    visible: true,
    coordinates,
  }
}

export function serializeTrackToGpx(track: GpxTrack) {
  const points = track.coordinates
    .map(
      ([longitude, latitude, elevation]) =>
        `      <trkpt lat="${latitude.toFixed(7)}" lon="${longitude.toFixed(7)}"><ele>${elevation.toFixed(1)}</ele></trkpt>`
    )
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GPX Lab" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(track.name)}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}
