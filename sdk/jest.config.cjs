/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  // A worker that ends a test file holding more than this is replaced before its next file. Every
  // test file re-imports the SDK under ESM and its modules stay reachable in the process that ran
  // them, and the suites that typecheck probes against the whole SDK (`routes-*-types`,
  // `routes-source-globals*`) each build TypeScript programs of over a gigabyte: one process running
  // the whole suite — a two-core runner, running in band — reached V8's heap limit on CI and aborted
  // the run. A limit makes jest use workers even then and replace one once it has grown past it.
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
