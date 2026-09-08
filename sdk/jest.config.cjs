/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    // @solana/web3.js (v1) is CJS and require()s rpc-websockets -> uuid, which is ESM-only in
    // v14 and cannot be require()d under jest's ESM/CJS interop. Redirect uuid to the CJS build
    // (v8, uuid.v1 is all rpc-websockets uses) so the web3.js barrel loads. Only the
    // ./svm/engine/web3js adapter test pulls web3.js in; kit-only tests are unaffected.
    "^uuid$": require.resolve("uuid"),
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
