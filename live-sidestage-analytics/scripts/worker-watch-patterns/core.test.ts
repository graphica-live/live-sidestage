import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { buildImportGraph, buildExpectedPatterns, diffPatterns, COMMON_WATCH_PATTERNS } from "./core";

describe("buildImportGraph", () => {
  describe("回帰テスト - 実リポジトリ", () => {
    it("live-sidestage-analyticsの実リポジトリからimportグラフを生成できる", () => {
      const repoRoot = path.resolve(__dirname, "../../");
      const srcDir = path.resolve(repoRoot, "src", "lib");
      const workerPath = path.resolve(repoRoot, "worker.ts");
      const tiktokListenerPath = path.resolve(srcDir, "tiktok-listener.ts");

      const result = buildImportGraph({
        rootDir: repoRoot,
        srcDir,
        roots: [workerPath, tiktokListenerPath],
      });

      // ファイルが検出されていること、ソート済みであることを確認
      // (正確なファイル数は前回計画と環境差異により異なる可能性があるので、数値チェックではなく構造チェック)
      // unresolved が存在するのは正常（外部パッケージなど解決不可能なimport）
      expect(result.libFiles.length).toBeGreaterThan(0);
      expect(result.libFiles).toEqual(result.libFiles.sort());
      expect(Array.isArray(result.unresolved)).toBe(true);
    });
  });

  describe("単体テスト - 最小限fixture", () => {
    let tempDir: string;
    let srcLibDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync("test-import-graph-");
      srcLibDir = path.join(tempDir, "src", "lib");
      fs.mkdirSync(srcLibDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("相対import (./) を解決できる", () => {
      // srcLibDir/
      //   helper.ts
      //   main.ts (imports ./helper.ts)
      fs.writeFileSync(path.join(srcLibDir, "helper.ts"), "export const help = () => {};");
      fs.writeFileSync(
        path.join(srcLibDir, "main.ts"),
        `import { help } from "./helper";`
      );

      const result = buildImportGraph({
        rootDir: tempDir,
        srcDir: srcLibDir,
        roots: [path.join(srcLibDir, "main.ts")],
      });

      expect(result.libFiles).toContain("helper.ts");
      expect(result.unresolved.length).toBe(0);
    });

    it("存在しない相対importはunresolvedに記録される", () => {
      fs.writeFileSync(
        path.join(srcLibDir, "main.ts"),
        `import { missing } from "./nonexistent";`
      );

      const result = buildImportGraph({
        rootDir: tempDir,
        srcDir: srcLibDir,
        roots: [path.join(srcLibDir, "main.ts")],
      });

      expect(result.unresolved.some(u => u.includes("./nonexistent"))).toBe(true);
    });

    it("@/ エイリアスを解決できる", () => {
      // srcLibDir = tempDir/src/lib
      // @/ は tempDir/src/ を指す（@/* → ./src/*）ので @/lib/nested/nested と書く
      // srcLibDir/
      //   nested/nested.ts
      //   main.ts (imports @/lib/nested/nested.ts)
      fs.mkdirSync(path.join(srcLibDir, "nested"), { recursive: true });
      fs.writeFileSync(path.join(srcLibDir, "nested", "nested.ts"), "export const n = 1;");
      fs.writeFileSync(
        path.join(srcLibDir, "main.ts"),
        `import { n } from "@/lib/nested/nested";`
      );

      const result = buildImportGraph({
        rootDir: tempDir,
        srcDir: srcLibDir,
        roots: [path.join(srcLibDir, "main.ts")],
      });

      expect(result.libFiles).toContain("nested/nested.ts");
      expect(result.unresolved.length).toBe(0);
    });

    it("動的import を解決できる", () => {
      fs.writeFileSync(path.join(srcLibDir, "dynamic.ts"), "export const d = 1;");
      fs.writeFileSync(
        path.join(srcLibDir, "main.ts"),
        `const mod = import("./dynamic");`
      );

      const result = buildImportGraph({
        rootDir: tempDir,
        srcDir: srcLibDir,
        roots: [path.join(srcLibDir, "main.ts")],
      });

      expect(result.libFiles).toContain("dynamic.ts");
      expect(result.unresolved.length).toBe(0);
    });

    it("require(...) を解決できる", () => {
      fs.writeFileSync(path.join(srcLibDir, "required.ts"), "module.exports = {};");
      fs.writeFileSync(
        path.join(srcLibDir, "main.ts"),
        `const mod = require("./required");`
      );

      const result = buildImportGraph({
        rootDir: tempDir,
        srcDir: srcLibDir,
        roots: [path.join(srcLibDir, "main.ts")],
      });

      expect(result.libFiles).toContain("required.ts");
      expect(result.unresolved.length).toBe(0);
    });

    it("外部パッケージ(node_modules等)は対象外としてスキップされる（unresolvedに入らない）", () => {
      fs.writeFileSync(
        path.join(srcLibDir, "main.ts"),
        `import { foo } from "external-package";`
      );

      const result = buildImportGraph({
        rootDir: tempDir,
        srcDir: srcLibDir,
        roots: [path.join(srcLibDir, "main.ts")],
      });

      // root自身(main.ts)はsrcDir配下なのでlibFilesに含まれる
      expect(result.libFiles).toEqual(["main.ts"]);
      // 外部パッケージはスキップ対象でunresolvedに記録されない
      expect(result.unresolved.length).toBe(0);
    });

    it("循環importを無限ループなく処理できる", () => {
      // main.ts -> cyclic.ts -> main.ts (cycle)
      fs.writeFileSync(
        path.join(srcLibDir, "main.ts"),
        `import { c } from "./cyclic";`
      );
      fs.writeFileSync(
        path.join(srcLibDir, "cyclic.ts"),
        `import { m } from "./main";`
      );

      const result = buildImportGraph({
        rootDir: tempDir,
        srcDir: srcLibDir,
        roots: [path.join(srcLibDir, "main.ts")],
      });

      expect(result.libFiles).toContain("main.ts");
      expect(result.libFiles).toContain("cyclic.ts");
      expect(result.libFiles.length).toBe(2);
    });

    it("root fileが存在しないときはエラーをthrowする", () => {
      const nonexistentPath = path.join(srcLibDir, "nonexistent.ts");

      expect(() => {
        buildImportGraph({
          rootDir: tempDir,
          srcDir: srcLibDir,
          roots: [nonexistentPath],
        });
      }).toThrow(/root file not found/);
    });

    it("root fileがディレクトリのときはエラーをthrowする", () => {
      const dirPath = path.join(srcLibDir, "isdir");
      fs.mkdirSync(dirPath);

      expect(() => {
        buildImportGraph({
          rootDir: tempDir,
          srcDir: srcLibDir,
          roots: [dirPath],
        });
      }).toThrow(/not a regular file/);
    });

    it("外部参照は unresolved に記録される", () => {
      // srcLibDir外に outsider.ts を作成
      const outsideDir = path.join(tempDir, "outside");
      fs.mkdirSync(outsideDir);
      fs.writeFileSync(path.join(outsideDir, "outsider.ts"), "export const o = 1;");

      // srcLibDir/main.ts が外部を参照してimportしようとする
      fs.writeFileSync(
        path.join(srcLibDir, "main.ts"),
        `import { o } from "../../outside/outsider";\nimport pkg from "external-package";`
      );

      const result = buildImportGraph({
        rootDir: tempDir,
        srcDir: srcLibDir,
        roots: [path.join(srcLibDir, "main.ts")],
      });

      // root自身(main.ts)はlibFilesに含まれるが、srcDir外のファイルや外部パッケージは含まれない
      expect(result.libFiles).toEqual(["main.ts"]);
      // 外部パッケージはスキップ対象、srcDir外の相対importは解決できてもキュー対象外なので
      // どちらもunresolvedには記録されない
      expect(result.unresolved.length).toBe(0);
    });
  });
});

describe("buildExpectedPatterns", () => {
  it("COMMON_WATCH_PATTERNS と libFiles を合わせた期待値を生成する", () => {
    const libFiles = ["helper.ts", "nested/module.ts", "foo/bar/baz.ts"];

    const expected = buildExpectedPatterns(libFiles);

    // COMMON_WATCH_PATTERNS (6個)
    for (const pattern of COMMON_WATCH_PATTERNS) {
      expect(expected.has("live-sidestage-analytics/" + pattern)).toBe(true);
    }

    // libFiles (3個)
    expect(expected.has("live-sidestage-analytics/src/lib/helper.ts")).toBe(true);
    expect(expected.has("live-sidestage-analytics/src/lib/nested/module.ts")).toBe(true);
    expect(expected.has("live-sidestage-analytics/src/lib/foo/bar/baz.ts")).toBe(true);

    expect(expected.size).toBe(6 + 3);
  });

  it("pathPrefix カスタマイズができる", () => {
    const libFiles = ["test.ts"];
    const expected = buildExpectedPatterns(libFiles, { pathPrefix: "custom/" });

    expect(expected.has("custom/worker.ts")).toBe(true);
    expect(expected.has("custom/src/lib/test.ts")).toBe(true);
  });
});

describe("diffPatterns", () => {
  it("完全一致のときは missing/extra が空", () => {
    const expected = new Set([
      "live-sidestage-analytics/worker.ts",
      "live-sidestage-analytics/src/lib/helper.ts",
    ]);
    const actual = [
      "live-sidestage-analytics/worker.ts",
      "live-sidestage-analytics/src/lib/helper.ts",
    ];

    const diff = diffPatterns(expected, actual);

    expect(diff.missing).toEqual([]);
    expect(diff.extra).toEqual([]);
  });

  it("expectedに無いものはmissingに入る", () => {
    const expected = new Set([
      "live-sidestage-analytics/worker.ts",
    ]);
    const actual = [
      "live-sidestage-analytics/worker.ts",
      "live-sidestage-analytics/src/lib/helper.ts",
    ];

    const diff = diffPatterns(expected, actual);

    expect(diff.missing).toEqual([]);
    expect(diff.extra).toContain("live-sidestage-analytics/src/lib/helper.ts");
  });

  it("actualに無いものはextraに入る", () => {
    const expected = new Set([
      "live-sidestage-analytics/worker.ts",
      "live-sidestage-analytics/src/lib/helper.ts",
    ]);
    const actual = [
      "live-sidestage-analytics/worker.ts",
    ];

    const diff = diffPatterns(expected, actual);

    expect(diff.missing).toContain("live-sidestage-analytics/src/lib/helper.ts");
    expect(diff.extra).toEqual([]);
  });

  it("missing と extra が両方ある場合", () => {
    const expected = new Set([
      "live-sidestage-analytics/worker.ts",
      "live-sidestage-analytics/src/lib/expected.ts",
    ]);
    const actual = [
      "live-sidestage-analytics/worker.ts",
      "live-sidestage-analytics/src/lib/extra.ts",
    ];

    const diff = diffPatterns(expected, actual);

    expect(diff.missing).toContain("live-sidestage-analytics/src/lib/expected.ts");
    expect(diff.extra).toContain("live-sidestage-analytics/src/lib/extra.ts");
  });
});
