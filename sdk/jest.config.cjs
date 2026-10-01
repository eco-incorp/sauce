const { availableParallelism } = process.getBuiltinModule("node:os");

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  // A process that runs many suites keeps a part of each one's module graph: measured in band, the
  // heap grows about 5 MB per suite and passes 2 GB before the last of them, which is the default
  // heap limit on CI's 2-vCPU runner. A worker past 1 GB after a suite is replaced instead. That
  // needs workers, and jest runs in band — with nothing to replace — when it has only one, so there
  // are always at least two.
  workerIdleMemoryLimit: "1GB",
  maxWorkers: Math.max(2, availableParallelism() - 1),
  roots: ["<rootDir>/test"],
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        diagnostics: false,
        tsconfig: "tsconfig.test.json",
      },
    ],
    "^.+\\.js$": [
      "ts-jest",
      {
        useESM: true,
        diagnostics: false,
        tsconfig: {
          allowJs: true,
          module: "ESNext",
          moduleResolution: "bundler",
        },
      },
    ],
  },
  testMatch: ["**/*.test.ts"],
};
