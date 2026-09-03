"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBattleItemCardSender = exports.getBattleItemCard = exports.BattleItemCardType = void 0;
/**
 * WebcastLinkMicBattleItemCard.cardType discriminant.
 *
 * POWER_UP_SUMMARY (4) is a periodic "contributors got power-ups" notice, not an item-use event --
 * it carries no sender and fires independently of anyone actually using an item. Treat it as noise
 * when detecting "an item was used".
 */
var BattleItemCardType;
(function (BattleItemCardType) {
    BattleItemCardType[BattleItemCardType["GLOVE"] = 2] = "GLOVE";
    BattleItemCardType[BattleItemCardType["POWER_UP_SUMMARY"] = 4] = "POWER_UP_SUMMARY";
    BattleItemCardType[BattleItemCardType["HAMMER"] = 6] = "HAMMER";
    BattleItemCardType[BattleItemCardType["TOP2_BOOSTER"] = 10] = "TOP2_BOOSTER";
    BattleItemCardType[BattleItemCardType["TOP3_BOOSTER"] = 11] = "TOP3_BOOSTER";
    BattleItemCardType[BattleItemCardType["VAULT_GLOVE"] = 12] = "VAULT_GLOVE";
})(BattleItemCardType = exports.BattleItemCardType || (exports.BattleItemCardType = {}));
/** Resolves the populated `*Card` slot for a given `cardType`, or `undefined` for an unknown/noise type. */
function getBattleItemCard(message) {
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
exports.getBattleItemCard = getBattleItemCard;
/** Resolves the sender (item user) for a card, or `undefined` for cardType=POWER_UP_SUMMARY which has none. */
function getBattleItemCardSender(card) {
    return card.comment?.senderEnvelope?.senderWrapper?.sender;
}
exports.getBattleItemCardSender = getBattleItemCardSender;
//# sourceMappingURL=battle.js.map