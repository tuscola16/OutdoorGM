import type { MapBoundary } from '../types';

/**
 * Client copy of the server's play-area boundary test (G1 / ROADMAP #64). Mirrors
 * `pointInBoundary`/`pointInPolygon` in `functions/src/geofence.ts` exactly so a
 * checkpoint the client accepts can always actually fire server-side. Shared by the
 * web GM dashboard (`@shared/common/geo`) and the mobile app (`@/common/geo`).
 */

/** Ray-casting point-in-polygon test (mirrors the geofence's #39 half). */
function pointInPolygon(
  lat: number,
  lng: number,
  poly: { latitude: number; longitude: number }[]
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].latitude;
    const xi = poly[i].longitude;
    const yj = poly[j].latitude;
    const xj = poly[j].longitude;
    const intersects =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Is a coordinate inside the play area? Polygon (≥3 verts) wins; else the bbox (#7). */
export function pointInBoundary(lat: number, lng: number, b: MapBoundary): boolean {
  if (Array.isArray(b.polygon) && b.polygon.length >= 3) {
    return pointInPolygon(lat, lng, b.polygon);
  }
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}
