'use strict';

const { configureTestDatabaseEnvironment } = require('./databaseSafety.cjs');

// Jest loads setupFiles before setupFilesAfterEnv and before each test module.
// Prisma therefore sees only the URL that passed the destructive-test guard.
configureTestDatabaseEnvironment(process.env);
