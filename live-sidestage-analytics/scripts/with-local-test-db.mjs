#!/usr/bin/env node
/**
 * ローカル Docker Postgres (localhost:5433) 向けに、git worktree ごとの
 * テストDBへ DATABASE_URL を差し替えて子プロセスを起動する。
 *
 * CI (port 5432 等) や本番 URL は書き換えない。
 */
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PREFIX = "liveanalytics_test_";
const MAX_DB_NAME_LEN = 60;
const LOCAL_TEST_PORT = 5433;

export function canonicalWorktreePath(absPath) {
  const resolved = path.resolve(absPath);
  let real = resolved;
  try {
    real = fs.realpathSync.native(resolved);
  } catch {
    try {
      real = fs.realpathSync(resolved);
    } catch {
      /* keep resolved */
    }
  }
  return path.normalize(real).replace(/\\/g, "/").replace(/^([A-Z]):/, (_, d) => `${d.toLowerCase()}:`);
}

export function slugFromWorktreePath(canonicalPath) {
  const base = path.posix.basename(canonicalPath.replace(/\/$/, ""));
  let slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!slug) slug = "worktree";
  return slug;
}

export function hashFromCanonicalPath(canonicalPath) {
  return crypto.createHash("sha256").update(canonicalPath, "utf8").digest("hex").slice(0, 8);
}

export function databaseNameForWorktree(worktreeRoot) {
  const canonical = canonicalWorktreePath(worktreeRoot);
  const hash = hashFromCanonicalPath(canonical);
  let slug = slugFromWorktreePath(canonical);
  const suffixLen = 1 + hash.length;
  const maxSlug = MAX_DB_NAME_LEN - PREFIX.length - suffixLen;
  if (slug.length > maxSlug) slug = slug.slice(0, maxSlug).replace(/_+$/g, "");
  if (!slug) slug = "w";
  const name = `${PREFIX}${slug}_${hash}`;
  if (name.length > MAX_DB_NAME_LEN) {
    throw new Error(`generated database name exceeds ${MAX_DB_NAME_LEN} chars: ${name}`);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`generated database name is not a safe identifier: ${name}`);
  }
  return name;
}

export function parsePostgresUrl(urlString) {
  const url = new URL(urlString);
  const db = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return {
    url,
    hostname: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database: db,
  };
}

export function isLocalDockerTestUrl(urlString) {
  if (!urlString) return false;
  try {
    const parsed = parsePostgresUrl(urlString);
    const host = parsed.hostname.toLowerCase();
    const localHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
    return localHost && parsed.port === LOCAL_TEST_PORT;
  } catch {
    return false;
  }
}

export function withDatabaseName(urlString, databaseName) {
  const url = new URL(urlString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export function gitWorktreeRoot(cwd = process.cwd()) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git rev-parse --show-toplevel failed: ${result.stderr || result.error}`);
  }
  return result.stdout.trim();
}

function analyticsRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadEnvFile(filePath, { fillMissingOnly = true } = {}) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = stripQuotes(line.slice(eq + 1).trim());
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (fillMissingOnly && process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}

function quoteIdent(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

function dockerPsql(sql, database) {
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      "liveanalytics-local-db",
      "psql",
      "-U",
      "liveanalytics",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-tAc",
      sql,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error || "").toString().trim();
    throw new Error(`psql failed (${database}): ${detail}`);
  }
  return (result.stdout || "").trim();
}

export function ensureDatabase(databaseName) {
  const exists = dockerPsql(
    `SELECT 1 FROM pg_database WHERE datname = '${databaseName.replaceAll("'", "''")}'`,
    "liveanalytics_test",
  );
  if (exists === "1") return { created: false };
  try {
    dockerPsql(`CREATE DATABASE ${quoteIdent(databaseName)}`, "liveanalytics_test");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already exists/i.test(message)) return { created: false };
    throw error;
  }
  return { created: true };
}

export function resolveLocalTestDatabaseUrl({ cwd = process.cwd() } = {}) {
  // 旧 `dotenv -e .env.local.test --override` と同じく、ファイルの値で上書きしてから worktree DB 名だけ差し替える。
  loadEnvFile(path.join(analyticsRoot(), ".env.local.test"), { fillMissingOnly: false });
  const baseUrl = process.env.DATABASE_URL;
  if (!isLocalDockerTestUrl(baseUrl || "")) {
    return { rewritten: false, url: baseUrl || "", databaseName: null };
  }
  const worktreeRoot = gitWorktreeRoot(cwd);
  const databaseName = databaseNameForWorktree(worktreeRoot);
  const url = withDatabaseName(baseUrl, databaseName);
  return { rewritten: true, url, databaseName, worktreeRoot };
}

function parseArgs(argv) {
  const printUrl = argv.includes("--print-url");
  const printName = argv.includes("--print-name");
  const dash = argv.indexOf("--");
  const command = dash >= 0 ? argv.slice(dash + 1) : [];
  return { printUrl, printName, command };
}

function main(argv = process.argv.slice(2)) {
  const { printUrl, printName, command } = parseArgs(argv);
  const resolved = resolveLocalTestDatabaseUrl({ cwd: process.cwd() });

  if (resolved.rewritten) {
    ensureDatabase(resolved.databaseName);
    process.env.DATABASE_URL = resolved.url;
    console.error(`[local-test-db] ${resolved.databaseName}`);
  }

  if (printName) {
    process.stdout.write(`${resolved.databaseName || ""}\n`);
  }
  if (printUrl) {
    process.stdout.write(`${resolved.url || ""}\n`);
  }

  if (command.length === 0) return;

  const env = { ...process.env };
  const binDir = path.join(analyticsRoot(), "node_modules", ".bin");
  const currentPath = env.Path || env.PATH || "";
  env.PATH = `${binDir}${path.delimiter}${currentPath}`;
  env.Path = env.PATH;

  const child = spawn(command[0], command.slice(1), {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
    windowsHide: true,
    cwd: analyticsRoot(),
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(`[local-test-db] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
