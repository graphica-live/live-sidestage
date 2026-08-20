'use strict';

module.exports = function createVdjEffects({ vdjClient }) {
    async function sendVdjEffectForEvent(effectEvent) {
        if (!effectEvent?.vdjEffectEnabled) {
            return;
        }

        const command = String(effectEvent.vdjCommand || '').trim();
        if (!command) {
            return;
        }

        await vdjClient.vdjExecute(command);
    }

    return { sendVdjEffectForEvent };
};
