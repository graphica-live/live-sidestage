import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("analytics theme tokens", () => {
  it("globals.css は prefers-color-scheme に追従しない", () => {
    const globals = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(globals).toContain(".analytics-theme-dark");
    expect(globals).toContain(".analytics-theme-light");
    expect(globals).not.toMatch(/prefers-color-scheme:\s*dark/);
  });
});
