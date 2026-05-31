/**
 * Map tile sources for the topographic ("AllTrails / Gaia"-style) basemap.
 *
 * We render a raster tile overlay instead of Google's satellite/hybrid imagery so
 * the map shows elevation contours and hiking trails rather than aerial photos.
 * Use these with a `<MapView mapType="none">` plus a `<UrlTile>` overlay.
 *
 * Default: USGS Topo (The National Map) — public-domain US topographic maps that
 * already include contour lines and named trails. No API key required.
 * See: https://www.usgs.gov/national-digital-trails/seven-ways-access-or-view-usgs-trails-dataset
 *
 * The {z}/{y}/{x} order matches the ArcGIS tile cache scheme used by The National Map.
 */
export const TOPO_TILE_URL =
  'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}';

/** USGS Topo tiles are cached up to zoom 16; requesting beyond that returns blanks. */
export const TOPO_MAX_ZOOM = 16;

/**
 * Alternative global topo source (contours + hiking paths, OSM-based) that looks very
 * close to Gaia's "OpenTopo" layer. Swap TOPO_TILE_URL for this for coverage outside
 * the US. Requires attribution and is subject to OpenTopoMap's fair-use tile policy.
 *
 * 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png'  (TOPO_MAX_ZOOM ~17)
 */
