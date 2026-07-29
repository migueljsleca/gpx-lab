export const unitSystems = ["metric", "imperial"] as const

export type UnitSystem = (typeof unitSystems)[number]

export const unitSystemLabels: Record<UnitSystem, string> = {
  metric: "Metric",
  imperial: "Imperial",
}

export const defaultUnitSystem: UnitSystem = "metric"

const kilometersToMiles = 0.621371
export const metersToFeet = 3.28084

export function isUnitSystem(value: unknown): value is UnitSystem {
  return unitSystems.some((unitSystem) => unitSystem === value)
}

export function convertDistance(
  distanceKm: number,
  unitSystem: UnitSystem
) {
  return unitSystem === "imperial"
    ? distanceKm * kilometersToMiles
    : distanceKm
}

export function convertElevation(
  elevationM: number,
  unitSystem: UnitSystem
) {
  return unitSystem === "imperial" ? elevationM * metersToFeet : elevationM
}

export function formatDistance(
  distanceKm: number,
  unitSystem: UnitSystem,
  fractionDigits = 1
) {
  const suffix = unitSystem === "imperial" ? "mi" : "km"
  return `${convertDistance(distanceKm, unitSystem).toFixed(fractionDigits)} ${suffix}`
}

export function formatElevation(
  elevationM: number,
  unitSystem: UnitSystem
) {
  const suffix = unitSystem === "imperial" ? "ft" : "m"
  return `${Math.round(convertElevation(elevationM, unitSystem))} ${suffix}`
}

export function elevationUnitName(unitSystem: UnitSystem) {
  return unitSystem === "imperial" ? "feet" : "meters"
}
