// Node-only helper (subpath export "@merchantmesh/shared/env") — not re-exported
// from the package index so browser bundles never touch node:fs.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Minimal .env loader: walks up from cwd, never overrides existing env. */
export function loadRootEnv(startDir: string = process.cwd()): void {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const file = join(dir, ".env");
    if (existsSync(file)) {
      for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        const hash = value.indexOf(" #");
        if (hash >= 0 && !value.startsWith('"')) value = value.slice(0, hash).trim();
        value = value.replace(/^"(.*)"$/, "$1");
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export function env(name: string, def?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (def !== undefined) return def;
  throw new Error(`Missing required env var: ${name}`);
}

export function envBool(name: string, def = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  return v === "true" || v === "1";
}

export function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`Env var ${name} must be an integer, got: ${v}`);
  return n;
}
