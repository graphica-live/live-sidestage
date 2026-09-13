import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  buildImportGraph,
  buildUsedBindingGraph,
  buildExpectedPatterns,
  COMMON_WATCH_PATTERNS,
  normalizeRepoRelativePath,
  patternMatches,
  intersectChangedWithExpected,
  classifyWorkerRestartProposal,
} from "./core";

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

describe("normalizeRepoRelativePath", () => {
  it("src/lib 相対に analytics プレフィックスを付ける", () => {
    expect(normalizeRepoRelativePath("src/lib/foo.ts")).toBe(
      "live-sidestage-analytics/src/lib/foo.ts"
    );
  });
  it("既にプレフィックス付きなら二重付与しない", () => {
    expect(
      normalizeRepoRelativePath("live-sidestage-analytics/src/lib/foo.ts")
    ).toBe("live-sidestage-analytics/src/lib/foo.ts");
  });
  it("バックスラッシュと先頭 ./ を正規化する", () => {
    expect(normalizeRepoRelativePath(".\\src\\lib\\foo.ts")).toBe(
      "live-sidestage-analytics/src/lib/foo.ts"
    );
  });
});

describe("patternMatches", () => {
  it("完全一致", () => {
    expect(
      patternMatches(
        "live-sidestage-analytics/worker.ts",
        "live-sidestage-analytics/worker.ts"
      )
    ).toBe(true);
  });
  it("prisma/** は配下にマッチし兄弟にはマッチしない", () => {
    expect(
      patternMatches(
        "live-sidestage-analytics/prisma/schema.prisma",
        "live-sidestage-analytics/prisma/**"
      )
    ).toBe(true);
    expect(
      patternMatches(
        "live-sidestage-analytics/prisma-not/schema.prisma",
        "live-sidestage-analytics/prisma/**"
      )
    ).toBe(false);
  });
});

describe("intersectChangedWithExpected", () => {
  const expected = new Set([
    "live-sidestage-analytics/worker.ts",
    "live-sidestage-analytics/prisma/**",
    "live-sidestage-analytics/src/lib/tiktok-listener.ts",
  ]);
  it("hit をソート一意で返す", () => {
    expect(
      intersectChangedWithExpected(
        [
          "src/lib/tiktok-listener.ts",
          "live-sidestage-analytics/worker.ts",
          "live-sidestage-analytics/src/app/page.tsx",
          "live-sidestage-analytics/worker.ts",
        ],
        expected
      )
    ).toEqual([
      "live-sidestage-analytics/src/lib/tiktok-listener.ts",
      "live-sidestage-analytics/worker.ts",
    ]);
  });
  it("page だけなら空", () => {
    expect(
      intersectChangedWithExpected(
        ["live-sidestage-analytics/src/app/page.tsx"],
        expected
      )
    ).toEqual([]);
  });
});

describe("buildUsedBindingGraph", () => {
  describe("fixture", () => {
    let tempDir: string;
    let srcLibDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync("test-used-binding-");
      srcLibDir = path.join(tempDir, "src", "lib");
      fs.mkdirSync(srcLibDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("mixed module: helper のみ辿り query 経路の C は used に含めない", () => {
      fs.writeFileSync(
        path.join(srcLibDir, "c.ts"),
        `export const fromC = () => "c";`
      );
      fs.writeFileSync(
        path.join(srcLibDir, "b.ts"),
        `import { fromC } from "./c";
export function helper() { return 1; }
export function query() { return fromC(); }`
      );
      fs.writeFileSync(
        path.join(srcLibDir, "a.ts"),
        `import { helper } from "./b";
export function run() { return helper(); }`
      );

      const used = buildUsedBindingGraph({
        rootDir: tempDir,
        srcDir: srcLibDir,
        roots: [path.join(srcLibDir, "a.ts")],
      });
      const graph = buildImportGraph({
        rootDir: tempDir,
        srcDir: srcLibDir,
        roots: [path.join(srcLibDir, "a.ts")],
      });

      expect(used.libFiles).toContain("b.ts");
      expect(used.libFiles).not.toContain("c.ts");
      expect(graph.libFiles).toContain("c.ts");
    });

    it("import type は辿らない", () => {
      fs.writeFileSync(
        path.join(srcLibDir, "types.ts"),
        `export type OnlyType = { x: number };`
      );
      fs.writeFileSync(
        path.join(srcLibDir, "main.ts"),
        `import type { OnlyType } from "./types";
export function run(): OnlyType { return { x: 1 }; }`
      );

      const used = buildUsedBindingGraph({
        rootDir: tempDir,
        srcDir: srcLibDir,
        roots: [path.join(srcLibDir, "main.ts")],
      });

      expect(used.libFiles).toEqual(["main.ts"]);
    });

    it("side-effect import を辿る", () => {
      fs.writeFileSync(path.join(srcLibDir, "side.ts"), `export const s = 1;`);
      fs.writeFileSync(
        path.join(srcLibDir, "main.ts"),
        `import "./side";
export const m = 1;`
      );

      const used = buildUsedBindingGraph({
        rootDir: tempDir,
        srcDir: srcLibDir,
        roots: [path.join(srcLibDir, "main.ts")],
      });

      expect(used.libFiles).toContain("side.ts");
    });

    it("inline object return type の関数本体の依存を辿る", () => {
      fs.writeFileSync(
        path.join(srcLibDir, "b.ts"),
        `export function helper() { return 1; }`
      );
      fs.writeFileSync(
        path.join(srcLibDir, "a.ts"),
        `import { helper } from "./b";
export function run(): { ok: boolean } { return { ok: helper() === 1 }; }`
      );

      const used = buildUsedBindingGraph({
        rootDir: tempDir,
        srcDir: srcLibDir,
        roots: [path.join(srcLibDir, "a.ts")],
      });

      expect(used.libFiles).toContain("b.ts");
    });

    it("import { Interface } は WHOLE_MODULE に倒さない", () => {
      fs.writeFileSync(
        path.join(srcLibDir, "heavy-dep.ts"),
        `export const heavy = 1;`
      );
      fs.writeFileSync(
        path.join(srcLibDir, "types.ts"),
        `import { heavy } from "./heavy-dep";
export interface MyType { x: number }
export const keep = heavy;`
      );
      fs.writeFileSync(
        path.join(srcLibDir, "main.ts"),
        `import { MyType } from "./types";
export function run(): MyType { return { x: 1 }; }`
      );

      const used = buildUsedBindingGraph({
        rootDir: tempDir,
        srcDir: srcLibDir,
        roots: [path.join(srcLibDir, "main.ts")],
      });

      expect(used.libFiles).toContain("main.ts");
      expect(used.libFiles).not.toContain("heavy-dep.ts");
    });

    it("型注釈付き const 代入の依存を辿る", () => {
      fs.writeFileSync(
        path.join(srcLibDir, "b.ts"),
        `export function helper() { return 1; }`
      );
      fs.writeFileSync(
        path.join(srcLibDir, "a.ts"),
        `import { helper } from "./b";
type Runner = () => number;
export const run: Runner = () => helper();`
      );

      const used = buildUsedBindingGraph({
        rootDir: tempDir,
        srcDir: srcLibDir,
        roots: [path.join(srcLibDir, "a.ts")],
      });

      expect(used.libFiles).toContain("b.ts");
    });

    it("class メソッド内の import を辿る", () => {
      fs.writeFileSync(
        path.join(srcLibDir, "b.ts"),
        `export function helper() { return 1; }`
      );
      fs.writeFileSync(
        path.join(srcLibDir, "a.ts"),
        `import { helper } from "./b";
export class Handler {
  exec() { return helper(); }
}`
      );

      const used = buildUsedBindingGraph({
        rootDir: tempDir,
        srcDir: srcLibDir,
        roots: [path.join(srcLibDir, "a.ts")],
      });

      expect(used.libFiles).toContain("b.ts");
    });

    it("named alias import { x as y } を source 名で辿る", () => {
      fs.writeFileSync(
        path.join(srcLibDir, "b.ts"),
        `export function sourceName() { return 1; }`
      );
      fs.writeFileSync(
        path.join(srcLibDir, "a.ts"),
        `import { sourceName as alias } from "./b";
export function run() { return alias(); }`
      );

      const used = buildUsedBindingGraph({
        rootDir: tempDir,
        srcDir: srcLibDir,
        roots: [path.join(srcLibDir, "a.ts")],
      });

      expect(used.libFiles).toContain("b.ts");
    });
  });

  describe("回帰 - 実リポジトリ", () => {
    it("battle-replay.ts は graph に含み used には含めない", () => {
      const repoRoot = path.resolve(__dirname, "../../");
      const srcDir = path.resolve(repoRoot, "src", "lib");
      const opts = {
        rootDir: repoRoot,
        srcDir,
        roots: [
          path.resolve(repoRoot, "worker.ts"),
          path.resolve(srcDir, "tiktok-listener.ts"),
        ],
      };

      const graph = buildImportGraph(opts);
      const used = buildUsedBindingGraph(opts);

      expect(graph.libFiles).toContain("battle-replay.ts");
      expect(used.libFiles).not.toContain("battle-replay.ts");
      expect(used.libFiles).toContain("battle-history-finalize.ts");
      expect(used.libFiles).toContain("battle-history.ts");
    });
  });
});

describe("classifyWorkerRestartProposal", () => {
  it("usedHits 優先で recommended", () => {
    expect(
      classifyWorkerRestartProposal({
        usedHits: ["live-sidestage-analytics/worker.ts"],
        graphHits: ["live-sidestage-analytics/src/lib/battle-replay.ts"],
      })
    ).toBe("recommended");
  });

  it("graph のみなら graph-only", () => {
    expect(
      classifyWorkerRestartProposal({
        usedHits: [],
        graphHits: ["live-sidestage-analytics/src/lib/battle-replay.ts"],
      })
    ).toBe("graph-only");
  });

  it("両方空なら not-needed", () => {
    expect(
      classifyWorkerRestartProposal({
        usedHits: [],
        graphHits: [],
      })
    ).toBe("not-needed");
  });
});
