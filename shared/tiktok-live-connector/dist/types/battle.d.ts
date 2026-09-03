import { User, WebcastLinkMicBattleItemCard, WebcastLinkMicBattleItemCard_BattleItemCard } from '../types/tiktok-schema';
/**
 * WebcastLinkMicBattleItemCard.cardType discriminant.
 *
 * POWER_UP_SUMMARY (4) is a periodic "contributors got power-ups" notice, not an item-use event --
 * it carries no sender and fires independently of anyone actually using an item. Treat it as noise
 * when detecting "an item was used".
 */
export declare enum BattleItemCardType {
    GLOVE = 2,
    POWER_UP_SUMMARY = 4,
    HAMMER = 6,
    TOP2_BOOSTER = 10,
    TOP3_BOOSTER = 11,
    VAULT_GLOVE = 12
}
/** Resolves the populated `*Card` slot for a given `cardType`, or `undefined` for an unknown/noise type. */
export declare function getBattleItemCard(message: WebcastLinkMicBattleItemCard): WebcastLinkMicBattleItemCard_BattleItemCard | undefined;
/** Resolves the sender (item user) for a card, or `undefined` for cardType=POWER_UP_SUMMARY which has none. */
export declare function getBattleItemCardSender(card: WebcastLinkMicBattleItemCard_BattleItemCard): User | undefined;
//# sourceMappingURL=battle.d.ts.map