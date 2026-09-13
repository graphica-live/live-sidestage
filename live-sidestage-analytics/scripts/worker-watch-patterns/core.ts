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

export type WorkerRestartProposalClass =
  | "recommended"
  | "graph-only"
  | "not-needed";

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

export const ANALYTICS_REPO_PREFIX = "live-sidestage-analytics/";

/**
 * モノレポ相対パスを expected パターンと揃える（バックスラッシュ・./ 除去、analytics プレフィックス）
 */
export function normalizeRepoRelativePath(file: string): string {
  const trimmed = file.trim();
  if (!trimmed) {
    return "";
  }

  let normalized = trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.startsWith(ANALYTICS_REPO_PREFIX)) {
    return normalized;
  }

  return ANALYTICS_REPO_PREFIX + normalized;
}

/**
 * expected パターン（完全一致、または `/**` 終端のディレクトリプレフィックス）と path が一致するか
 */
export function patternMatches(path: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) {
    const dir = pattern.slice(0, -3);
    return path === dir || path.startsWith(`${dir}/`);
  }

  return path === pattern;
}

/**
 * 変更ファイル一覧と expected パターン集合の交差（正規化後の変更パスをソート一意で返す）
 */
export function intersectChangedWithExpected(
  changedFiles: string[],
  expected: Set<string>
): string[] {
  const patterns = Array.from(expected);
  const hits = new Set<string>();

  for (const file of changedFiles) {
    const normalized = normalizeRepoRelativePath(file);
    if (!normalized) {
      continue;
    }

    for (const pattern of patterns) {
      if (patternMatches(normalized, pattern)) {
        hits.add(normalized);
        break;
      }
    }
  }

  return Array.from(hits).sort();
}

export function classifyWorkerRestartProposal(opts: {
  usedHits: string[];
  graphHits: string[];
}): WorkerRestartProposalClass {
  if (opts.usedHits.length > 0) {
    return "recommended";
  }
  if (opts.graphHits.length > 0) {
    return "graph-only";
  }
  return "not-needed";
}

/**
 * 正規表現ベースのimport/export抽出
 * import/export ... from "..." 形式の他、動的importやrequireにも対応
 * 複数行のimport文にも対応
 */
type NeededBinding = "*" | Set<string>;

interface ParsedImport {
  spec: string;
  kind:
    | "side-effect"
    | "namespace"
    | "default"
    | "named"
    | "export-all"
    | "dynamic"
    | "require";
  namedSources: string[];
  localNames: string[];
  typeOnly: boolean;
}

function isLocalResolvableSpec(spec: string): boolean {
  return spec.startsWith("@/") || spec.startsWith(".");
}

/**
 * import graph 用: モジュール単位 BFS で辿る spec 一覧（side-effect 含む）
 */
function extractImportSpecsForGraph(content: string): string[] {
  const specs: string[] = [];

  const staticPattern = /(?:import|export)[\s\S]*?from\s+["'`]([^"'`]+)["'`]/g;
  let match: RegExpExecArray | null;
  while ((match = staticPattern.exec(content)) !== null) {
    specs.push(match[1]);
  }

  const sideEffectPattern = /import\s+["'`]([^"'`]+)["'`]\s*;?/g;
  while ((match = sideEffectPattern.exec(content)) !== null) {
    specs.push(match[1]);
  }

  const dynamicPattern = /import\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  while ((match = dynamicPattern.exec(content)) !== null) {
    specs.push(match[1]);
  }

  const requirePattern = /require\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  while ((match = requirePattern.exec(content)) !== null) {
    specs.push(match[1]);
  }

  return specs;
}

function stripImportTypeOnlyPrefix(statement: string): string {
  return statement.replace(/^import\s+type\s+/, "import ");
}

function parseNamedImportClause(clause: string): { sources: string[]; locals: string[] } {
  const sources: string[] = [];
  const locals: string[] = [];
  const inner = clause.replace(/^\{/, "").replace(/\}$/, "").trim();
  if (!inner) {
    return { sources, locals };
  }

  for (const part of inner.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    if (/^type\s+/.test(trimmed)) {
      continue;
    }
    const asMatch = trimmed.match(/^([\w$]+)\s+as\s+([\w$]+)$/);
    if (asMatch) {
      sources.push(asMatch[1]);
      locals.push(asMatch[2]);
      continue;
    }
    const idMatch = trimmed.match(/^([\w$]+)$/);
    if (idMatch) {
      sources.push(idMatch[1]);
      locals.push(idMatch[1]);
    }
  }

  return { sources, locals };
}

function parseImportStatements(content: string): ParsedImport[] {
  const results: ParsedImport[] = [];
  const importPattern = /import\s+[\s\S]*?;|import\s+[\s\S]*?(?=\n|$)/g;
  let match: RegExpExecArray | null;

  while ((match = importPattern.exec(content)) !== null) {
    let statement = match[0].trim();
    if (!statement) {
      continue;
    }

    if (/^import\s+type\s+/.test(statement)) {
      continue;
    }

    statement = stripImportTypeOnlyPrefix(statement);

    const sideEffect = statement.match(/^import\s+["'`]([^"'`]+)["'`]/);
    if (sideEffect && !/\bfrom\b/.test(statement)) {
      results.push({
        spec: sideEffect[1],
        kind: "side-effect",
        namedSources: [],
        localNames: [],
        typeOnly: false,
      });
      continue;
    }

    const fromMatch = statement.match(/\bfrom\s+["'`]([^"'`]+)["'`]/);
    if (!fromMatch) {
      continue;
    }
    const spec = fromMatch[1];

    if (/^export\s+\*\s+from/.test(statement)) {
      results.push({
        spec,
        kind: "export-all",
        namedSources: [],
        localNames: [],
        typeOnly: false,
      });
      continue;
    }

    const nsMatch = statement.match(/^import\s+\*\s+as\s+([\w$]+)\s+from/);
    if (nsMatch) {
      results.push({
        spec,
        kind: "namespace",
        namedSources: [],
        localNames: [nsMatch[1]],
        typeOnly: false,
      });
      continue;
    }

    const namedMatch = statement.match(/^import\s+(\{[\s\S]*?\})\s+from/);
    if (namedMatch) {
      const { sources, locals } = parseNamedImportClause(namedMatch[1]);
      if (sources.length === 0) {
        continue;
      }
      results.push({
        spec,
        kind: "named",
        namedSources: sources,
        localNames: locals,
        typeOnly: false,
      });
      continue;
    }

    const defaultMatch = statement.match(/^import\s+([\w$]+)\s+from/);
    if (defaultMatch) {
      results.push({
        spec,
        kind: "default",
        namedSources: [],
        localNames: [defaultMatch[1]],
        typeOnly: false,
      });
      continue;
    }
  }

  const exportFromPattern = /export\s+\*\s+from\s+["'`]([^"'`]+)["'`]/g;
  while ((match = exportFromPattern.exec(content)) !== null) {
    results.push({
      spec: match[1],
      kind: "export-all",
      namedSources: [],
      localNames: [],
      typeOnly: false,
    });
  }

  const dynamicPattern = /import\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  while ((match = dynamicPattern.exec(content)) !== null) {
    results.push({
      spec: match[1],
      kind: "dynamic",
      namedSources: [],
      localNames: [],
      typeOnly: false,
    });
  }

  const requirePattern = /require\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  while ((match = requirePattern.exec(content)) !== null) {
    results.push({
      spec: match[1],
      kind: "require",
      namedSources: [],
      localNames: [],
      typeOnly: false,
    });
  }

  return results;
}

function mapExportNameToSource(content: string, exportName: string): string | null {
  const declPatterns = [
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${exportName}\\b`),
    new RegExp(`export\\s+const\\s+${exportName}\\b`),
    new RegExp(`export\\s+class\\s+${exportName}\\b`),
    new RegExp(`export\\s+let\\s+${exportName}\\b`),
    new RegExp(`export\\s+var\\s+${exportName}\\b`),
  ];
  for (const p of declPatterns) {
    if (p.test(content)) {
      return exportName;
    }
  }

  const reExport = new RegExp(
    `export\\s+\\{[^}]*\\b([\\w$]+)(?:\\s+as\\s+${exportName})?\\b[^}]*\\}`,
    "g"
  );
  let m: RegExpExecArray | null;
  while ((m = reExport.exec(content)) !== null) {
    const block = m[0];
    const parts = block.replace(/^export\s+\{/, "").replace(/\}$/, "").split(",");
    for (const part of parts) {
      const trimmed = part.trim();
      const asMatch = trimmed.match(/^([\w$]+)\s+as\s+([\w$]+)$/);
      if (asMatch) {
        if (asMatch[2] === exportName) {
          return asMatch[1];
        }
        continue;
      }
      const idMatch = trimmed.match(/^([\w$]+)$/);
      if (idMatch && idMatch[1] === exportName) {
        return exportName;
      }
    }
  }

  return null;
}

function extractBalancedBraces(content: string, openBraceIndex: number): string | null {
  let depth = 0;
  let mode: "code" | "sq" | "dq" | "tmpl" | "line" | "block" = "code";

  for (let i = openBraceIndex; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (mode === "line") {
      if (ch === "\n") {
        mode = "code";
      }
      continue;
    }
    if (mode === "block") {
      if (ch === "*" && next === "/") {
        mode = "code";
        i++;
      }
      continue;
    }
    if (mode === "sq" || mode === "dq") {
      if (ch === "\\") {
        i++;
        continue;
      }
      if ((mode === "sq" && ch === "'") || (mode === "dq" && ch === '"')) {
        mode = "code";
      }
      continue;
    }
    if (mode === "tmpl") {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === "`") {
        mode = "code";
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      mode = "line";
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      mode = "block";
      i++;
      continue;
    }
    if (ch === "'") {
      mode = "sq";
      continue;
    }
    if (ch === '"') {
      mode = "dq";
      continue;
    }
    if (ch === "`") {
      mode = "tmpl";
      continue;
    }

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return content.slice(openBraceIndex, i + 1);
      }
    }
  }
  return null;
}

function skipWhitespace(slice: string, index: number): number {
  let i = index;
  while (i < slice.length && /\s/.test(slice[i])) {
    i++;
  }
  return i;
}

function looksLikeTypeObject(bracesInclusive: string): boolean {
  const inner = bracesInclusive.slice(1, -1);
  if (/\b(return|await|throw|try|catch|if|for|while|switch|const|let|var)\b/.test(inner)) {
    return false;
  }
  return /[\w$]\s*:/.test(inner) || inner.trim() === "";
}

function findFunctionBodyBraceIndex(slice: string): number {
  const openParen = slice.indexOf("(");
  if (openParen === -1) {
    return -1;
  }

  let depth = 0;
  for (let i = openParen; i < slice.length; i++) {
    const ch = slice[i];
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return findBodyBraceAfterParams(slice, i + 1);
      }
    }
  }

  return -1;
}

function findBodyBraceAfterParams(slice: string, start: number): number {
  let i = skipWhitespace(slice, start);
  if (i < slice.length && slice[i] === "{") {
    return i;
  }
  if (i >= slice.length || slice[i] !== ":") {
    const braceIndex = slice.indexOf("{", start);
    return braceIndex;
  }

  i += 1;
  let angle = 0;
  let paren = 0;
  let square = 0;
  while (i < slice.length) {
    i = skipWhitespace(slice, i);
    if (i >= slice.length) {
      break;
    }
    const ch = slice[i];
    if (ch === "<") {
      angle++;
      i++;
      continue;
    }
    if (ch === ">" && angle > 0) {
      angle--;
      i++;
      continue;
    }
    if (ch === "(") {
      paren++;
      i++;
      continue;
    }
    if (ch === ")" && paren > 0) {
      paren--;
      i++;
      continue;
    }
    if (ch === "[") {
      square++;
      i++;
      continue;
    }
    if (ch === "]" && square > 0) {
      square--;
      i++;
      continue;
    }
    if (ch === "{" && angle === 0 && paren === 0 && square === 0) {
      const obj = extractBalancedBraces(slice, i);
      if (!obj) {
        return i;
      }
      if (looksLikeTypeObject(obj)) {
        i += obj.length;
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

function findAssignmentEquals(slice: string): number {
  let angle = 0;
  let paren = 0;
  let square = 0;
  let brace = 0;
  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    const next = slice[i + 1];
    if (ch === "=" && next === ">") {
      i++;
      continue;
    }
    if (ch === "<") {
      angle++;
      continue;
    }
    if (ch === ">" && angle > 0) {
      angle--;
      continue;
    }
    if (ch === "(") {
      paren++;
      continue;
    }
    if (ch === ")" && paren > 0) {
      paren--;
      continue;
    }
    if (ch === "[") {
      square++;
      continue;
    }
    if (ch === "]" && square > 0) {
      square--;
      continue;
    }
    if (ch === "{") {
      brace++;
      continue;
    }
    if (ch === "}" && brace > 0) {
      brace--;
      continue;
    }
    if (ch === "=" && angle === 0 && paren === 0 && square === 0 && brace === 0) {
      return i;
    }
  }
  return -1;
}

function extractTopLevelBindingBody(content: string, bindingName: string): string | null {
  const patterns = [
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${bindingName}\\b`),
    new RegExp(`(?:^|\\n)(?:async\\s+)?function\\s+${bindingName}\\b`),
    new RegExp(`export\\s+class\\s+${bindingName}\\b`),
    new RegExp(`(?:^|\\n)class\\s+${bindingName}\\b`),
    new RegExp(`export\\s+const\\s+${bindingName}\\b`),
    new RegExp(`(?:^|\\n)const\\s+${bindingName}\\b`),
    new RegExp(`export\\s+let\\s+${bindingName}\\b`),
    new RegExp(`(?:^|\\n)let\\s+${bindingName}\\b`),
    new RegExp(`export\\s+var\\s+${bindingName}\\b`),
    new RegExp(`(?:^|\\n)var\\s+${bindingName}\\b`),
  ];

  for (const p of patterns) {
    const m = content.match(p);
    if (!m || m.index === undefined) {
      continue;
    }

    const slice = content.slice(m.index);
    if (/function\s/.test(slice) || /\bclass\s/.test(slice)) {
      const braceIndex = /function\s/.test(slice)
        ? findFunctionBodyBraceIndex(slice)
        : slice.indexOf("{");
      if (braceIndex !== -1) {
        const body = extractBalancedBraces(slice, braceIndex);
        if (body) {
          return body;
        }
      }
      continue;
    }

    const eq = findAssignmentEquals(slice);
    const searchFrom = eq === -1 ? slice : slice.slice(eq + 1);

    const arrowBrace = searchFrom.indexOf("=>");
    if (arrowBrace !== -1) {
      const afterArrow = searchFrom.slice(arrowBrace + 2).trimStart();
      if (afterArrow.startsWith("{")) {
        const body = extractBalancedBraces(afterArrow, 0);
        if (body) {
          return body;
        }
      }
      const semi = searchFrom.indexOf(";");
      if (semi !== -1) {
        return searchFrom.slice(0, semi + 1);
      }
      continue;
    }

    const braceIndex = searchFrom.indexOf("{");
    const semi = searchFrom.indexOf(";");
    if (braceIndex !== -1 && (semi === -1 || braceIndex < semi)) {
      const body = extractBalancedBraces(searchFrom, braceIndex);
      if (body) {
        return body;
      }
    }
    if (semi !== -1) {
      return searchFrom.slice(0, semi + 1);
    }
  }

  return null;
}

function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, " ")
    .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, " ")
    .replace(/`[^`\\]*(?:\\.[^`\\]*)*`/g, " ");
}

function listTopLevelBindingNames(content: string): Set<string> {
  const names = new Set<string>();
  const patterns = [
    /(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+([\w$]+)/g,
    /(?:^|\n)(?:export\s+)?const\s+([\w$]+)\b/g,
    /(?:^|\n)(?:export\s+)?let\s+([\w$]+)\b/g,
    /(?:^|\n)(?:export\s+)?var\s+([\w$]+)\b/g,
    /(?:^|\n)(?:export\s+)?class\s+([\w$]+)/g,
  ];
  for (const p of patterns) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(content)) !== null) {
      names.add(m[1]);
    }
  }
  return names;
}

/** List/query entrypoints in mixed modules (e.g. battle-history.ts).
 * They share the file with listener helpers but are not on the worker runtime path.
 */
const LIST_QUERY_EXPORTS_EXCLUDED_FROM_USED_CLOSURE = new Set([
  "queryBattles",
  "queryBattleContributors",
  "buildBattleListItems",
]);

function closeReferencedBindings(content: string, seedNames: Set<string>): Set<string> {
  const topLevel = listTopLevelBindingNames(content);
  const closed = new Set<string>();
  const worklist = [...seedNames];

  while (worklist.length > 0) {
    const name = worklist.pop()!;
    if (closed.has(name)) {
      continue;
    }
    if (!topLevel.has(name)) {
      continue;
    }
    if (LIST_QUERY_EXPORTS_EXCLUDED_FROM_USED_CLOSURE.has(name)) {
      continue;
    }
    closed.add(name);

    const body = extractTopLevelBindingBody(content, name);
    if (!body) {
      continue;
    }

    const scrubbed = stripCommentsAndStrings(body);
    const idPattern = /\b([A-Za-z_$][\w$]*)\b/g;
    let m: RegExpExecArray | null;
    while ((m = idPattern.exec(scrubbed)) !== null) {
      const id = m[1];
      if (LIST_QUERY_EXPORTS_EXCLUDED_FROM_USED_CLOSURE.has(id)) {
        continue;
      }
      if (topLevel.has(id) && !closed.has(id)) {
        worklist.push(id);
      }
    }
  }

  return closed;
}

function collectReferencedIdentifiers(content: string, closed: Set<string>): Set<string> {
  const referenced = new Set<string>();
  for (const name of closed) {
    const body = extractTopLevelBindingBody(content, name);
    if (!body) {
      continue;
    }
    const scrubbed = stripCommentsAndStrings(body);
    const idPattern = /\b([A-Za-z_$][\w$]*)\b/g;
    let m: RegExpExecArray | null;
    while ((m = idPattern.exec(scrubbed)) !== null) {
      referenced.add(m[1]);
    }
  }
  return referenced;
}

function collectNeededExportSources(
  content: string,
  needed: Set<string>
): { closed: Set<string>; fallbackWholeModule: boolean } {
  const seeds = new Set<string>();

  for (const exportName of needed) {
    const source = mapExportNameToSource(content, exportName);
    if (source === null) {
      // type-only / 見つからない named は WHOLE_MODULE に倒さず飛ばす
      continue;
    }
    seeds.add(source);
  }

  if (seeds.size === 0) {
    return { closed: new Set(), fallbackWholeModule: false };
  }

  const closed = closeReferencedBindings(content, seeds);
  return { closed, fallbackWholeModule: false };
}

function validateRootFiles(roots: string[]): void {
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
}

function mergeNeeded(
  existing: NeededBinding | undefined,
  incoming: NeededBinding
): NeededBinding {
  if (incoming === "*" || existing === "*") {
    return "*";
  }
  const merged = new Set(existing ?? []);
  for (const n of incoming) {
    merged.add(n);
  }
  return merged;
}

function neededHasNewNames(
  existing: NeededBinding | undefined,
  incoming: NeededBinding
): boolean {
  if (incoming === "*") {
    return existing !== "*";
  }
  if (existing === "*" || existing === undefined) {
    return incoming.size > 0;
  }
  for (const n of incoming) {
    if (!existing.has(n)) {
      return true;
    }
  }
  return false;
}

function neededToSet(needed: NeededBinding): Set<string> | null {
  return needed === "*" ? null : needed;
}

function enqueueResolved(
  queue: Array<{ fileAbs: string; needed: NeededBinding }>,
  fileNeeded: Map<string, NeededBinding>,
  resolved: string,
  needed: NeededBinding,
  normalizedSrcDir: string
): void {
  const normalizedResolved = path.resolve(resolved).replace(/\\/g, "/");
  if (!normalizedResolved.startsWith(normalizedSrcDir)) {
    return;
  }

  const prev = fileNeeded.get(resolved);
  const merged = mergeNeeded(prev, needed);
  if (!neededHasNewNames(prev, needed)) {
    return;
  }
  fileNeeded.set(resolved, merged);
  queue.push({ fileAbs: resolved, needed: merged });
}


function processWholeModuleImports(
  content: string,
  current: string,
  rootDir: string,
  srcDir: string,
  queue: Array<{ fileAbs: string; needed: NeededBinding }>,
  fileNeeded: Map<string, NeededBinding>,
  unresolved: string[],
  normalizedSrcDir: string
): void {
  const imports = parseImportStatements(content);
  const fromDir = path.dirname(current);

  for (const imp of imports) {
    if (!isLocalResolvableSpec(imp.spec)) {
      continue;
    }

    const resolved = resolveImportSpec(imp.spec, fromDir, rootDir, srcDir);
    if (resolved === null) {
      unresolved.push(`${current} -> ${imp.spec}`);
      continue;
    }

    if (
      imp.kind === "side-effect" ||
      imp.kind === "namespace" ||
      imp.kind === "default" ||
      imp.kind === "export-all" ||
      imp.kind === "dynamic" ||
      imp.kind === "require"
    ) {
      enqueueResolved(queue, fileNeeded, resolved, "*", normalizedSrcDir);
      continue;
    }

    if (imp.kind === "named") {
      enqueueResolved(
        queue,
        fileNeeded,
        resolved,
        new Set(imp.namedSources),
        normalizedSrcDir
      );
    }
  }
}

function processNamedModuleImports(
  content: string,
  needed: Set<string>,
  current: string,
  rootDir: string,
  srcDir: string,
  queue: Array<{ fileAbs: string; needed: NeededBinding }>,
  fileNeeded: Map<string, NeededBinding>,
  unresolved: string[],
  normalizedSrcDir: string
): void {
  const { closed, fallbackWholeModule } = collectNeededExportSources(content, needed);
  if (fallbackWholeModule) {
    processWholeModuleImports(
      content,
      current,
      rootDir,
      srcDir,
      queue,
      fileNeeded,
      unresolved,
      normalizedSrcDir
    );
    return;
  }

  const referenced = collectReferencedIdentifiers(content, closed);

  const imports = parseImportStatements(content);
  const fromDir = path.dirname(current);
  const localToImp = new Map<string, ParsedImport>();

  for (const imp of imports) {
    if (imp.kind === "named") {
      for (let i = 0; i < imp.localNames.length; i++) {
        localToImp.set(imp.localNames[i], imp);
      }
    } else if (imp.kind === "default" || imp.kind === "namespace") {
      for (const local of imp.localNames) {
        localToImp.set(local, imp);
      }
    }
  }

  for (const [localName, imp] of localToImp) {
    if (!referenced.has(localName)) {
      continue;
    }
    if (!isLocalResolvableSpec(imp.spec)) {
      continue;
    }

    const resolved = resolveImportSpec(imp.spec, fromDir, rootDir, srcDir);
    if (resolved === null) {
      unresolved.push(`${current} -> ${imp.spec}`);
      continue;
    }

    if (
      imp.kind === "namespace" ||
      imp.kind === "default" ||
      imp.kind === "dynamic" ||
      imp.kind === "require" ||
      imp.kind === "export-all"
    ) {
      enqueueResolved(queue, fileNeeded, resolved, "*", normalizedSrcDir);
    } else if (imp.kind === "named") {
      enqueueResolved(
        queue,
        fileNeeded,
        resolved,
        new Set(imp.namedSources),
        normalizedSrcDir
      );
    }
  }

  for (const imp of imports) {
    if (imp.kind !== "side-effect") {
      continue;
    }
    if (!isLocalResolvableSpec(imp.spec)) {
      continue;
    }
    const resolved = resolveImportSpec(imp.spec, fromDir, rootDir, srcDir);
    if (resolved === null) {
      unresolved.push(`${current} -> ${imp.spec}`);
      continue;
    }
    enqueueResolved(queue, fileNeeded, resolved, "*", normalizedSrcDir);
  }
}

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
export function buildUsedBindingGraph(opts: ImportGraphOptions): ImportGraphResult {
  const { rootDir, srcDir, roots } = opts;
  validateRootFiles(roots);

  const libFiles = new Set<string>();
  const unresolved: string[] = [];
  const normalizedSrcDir = path.resolve(srcDir).replace(/\\/g, "/");

  const fileNeeded = new Map<string, NeededBinding>();
  const queue: Array<{ fileAbs: string; needed: NeededBinding }> = [];

  for (const root of roots) {
    fileNeeded.set(root, "*");
    queue.push({ fileAbs: root, needed: "*" });
  }

  const processedWhole = new Set<string>();

  while (queue.length > 0) {
    const { fileAbs: current, needed: itemNeeded } = queue.shift()!;

    const normalizedCurrent = path.resolve(current).replace(/\\/g, "/");
    if (normalizedCurrent.startsWith(normalizedSrcDir)) {
      libFiles.add(path.relative(srcDir, current).replace(/\\/g, "/"));
    }

    const neededSet = neededToSet(itemNeeded);
    if (neededSet === null) {
      if (processedWhole.has(current)) {
        continue;
      }
      processedWhole.add(current);
    }

    let content: string;
    try {
      content = fs.readFileSync(current, "utf8");
    } catch {
      unresolved.push(`${current} -> <read error>`);
      continue;
    }

    if (neededSet === null) {
      processWholeModuleImports(
        content,
        current,
        rootDir,
        srcDir,
        queue,
        fileNeeded,
        unresolved,
        normalizedSrcDir
      );
    } else {
      processNamedModuleImports(
        content,
        neededSet,
        current,
        rootDir,
        srcDir,
        queue,
        fileNeeded,
        unresolved,
        normalizedSrcDir
      );
    }
  }

  return {
    libFiles: Array.from(libFiles).sort(),
    unresolved: unresolved.sort(),
  };
}

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
    const specs = extractImportSpecsForGraph(content);

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
  const prefix = opts?.pathPrefix ?? ANALYTICS_REPO_PREFIX;
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


