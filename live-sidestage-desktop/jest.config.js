/** @type {import('jest').Config} */
module.exports = {
    testMatch: ['**/tests/unit/**/*.test.js'],
    testEnvironment: 'node',
    testTimeout: 10000,
    // worktree の package.json が Haste collision を起こすのを防ぐ
    modulePathIgnorePatterns: ['\\.claude/worktrees', '<rootDir>/dist/'],
    watchPathIgnorePatterns: ['\\.claude/worktrees', '<rootDir>/dist/'],
};
