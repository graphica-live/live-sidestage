// Custom addition (live-sidestage fork, not part of upstream zerodytrash/TikTok-Live-Connector).
// Interpretation helpers for WebcastLinkMicBattleItemCard, whose card_type field is a bare int32
// (see .proto/src/webcast-battle-item.proto for why it isn't a proto enum). Values below were
// reverse-engineered from real battle payloads; see tiktok-probe skill's KNOWLEDGE.md for the
// underlying investigation.
import { User, WebcastLinkMicBattleItemCard, WebcastLinkMicBattleItemCard_BattleItemCard } from '@/types/tiktok-schema';

/**
 * WebcastLinkMicBattleItemCard.cardType discriminant.
 *
 * POWER_UP_SUMMARY (4) is a periodic "contributors got power-ups" notice, not an item-use event --
 * it carries no sender and fires independently of anyone actually using an item. Treat it as noise
 * when detecting "an item was used".
 */
export enum BattleItemCardType {
    GLOVE = 2,
    POWER_UP_SUMMARY = 4,
    HAMMER = 6,
    TOP2_BOOSTER = 10,
    TOP3_BOOSTER = 11,
    VAULT_GLOVE = 12,
}

/** Resolves the populated `*Card` slot for a given `cardType`, or `undefined` for an unknown/noise type. */
export function getBattleItemCard(
    message: WebcastLinkMicBattleItemCard
): WebcastLinkMicBattleItemCard_BattleItemCard | undefined {
    switch (message.cardType) {
        case BattleItemCardType.GLOVE: return message.gloveCard;
        case BattleItemCardType.POWER_UP_SUMMARY: return message.powerupSummaryCard;
        case BattleItemCardType.HAMMER: return message.hammerCard;
        case BattleItemCardType.TOP2_BOOSTER: return message.top2BoosterCard;
        case BattleItemCardType.TOP3_BOOSTER: return message.top3BoosterCard;
        case BattleItemCardType.VAULT_GLOVE: return message.vaultGloveCard;
        default: return undefined;
    }
}

/** Resolves the sender (item user) for a card, or `undefined` for cardType=POWER_UP_SUMMARY which has none. */
export function getBattleItemCardSender(card: WebcastLinkMicBattleItemCard_BattleItemCard): User | undefined {
    return card.comment?.senderEnvelope?.senderWrapper?.sender;
}
