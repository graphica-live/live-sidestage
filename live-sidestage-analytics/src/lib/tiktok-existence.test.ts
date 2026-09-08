import { describe, it, expect } from "vitest";
import type { AccountExistence, AccountExistenceCheck, TiktokAccountPreview } from "./tiktok-profile";
import {
  createExistenceChecker,
  formatExistenceGateError,
  isExistenceCheckDisabled,
  previewTiktokAccount,
  requireExistingTiktokAccount,
} from "./tiktok-existence";
import type { ExistenceChecker, ExistenceCheckOptions } from "./tiktok-existence";

/** `preview` を持たない旧テストfixtureへ後付けする空の付随情報(全項目 null)。 */
const emptyPreview: TiktokAccountPreview = {
  avatarUrl: null,
  signature: null,
  followingCount: null,
  followerCount: null,
};

/** 呼び出し回数を数えつつ、決め打ちの判定を返す fetch。nickname は常に null。 */
function stubFetch(verdicts: AccountExistence[] | AccountExistence) {
  const calls: string[] = [];
  const queue = Array.isArray(verdicts) ? [...verdicts] : null;
  const fixed = Array.isArray(verdicts) ? null : verdicts;

  return {
    calls,
    fn: async (tiktokHandle: string): Promise<AccountExistenceCheck> => {
      calls.push(tiktokHandle);
      const verdict = fixed ?? queue!.shift() ?? "UNVERIFIED";
      return { verdict, nickname: null, tiktokUid: null, preview: emptyPreview };
    },
  };
}

/** verdict と nickname を両方決め打ちできる fetch。キャッシュへの nickname 保持を検証するのに使う。 */
function stubFetchWithChecks(checks: AccountExistenceCheck[]) {
  const calls: string[] = [];
  const queue = [...checks];

  return {
    calls,
    fn: async (tiktokHandle: string): Promise<AccountExistenceCheck> => {
      calls.push(tiktokHandle);
      return queue.shift() ?? { verdict: "UNVERIFIED", nickname: null, tiktokUid: null, preview: emptyPreview };
    },
  };
}

/**
 * 保留中のマイクロタスクを流す。
 * `check()` は枠の確保を待ってから fetch するので、投げた直後には呼ばれていない。
 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 外から解決できる fetch。同時実行や in-flight 集約の検証に使う。 */
function deferredFetch() {
  const calls: string[] = [];
  const resolvers: ((verdict: AccountExistence) => void)[] = [];

  return {
    calls,
    resolvers,
    fn: (tiktokHandle: string): Promise<AccountExistenceCheck> => {
      calls.push(tiktokHandle);
      return new Promise<AccountExistenceCheck>((resolve) => {
        resolvers.push((verdict) => resolve({ verdict, nickname: null, tiktokUid: null, preview: emptyPreview }));
      });
    },
  };
}

describe("requireExistingTiktokAccount", () => {
  /** `check()` に渡された options を記録するだけの checker。 */
  function recordingChecker() {
    const seen: (ExistenceCheckOptions | undefined)[] = [];
    const checker: ExistenceChecker = {
      async check(_tiktokHandle, opts) {
        seen.push(opts);
        return { verdict: "EXISTS", nickname: "n", tiktokUid: "999", preview: emptyPreview };
      },
      size: () => 0,
    };
    return { seen, checker };
  }

  it("options をそのまま checker へ通す(所有確定経路のキャッシュ回避が効く)", async () => {
    const { seen, checker } = recordingChecker();

    await requireExistingTiktokAccount("someone", checker, { skipPositiveCache: true });
    expect(seen).toEqual([{ skipPositiveCache: true }]);
  });

  it("options 省略時はキャッシュを使う既定のまま(表示用途の呼び出しを変えない)", async () => {
    const { seen, checker } = recordingChecker();

    await requireExistingTiktokAccount("someone", checker);
    expect(seen).toEqual([undefined]);
  });
});

describe("createExistenceChecker のキャッシュ", () => {
  it("EXISTS を覚えて2回目は引き直さない", async () => {
    const fetcher = stubFetch("EXISTS");
    const checker = createExistenceChecker({ fetchExistence: fetcher.fn });

    expect((await checker.check("someone")).verdict).toBe("EXISTS");
    expect((await checker.check("someone")).verdict).toBe("EXISTS");
    expect(fetcher.calls).toEqual(["someone"]);
  });

  it("skipPositiveCache は EXISTS のキャッシュを読まず、その時点の tiktokUid を返す", async () => {
    // ハンドル H を A が手放し、6時間以内に B が取得した状況。キャッシュを読むと
    // B の登録に A の uid が返り、B が A の room へ紐付く。
    const fetcher = stubFetchWithChecks([
      { verdict: "EXISTS", nickname: "A", tiktokUid: "111", preview: emptyPreview },
      { verdict: "EXISTS", nickname: "B", tiktokUid: "222", preview: emptyPreview },
    ]);
    const checker = createExistenceChecker({ fetchExistence: fetcher.fn });

    expect((await checker.check("handle")).tiktokUid).toBe("111");
    // 素の呼び出し(プレビュー等)はキャッシュのままでよい。
    expect((await checker.check("handle")).tiktokUid).toBe("111");
    expect(fetcher.calls).toHaveLength(1);

    const fresh = await checker.check("handle", { skipPositiveCache: true });
    expect(fresh.tiktokUid).toBe("222");
    expect(fresh.nickname).toBe("B");
    expect(fetcher.calls).toEqual(["handle", "handle"]);
  });

  it("skipPositiveCache でも MISSING のキャッシュは使う(negative は uid を持ち回らない)", async () => {
    const fetcher = stubFetch("MISSING");
    const checker = createExistenceChecker({ fetchExistence: fetcher.fn });

    expect((await checker.check("nobody")).verdict).toBe("MISSING");
    expect((await checker.check("nobody", { skipPositiveCache: true })).verdict).toBe("MISSING");
    expect(fetcher.calls).toEqual(["nobody"]);
  });

  it("skipPositiveCache でも同時要求の in-flight 重複排除は共有する", async () => {
    const fetcher = deferredFetch();
    const checker = createExistenceChecker({ fetchExistence: fetcher.fn });

    const pending = [
      checker.check("someone", { skipPositiveCache: true }),
      checker.check("someone"),
      checker.check("someone", { skipPositiveCache: true }),
    ];
    await flush();
    expect(fetcher.calls).toEqual(["someone"]);

    fetcher.resolvers[0]("EXISTS");
    expect((await Promise.all(pending)).map((r) => r.verdict)).toEqual([
      "EXISTS",
      "EXISTS",
      "EXISTS",
    ]);
  });

  it("MISSING も覚える(打ち間違いの連打で TikTok を叩き続けない)", async () => {
    const fetcher = stubFetch("MISSING");
    const checker = createExistenceChecker({ fetchExistence: fetcher.fn });

    expect((await checker.check("nobody")).verdict).toBe("MISSING");
    expect((await checker.check("nobody")).verdict).toBe("MISSING");
    expect(fetcher.calls).toEqual(["nobody"]);
  });

  it("UNVERIFIED は覚えない(状況が変わりうるので次は引き直す)", async () => {
    const fetcher = stubFetch(["UNVERIFIED", "EXISTS"]);
    const checker = createExistenceChecker({ fetchExistence: fetcher.fn });

    expect((await checker.check("someone")).verdict).toBe("UNVERIFIED");
    expect((await checker.check("someone")).verdict).toBe("EXISTS");
    expect(fetcher.calls).toEqual(["someone", "someone"]);
    expect(checker.size()).toBe(1);
  });

  it("MISSING の保持は短く、EXISTS は長い", async () => {
    const fetcher = stubFetch(["MISSING", "MISSING", "EXISTS", "EXISTS"]);
    let now = 1_000_000;
    const checker = createExistenceChecker({ fetchExistence: fetcher.fn, now: () => now });

    expect((await checker.check("nobody")).verdict).toBe("MISSING");
    expect((await checker.check("somebody")).verdict).toBe("MISSING");

    // 10分後: MISSING(5分)は期限切れで引き直す。
    now += 10 * 60 * 1000;
    expect((await checker.check("nobody")).verdict).toBe("EXISTS");
    expect(fetcher.calls).toEqual(["nobody", "somebody", "nobody"]);

    // さらに1時間後でも EXISTS(6時間)は生きている。
    now += 60 * 60 * 1000;
    expect((await checker.check("nobody")).verdict).toBe("EXISTS");
    expect(fetcher.calls).toHaveLength(3);
  });

  it("EXISTS のニックネームもキャッシュに残り、2回目のヒットでも同じ値が返る", async () => {
    const fetcher = stubFetchWithChecks([
      { verdict: "EXISTS", nickname: "テスト配信者", tiktokUid: null, preview: emptyPreview },
    ]);
    const checker = createExistenceChecker({ fetchExistence: fetcher.fn });

    expect(await checker.check("someone")).toEqual({
      verdict: "EXISTS",
      nickname: "テスト配信者",
      tiktokUid: null,
      preview: emptyPreview,
    });
    // キャッシュヒット。fetch を引き直さずに同じ nickname が返る。
    expect(await checker.check("someone")).toEqual({
      verdict: "EXISTS",
      nickname: "テスト配信者",
      tiktokUid: null,
      preview: emptyPreview,
    });
    expect(fetcher.calls).toEqual(["someone"]);
  });

  it("MISSING の nickname は常に null で覚える", async () => {
    const fetcher = stubFetchWithChecks([
      { verdict: "MISSING", nickname: null, tiktokUid: null, preview: emptyPreview },
    ]);
    const checker = createExistenceChecker({ fetchExistence: fetcher.fn });

    expect(await checker.check("nobody")).toEqual({
      verdict: "MISSING",
      nickname: null,
      tiktokUid: null,
      preview: emptyPreview,
    });
    expect(await checker.check("nobody")).toEqual({
      verdict: "MISSING",
      nickname: null,
      tiktokUid: null,
      preview: emptyPreview,
    });
    expect(fetcher.calls).toEqual(["nobody"]);
  });

  it("上限を超えたら古い順に捨てる", async () => {
    const fetcher = stubFetch("EXISTS");
    const checker = createExistenceChecker({ fetchExistence: fetcher.fn, maxEntries: 2 });

    await checker.check("a");
    await checker.check("b");
    await checker.check("c");

    expect(checker.size()).toBe(2);
  });
});

describe("createExistenceChecker の呼び出し制御", () => {
  it("同じハンドルへの同時要求を1本にまとめる", async () => {
    const fetcher = deferredFetch();
    const checker = createExistenceChecker({ fetchExistence: fetcher.fn });

    const pending = [
      checker.check("someone"),
      checker.check("someone"),
      checker.check("someone"),
      checker.check("someone"),
      checker.check("someone"),
    ];
    await flush();
    expect(fetcher.calls).toEqual(["someone"]);

    fetcher.resolvers[0]("EXISTS");
    const results = await Promise.all(pending);
    expect(results.map((r) => r.verdict)).toEqual(["EXISTS", "EXISTS", "EXISTS", "EXISTS", "EXISTS"]);
  });

  it("枠が埋まっていても、空けば待っていた分を外へ出す(並行POSTで確認を素通しさせない)", async () => {
    const fetcher = deferredFetch();
    const checker = createExistenceChecker({
      fetchExistence: fetcher.fn,
      maxConcurrency: 2,
      slotWaitMs: 5_000,
    });

    const pending = [checker.check("a"), checker.check("b"), checker.check("c")];

    // 3本目はまだ外へ出ていない(枠待ち)。
    await flush();
    expect(fetcher.calls).toEqual(["a", "b"]);

    // 1本目が終われば枠が空き、待っていた3本目が出る。
    fetcher.resolvers[0]("EXISTS");
    expect((await pending[0]).verdict).toBe("EXISTS");
    await flush();
    expect(fetcher.calls).toEqual(["a", "b", "c"]);

    fetcher.resolvers[1]("MISSING");
    fetcher.resolvers[2]("MISSING");
    expect((await pending[1]).verdict).toBe("MISSING");
    expect((await pending[2]).verdict).toBe("MISSING");
  });

  it("待っても枠が空かなければ UNVERIFIED で通す(主催者を待たせ続けない)", async () => {
    const fetcher = deferredFetch();
    const checker = createExistenceChecker({
      fetchExistence: fetcher.fn,
      maxConcurrency: 2,
      slotWaitMs: 0,
    });

    const pending = [checker.check("a"), checker.check("b"), checker.check("c")];

    expect(await pending[2]).toEqual({ verdict: "UNVERIFIED", nickname: null, tiktokUid: null, preview: emptyPreview });
    expect(fetcher.calls).toEqual(["a", "b"]);

    fetcher.resolvers[0]("EXISTS");
    fetcher.resolvers[1]("EXISTS");
    await Promise.all([pending[0], pending[1]]);
  });

  it("判定不能が続いたらブレーカーが開き、外へ出さなくなる", async () => {
    const fetcher = stubFetch("UNVERIFIED");
    let now = 1_000_000;
    const checker = createExistenceChecker({ fetchExistence: fetcher.fn, now: () => now });

    for (const id of ["a", "b", "c", "d", "e"]) {
      expect((await checker.check(id)).verdict).toBe("UNVERIFIED");
    }
    expect(fetcher.calls).toHaveLength(5);

    // 開いている間は fetch を呼ばない。
    expect((await checker.check("f")).verdict).toBe("UNVERIFIED");
    expect(fetcher.calls).toHaveLength(5);

    // 5分後に閉じる。
    now += 5 * 60 * 1000 + 1;
    expect((await checker.check("g")).verdict).toBe("UNVERIFIED");
    expect(fetcher.calls).toHaveLength(6);
  });

  it("MISSING はブレーカーに数えない(TikTok は正常に答えている)", async () => {
    const fetcher = stubFetch("MISSING");
    const checker = createExistenceChecker({ fetchExistence: fetcher.fn });

    for (const id of ["a", "b", "c", "d", "e", "f", "g"]) {
      expect((await checker.check(id)).verdict).toBe("MISSING");
    }
    expect(fetcher.calls).toHaveLength(7);
  });

  it("EXISTS を挟めば連続カウントが切れる", async () => {
    const fetcher = stubFetch([
      "UNVERIFIED",
      "UNVERIFIED",
      "UNVERIFIED",
      "UNVERIFIED",
      "EXISTS",
      "UNVERIFIED",
      "UNVERIFIED",
    ]);
    const checker = createExistenceChecker({ fetchExistence: fetcher.fn });

    for (const id of ["a", "b", "c", "d", "e", "f", "g"]) {
      await checker.check(id);
    }
    // ブレーカーが開いていないので全部 fetch まで届く。
    expect(fetcher.calls).toHaveLength(7);
  });

  it("fetch が例外を投げても UNVERIFIED として返す", async () => {
    const checker = createExistenceChecker({
      fetchExistence: async () => {
        throw new Error("boom");
      },
    });

    expect(await checker.check("someone")).toEqual({ verdict: "UNVERIFIED", nickname: null, tiktokUid: null, preview: emptyPreview });
  });

  it("空のハンドルは外へ出さない", async () => {
    const fetcher = stubFetch("EXISTS");
    const checker = createExistenceChecker({ fetchExistence: fetcher.fn });

    expect(await checker.check("")).toEqual({ verdict: "UNVERIFIED", nickname: null, tiktokUid: null, preview: emptyPreview });
    expect(fetcher.calls).toEqual([]);
  });
});

describe("isExistenceCheckDisabled", () => {
  it("TIKTOK_EXISTENCE_CHECK_DISABLED=1 のときだけ止める", () => {
    const original = process.env.TIKTOK_EXISTENCE_CHECK_DISABLED;
    try {
      delete process.env.TIKTOK_EXISTENCE_CHECK_DISABLED;
      expect(isExistenceCheckDisabled()).toBe(false);

      process.env.TIKTOK_EXISTENCE_CHECK_DISABLED = "0";
      expect(isExistenceCheckDisabled()).toBe(false);

      process.env.TIKTOK_EXISTENCE_CHECK_DISABLED = "1";
      expect(isExistenceCheckDisabled()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.TIKTOK_EXISTENCE_CHECK_DISABLED;
      else process.env.TIKTOK_EXISTENCE_CHECK_DISABLED = original;
    }
  });
});

/** previewTiktokAccount 用。判定・preview を決め打ちできる checker。 */
function stubChecker(check: AccountExistenceCheck): ExistenceChecker {
  return { check: async () => check, size: () => 0 };
}

const somePreview: TiktokAccountPreview = {
  avatarUrl: "https://p16-common-sign.tiktokcdn.com/x.webp",
  signature: "テストBIO",
  followingCount: 12,
  followerCount: 345,
};

describe("previewTiktokAccount", () => {
  it("フォーマット不正は実在確認を呼ばず INVALID_FORMAT を返す", async () => {
    let called = false;
    const checker: ExistenceChecker = {
      check: async () => {
        called = true;
        return { verdict: "EXISTS", nickname: null, tiktokUid: null, preview: somePreview };
      },
      size: () => 0,
    };
    const result = await previewTiktokAccount("bad id!!", checker);
    expect(result).toEqual({ ok: false, code: "INVALID_FORMAT" });
    expect(called).toBe(false);
  });

  it("MISSING は USER_NOT_FOUND を返す", async () => {
    const checker = stubChecker({ verdict: "MISSING", nickname: null, tiktokUid: null, preview: emptyPreview });
    expect(await previewTiktokAccount("nobody", checker)).toEqual({ ok: false, code: "USER_NOT_FOUND" });
  });

  it("UNVERIFIED は CHECK_UNVERIFIED を返す", async () => {
    const checker = stubChecker({ verdict: "UNVERIFIED", nickname: null, tiktokUid: null, preview: emptyPreview });
    expect(await previewTiktokAccount("someone", checker)).toEqual({ ok: false, code: "CHECK_UNVERIFIED" });
  });

  it("EXISTS は正規化済み tiktokHandle・nickname・preview をそのまま返す", async () => {
    const checker = stubChecker({ verdict: "EXISTS", nickname: "テスト太郎", tiktokUid: "123", preview: somePreview });
    expect(await previewTiktokAccount("@Some_User", checker)).toEqual({
      ok: true,
      tiktokHandle: "some_user",
      nickname: "テスト太郎",
      preview: somePreview,
    });
  });
});

describe("formatExistenceGateError", () => {
  it("各コードに日本語メッセージ+かっこ書きのコードを付与する", () => {
    for (const code of ["INVALID_FORMAT", "USER_NOT_FOUND", "CHECK_UNVERIFIED"] as const) {
      const { error, status } = formatExistenceGateError(code);
      expect(error).toContain(`(${code})`);
      expect(status).toBeGreaterThanOrEqual(400);
    }
  });

  it("CHECK_UNVERIFIED だけ 503(再試行可能)を返す", () => {
    expect(formatExistenceGateError("CHECK_UNVERIFIED").status).toBe(503);
    expect(formatExistenceGateError("INVALID_FORMAT").status).toBe(400);
    expect(formatExistenceGateError("USER_NOT_FOUND").status).toBe(400);
  });
});
