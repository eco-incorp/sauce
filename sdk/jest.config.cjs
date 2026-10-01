/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  // A worker that ends a test file holding more than this is replaced before its next file. The
  // suites that typecheck probes against the whole SDK (`routes-*-types`, `routes-source-globals*`)
  // each build TypeScript programs of over a gigabyte, and a worker that ran several of them in a
  // row reached V8's heap limit on CI and aborted the run.
  workerIdleMemoryLimit: "1GB",
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
