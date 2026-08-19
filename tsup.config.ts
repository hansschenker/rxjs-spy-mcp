import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    index: "src/index.ts",
    "operators/index": "src/operators/index.ts",
  },
  external: ["rxjs"],
  format: ["esm", "cjs"],
  sourcemap: true,
});
