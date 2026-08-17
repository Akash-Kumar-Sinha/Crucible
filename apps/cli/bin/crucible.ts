#!/usr/bin/env bun
import { main } from "../src/cli";

main(process.argv.slice(2))
  .then((exitCode) => {
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  })
  .catch((err) => {
    console.error("Fatal CLI error:", err);
    process.exit(1);
  });
