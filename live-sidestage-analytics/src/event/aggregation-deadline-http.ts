// 締切超過(AggregationDeadlinePassedError)を主催者向けレスポンスへ変換する。
//
// `reopenAggregation()` は主催者ミューテーションの10箇所超から同一トランザクションで
// 呼ばれる。締切を過ぎているとそこで例外が飛び、**ミューテーション自体がロールバックする**
// (「訂正が無かったことになる」という意図した挙動)。各ルートはこれを素の500にせず、
// 409 + 理由つきで返すこと。

import { NextResponse } from "next/server";
import {
  AGGREGATION_DEADLINE_PASSED_CODE,
  AGGREGATION_DEADLINE_PASSED_MESSAGE,
  isAggregationDeadlinePassed,
} from "./reopen-aggregation";

export function aggregationDeadlinePassedResponse(): NextResponse {
  return NextResponse.json(
    {
      error: AGGREGATION_DEADLINE_PASSED_MESSAGE,
      errors: [AGGREGATION_DEADLINE_PASSED_MESSAGE],
      code: AGGREGATION_DEADLINE_PASSED_CODE,
    },
    { status: 409 }
  );
}

/** catch 節の先頭で使う。締切超過でなければ null(呼び出し元は従来どおり再throw)。 */
export function aggregationDeadlineResponseFor(err: unknown): NextResponse | null {
  return isAggregationDeadlinePassed(err) ? aggregationDeadlinePassedResponse() : null;
}
