import { defineConfig } from "prisma/config";

const url =
  process.env.DATABASE_URL ||
  "postgresql://crucible:crucible_secret@localhost:5432/crucible?schema=public";

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url,
  },
});
