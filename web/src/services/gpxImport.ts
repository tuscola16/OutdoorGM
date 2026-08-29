import type { MapBoundary } from '@shared/types';

/**
 * GPX waypoint import for the setup screen: turn a GPX file's `<wpt>` markers into
 * checkpoints.
 *
 * **Waypoints only, deliberately.** A GPX file can hold three kinds of point:
 * `<wpt>` (a named place the author dropped), `<rtept>` (a routing instruction) and
 * `<trkpt>` (one sample of a recorded track, often thousands at 1s intervals). Only
 * `<wpt>` means "somewhere that matters", which is what a checkpoint is. Importing
 * track points would create thousands of overlapping checkpoints, and the geofence
 * Cloud Function walks every checkpoint on every location write — so it's a real
 * cost/latency problem, not just UI clutter. We match on tag name, which separates
 * them exactly; file size would only be a bad proxy for the same thing.
 */

export interface GpxWaypoint {
  name: string;
  latitude: number;
  longitude: number;
}

export interface GpxParseResult {
  waypoints: GpxWaypoint[];
  /** Counts of the point types we deliberately ignored, so the UI can explain itself. */
  skipped: { trackPoints: number; routePoints: number };
}

/** Direct-child lookup by local name, namespace-agnostic (files vary on `gpx:` prefixes). */
function childText(el: Element, localName: string): string | null {
  for (const child of Array.from(el.children)) {
    if (child.localName === localName) return child.textContent?.trim() ?? null;
  }
  return null;
}

function finite(raw: string | null, min: number, max: number): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/**
 * Parse GPX text into waypoints. Throws with a GM-readable message when the file
 * isn't GPX at all; silently drops individual `<wpt>`s with unusable coordinates.
 */
export function parseGpxWaypoints(xml: string): GpxParseResult {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error("That file isn't valid XML — is it really a .gpx export?");
  }
  // `*` matches any namespace: GPX 1.1 uses a default ns, some exporters use a prefix.
  const wpts = Array.from(doc.getElementsByTagNameNS('*', 'wpt'));
  const trackPoints = doc.getElementsByTagNameNS('*', 'trkpt').length;
  const routePoints = doc.getElementsByTagNameNS('*', 'rtept').length;

  if (wpts.length === 0 && trackPoints === 0 && routePoints === 0) {
    throw new Error('No GPX points found in that file.');
  }

  const waypoints: GpxWaypoint[] = [];
  for (const wpt of wpts) {
    const latitude = finite(wpt.getAttribute('lat'), -90, 90);
    const longitude = finite(wpt.getAttribute('lon'), -180, 180);
    if (latitude === null || longitude === null) continue; // unusable — skip it
    const name = childText(wpt, 'name') || childText(wpt, 'desc') || '';
    waypoints.push({
      name: name || `Waypoint ${waypoints.length + 1}`,
      latitude,
      longitude,
    });
  }

  return { waypoints, skipped: { trackPoints, routePoints } };
}

// --- Boundary expansion ---------------------------------------------------------

/** ~55m at the equator; the padding that keeps an imported point off the boundary edge. */
const PAD_DEG = 0.0005;

type LatLng = { latitude: number; longitude: number };

/** Andrew's monotone chain. Returns the hull counter-clockwise in (lng, lat) space. */
function convexHull(input: LatLng[]): LatLng[] {
  const seen = new Set<string>();
  const pts = input
    .filter((p) => {
      const k = `${p.latitude},${p.longitude}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.longitude - b.longitude || a.latitude - b.latitude);
  if (pts.length < 3) return pts;

  const cross = (o: LatLng, a: LatLng, b: LatLng) =>
    (a.longitude - o.longitude) * (b.latitude - o.latitude) -
    (a.latitude - o.latitude) * (b.longitude - o.longitude);

  const half = (ordered: LatLng[]): LatLng[] => {
    const out: LatLng[] = [];
    for (const p of ordered) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };

  return [...half(pts), ...half([...pts].reverse())];
}

/** Push each vertex away from the centroid so points that became hull vertices sit
 *  strictly inside — ray-casting is unreliable for a point exactly on an edge. */
function padPolygon(poly: LatLng[]): LatLng[] {
  const cLat = poly.reduce((s, p) => s + p.latitude, 0) / poly.length;
  const cLng = poly.reduce((s, p) => s + p.longitude, 0) / poly.length;
  const lngScale = 1 / Math.max(Math.cos((cLat * Math.PI) / 180), 0.01);
  return poly.map((p) => {
    const dLat = p.latitude - cLat;
    const dLng = (p.longitude - cLng) / lngScale;
    const mag = Math.hypot(dLat, dLng) || 1;
    return {
      latitude: p.latitude + (dLat / mag) * PAD_DEG,
      longitude: p.longitude + ((dLng / mag) * PAD_DEG) * lngScale,
    };
  });
}

function bbox(pts: LatLng[]): Omit<MapBoundary, 'polygon'> {
  return {
    minLat: Math.min(...pts.map((p) => p.latitude)),
    maxLat: Math.max(...pts.map((p) => p.latitude)),
    minLng: Math.min(...pts.map((p) => p.longitude)),
    maxLng: Math.max(...pts.map((p) => p.longitude)),
  };
}

/**
 * Grow a play-area boundary so every one of `points` falls inside it (#64: a checkpoint
 * outside the boundary can never fire).
 *
 * Rectangle boundaries widen to a padded bounding box. **Drawn polygons become the convex
 * hull** of their own vertices plus the new points — the original area is always kept, but
 * any concave bite the GM drew is filled in, so the UI must say so before calling this.
 */
export function expandBoundary(boundary: MapBoundary, points: LatLng[]): MapBoundary {
  if (points.length === 0) return boundary;
  const hasPolygon = Array.isArray(boundary.polygon) && boundary.polygon.length >= 3;

  if (hasPolygon) {
    const polygon = padPolygon(convexHull([...boundary.polygon!, ...points]));
    return { ...boundary, ...bbox(polygon), polygon };
  }

  const corners: LatLng[] = [
    { latitude: boundary.minLat, longitude: boundary.minLng },
    { latitude: boundary.maxLat, longitude: boundary.maxLng },
  ];
  const box = bbox([...corners, ...points]);
  return {
    ...boundary,
    minLat: box.minLat - PAD_DEG,
    maxLat: box.maxLat + PAD_DEG,
    minLng: box.minLng - PAD_DEG,
    maxLng: box.maxLng + PAD_DEG,
  };
}
