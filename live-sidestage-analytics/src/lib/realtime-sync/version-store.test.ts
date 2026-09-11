import { describe, it, expect, beforeEach } from "vitest";
import {
  nextVersion,
  bumpEpoch,
  currentVersion,
  currentBootId,
  __resetVersionStoreForTest,
  __regenerateBootIdForTest,
  type SyncKind,
} from "@/lib/realtime-sync/version-store";

describe("version-store", () => {
  beforeEach(() => {
    __resetVersionStoreForTest();
  });

  describe("nextVersion", () => {
    it("最初の呼び出しはversion: 1を返す", () => {
      const result = nextVersion("ranking", "streamer-1");
      expect(result.epoch).toBe(0);
      expect(result.version).toBe(1);
      expect(result.bootId).toEqual(expect.any(String));
    });

    it("同一の(syncKind, streamerId)で呼び出すたびにversionが増える", () => {
      const v1 = nextVersion("ranking", "streamer-1");
      const v2 = nextVersion("ranking", "streamer-1");
      const v3 = nextVersion("ranking", "streamer-1");

      expect(v1.version).toBe(1);
      expect(v2.version).toBe(2);
      expect(v3.version).toBe(3);
      expect(v1.epoch).toBe(0);
      expect(v2.epoch).toBe(0);
      expect(v3.epoch).toBe(0);
    });

    it("epochはnextVersionで変わらない", () => {
      const v1 = nextVersion("gift-history", "streamer-2");
      const v2 = nextVersion("gift-history", "streamer-2");

      expect(v1.epoch).toBe(0);
      expect(v2.epoch).toBe(0);
    });
  });

  describe("bumpEpoch", () => {
    it("epochを +1 してversionを 0 にリセットする", () => {
      // 最初にいくつかバージョンを払い出す
      nextVersion("ranking", "streamer-1");
      nextVersion("ranking", "streamer-1");
      const beforeBump = currentVersion("ranking", "streamer-1");
      expect(beforeBump.version).toBe(2);
      expect(beforeBump.epoch).toBe(0);

      // epoch bump
      const result = bumpEpoch("ranking", "streamer-1");

      expect(result.epoch).toBe(1);
      expect(result.version).toBe(0);
    });

    it("bump直後のnextVersionはepochを保ったまま version: 1 を返す", () => {
      nextVersion("ranking", "streamer-1");
      bumpEpoch("ranking", "streamer-1");
      const next = nextVersion("ranking", "streamer-1");

      expect(next.epoch).toBe(1);
      expect(next.version).toBe(1);
    });

    it("複数回のbumpで epochが増え続ける", () => {
      const bump1 = bumpEpoch("battle-history", "streamer-1");
      const bump2 = bumpEpoch("battle-history", "streamer-1");
      const bump3 = bumpEpoch("battle-history", "streamer-1");

      expect(bump1.epoch).toBe(1);
      expect(bump2.epoch).toBe(2);
      expect(bump3.epoch).toBe(3);
      expect(bump1.version).toBe(0);
      expect(bump2.version).toBe(0);
      expect(bump3.version).toBe(0);
    });
  });

  describe("異なるstreamerId間の独立性", () => {
    it("streamerId が異なるとversion状態が独立している", () => {
      const s1v1 = nextVersion("ranking", "streamer-1");
      const s1v2 = nextVersion("ranking", "streamer-1");
      const s2v1 = nextVersion("ranking", "streamer-2");

      expect(s1v1.version).toBe(1);
      expect(s1v2.version).toBe(2);
      expect(s2v1.version).toBe(1); // streamer-2 は独立
    });

    it("異なるstreamerId同時にbumpしても相互に影響しない", () => {
      nextVersion("ranking", "streamer-1");
      nextVersion("ranking", "streamer-1");
      nextVersion("ranking", "streamer-2");

      const bump1 = bumpEpoch("ranking", "streamer-1");
      const current2 = currentVersion("ranking", "streamer-2");

      expect(bump1.epoch).toBe(1);
      expect(current2.epoch).toBe(0); // streamer-2 は影響されない
      expect(current2.version).toBe(1);
    });
  });

  describe("異なるsyncKind間の独立性", () => {
    it("syncKind が異なるとversion状態が独立している", () => {
      const ranking1 = nextVersion("ranking", "streamer-1");
      const ranking2 = nextVersion("ranking", "streamer-1");
      const gift1 = nextVersion("gift-history", "streamer-1");
      const battle1 = nextVersion("battle-history", "streamer-1");

      expect(ranking1.version).toBe(1);
      expect(ranking2.version).toBe(2);
      expect(gift1.version).toBe(1); // gift-history は独立
      expect(battle1.version).toBe(1); // battle-history は独立
    });

    it("異なるsyncKindでepochを独立に管理できる", () => {
      // ranking は epoch を 2 まで上げる
      bumpEpoch("ranking", "streamer-1");
      bumpEpoch("ranking", "streamer-1");
      const rankingState = currentVersion("ranking", "streamer-1");

      // gift-history は epoch を 1 にする
      bumpEpoch("gift-history", "streamer-1");
      const giftState = currentVersion("gift-history", "streamer-1");

      // battle-history は epoch を上げない
      const battleState = currentVersion("battle-history", "streamer-1");

      expect(rankingState.epoch).toBe(2);
      expect(giftState.epoch).toBe(1);
      expect(battleState.epoch).toBe(0);
    });
  });

  describe("currentVersion", () => {
    it("存在しないエントリは { epoch: 0, version: 0 } を返す", () => {
      const result = currentVersion("ranking", "nonexistent");
      expect(result.epoch).toBe(0);
      expect(result.version).toBe(0);
    });

    it("呼び出しは内部状態を変えない", () => {
      nextVersion("ranking", "streamer-1");
      const before = currentVersion("ranking", "streamer-1");
      const after = currentVersion("ranking", "streamer-1");

      expect(before).toEqual(after);
      expect(after.version).toBe(1);
    });
  });

  describe("__resetVersionStoreForTest", () => {
    it("リセット後は状態が初期化される", () => {
      nextVersion("ranking", "streamer-1");
      __resetVersionStoreForTest();

      const result = currentVersion("ranking", "streamer-1");
      expect(result.epoch).toBe(0);
      expect(result.version).toBe(0);
    });

    it("すべてのsyncKind・streamerIdをリセットする", () => {
      nextVersion("ranking", "streamer-1");
      nextVersion("gift-history", "streamer-2");
      bumpEpoch("battle-history", "streamer-3");

      __resetVersionStoreForTest();

      expect(currentVersion("ranking", "streamer-1").version).toBe(0);
      expect(currentVersion("gift-history", "streamer-2").version).toBe(0);
      expect(currentVersion("battle-history", "streamer-3").version).toBe(0);
    });

    it("__resetVersionStoreForTestはbootIdを変えない(version/epochのみ初期化)", () => {
      const before = currentBootId();
      nextVersion("ranking", "streamer-1");
      __resetVersionStoreForTest();
      expect(currentBootId()).toBe(before);
    });
  });

  describe("bootId(プロセス再起動相当の検知)", () => {
    it("同一プロセス内では常に同じbootIdを返す", () => {
      const v1 = nextVersion("ranking", "streamer-1");
      const v2 = nextVersion("ranking", "streamer-1");
      const current = currentVersion("ranking", "streamer-1");

      expect(v1.bootId).toBe(v2.bootId);
      expect(v1.bootId).toBe(current.bootId);
      expect(v1.bootId).toBe(currentBootId());
    });

    it("__regenerateBootIdForTestでbootIdが変わる(プロセス再起動相当の再現)", () => {
      const before = nextVersion("ranking", "streamer-1").bootId;
      __regenerateBootIdForTest();
      const after = currentVersion("ranking", "streamer-1").bootId;

      expect(after).not.toBe(before);
    });

    it("bumpEpochの戻り値にも現在のbootIdが含まれる", () => {
      const result = bumpEpoch("ranking", "streamer-1");
      expect(result.bootId).toBe(currentBootId());
    });
  });
});
