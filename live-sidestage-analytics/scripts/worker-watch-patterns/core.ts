import fs from "fs";
import path from "path";

/**
 * import graph generation and pattern comparison for worker watchPatterns detection
 * design-review反映: cycle detection, root files検証, schema暗黙依存のthrow等をここで実装
 */

export interface ImportGraphOptions {
  rootDir: string;  // live-sidestage-analytics ディレクトリの絶対パス
  srcDir: string;   // rootDir/src/lib
  roots: string[];  // BFSの起点となる絶対パスの配列
}

export interface ImportGraphResult {
  libFiles: string[];   // srcDir相対、"/"区切り、ソート済み（例: "overlay/emit.ts"）
  unresolved: string[]; // 解決できなかった import spec（"<file> -> <spec>"形式）
}

export const COMMON_WATCH_PATTERNS: string[] = [
  "worker.ts",
  "prisma/**",
  "package.json",
  "package-lock.json",
  "Dockerfile",
  "tsconfig.json",
];

/**
 * 正規表現ベースのimport/export抽出
 * import/export ... from "..." 形式の他、動的importやrequireにも対応
 * 複数行のimport文にも対応
 */
function extractImports(content: string): string[] {
  const specs: string[] = [];

  // import ... from "..." / export ... from "..." パターン（複数行対応）
  // [\s\S]*? は改行を含めて任意文字にマッチ（. は改行にマッチしないため）
  const staticPattern = /(?:import|export)[\s\S]*?from\s+["'`]([^"'`]+)["'`]/g;
  let match;
  while ((match = staticPattern.exec(content)) !== null) {
    specs.push(match[1]);
  }

  // 動的import: import("...")
  const dynamicPattern = /import\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  while ((match = dynamicPattern.exec(content)) !== null) {
    specs.push(match[1]);
  }

  // require("...")
  const requirePattern = /require\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  while ((match = requirePattern.exec(content)) !== null) {
    specs.push(match[1]);
  }

  return specs;
}

/**
 * 相対パスまたは@/エイリアスをファイルシステム上の絶対パスへ解決
 * @/ → rootDir/src/
 * ./ / ../ → 相対パス（fromDir基準）
 */
function resolveImportSpec(spec: string, fromDir: string, rootDir: string, srcDir: string): string | null {
  let targetDir: string;
  let relSpec: string;

  if (spec.startsWith("@/")) {
    // @/ エイリアス → rootDir/src/ (srcDirはrootDir/src/libを指すため使わない)
    targetDir = path.resolve(rootDir, "src");
    relSpec = spec.slice(2);
  } else if (spec.startsWith(".")) {
    // 相対パス
    targetDir = fromDir;
    relSpec = spec;
  } else {
    // 外部パッケージ（今回は対象外）
    return null;
  }

  // 絶対パスを生成
  let resolved = path.resolve(targetDir, relSpec);

  // .ts/.tsx/index.ts/index.tsx の順で試す
  const candidates = [
    resolved,
    resolved + ".ts",
    resolved + ".tsx",
    path.join(resolved, "index.ts"),
    path.join(resolved, "index.tsx"),
  ];

  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // ファイルが存在しない、続ける
    }
  }

  return null;
}

/**
 * import graphを生成（BFS）
 * design-review反映: cycle detection (Set利用)、root files存在チェック
 */
export function buildImportGraph(opts: ImportGraphOptions): ImportGraphResult {
  const { rootDir, srcDir, roots } = opts;

  // root files存在チェック（design-review: root files存在チェック）
  for (const root of roots) {
    try {
      const stat = fs.statSync(root);
      if (!stat.isFile()) {
        throw new Error(`root is not a regular file: ${root}`);
      }
    } catch (err) {
      throw new Error(
        `root file not found or inaccessible: ${root}` +
        (err instanceof Error ? ` (${err.message})` : "")
      );
    }
  }

  const libFiles = new Set<string>();
  const unresolved: string[] = [];
  const processed = new Set<string>(); // cycle detection (design-review反映)

  // パス正規化（Windows対応）
  const normalizedSrcDir = path.resolve(srcDir).replace(/\\/g, "/");

  const queue: string[] = [...roots];

  while (queue.length > 0) {
    const current = queue.shift()!;

    // cycle detection: 既に処理済みならスキップ
    if (processed.has(current)) {
      continue;
    }
    processed.add(current);

    // rootファイル自身がsrcDir配下なら期待値に含める（例: tiktok-listener.ts）
    const normalizedCurrent = path.resolve(current).replace(/\\/g, "/");
    if (normalizedCurrent.startsWith(normalizedSrcDir)) {
      libFiles.add(path.relative(srcDir, current).replace(/\\/g, "/"));
    }

    // content読み込み
    let content: string;
    try {
      content = fs.readFileSync(current, "utf8");
    } catch {
      unresolved.push(`${current} -> <read error>`);
      continue;
    }

    // import spec抽出
    const specs = extractImports(content);

    for (const spec of specs) {
      // 外部パッケージ・node組み込みモジュール（@/でも相対パスでもない）は対象外としてスキップ
      // (unresolvedは「相対パス/@/エイリアスだがファイルが見つからない」という異常のみを表す)
      if (!spec.startsWith("@/") && !spec.startsWith(".")) {
        continue;
      }

      const fromDir = path.dirname(current);
      const resolved = resolveImportSpec(spec, fromDir, rootDir, srcDir);

      if (resolved === null) {
        unresolved.push(`${current} -> ${spec}`);
      } else {
        // srcDirの配下かチェック（パス正規化済みで比較）
        const normalizedResolved = path.resolve(resolved).replace(/\\/g, "/");
        if (normalizedResolved.startsWith(normalizedSrcDir)) {
          // srcDir相対パスへ正規化
          const relPath = path.relative(srcDir, resolved).replace(/\\/g, "/");
          libFiles.add(relPath);
        }

        // 次のキューへ（srcDir内ならキューに追加）
        if (normalizedResolved.startsWith(normalizedSrcDir) && !processed.has(resolved)) {
          queue.push(resolved);
        }
      }
    }
  }

  // ソート済みで返す
  return {
    libFiles: Array.from(libFiles).sort(),
    unresolved: unresolved.sort(),
  };
}

/**
 * 期待値を生成（共通パターン + libFilesをプリフィックス付きで）
 */
export function buildExpectedPatterns(
  libFiles: string[],
  opts?: { pathPrefix?: string }
): Set<string> {
  const prefix = opts?.pathPrefix ?? "live-sidestage-analytics/";
  const expected = new Set<string>();

  // 共通パターン
  for (const pattern of COMMON_WATCH_PATTERNS) {
    expected.add(prefix + pattern);
  }

  // libFiles
  for (const libFile of libFiles) {
    expected.add(prefix + "src/lib/" + libFile);
  }

  return expected;
}

/**
 * 期待値と実測値の差分計算
 */
export interface PatternDiff {
  missing: string[]; // expectedにあるがactualに無い
  extra: string[];   // actualにあるがexpectedに無い
}

export function diffPatterns(expected: Set<string>, actual: string[]): PatternDiff {
  const actualSet = new Set(actual);

  const missing: string[] = [];
  for (const pattern of expected) {
    if (!actualSet.has(pattern)) {
      missing.push(pattern);
    }
  }

  const extra: string[] = [];
  for (const pattern of actual) {
    if (!expected.has(pattern)) {
      extra.push(pattern);
    }
  }

  return {
    missing: missing.sort(),
    extra: extra.sort(),
  };
}
