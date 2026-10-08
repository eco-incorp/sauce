// `sauce-compiler/ready` of the build in SAUCE_COMPILER_REAL.
const path = require("node:path");
const real = require(path.join(process.env.SAUCE_COMPILER_REAL, "node/ready.js"));
exports.ready = real.ready;
