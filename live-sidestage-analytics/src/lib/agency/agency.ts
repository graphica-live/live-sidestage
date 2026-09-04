import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeTiktokId, upsertRoom } from "@/lib/tiktok-room";
import { getWorkerCount, resolveWorkerForRoom } from "@/lib/tiktok-listener";
import { type ExistenceChecker, requireExistingTiktokAccount } from "@/lib/tiktok-existence";
import { isValidNormalizedTiktokId } from "./params";

// 企業向けAPIキーは平文で保存しない。参照は常にキー本体のSHA-256で引く。
export function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

// Googleが返すメールアドレスの大文字小文字の揺れで別アカウント扱いにならないよう、
// 保存も参照も小文字へ正規化した値で行う。
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export type AgencyRecord = {
  id: string;
  name: string;
  email: string;
  maxWatchTargets: number;
  hasApiKey: boolean;
  watchCount: number;
};

export type WatchRecord = {
  id: string;
  tiktokId: string;
  label: string | null;
  createdAt: string;
  listenerStatus: string | null;
  listenerMessage: string | null;
  listenerUpdatedAt: string | null;
};

const AGENCY_SELECT = {
  id: true,
  name: true,
  email: true,
  maxWatchTargets: true,
  apiKeyHash: true,
  _count: { select: { watches: true } },
} as const;

type AgencyRow = {
  id: string;
  name: string;
  email: string;
  maxWatchTargets: number;
  apiKeyHash: string | null;
  _count: { watches: number };
};

function toRecord(a: AgencyRow): AgencyRecord {
  return {
    id: a.id,
    name: a.name,
    email: a.email,
    maxWatchTargets: a.maxWatchTargets,
    hasApiKey: Boolean(a.apiKeyHash),
    watchCount: a._count.watches,
  };
}

// ログイン中のGoogleアカウントのメールアドレスで事務所を引く。
// 管理者が登録していないアドレスなら null で、事務所コンソールは利用できない。
export async function getAgencyByEmail(email: string | null | undefined): Promise<AgencyRecord | null> {
  if (!email) return null;
  const agency = await prisma.agency.findUnique({
    where: { email: normalizeEmail(email) },
    select: AGENCY_SELECT,
  });
  return agency ? toRecord(agency) : null;
}

export type CreateAgencyResult =
  | { ok: true; agency: AgencyRecord }
  | { ok: false; code: "invalid" | "duplicate"; error: string };

// 事務所の作成は管理者操作。ここで登録したメールアドレスのGoogleアカウントでログインすれば、
// 本人側の申請や承認待ちを挟まずそのまま使える。
export async function createAgency(
  rawEmail: string,
  rawName: string,
  maxWatchTargets?: number
): Promise<CreateAgencyResult> {
  const email = normalizeEmail(rawEmail ?? "");
  const name = (rawName ?? "").trim();

  if (!name) return { ok: false, code: "invalid", error: "事務所名を入力してください。" };
  if (name.length > 100) {
    return { ok: false, code: "invalid", error: "事務所名は100文字以内で入力してください。" };
  }
  // ログイン前で本人確認ができないぶん、宛先の取り違えを防ぐため形だけは検証する。
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, code: "invalid", error: "メールアドレスの形式が正しくありません。" };
  }
  if (maxWatchTargets !== undefined && (!Number.isInteger(maxWatchTargets) || maxWatchTargets < 0 || maxWatchTargets > 1000)) {
    return { ok: false, code: "invalid", error: "監視対象の上限は0〜1000の整数で指定してください。" };
  }

  try {
    const agency = await prisma.agency.create({
      data: { email, name, ...(maxWatchTargets !== undefined ? { maxWatchTargets } : {}) },
      select: AGENCY_SELECT,
    });
    return { ok: true, agency: toRecord(agency) };
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      return { ok: false, code: "duplicate", error: "このメールアドレスはすでに登録されています。" };
    }
    throw err;
  }
}

// 事務所を削除する。監視対象(AgencyWatch)はカスケードで消え、その部屋を他に見ている人が
// いなければ ensureAllListenersAlive() が次の周回でTikTok接続を切る。
export async function deleteAgency(id: string): Promise<boolean> {
  const result = await prisma.agency.deleteMany({ where: { id } });
  return result.count > 0;
}

// APIキーを新規発行(または再発行)する。平文を返すのはこの瞬間だけで、DBにはハッシュしか残らない。
// 再発行するとハッシュが置き換わるため、旧キーは即座に認証を通らなくなる。
export async function issueAgencyApiKey(agencyId: string): Promise<string> {
  const apiKey = crypto.randomBytes(32).toString("hex");
  await prisma.agency.update({
    where: { id: agencyId },
    data: { apiKeyHash: hashApiKey(apiKey) },
  });
  return apiKey;
}

export async function listWatches(agencyId: string): Promise<WatchRecord[]> {
  const watches = await prisma.agencyWatch.findMany({
    where: { agencyId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      tiktokId: true,
      label: true,
      createdAt: true,
      room: {
        select: { listenerStatus: true, listenerMessage: true, listenerUpdatedAt: true },
      },
    },
  });

  return watches.map((w) => ({
    id: w.id,
    tiktokId: w.tiktokId,
    label: w.label,
    createdAt: w.createdAt.toISOString(),
    listenerStatus: w.room.listenerStatus,
    listenerMessage: w.room.listenerMessage,
    listenerUpdatedAt: w.room.listenerUpdatedAt?.toISOString() ?? null,
  }));
}

export type AddWatchResult =
  | { ok: true; watch: WatchRecord }
  | {
      ok: false;
      code: "invalid" | "limit" | "duplicate" | "conflict" | "not_found" | "unverified";
      error: string;
    };

// 監視対象を追加する。src/app/api/listener/start/route.ts と同じく、ここでは部屋の解決と
// 担当Workerの割当までを行い、実際のTikTok接続は担当Workerのensureループ(最大30秒間隔)が拾う。
export async function addWatch(
  agencyId: string,
  rawTiktokId: string,
  rawLabel: string | null,
  deps: { checker?: ExistenceChecker } = {}
): Promise<AddWatchResult> {
  const normalized = normalizeTiktokId(rawTiktokId ?? "");
  if (!normalized) {
    return { ok: false, code: "invalid", error: "TikTok IDを入力してください。" };
  }
  if (!isValidNormalizedTiktokId(normalized)) {
    return {
      ok: false,
      code: "invalid",
      error: "TikTok IDの形式が正しくありません(英数字・アンダースコア・ドットの2〜24文字)。",
    };
  }

  // TikTok上に実在しないIDは監視対象に追加させない(fail-closed)。誰も配信しない部屋を
  // 無期限に監視し続ける実害を防ぐ。
  const existence = await requireExistingTiktokAccount(normalized, deps.checker);
  if (!existence.ok) {
    return {
      ok: false,
      code: existence.reason === "MISSING" ? "not_found" : "unverified",
      error:
        existence.reason === "MISSING"
          ? "このTikTok IDのアカウントが見つかりません。IDを確認してください。"
          : "TikTok上の実在確認ができませんでした。しばらくしてから再試行してください。",
    };
  }

  const room = await upsertRoom(normalized);
  const label = rawLabel?.trim() || null;

  // 上限チェックと作成を1トランザクションに閉じる。READ COMMITTEDだと同時リクエストが
  // 同じ件数を読んで両方通ってしまうため、Serializableにして競合をDBに検出させる。
  let created;
  try {
    created = await prisma.$transaction(
      async (tx) => {
        const target = await tx.agency.findUniqueOrThrow({
          where: { id: agencyId },
          select: { maxWatchTargets: true },
        });
        const current = await tx.agencyWatch.count({ where: { agencyId } });
        if (current >= target.maxWatchTargets) {
          throw new WatchLimitError(target.maxWatchTargets);
        }

        return tx.agencyWatch.create({
          data: { agencyId, roomId: room.id, tiktokId: rawTiktokId.trim(), label },
          select: {
            id: true,
            tiktokId: true,
            label: true,
            createdAt: true,
            room: {
              select: { listenerStatus: true, listenerMessage: true, listenerUpdatedAt: true },
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (err) {
    if (err instanceof WatchLimitError) {
      return {
        ok: false,
        code: "limit",
        error: `監視対象は最大${err.max}件までです。不要な対象を削除してください。`,
      };
    }
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      return { ok: false, code: "duplicate", error: "このTikTok IDはすでに監視対象です。" };
    }
    // Serializableの書き込み競合。呼び出し元が再試行すれば通る。
    if (code === "P2034") {
      return { ok: false, code: "conflict", error: "処理が競合しました。もう一度お試しください。" };
    }
    throw err;
  }

  // 担当Workerを確定させる。すでに他の登録者/事務所が同じ部屋を使っていれば既存の割当が返る。
  // ここは高速化のための先回りでしかなく、失敗しても各Workerのensureループが未割当の部屋を
  // 自分でclaimする(getMyRooms)。watchは作成済みなので、ここで例外を投げて500にすると
  // 「登録されているのにAPIはエラー、再試行するとduplicate」という不整合になる。
  await resolveWorkerForRoom(room.id, getWorkerCount()).catch((err) =>
    console.error("[agency] resolveWorkerForRoom failed (ensure loop will claim it):", err)
  );

  return {
    ok: true,
    watch: {
      id: created.id,
      tiktokId: created.tiktokId,
      label: created.label,
      createdAt: created.createdAt.toISOString(),
      listenerStatus: created.room.listenerStatus,
      listenerMessage: created.room.listenerMessage,
      listenerUpdatedAt: created.room.listenerUpdatedAt?.toISOString() ?? null,
    },
  };
}

class WatchLimitError extends Error {
  constructor(readonly max: number) {
    super(`watch limit ${max} reached`);
  }
}

// 監視対象を外す。TiktokRoomとGiftは削除しない — 同じ部屋を他の事務所や配信者本人(Streamer)が
// 参照している可能性があるため。購読者が誰もいなくなった部屋は
// ensureAllListenersAlive()が次の周回で切断する。
// agencyIdをwhereに含めるので、他事務所のwatchは削除できない(IDOR対策)。
export async function removeWatch(agencyId: string, watchId: string): Promise<boolean> {
  const result = await prisma.agencyWatch.deleteMany({ where: { id: watchId, agencyId } });
  return result.count > 0;
}

export type WatchedRoomRef = {
  roomId: string;
  normalizedTiktokId: string;
  tiktokId: string;
  label: string | null;
  watchStartedAt: string;
  listenerStatus: string | null;
  listenerUpdatedAt: string | null;
};

// 企業向けAPIの認可境界。この事務所の監視対象だけを返し、以降の集計対象をここに閉じる。
export async function listWatchedRooms(agencyId: string): Promise<WatchedRoomRef[]> {
  const watches = await prisma.agencyWatch.findMany({
    where: { agencyId },
    orderBy: { createdAt: "asc" },
    select: {
      roomId: true,
      tiktokId: true,
      label: true,
      createdAt: true,
      room: { select: { tiktokId: true, listenerStatus: true, listenerUpdatedAt: true } },
    },
  });

  return watches.map((w) => ({
    roomId: w.roomId,
    normalizedTiktokId: w.room.tiktokId,
    tiktokId: w.tiktokId,
    label: w.label,
    watchStartedAt: w.createdAt.toISOString(),
    listenerStatus: w.room.listenerStatus,
    listenerUpdatedAt: w.room.listenerUpdatedAt?.toISOString() ?? null,
  }));
}

export type AdminAgencyRow = AgencyRecord & { createdAt: string };

export async function listAllAgencies(): Promise<AdminAgencyRow[]> {
  const agencies = await prisma.agency.findMany({
    orderBy: { createdAt: "desc" },
    select: { ...AGENCY_SELECT, createdAt: true },
  });
  return agencies.map((a) => ({ ...toRecord(a), createdAt: a.createdAt.toISOString() }));
}

export async function setMaxWatchTargets(id: string, max: number): Promise<AgencyRecord | null> {
  const agency = await prisma.agency
    .update({ where: { id }, data: { maxWatchTargets: max }, select: AGENCY_SELECT })
    .catch(() => null);
  return agency ? toRecord(agency) : null;
}
