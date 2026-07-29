export const mapStyleIds = [
  "dark",
  "topographic",
  "outdoors",
  "satellite",
] as const

export type MapStyleId = (typeof mapStyleIds)[number]

export const mapStyleLabels: Record<MapStyleId, string> = {
  dark: "Dark",
  topographic: "Topographic",
  outdoors: "Outdoors",
  satellite: "Satellite",
}

export const defaultMapStyle: MapStyleId = "dark"
export const mapStyleDefaultsVersion = 2

export const routeLineWeights = ["thin", "standard", "bold"] as const

export type RouteLineWeight = (typeof routeLineWeights)[number]

export const routeLineWeightLabels: Record<RouteLineWeight, string> = {
  thin: "Thin",
  standard: "Standard",
  bold: "Bold",
}

export const defaultRouteLineWeight: RouteLineWeight = "standard"

export function isMapStyleId(value: unknown): value is MapStyleId {
  return mapStyleIds.some((styleId) => styleId === value)
}

export function isRouteLineWeight(value: unknown): value is RouteLineWeight {
  return routeLineWeights.some((weight) => weight === value)
}
