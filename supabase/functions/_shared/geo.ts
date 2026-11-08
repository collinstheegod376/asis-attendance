/**
 * ADUN Attendance - Geolocation, Haversine & Geofencing Utilities
 */

/**
 * Calculates Haversine distance between two coordinates in metres.
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in metres
  const toRad = (angle: number) => (angle * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export type GeoJSONGeometry =
  | { type: 'Polygon'; coordinates: [number, number][][] }
  | { type: 'MultiPolygon'; coordinates: [number, number][][][] }
  | { type: 'Feature'; geometry: GeoJSONGeometry };

/**
 * Checks if a coordinate (lat, lng) is inside a GeoJSON Polygon or MultiPolygon using ray-casting.
 */
export function isPointInPolygon(
  lat: number,
  lng: number,
  geoJson: GeoJSONGeometry | any
): boolean {
  if (!geoJson) return false;

  let geom = geoJson;
  if (geom.type === 'Feature' && geom.geometry) {
    geom = geom.geometry;
  }

  if (geom.type === 'Polygon') {
    const rings = geom.coordinates;
    if (!rings || rings.length === 0) return false;
    // Outer ring check
    return pointInLinearRing(lat, lng, rings[0]);
  }

  if (geom.type === 'MultiPolygon') {
    const polygons = geom.coordinates;
    if (!polygons) return false;
    for (const poly of polygons) {
      if (poly.length > 0 && pointInLinearRing(lat, lng, poly[0])) {
        return true;
      }
    }
    return false;
  }

  return false;
}

function pointInLinearRing(
  lat: number,
  lng: number,
  ring: [number, number][]
): boolean {
  let inside = false;
  const n = ring.length;
  if (n < 3) return false;

  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = ring[i][0]; // lng
    const yi = ring[i][1]; // lat
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

    if (intersect) {
      inside = !inside;
    }
    j = i;
  }

  return inside;
}
