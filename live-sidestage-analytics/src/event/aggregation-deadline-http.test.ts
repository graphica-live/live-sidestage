import { describe, it, expect } from "vitest";
import { aggregationDeadlineResponseFor } from "./aggregation-deadline-http";
import {
  AGGREGATION_DEADLINE_PASSED_CODE,
  AggregationDeadlinePassedError,
} from "./reopen-aggregation";

describe("aggregationDeadlineResponseFor", () => {
  it("締切超過エラーを409 AGGREGATION_DEADLINE_PASSEDへ変換する", async () => {
    const res = aggregationDeadlineResponseFor(new AggregationDeadlinePassedError());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(409);
    const body = await res!.json();
    expect(body.code).toBe(AGGREGATION_DEADLINE_PASSED_CODE);
  });

  it("締切超過以外のエラーはnullを返す(呼び出し元が従来どおり再throwする)", () => {
    expect(aggregationDeadlineResponseFor(new Error("other"))).toBeNull();
    expect(aggregationDeadlineResponseFor(null)).toBeNull();
    expect(aggregationDeadlineResponseFor("not-an-error")).toBeNull();
  });
});
