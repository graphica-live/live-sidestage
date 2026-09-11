#!/usr/bin/env node

/**
 * Destructive migration detection script
 *
 * Detects newly added prisma/migrations/ * /migration.sql files and warns
 * if they contain destructive DDL like DROP TABLE, DROP COLUMN, ALTER COLUMN TYPE, etc.
 *
 * This script never connects to production DB (static file scanning only).
 * Tolerates false negatives as a lightweight linter without complete safety guarantees.
 *
 * Usage:
 *   npx tsx scripts/check-migration-safety.ts [--base=origin/main] [--head=HEAD]
 *
 * Exit codes:
 *   0: No issues
 *   1: Destructive DDL detected (warning)
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { scanMigrationContent } from '../src/lib/migration-safety';

const args = process.argv.slice(2);
let baseRef = 'origin/main';
let headRef = 'HEAD';

// Parse CLI options
for (const arg of args) {
  if (arg.startsWith('--base=')) {
    baseRef = arg.slice(7);
  }
  if (arg.startsWith('--head=')) {
    headRef = arg.slice(7);
  }
}

/**
 * Get newly added migration.sql files
 */
function getNewMigrationFiles(baseRef: string, headRef: string): string[] {
  try {
    // Detect file additions via git diff
    const diffOutput = execSync(
      `git diff --name-only --diff-filter=A ${baseRef}...${headRef} -- prisma/migrations`,
      { encoding: 'utf-8' }
    ).trim();

    if (!diffOutput) {
      return [];
    }

    return diffOutput
      .split('\n')
      .filter((file) => file.endsWith('migration.sql'));
  } catch (error) {
    // Return empty list if baseRef or headRef not found
    console.warn(
      `Warning: git diff failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

/**
 * Scan migration.sql file
 */
function scanMigrationFile(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return scanMigrationContent(content);
  } catch (error) {
    console.error(
      `Error: Cannot read file: ${filePath}`
    );
    throw error;
  }
}

/**
 * Main process
 */
async function main(): Promise<number> {
  const newMigrationFiles = getNewMigrationFiles(baseRef, headRef);

  if (newMigrationFiles.length === 0) {
    console.log('✓ No new migration.sql files detected');
    return 0;
  }

  console.log(`Scanning: ${newMigrationFiles.length} migration.sql file(s)`);

  let foundDestructivePatterns = false;

  for (const filePath of newMigrationFiles) {
    const warnings = scanMigrationFile(filePath);

    if (warnings.length > 0) {
      foundDestructivePatterns = true;
      console.warn(`\n⚠️  Warning: ${filePath}`);
      console.warn(`   Detected patterns: ${warnings.join(', ')}`);
      console.warn(
        '   This migration may contain destructive DDL. Review required.'
      );
    } else {
      console.log(`✓ ${filePath} (safe)`);
    }
  }

  if (foundDestructivePatterns) {
    console.warn(
      '\n⚠️  Destructive DDL detected. Alerting reviewers.'
    );
    return 1;
  }

  console.log('\n✓ All migration.sql files are safe');
  return 0;
}

main()
  .then((exitCode) => process.exit(exitCode))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
