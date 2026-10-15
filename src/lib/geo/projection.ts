/**
 * The dashboard map's plane: a plain equirectangular projection around Israel, scaled so one
 * unit is about 370 m (x shrunk by cos 31.5° to keep shapes true). The sub-district outlines in
 * map.ts were drawn in it, and scripts/build-localities.ts places every locality with it.
 */
export const MAP_ORIGIN = { lon: 34.2, lat: 33.4 } as const;
const SCALE_X = 255.78;
const SCALE_Y = 300;

export function project(lon: number, lat: number): [x: number, y: number] {
  return [(lon - MAP_ORIGIN.lon) * SCALE_X, (MAP_ORIGIN.lat - lat) * SCALE_Y];
}
