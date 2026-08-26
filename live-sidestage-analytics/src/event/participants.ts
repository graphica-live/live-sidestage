import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeLeaseWindow } from "@/lib/room-lease";
import {
  type ExistenceChecker,
  existenceChecker,
  isExistenceCheckDisabled,
} from "@/lib/tiktok-existence";
import { RoomMonitorError, ensureRoomForEvent, releaseRoomMonitor } from "@/lib/tiktok-room";
import { acquireEventLock } from "./event-lock";
import { MUTATION_TX_OPTIONS, reopenAggregation } from "./reopen-aggregation";
import {
  MAX_PARTICIPANTS,
  type ParticipantPatchInput,
  normalizeTiktokId,
  resolveParticipantDisplayName,
  sanitizeNicknameFallback,
  validateExplicitDisplayName,
} from "./validation";

// 参加者登録と room 監視要求。`public` 側(TiktokRoom)に副作用が出る唯一の経路なので、
// 失敗時の後始末までここに閉じ込める。

export class ParticipantError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ParticipantError";
  }
}

/**
 * TikTok 側でアカウントの実在を確認できたか。
 *
 * - `VERIFIED` … 実在を確認した
 * - `UNVERIFIED` … 確認できなかった(TikTok の障害・レート制限・想定外の応答)。**登録は通す**
 * - `DISABLED` … 確認自体を止めている(`EVENT_PARTICIPANT_EXISTENCE_CHECK=0`)
 */
export type ExistenceOutcome = "VERIFIED" | "UNVERIFIED" | "DISABLED";

export type RegisterResult = {
  participantId: string;
  tiktokId: string;
  roomId: string;
  /** analytics 側で room を新規作成したか(false = 既存 room の再利用) */
  createdRoom: boolean;
  /** 監視期限を切り詰めたか。true なら期限前に再登録が要る */
  leaseClamped: boolean;
  /** 実在確認の結果。`UNVERIFIED` なら主催者へ「確認できなかった」と出す */
  existence: ExistenceOutcome;
};

/**
 * 参加者を1人登録する。
 *
 * analytics 側に room がなければ作らせ、イベント終了+猶予まで配信開始監視を要求する。
 * 既存 room があればそれを再利用する(同じ配信者のギフトが分裂しないように)。
 *
 * **TikTok 上に実在しないハンドルは弾く。** 打ち間違いをそのまま登録すると、誰も配信しない
 * room を監視し続けたうえに、主催者は開催中まで気づけない。ただし判定できなかったときは
 * 通す(fail-open) — TikTok 側の障害でイベントの参加者登録が止まるほうが被害が大きい。
 */
export async function registerParticipant(
  input: {
    eventId: string;
    rawTiktokId: string;
    displayName?: string | null;
    teamId?: string | null;
  },
  deps: { checker?: ExistenceChecker; existenceDisabled?: boolean } = {}
): Promise<RegisterResult> {
  const tiktokId = normalizeTiktokId(input.rawTiktokId);
  if (!tiktokId) {
    throw new ParticipantError("TikTok ID の形式が正しくない。", 400);
  }

  // 主催者が明示した表示名はここで検証だけ済ませる(TikTok問い合わせ不要)。空欄のときの
  // 実際の値(ニックネーム、取れなければTikTok ID)は、下の実在確認の結果を見てから決める。
  const explicitName = validateExplicitDisplayName(input.displayName);
  if (!explicitName.ok) {
    throw new ParticipantError(explicitName.errors[0], 400);
  }

  const event = await prisma.event.findUnique({
    where: { id: input.eventId },
    select: { id: true, endAt: true, _count: { select: { participants: true } } },
  });
  if (!event) {
    throw new ParticipantError("イベントが見つからない。", 404);
  }
  if (event._count.participants >= MAX_PARTICIPANTS) {
    throw new ParticipantError(`参加者は${MAX_PARTICIPANTS}人までです。`, 400);
  }

  const duplicate = await prisma.eventParticipant.findUnique({
    where: { eventId_tiktokId: { eventId: input.eventId, tiktokId } },
    select: { id: true },
  });
  if (duplicate) {
    throw new ParticipantError("この TikTok ID はすでに登録されている。", 409);
  }

  if (input.teamId) {
    const team = await prisma.eventTeam.findFirst({
      where: { id: input.teamId, eventId: input.eventId },
      select: { id: true },
    });
    if (!team) {
      throw new ParticipantError("指定されたチームが見つからない。", 400);
    }
  }

  // TikTok への問い合わせは、ローカルで弾ける検証を全部通してから1回だけ行う。
  // (重複・上限・チーム不正で落ちる登録では外へ出さない)
  const existence = await resolveExistence(tiktokId, deps);
  if (existence.verdict === "MISSING") {
    throw new ParticipantError(
      "この TikTok ID のアカウントが TikTok 上に見つからない。ID を確認すること。",
      400
    );
  }

  // 主催者が未入力なら、実在確認と同じ問い合わせで取れたニックネームを使う
  // (取れない・長すぎる・制御文字を含む場合はさらに TikTok ID へ落とす)。
  const displayName =
    explicitName.value ?? sanitizeNicknameFallback(existence.nickname) ?? tiktokId;

  const lease = computeLeaseWindow(event.endAt);

  // 先に room を確保する。roomId が決まらないと参加者行を作れないため。
  let leased;
  try {
    leased = await ensureRoomForEvent(tiktokId, lease.granted);
  } catch (err) {
    if (err instanceof RoomMonitorError) {
      throw new ParticipantError(`監視の登録に失敗した: ${err.message}`, err.status);
    }
    throw err;
  }

  try {
    const participant = await prisma.$transaction(async (tx) => {
      const created = await tx.eventParticipant.create({
        data: {
          eventId: input.eventId,
          tiktokId,
          roomId: leased.roomId,
          displayName,
          teamId: input.teamId ?? null,
        },
        select: { id: true },
      });

      // 台帳。同じ room を再登録した場合は解放済みエントリを復活させる。
      await tx.eventRoomLease.upsert({
        where: { eventId_roomId: { eventId: input.eventId, roomId: leased.roomId } },
        create: {
          eventId: input.eventId,
          roomId: leased.roomId,
          tiktokId,
          createdBySystem: leased.created,
          monitorUntil: lease.requested,
          releasedAt: null,
        },
        update: { monitorUntil: lease.requested, releasedAt: null },
      });

      return created;
    });

    return {
      participantId: participant.id,
      tiktokId,
      roomId: leased.roomId,
      createdRoom: leased.created,
      leaseClamped: lease.clamped,
      existence:
        existence.verdict === "EXISTS"
          ? "VERIFIED"
          : existence.verdict === "DISABLED"
            ? "DISABLED"
            : "UNVERIFIED",
    };
  } catch (err) {
    // event スキーマ側の書き込みが失敗したら、確保した監視要求を戻す。
    // **ここでは自分のイベントの lease も数える**(`releaseIfUnused` ではなく)。
    // 同じ ID を並行登録して片方が一意制約で落ちた場合、勝った側の lease が残っている。
    // 自分のイベントを除いて数えると、登録に成功した参加者の監視をこの補償が止めてしまう。
    await releaseIfNoLeaseRemains(leased.roomId).catch((e) =>
      console.error("[participants] 補償の解放に失敗:", e)
    );

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // @@unique([eventId, roomId]) — 別表記で同じ配信者を二重登録しようとした場合。
      throw new ParticipantError("この配信者はすでに登録されている。", 409);
    }
    throw err;
  }
}

/**
 * TikTok にアカウントが実在するか確かめる。**例外は投げない。**
 *
 * 実在(`EXISTS`)が確認できたときは、同じ問い合わせで取れたニックネームも一緒に返す
 * (表示名フォールバックに使う。登録経路からの新規の問い合わせは増やさない)。
 *
 * 間引き(キャッシュ・同時実行上限・サーキットブレーカ)は `tiktok-existence.ts` が持つ。
 * ここは kill switch の解釈だけ。
 */
async function resolveExistence(
  tiktokId: string,
  deps: { checker?: ExistenceChecker; existenceDisabled?: boolean }
): Promise<{
  verdict: "EXISTS" | "MISSING" | "UNVERIFIED" | "DISABLED";
  nickname: string | null;
}> {
  const disabled = deps.existenceDisabled ?? isExistenceCheckDisabled();
  if (disabled) return { verdict: "DISABLED", nickname: null };

  const checker = deps.checker ?? existenceChecker;
  try {
    return await checker.check(tiktokId);
  } catch (err) {
    // checker は例外を投げない契約だが、投げても登録は止めない(fail-open)。
    console.error(`[participants] @${tiktokId} の実在確認に失敗:`, err);
    return { verdict: "UNVERIFIED", nickname: null };
  }
}

/**
 * この room を確保している未解放の lease が**どのイベントにも**残っていなければ、
 * 監視要求を解除する。
 *
 * `releaseIfUnused()` との違いは、自分のイベントの lease も数えることだけ。
 * 登録の補償経路専用 — 補償が走る時点で自分のイベントに未解放 lease が残っているなら、
 * それは並行登録の勝者が作ったものなので、解除してはいけない
 * (以前からある lease なら重複チェックが 409 で先に落としている)。
 */
async function releaseIfNoLeaseRemains(roomId: string): Promise<void> {
  const remaining = await prisma.eventRoomLease.count({
    where: { roomId, releasedAt: null },
  });
  if (remaining > 0) return;

  await releaseRoomMonitor(roomId);
}

export type UpdateParticipantResult = {
  displayName: string;
  tiktokId: string;
  roomId: string;
  /** tiktokId を実際に変更したか(未指定、または正規化後に現在値と同じなら false = no-op) */
  tiktokIdChanged: boolean;
  /** 以下は tiktokIdChanged === true のときだけ意味を持つ(RegisterResult と同じ意味) */
  createdRoom?: boolean;
  leaseClamped?: boolean;
  existence?: ExistenceOutcome;
};

/**
 * 参加者の表示名・所属チーム・TikTok ID(登録ミスの訂正)を更新する。
 *
 * `tiktokId` を変えない場合は `room` も `lease` も動かない。表示名は `EventParticipant` に
 * しか無く、順位表・貢献・トーナメント表はすべて読み取り時に join して解決しているので、
 * その場合は再集計(`reopenAggregation`)も要らない。
 *
 * **`tiktokId` を変える場合は話が別。** トーナメント表の枠(`EventMatchSideParticipant`)は
 * `EventParticipant.id`(不変PK)を参照しているだけなので、この行の `tiktokId`/`roomId` を
 * 書き換えれば表の位置は自動的に維持される(削除→再登録と違い、枠を作り直さずに済む)。
 * 一方で集計母集団(roomId)が変わる操作でもあるので、`registerParticipant` と同じ
 * 実在確認・room確保・lease台帳更新に加え、`reopenAggregation` を同じトランザクションで
 * 呼ぶ(呼ばないと最終集計後(`finalizedAt`確定後)の訂正が二度と反映されない)。
 *
 * **検証は全部済ませてから書く。** 表示名を先に書いてからチームの検証に落ちると
 * 「エラー応答なのに名前だけ変わっている」部分適用になる。`where` には `eventId` を
 * 必ず入れる(参加者を引くときだけでなく書くときも認可の境界を残す)。
 */
export async function updateParticipant(
  input: {
    eventId: string;
    participantId: string;
    patch: ParticipantPatchInput;
  },
  deps: { checker?: ExistenceChecker; existenceDisabled?: boolean } = {}
): Promise<UpdateParticipantResult> {
  const participant = await prisma.eventParticipant.findFirst({
    where: { id: input.participantId, eventId: input.eventId },
    select: { id: true, tiktokId: true, displayName: true, roomId: true },
  });
  if (!participant) {
    throw new ParticipantError("参加者が見つからない。", 404);
  }

  // tiktokId の正規化(ローカル、副作用なし)。訂正後の値を表示名フォールバックにも使う
  // (打ち間違えた旧IDへ戻さないため)。
  let newTiktokId: string | undefined;
  let tiktokChanged = false;
  if (input.patch.tiktokId !== undefined) {
    const normalized = normalizeTiktokId(input.patch.tiktokId);
    if (!normalized) {
      throw new ParticipantError("TikTok ID の形式が正しくない。", 400);
    }
    newTiktokId = normalized;
    tiktokChanged = normalized !== participant.tiktokId;
  }
  const effectiveTiktokId = tiktokChanged ? newTiktokId! : participant.tiktokId;

  const data: {
    displayName?: string;
    teamId?: string | null;
    tiktokId?: string;
    roomId?: string;
    avatarOffsetX?: number | null;
    avatarOffsetY?: number | null;
    avatarZoom?: number | null;
  } = {};

  if (input.patch.displayName !== undefined) {
    const name = resolveParticipantDisplayName(input.patch.displayName, effectiveTiktokId);
    if (!name.ok) {
      throw new ParticipantError(name.errors[0], 400);
    }
    data.displayName = name.value;
  }

  if (input.patch.avatarFrame !== undefined) {
    // null = デフォルト(50%/30%/等倍)へリセット。表示専用の値なので集計への影響は無い
    // (reopenAggregation は呼ばない)。
    data.avatarOffsetX = input.patch.avatarFrame?.offsetX ?? null;
    data.avatarOffsetY = input.patch.avatarFrame?.offsetY ?? null;
    data.avatarZoom = input.patch.avatarFrame?.zoom ?? null;
  }

  if (input.patch.teamId !== undefined) {
    if (input.patch.teamId !== null) {
      // 他イベントのチームIDを渡されないよう、必ず eventId 込みで存在確認する。
      const team = await prisma.eventTeam.findFirst({
        where: { id: input.patch.teamId, eventId: input.eventId },
        select: { id: true },
      });
      if (!team) {
        throw new ParticipantError("指定されたチームが見つからない。", 400);
      }
    }
    data.teamId = input.patch.teamId;
  }

  // 実質なにも変わらないなら、外部呼び出し・トランザクションに入らず早期return。
  // アバターの表示位置は `data` へ3列まとめて入るので `avatarOffsetX` の有無で判定する
  // (`avatarFrame: null` のリセットも「変える操作」なので早期returnさせない)。
  if (
    !tiktokChanged &&
    data.displayName === undefined &&
    data.teamId === undefined &&
    data.avatarOffsetX === undefined
  ) {
    return {
      displayName: participant.displayName,
      tiktokId: participant.tiktokId,
      roomId: participant.roomId,
      tiktokIdChanged: false,
    };
  }

  let leased: Awaited<ReturnType<typeof ensureRoomForEvent>> | undefined;
  let lease: ReturnType<typeof computeLeaseWindow> | undefined;
  let existenceOutcome: ExistenceOutcome | undefined;

  if (tiktokChanged) {
    // 同一イベント内の重複チェック(register と同じ)。
    const duplicate = await prisma.eventParticipant.findUnique({
      where: { eventId_tiktokId: { eventId: input.eventId, tiktokId: newTiktokId! } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ParticipantError("この TikTok ID はすでに登録されている。", 409);
    }

    const existence = await resolveExistence(newTiktokId!, deps);
    if (existence.verdict === "MISSING") {
      throw new ParticipantError(
        "この TikTok ID のアカウントが TikTok 上に見つからない。ID を確認すること。",
        400
      );
    }
    existenceOutcome =
      existence.verdict === "EXISTS"
        ? "VERIFIED"
        : existence.verdict === "DISABLED"
          ? "DISABLED"
          : "UNVERIFIED";

    const event = await prisma.event.findUnique({
      where: { id: input.eventId },
      select: { endAt: true },
    });
    if (!event) {
      throw new ParticipantError("イベントが見つからない。", 404);
    }
    lease = computeLeaseWindow(event.endAt);

    // 先に新しい room を確保する(register と同じ理由)。
    try {
      leased = await ensureRoomForEvent(newTiktokId!, lease.granted);
    } catch (err) {
      if (err instanceof RoomMonitorError) {
        throw new ParticipantError(`監視の登録に失敗した: ${err.message}`, err.status);
      }
      throw err;
    }

    data.tiktokId = newTiktokId!;
    data.roomId = leased.roomId;
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        if (tiktokChanged) {
          // 結果を変える操作。集計とのロック順序規則(advisory lock を先に取る)を守る。
          // `reopenAggregation` が末尾でもう一度取るが、先頭で取っていれば待たされない。
          await acquireEventLock(tx, input.eventId);
        }

        const updated = await tx.eventParticipant.updateMany({
          where: {
            id: input.participantId,
            eventId: input.eventId,
            // 楽観ガード: 読み取り時点の roomId と一致する場合だけ書き込む。
            // 同一参加者への並行 tiktokId 訂正が、互いの確保した新 room の lease を
            // 孤児化させない(後勝ち側は count===0 で 404 になり、確保した room を補償で戻す)。
            roomId: participant.roomId,
          },
          data,
        });
        if (updated.count === 0) {
          throw new ParticipantError("参加者が見つからない。", 404);
        }

        if (tiktokChanged) {
          // 台帳。新 room を確保/復活させる。
          await tx.eventRoomLease.upsert({
            where: { eventId_roomId: { eventId: input.eventId, roomId: leased!.roomId } },
            create: {
              eventId: input.eventId,
              roomId: leased!.roomId,
              tiktokId: newTiktokId!,
              createdBySystem: leased!.created,
              monitorUntil: lease!.requested,
              releasedAt: null,
            },
            update: { monitorUntil: lease!.requested, releasedAt: null },
          });
          // 旧 room の lease を解放マーク(実際の監視解除はトランザクションの外)。
          await tx.eventRoomLease.updateMany({
            where: { eventId: input.eventId, roomId: participant.roomId, releasedAt: null },
            data: { releasedAt: new Date() },
          });

          await reopenAggregation(tx, input.eventId);
        }
      },
      tiktokChanged ? MUTATION_TX_OPTIONS : undefined
    );
  } catch (err) {
    if (tiktokChanged) {
      // register と同じ理由: 自分のイベントの lease も数える補償専用の解除。
      await releaseIfNoLeaseRemains(leased!.roomId).catch((e) =>
        console.error("[participants] 補償の解放に失敗:", e)
      );
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ParticipantError("この配信者はすでに登録されている。", 409);
    }
    throw err;
  }

  if (tiktokChanged) {
    // 旧 room の実監視解除はコミット後にベストエフォート(removeParticipant と同じ配置)。
    await releaseIfUnused(input.eventId, participant.roomId).catch((err) =>
      console.error("[participants] 旧 room の監視要求の解除に失敗(期限切れを待つ):", err)
    );
  }

  return {
    displayName: data.displayName ?? participant.displayName,
    tiktokId: tiktokChanged ? newTiktokId! : participant.tiktokId,
    roomId: tiktokChanged ? leased!.roomId : participant.roomId,
    tiktokIdChanged: tiktokChanged,
    ...(tiktokChanged
      ? {
          createdRoom: leased!.created,
          leaseClamped: lease!.clamped,
          existence: existenceOutcome,
        }
      : {}),
  };
}

/**
 * 参加者を削除し、他に使っているイベントがなければ監視要求も解除する。
 *
 * 監視要求の解除に失敗しても参加者の削除は成立させる。
 * 期限(monitorUntil)が来れば監視は自然に止まるため、解除漏れは
 * 「余分に監視が続く」だけで、データの不整合にはならない。
 */
export async function removeParticipant(eventId: string, participantId: string): Promise<void> {
  const participant = await prisma.eventParticipant.findFirst({
    where: { id: participantId, eventId },
    select: { id: true, roomId: true },
  });
  if (!participant) {
    throw new ParticipantError("参加者が見つからない。", 404);
  }

  await prisma.$transaction(async (tx) => {
    await tx.eventParticipant.delete({ where: { id: participant.id } });
    await tx.eventRoomLease.updateMany({
      where: { eventId, roomId: participant.roomId, releasedAt: null },
      data: { releasedAt: new Date() },
    });
  });

  await releaseIfUnused(eventId, participant.roomId).catch((err) =>
    console.error("[participants] 監視要求の解除に失敗(期限切れを待つ):", err)
  );
}

/**
 * この room を確保している未解放の lease が他のイベントに残っていなければ、
 * 監視要求を解除する。
 *
 * `TiktokRoom.monitorUntil` は room につき1本しかないので、他イベントが使っている
 * 間に解除すると、そのイベントの監視まで止めてしまう。
 */
async function releaseIfUnused(eventId: string, roomId: string): Promise<void> {
  const others = await prisma.eventRoomLease.count({
    where: { roomId, releasedAt: null, eventId: { not: eventId } },
  });
  if (others > 0) return;

  await releaseRoomMonitor(roomId);
}

/**
 * イベント期間が変わったとき、確保済みの lease の期限を取り直す。
 *
 * **期間を延ばしたときだけ意味がある。** `monitorUntil` は `max(既存, 要求)` で
 * 更新されるので、期間を縮めても監視は短くならない(同じ room を他イベントが
 * 使っている可能性があるため、縮める操作は用意していない)。
 * 余分な監視は期限が来れば自然に止まる。
 */
export async function refreshEventLeases(eventId: string, endAt: Date): Promise<void> {
  const leases = await prisma.eventRoomLease.findMany({
    where: { eventId, releasedAt: null },
    select: { id: true, tiktokId: true },
  });
  if (leases.length === 0) return;

  const window = computeLeaseWindow(endAt);

  for (const lease of leases) {
    try {
      await ensureRoomForEvent(lease.tiktokId, window.granted);
      await prisma.eventRoomLease.update({
        where: { id: lease.id },
        data: { monitorUntil: window.requested },
      });
    } catch (err) {
      // 期限の取り直しに失敗しても、イベントの更新自体は成立させる。
      // 切り詰めが起きているならワーカーの renewClampedLeases が次の周回で拾う。
      console.error(`[participants] @${lease.tiktokId} の監視期限の更新に失敗:`, err);
    }
  }
}

/**
 * いまイベント機能が監視を要求しているアカウントのハンドル一覧。
 *
 * 絞り込みは `renewClampedLeases()` と揃える(解放前・期限内・非 ARCHIVED)。
 * `TiktokRoom.hostUserId` の補完対象を決めるのに使う(`src/lib/tiktok-host-id.ts`)。
 * lease は開催前から立っているので、バトル本番までに埋まる。
 */
export async function activeLeaseTiktokIds(now: Date = new Date()): Promise<string[]> {
  const leases = await prisma.eventRoomLease.findMany({
    where: {
      releasedAt: null,
      monitorUntil: { gt: now },
      event: { status: { notIn: ["ARCHIVED"] } },
    },
    select: { tiktokId: true },
    distinct: ["tiktokId"],
  });
  return leases.map((lease) => lease.tiktokId);
}

/**
 * 期限を切り詰めた lease を確保し直す。
 *
 * イベント終了が `MAX_LEASE_DAYS`(120日)より先だと、設定できた期限は本来必要な期限より
 * 手前で切れる。放置すると開催前に監視が止まるので、ワーカーが定期的に期限を伸ばし直す。
 * 切り詰めが起きていない lease は正しい期限を持っているので触らない。
 *
 * `monitorUntil` は `max(既存, 要求)` で更新するため、何度呼んでも短くならない(冪等)。
 */
export async function renewClampedLeases(now: Date = new Date()): Promise<{
  renewed: number;
  failed: number;
}> {
  const leases = await prisma.eventRoomLease.findMany({
    where: {
      releasedAt: null,
      monitorUntil: { gt: now },
      // 保管済みのイベントは監視しない。
      event: { status: { notIn: ["ARCHIVED"] } },
    },
    select: { id: true, tiktokId: true, event: { select: { endAt: true } } },
  });

  let renewed = 0;
  let failed = 0;

  for (const lease of leases) {
    const window = computeLeaseWindow(lease.event.endAt, now);
    if (!window.clamped) continue;

    try {
      await ensureRoomForEvent(lease.tiktokId, window.granted, now);
      renewed++;
    } catch (err) {
      failed++;
      console.error(`[participants] @${lease.tiktokId} の監視期限の延長に失敗:`, err);
    }
  }

  return { renewed, failed };
}

/**
 * イベント削除前に、そのイベントが確保している監視要求をすべて解除する。
 * 参加者行は Event の cascade で消えるが、`TiktokRoom.monitorUntil` は
 * 明示的に解除しないと期限まで残るため、ここで戻す。
 */
export async function releaseEventLeases(eventId: string): Promise<void> {
  const leases = await prisma.eventRoomLease.findMany({
    where: { eventId, releasedAt: null },
    select: { roomId: true },
  });

  for (const lease of leases) {
    await releaseIfUnused(eventId, lease.roomId).catch((err) =>
      console.error(`[participants] room ${lease.roomId} の解除に失敗:`, err)
    );
  }
}
