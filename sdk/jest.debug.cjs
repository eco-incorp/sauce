const base = require("./jest.config.cjs");
const { workerIdleMemoryLimit, maxWorkers, ...rest } = base;
module.exports = { ...rest, rootDir: __dirname };
