export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.ts', '<rootDir>/integration-test/**/*.test.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  globalSetup: '<rootDir>/integration-test/global-setup.ts',
  globalTeardown: '<rootDir>/integration-test/global-teardown.ts',
};
