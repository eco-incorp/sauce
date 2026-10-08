// The real package's `ready`, from the build REAL_SAUCE_COMPILER names.
const { join } = require("node:path");
exports.ready = require(join(process.env.REAL_SAUCE_COMPILER, "node/ready.js")).ready;
