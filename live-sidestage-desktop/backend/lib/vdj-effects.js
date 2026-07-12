'use strict';

const BACKSPIN_BEATS_BY_EFFECT_TYPE = {
    backspin_1_1: '4',
    backspin_1_2: '2',
    backspin_1_4: '1',
    backspin_1_8: '0.5',
    backspin_1_16: '0.25'
};

module.exports = function createVdjEffects({ vdjClient }) {
    async function sendVdjEffectForEvent(effectEvent) {
        if (!effectEvent?.vdjEffectEnabled) {
            return;
        }

        const beatsToken = BACKSPIN_BEATS_BY_EFFECT_TYPE[effectEvent.vdjEffectType];
        if (!beatsToken) {
            return;
        }

        try {
            const decks = await vdjClient.resolveTargetDecks(effectEvent.vdjEffectTargetDeck || 'master');
            await Promise.all(decks.map((deckNum) => vdjClient.triggerBackspin(deckNum, beatsToken)));
        } catch (error) {
            console.warn('⚠️ VDJエフェクトの送信に失敗しました:', error.message);
        }
    }

    return { sendVdjEffectForEvent };
};
