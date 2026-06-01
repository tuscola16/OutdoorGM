/**
 * Map tile source for the topographic ("AllTrails / Gaia"-style) basemap.
 *
 * We render a raster tile overlay (via `<MapView mapType="none">` + `<UrlTile>`)
 * instead of Google's satellite/hybrid imagery, so the map shows a clean outdoors
 * style — light land, green parks, blue water, labeled streets, and trails.
 *
 * Primary: Mapbox "Outdoors" — the same styled outdoors map AllTrails renders.
 * It needs a public access token. Create one (free tier is generous) at
 * https://account.mapbox.com/access-tokens/ and set it when starting Metro:
 *
 *   EXPO_PUBLIC_MAPBOX_TOKEN=pk.your_token_here
 *
 * Fallback (no token set): OpenStreetMap standard tiles, so the map still renders
 * during development. NOTE: OSM's public tile server is not intended for
 * production-scale app use — set the Mapbox token before shipping.
 */
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

/** 512px tiles render crisp labels on high-DPI phones (pair with TOPO_TILE_SIZE). */
export const TOPO_TILE_URL = MAPBOX_TOKEN
  ? `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/512/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`
  : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Mapbox serves 512px tiles; OSM serves 256px. Must match the source above. */
export const TOPO_TILE_SIZE = MAPBOX_TOKEN ? 512 : 256;

/** How far the user may zoom in. Both sources support deep zoom. */
export const TOPO_MAX_ZOOM = 20;

/**
 * Deepest zoom the server actually has tiles for. Past this, react-native-maps
 * upscales ("overzooms") the deepest tiles instead of drawing nothing — which is
 * what fixes the map going blank when zoomed in too far.
 */
export const TOPO_MAX_NATIVE_ZOOM = 18;

/** Whether a real outdoors basemap (Mapbox) is configured vs. the OSM fallback. */
export const TOPO_USING_MAPBOX = !!MAPBOX_TOKEN;
