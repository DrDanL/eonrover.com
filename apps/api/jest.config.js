/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/testSetup.ts'],
  testTimeout: 20000,
};
