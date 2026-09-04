/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.test.ts'],
  testPathIgnorePatterns: ['\\.unit\\.test\\.ts$'],
  setupFiles: ['<rootDir>/../../test/jestDatabaseSetup.cjs'],
  setupFilesAfterEnv: ['<rootDir>/src/testSetup.ts'],
  testTimeout: 20000,
};
