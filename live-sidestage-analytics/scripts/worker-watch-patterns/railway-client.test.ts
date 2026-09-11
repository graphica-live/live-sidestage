import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWatchPatterns } from "./railway-client";

const serviceIds = { worker1: "svc1", worker2: "svc2", worker3: "svc3" };

function mockFetchOnce(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: async () => body,
    } as Response)
  );
}

describe("fetchWatchPatterns", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("正常なレスポンスからworker1/2/3のwatchPatternsを振り分ける", async () => {
    mockFetchOnce({
      data: {
        environment: {
          serviceInstances: {
            edges: [
              { node: { serviceId: "svc1", watchPatterns: ["a.ts"] } },
              { node: { serviceId: "svc2", watchPatterns: ["b.ts"] } },
              { node: { serviceId: "svc3", watchPatterns: ["c.ts"] } },
            ],
          },
        },
      },
    });

    const result = await fetchWatchPatterns("env1", "token", serviceIds);

    expect(result.worker1).toEqual(["a.ts"]);
    expect(result.worker2).toEqual(["b.ts"]);
    expect(result.worker3).toEqual(["c.ts"]);
  });

  it("watchPatternsフィールドが欠落しているとエラーを投げる（design-review反映のschema防御）", async () => {
    mockFetchOnce({
      data: {
        environment: {
          serviceInstances: {
            edges: [{ node: { serviceId: "svc1" } }],
          },
        },
      },
    });

    await expect(fetchWatchPatterns("env1", "token", serviceIds)).rejects.toThrow(
      /missing watchPatterns field/
    );
  });

  it("serviceInstances.edgesが欠落しているとエラーを投げる", async () => {
    mockFetchOnce({ data: { environment: {} } });

    await expect(fetchWatchPatterns("env1", "token", serviceIds)).rejects.toThrow(
      /missing environment.serviceInstances.edges/
    );
  });

  it("GraphQL errorsが返るとエラーを投げる", async () => {
    mockFetchOnce({ errors: [{ message: "Not Authorized" }] });

    await expect(fetchWatchPatterns("env1", "token", serviceIds)).rejects.toThrow(
      /Not Authorized/
    );
  });
});
