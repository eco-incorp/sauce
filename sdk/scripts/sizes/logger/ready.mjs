// `sauce-compiler/ready` of the build in SAUCE_COMPILER_REAL.
import { createRequire } from "node:module";
import { join } from "node:path";

export const { ready } = createRequire(import.meta.url)(
  join(process.env.SAUCE_COMPILER_REAL, "node/ready.js"),
);
