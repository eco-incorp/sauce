const { join } = require("node:path");
exports.ready = require(join(process.env.SAUCE_COMPILER_REAL, "node/ready.js")).ready;
