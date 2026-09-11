/**
 * Railway API読み取り専用クライアント
 * Node 18+ required (globalThis.fetch)
 * design-review反映: GraphQL schema暗黙依存のthrow、execFileSyncエラー再送出
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RailwayContext {
  environmentId: string;
  serviceIds: { worker1: string; worker2: string; worker3: string };
}

/**
 * railway status --json から production環境ID と worker1/2/3 serviceIdを取得
 * design-review反映: execFileSyncエラーの安全な再送出
 */
export function getRailwayContext(rootDir: string): RailwayContext {
  let statusOutput: string;

  try {
    // Windows では railway の実体が railway.cmd/.ps1 のため execFileSync の直接実行はENOENTになる。
    // 引数は固定文字列のみでユーザー入力を含まないため shell 経由でも injection リスクはない。
    statusOutput = execFileSync("railway", ["status", "--json"], {
      cwd: rootDir,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
  } catch (err) {
    // execFileSync失敗時は原因が分かるメッセージで再throw
    // (生stdout/stderrを素通しにしない)
    if (err instanceof Error) {
      throw new Error(
        `Failed to run "railway status --json": ${err.message}`
      );
    }
    throw new Error(`Failed to run "railway status --json": unknown error`);
  }

  let status: any;
  try {
    status = JSON.parse(statusOutput);
  } catch {
    throw new Error("Failed to parse railway status JSON output");
  }

  // production環境を探す
  let environmentId: string | undefined;
  if (status.environments?.edges) {
    for (const edge of status.environments.edges) {
      if (edge.node?.name === "production") {
        environmentId = edge.node.id;
        break;
      }
    }
  }

  if (!environmentId) {
    throw new Error('No production environment found in railway status');
  }

  // worker1, worker2, worker3 のserviceIdを探す
  const serviceIds: { worker1?: string; worker2?: string; worker3?: string } = {};
  if (status.services?.edges) {
    for (const edge of status.services.edges) {
      const name = edge.node?.name;
      const id = edge.node?.id;
      if (name && id && (name === "worker1" || name === "worker2" || name === "worker3")) {
        serviceIds[name as "worker1" | "worker2" | "worker3"] = id;
      }
    }
  }

  if (!serviceIds.worker1 || !serviceIds.worker2 || !serviceIds.worker3) {
    throw new Error(
      `Not all worker services found. Got: worker1=${serviceIds.worker1}, ` +
      `worker2=${serviceIds.worker2}, worker3=${serviceIds.worker3}`
    );
  }

  return {
    environmentId,
    serviceIds: serviceIds as Required<typeof serviceIds>,
  };
}

/**
 * ~/.railway/config.json からアクセストークンを読取
 * tokenが無い場合は原因が分かるメッセージでthrow
 */
export function getAccessToken(): string {
  const configPath = path.join(os.homedir(), ".railway", "config.json");

  let configContent: string;
  try {
    configContent = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    throw new Error(
      `Railway config not found at ${configPath}. ` +
      `Please run "railway login" first.`
    );
  }

  let config: any;
  try {
    config = JSON.parse(configContent);
  } catch {
    throw new Error(`Failed to parse railway config at ${configPath}`);
  }

  const token = config?.user?.accessToken;
  if (!token) {
    throw new Error(
      `Access token not found in railway config. ` +
      `Please run "railway login" again.`
    );
  }

  return token;
}

/**
 * GraphQL query で environment のserviceInstances と watchPatterns を取得
 * design-review反映: GraphQL schema暗黙依存のthrow (watchPatternsフィールド無し/edges空の場合)
 */
export async function fetchWatchPatterns(
  environmentId: string,
  accessToken: string,
  serviceIds: Record<"worker1" | "worker2" | "worker3", string>
): Promise<Record<"worker1" | "worker2" | "worker3", string[]>> {
  const query = `
    query($id: String!) {
      environment(id: $id) {
        serviceInstances {
          edges {
            node {
              serviceId
              watchPatterns
            }
          }
        }
      }
    }
  `;

  let response: Response;
  try {
    response = await globalThis.fetch("https://backboard.railway.com/graphql/v2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: { id: environmentId },
      }),
    });
  } catch (err) {
    throw new Error(
      `Network error fetching Railway GraphQL: ` +
      (err instanceof Error ? err.message : "unknown")
    );
  }

  let json: any;
  try {
    json = await response.json();
  } catch {
    throw new Error(`Failed to parse Railway GraphQL response`);
  }

  // GraphQL errors チェック
  if (json.errors) {
    const errorMessages = (json.errors as any[])
      .map((e) => typeof e === "string" ? e : e.message)
      .join("; ");
    throw new Error(`Railway GraphQL error: ${errorMessages}`);
  }

  // schema チェック (design-review反映)
  const serviceInstances = json?.data?.environment?.serviceInstances;
  if (!serviceInstances || !serviceInstances.edges) {
    throw new Error(
      `Unexpected Railway GraphQL response schema: ` +
      `missing environment.serviceInstances.edges`
    );
  }

  // 結果振り分け
  const result: Record<"worker1" | "worker2" | "worker3", string[]> = {
    worker1: [],
    worker2: [],
    worker3: [],
  };

  for (const edge of serviceInstances.edges) {
    const node = edge.node;
    if (!node) continue;

    const { serviceId, watchPatterns } = node;

    // watchPatterns が無い場合はエラー (design-review反映)
    if (!Array.isArray(watchPatterns)) {
      throw new Error(
        `Unexpected Railway GraphQL response schema: ` +
        `missing watchPatterns field for serviceId=${serviceId}`
      );
    }

    // serviceId逆引き
    const workerNames: Array<"worker1" | "worker2" | "worker3"> = ["worker1", "worker2", "worker3"];
    for (const name of workerNames) {
      if (serviceIds[name] === serviceId) {
        result[name] = watchPatterns;
        break;
      }
    }
  }

  return result;
}
