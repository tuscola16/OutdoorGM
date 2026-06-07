import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import type { Checkpoint, PlayerLocation, MapBoundary } from '@shared/types';
import { KIND_META, checkpointKind } from '@/services/checkpointKinds';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN ?? '';

/** A spot where an eliminated player dropped their gear (Rules 19, 20). */
export interface DeathMarker {
  userId: string;
  displayName: string;
  latitude: number;
  longitude: number;
}

interface GameMapProps {
  checkpoints: Checkpoint[];
  playerLocations: PlayerLocation[];
  deathMarkers?: DeathMarker[];
  boundary?: MapBoundary | null;
  /** When true, clicking the map adds a checkpoint and a drag draws the boundary. */
  editMode?: boolean;
  /** Setup: a single map click (lng/lat) to drop a checkpoint. */
  onMapClick?: (coord: { latitude: number; longitude: number }) => void;
  /** Click an existing checkpoint pin (edit in setup, info in play). */
  onCheckpointClick?: (cp: Checkpoint) => void;
  /** Setup: while true, a click-drag on the map defines the rectangular boundary. */
  drawingBoundary?: boolean;
  /** Setup: while true, mapbox-gl-draw is active to draw/edit a polygon boundary (#39).
   * An existing polygon is loaded for vertex editing; otherwise a fresh polygon is drawn. */
  drawingPolygon?: boolean;
  onBoundaryDrawn?: (b: MapBoundary) => void;
}

const COLORS = {
  primary: '#d4893f',
  secondary: '#5a7e4e',
  playerDot: '#4fc3f7',
  danger: '#e8402a',
};

/** Build a GeoJSON polygon approximating a circle of `radiusM` meters. */
function circlePolygon(lng: number, lat: number, radiusM: number, steps = 64): number[][] {
  const coords: number[][] = [];
  const earth = 6378137;
  const dLat = (radiusM / earth) * (180 / Math.PI);
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  return coords;
}

/**
 * The closed GeoJSON ring ([lng, lat], first === last) for a boundary. Uses the
 * polygon vertices when present (≥ 3), otherwise the min/max rectangle.
 */
function boundaryRing(b: MapBoundary): number[][] {
  if (b.polygon && b.polygon.length >= 3) {
    const ring = b.polygon.map((v) => [v.longitude, v.latitude]);
    ring.push(ring[0]); // close the ring
    return ring;
  }
  return [
    [b.minLng, b.maxLat],
    [b.maxLng, b.maxLat],
    [b.maxLng, b.minLat],
    [b.minLng, b.minLat],
    [b.minLng, b.maxLat],
  ];
}

function emptyFc(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

export function GameMap({
  checkpoints,
  playerLocations,
  deathMarkers = [],
  boundary,
  editMode = false,
  onMapClick,
  onCheckpointClick,
  drawingBoundary = false,
  drawingPolygon = false,
  onBoundaryDrawn,
}: GameMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const readyRef = useRef(false);
  const playerMarkers = useRef<Record<string, mapboxgl.Marker>>({});
  const deathMarkerEls = useRef<Record<string, mapboxgl.Marker>>({});
  const checkpointMarkers = useRef<mapboxgl.Marker[]>([]);
  const didFit = useRef(false);
  const fitToDataRef = useRef<() => boolean>(() => false);
  const syncSourcesRef = useRef<() => void>(() => {});

  // Keep latest callbacks/data in refs so the map's own event handlers (bound
  // once) always see current values without re-subscribing.
  const onMapClickRef = useRef(onMapClick);
  const onCheckpointClickRef = useRef(onCheckpointClick);
  const onBoundaryDrawnRef = useRef(onBoundaryDrawn);
  const editRef = useRef(editMode);
  const drawingRef = useRef(drawingBoundary);
  onMapClickRef.current = onMapClick;
  onCheckpointClickRef.current = onCheckpointClick;
  onBoundaryDrawnRef.current = onBoundaryDrawn;
  editRef.current = editMode;
  drawingRef.current = drawingBoundary;

  // Polygon drawing (#39): the mapbox-gl-draw instance + a ref to the latest boundary so
  // entering polygon mode can load the existing polygon for editing.
  const drawRef = useRef<MapboxDraw | null>(null);
  const drawHandlerRef = useRef<(() => void) | null>(null);
  const boundaryRef = useRef<MapBoundary | null | undefined>(boundary);
  boundaryRef.current = boundary;

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: [-95.7129, 37.0902],
      zoom: 3,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      map.addSource('boundary', { type: 'geojson', data: emptyFc() });
      map.addLayer({
        id: 'boundary-fill',
        type: 'fill',
        source: 'boundary',
        paint: { 'fill-color': COLORS.secondary, 'fill-opacity': 0.08 },
      });
      map.addLayer({
        id: 'boundary-line',
        type: 'line',
        source: 'boundary',
        paint: { 'line-color': COLORS.secondary, 'line-width': 2 },
      });

      map.addSource('checkpoint-circles', { type: 'geojson', data: emptyFc() });
      map.addLayer({
        id: 'checkpoint-circles-fill',
        type: 'fill',
        source: 'checkpoint-circles',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.15 },
      });
      map.addLayer({
        id: 'checkpoint-circles-line',
        type: 'line',
        source: 'checkpoint-circles',
        paint: { 'line-color': ['get', 'color'], 'line-width': 2 },
      });

      map.addSource('draft-boundary', { type: 'geojson', data: emptyFc() });
      map.addLayer({
        id: 'draft-boundary-line',
        type: 'line',
        source: 'draft-boundary',
        paint: { 'line-color': COLORS.primary, 'line-width': 2, 'line-dasharray': [2, 1] },
      });

      readyRef.current = true;
      syncSourcesRef.current();
      if (fitToDataRef.current()) didFit.current = true;
    });

    // Click to add a checkpoint (setup only, and not while drawing a boundary).
    map.on('click', (e) => {
      if (!editRef.current || drawingRef.current) return;
      onMapClickRef.current?.({ latitude: e.lngLat.lat, longitude: e.lngLat.lng });
    });

    // Drag to draw the rectangular boundary (setup only).
    let dragStart: mapboxgl.LngLat | null = null;
    map.on('mousedown', (e) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      dragStart = e.lngLat;
    });
    map.on('mousemove', (e) => {
      if (!dragStart) return;
      const b = lngLatsToBoundary(dragStart, e.lngLat);
      (map.getSource('draft-boundary') as mapboxgl.GeoJSONSource)?.setData(boundaryFc(b));
    });
    map.on('mouseup', (e) => {
      if (!dragStart) return;
      const b = lngLatsToBoundary(dragStart, e.lngLat);
      dragStart = null;
      (map.getSource('draft-boundary') as mapboxgl.GeoJSONSource)?.setData(emptyFc());
      onBoundaryDrawnRef.current?.(b);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Disable map panning while the GM is drawing the boundary rectangle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawingBoundary) map.dragPan.disable();
    else map.dragPan.enable();
  }, [drawingBoundary]);

  // Read the current polygon out of mapbox-gl-draw and emit it as a boundary (#39):
  // the polygon vertices plus their bbox (kept in min/max for legacy/framing).
  function emitPolygonFromDraw(draw: MapboxDraw): void {
    const all = draw.getAll();
    const poly = all.features.find(
      (f) => f.geometry?.type === 'Polygon'
    ) as GeoJSON.Feature<GeoJSON.Polygon> | undefined;
    if (!poly) return;
    const ring = poly.geometry.coordinates[0];
    if (!ring || ring.length < 4) return; // ≥3 distinct verts + closing point
    const verts = ring.slice(0, -1).map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
    if (verts.length < 3) return;
    const lats = verts.map((v) => v.latitude);
    const lngs = verts.map((v) => v.longitude);
    onBoundaryDrawnRef.current?.({
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
      polygon: verts,
    });
  }

  // Activate mapbox-gl-draw while in polygon mode (#39); tear it down when leaving.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const teardown = () => {
      const m = mapRef.current;
      if (drawHandlerRef.current && m) {
        (m as mapboxgl.Map).off('draw.create' as never, drawHandlerRef.current as never);
        (m as mapboxgl.Map).off('draw.update' as never, drawHandlerRef.current as never);
        drawHandlerRef.current = null;
      }
      if (drawRef.current && m) {
        // Commit whatever polygon exists before removing the control. Covers the case
        // where Done was clicked before double-click-finishing, or the draw.create /
        // draw.update events didn't fire (#51).
        emitPolygonFromDraw(drawRef.current);
        try { m.removeControl(drawRef.current as unknown as mapboxgl.IControl); } catch { /* already gone */ }
        drawRef.current = null;
      }
    };

    if (!drawingPolygon) { teardown(); return; }

    const setup = () => {
      if (drawRef.current) return;
      const draw = new MapboxDraw({ displayControlsDefault: false, controls: {} });
      drawRef.current = draw;
      map.addControl(draw as unknown as mapboxgl.IControl);

      // Load an existing polygon for vertex editing; otherwise start a fresh draw.
      const b = boundaryRef.current;
      if (b?.polygon && b.polygon.length >= 3) {
        const ring = b.polygon.map((v) => [v.longitude, v.latitude]);
        ring.push(ring[0]);
        const ids = draw.add({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [ring] },
        });
        draw.changeMode('direct_select', { featureId: ids[0] });
      } else {
        draw.changeMode('draw_polygon');
      }

      const onChange = () => emitPolygonFromDraw(draw);
      drawHandlerRef.current = onChange;
      (map as mapboxgl.Map).on('draw.create' as never, onChange as never);
      (map as mapboxgl.Map).on('draw.update' as never, onChange as never);
    };

    if (readyRef.current) setup();
    else map.once('load', setup);

    return teardown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawingPolygon]);

  function syncSources() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    (map.getSource('boundary') as mapboxgl.GeoJSONSource | undefined)?.setData(
      boundary ? boundaryFc(boundary) : emptyFc()
    );

    const circleFeatures: GeoJSON.Feature[] = checkpoints.map((cp) => ({
      type: 'Feature',
      properties: { color: KIND_META[checkpointKind(cp)].color },
      geometry: { type: 'Polygon', coordinates: [circlePolygon(cp.longitude, cp.latitude, cp.radius)] },
    }));
    (map.getSource('checkpoint-circles') as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: circleFeatures,
    });

    syncCheckpointMarkers();
    syncPlayerMarkers();
    syncDeathMarkers();
  }

  function syncDeathMarkers() {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    for (const d of deathMarkers) {
      seen.add(d.userId);
      let marker = deathMarkerEls.current[d.userId];
      if (!marker) {
        const el = document.createElement('div');
        el.style.cssText = `width:26px;height:26px;border-radius:50%;background:rgba(0,0,0,0.6);border:2px solid ${COLORS.danger};display:flex;align-items:center;justify-content:center;font-size:13px`;
        el.textContent = '☠️';
        marker = new mapboxgl.Marker({ element: el }).setLngLat([d.longitude, d.latitude]);
        marker.setPopup(new mapboxgl.Popup({ offset: 18 }).setText(`${d.displayName} fell here — gear dropped`));
        marker.addTo(map);
        deathMarkerEls.current[d.userId] = marker;
      } else {
        marker.setLngLat([d.longitude, d.latitude]);
      }
    }
    for (const id of Object.keys(deathMarkerEls.current)) {
      if (!seen.has(id)) {
        deathMarkerEls.current[id].remove();
        delete deathMarkerEls.current[id];
      }
    }
  }

  function syncCheckpointMarkers() {
    const map = mapRef.current;
    if (!map) return;
    checkpointMarkers.current.forEach((m) => m.remove());
    checkpointMarkers.current = checkpoints.map((cp) => {
      const el = document.createElement('div');
      // The element box is just the dot (16×16) so Mapbox's default `center` anchor
      // lands the dot exactly on the checkpoint coordinate. The name label is absolutely
      // positioned below and doesn't affect the layout box (otherwise it would push the
      // dot up toward the top of the radius).
      //
      // Do NOT set `position` here: Mapbox positions every marker by writing a
      // `transform` onto this element and relies on its own `.mapboxgl-marker`
      // rule keeping it `position:absolute`. An inline `position:relative` would
      // win over that rule, drop the element back into normal flow, and offset
      // the dot from its true coordinate. The element is still a positioned
      // ancestor (absolute, via Mapbox), so the label's `left:50%` resolves fine.
      el.style.cssText = `width:16px;height:16px;cursor:pointer;`;
      const cpColor = KIND_META[checkpointKind(cp)].color;
      el.innerHTML = `
        <div style="width:16px;height:16px;border-radius:50%;background:${cpColor};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>
        <div style="position:absolute;top:20px;left:50%;transform:translateX(-50%);font-size:11px;font-weight:700;color:#fff;text-shadow:0 1px 2px #000;white-space:nowrap">${escapeHtml(cp.name)}</div>`;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onCheckpointClickRef.current?.(cp);
      });
      return new mapboxgl.Marker({ element: el })
        .setLngLat([cp.longitude, cp.latitude])
        .addTo(map);
    });
  }

  function syncPlayerMarkers() {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    for (const p of playerLocations) {
      seen.add(p.userId);
      const initials = p.displayName
        .split(' ')
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
      let marker = playerMarkers.current[p.userId];
      if (!marker) {
        const el = document.createElement('div');
        el.style.cssText = `width:34px;height:34px;border-radius:50%;background:${COLORS.playerDot};border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;color:#000;box-shadow:0 2px 4px rgba(0,0,0,.5)`;
        el.textContent = initials;
        marker = new mapboxgl.Marker({ element: el }).setLngLat([p.longitude, p.latitude]);
        marker.setPopup(new mapboxgl.Popup({ offset: 20 }).setText(p.displayName));
        marker.addTo(map);
        playerMarkers.current[p.userId] = marker;
      } else {
        marker.setLngLat([p.longitude, p.latitude]);
        (marker.getElement()).textContent = initials;
      }
    }
    // Remove markers for players that disappeared.
    for (const id of Object.keys(playerMarkers.current)) {
      if (!seen.has(id)) {
        playerMarkers.current[id].remove();
        delete playerMarkers.current[id];
      }
    }
  }

  /** Center/zoom the map to fit the boundary (preferred), checkpoints, and
   * players. Returns true only if it actually fit (map ready + data present) so
   * the caller knows whether to consider the one-time fit "done". */
  function fitToData(): boolean {
    const map = mapRef.current;
    if (!map || !readyRef.current) return false;
    const pts: [number, number][] = [
      ...(boundary
        ? boundary.polygon && boundary.polygon.length >= 3
          ? boundary.polygon.map((v) => [v.longitude, v.latitude] as [number, number])
          : ([
              [boundary.minLng, boundary.minLat],
              [boundary.maxLng, boundary.maxLat],
            ] as [number, number][])
        : []),
      ...checkpoints.map((c) => [c.longitude, c.latitude] as [number, number]),
      ...playerLocations.map((p) => [p.longitude, p.latitude] as [number, number]),
    ];
    if (pts.length === 0) return false;
    const bounds = pts.reduce(
      (acc, pt) => acc.extend(pt),
      new mapboxgl.LngLatBounds(pts[0], pts[0])
    );
    map.fitBounds(bounds, { padding: 80, maxZoom: 16, duration: 600 });
    return true;
  }

  // Keep latest data-dependent fns in refs so the once-bound map `load` handler
  // calls the current-render versions (not stale first-render closures where the
  // boundary was still empty).
  fitToDataRef.current = fitToData;
  syncSourcesRef.current = syncSources;

  // Re-sync sources/markers whenever data changes.
  useEffect(() => {
    syncSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkpoints, playerLocations, boundary, deathMarkers]);

  // Fit once when the first data arrives. Only mark the one-time fit as done if
  // it actually fit — if the data lands before the map's `load` event, fitToData
  // bails and the `load` handler completes the fit instead.
  useEffect(() => {
    if (didFit.current) return;
    if (fitToData()) didFit.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkpoints.length, playerLocations.length, boundary]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}

function lngLatsToBoundary(a: mapboxgl.LngLat, b: mapboxgl.LngLat): MapBoundary {
  return {
    minLat: Math.min(a.lat, b.lat),
    maxLat: Math.max(a.lat, b.lat),
    minLng: Math.min(a.lng, b.lng),
    maxLng: Math.max(a.lng, b.lng),
  };
}

function boundaryFc(b: MapBoundary): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [boundaryRing(b)] },
      },
    ],
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
}
