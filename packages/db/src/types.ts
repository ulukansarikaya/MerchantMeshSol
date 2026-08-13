import { customType } from "drizzle-orm/pg-core";

/**
 * PostGIS geography(Point,4326) column, exposed as a raw EWKT string.
 *
 * Deliberately NOT round-tripped as {lat,lng} here: geography's default
 * output format is EWKB hex, not WKT, so a naive fromDriver would need a
 * full WKB parser. Faz A only defines the column; the repo-layer functions
 * that actually query it (Faz H) use explicit `ST_X`/`ST_Y`/`ST_DWithin` SQL
 * and read those computed columns directly instead of relying on ORM
 * round-tripping. See DECISIONS.md.
 */
export const geographyPoint = customType<{ data: string }>({
  dataType() {
    return "geography(Point,4326)";
  },
  toDriver(value: string): string {
    return value; // caller passes 'SRID=4326;POINT(lng lat)' — PostGIS parses EWKT on input
  },
});

/** pgvector `vector(dimensions)` column, exposed as a plain number[]. */
export const vector = customType<{ data: number[]; config: { dimensions: number } }>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: unknown): number[] {
    const s = String(value);
    return s
      .slice(1, -1)
      .split(",")
      .filter((x) => x.length > 0)
      .map(Number);
  },
});

/** Builds an EWKT point literal for geographyPoint columns. */
export function ewktPoint(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}
