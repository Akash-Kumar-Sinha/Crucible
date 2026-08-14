import { defineConfig, env } from "prisma/config";

const url = env("DATABASE_URL") || process.env.DATABASE_URL || "";

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url,
  },
});
