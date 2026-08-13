import { defineConfig } from "drizzle-kit";

// DATABASE_URL is read lazily by drizzle-kit commands (generate does not need
// a live connection; migrate/push do). See plans/faz-a.md.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/*.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/merchantmesh",
  },
});
