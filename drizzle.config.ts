import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./drizzle/schema.ts",
  out: "./drizzle/sqlite-migrations",
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? "./data/guest-posting.db",
  },
});
