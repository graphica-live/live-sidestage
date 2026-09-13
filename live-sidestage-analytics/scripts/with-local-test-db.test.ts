import { describe, expect, it } from "vitest";
import {
  canonicalWorktreePath,
  databaseNameForWorktree,
  hashFromCanonicalPath,
  isLocalDockerTestUrl,
  slugFromWorktreePath,
  withDatabaseName,
} from "./with-local-test-db.mjs";

describe("with-local-test-db", () => {
  it("two worktree paths get different database names", () => {
    const a = databaseNameForWorktree("C:/dev/live-sidestage/.claude/worktrees/auth");
    const b = databaseNameForWorktree("C:/dev/live-sidestage/.claude/worktrees/battle");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^liveanalytics_test_[a-z0-9_]+_[0-9a-f]{8}$/);
    expect(b).toMatch(/^liveanalytics_test_[a-z0-9_]+_[0-9a-f]{8}$/);
  });

  it("same canonical path is stable", () => {
    expect(databaseNameForWorktree("C:/dev/live-sidestage")).toBe(
      databaseNameForWorktree("C:/dev/live-sidestage"),
    );
  });

  it("slug is lowercase identifier from directory name", () => {
    expect(slugFromWorktreePath("C:/dev/live-sidestage/.claude/worktrees/Worktree-Auth")).toBe(
      "worktree_auth",
    );
  });

  it("hash is 8 hex of canonical path", () => {
    const canonical = canonicalWorktreePath("C:/dev/live-sidestage");
    expect(hashFromCanonicalPath(canonical)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("name stays at most 60 characters even with a long directory", () => {
    const long = `C:/dev/${"x".repeat(80)}`;
    const name = databaseNameForWorktree(long);
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name.startsWith("liveanalytics_test_")).toBe(true);
    expect(name.slice(-9)).toMatch(/^_[0-9a-f]{8}$/);
  });

  it("rewrites only local docker test URLs on port 5433", () => {
    expect(isLocalDockerTestUrl("postgresql://liveanalytics:liveanalytics@localhost:5433/liveanalytics_test")).toBe(
      true,
    );
    expect(isLocalDockerTestUrl("postgresql://liveanalytics:liveanalytics@localhost:5432/liveanalytics_test")).toBe(
      false,
    );
    expect(
      isLocalDockerTestUrl("postgresql://postgres:x@acela.proxy.rlwy.net:55211/railway"),
    ).toBe(false);
  });

  it("swaps the database name in DATABASE_URL", () => {
    const next = withDatabaseName(
      "postgresql://liveanalytics:liveanalytics@localhost:5433/liveanalytics_test",
      "liveanalytics_test_auth_abcd1234",
    );
    expect(next).toContain("/liveanalytics_test_auth_abcd1234");
    expect(next).toContain("localhost:5433");
  });
});
