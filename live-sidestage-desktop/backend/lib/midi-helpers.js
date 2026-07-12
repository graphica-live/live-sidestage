'use strict';

const midi = require('@julusian/midi');

const MIDI_MESSAGE_STATUS = {
    noteon: 0x90,
    noteoff: 0x80,
    noteonoff: 0x90,
    cc: 0xb0,
    pc: 0xc0
};

const NOTE_ON_OFF_GAP_MS = 50;

const openOutputsByDeviceName = new Map();

function listMidiOutputDevices() {
    const output = new midi.Output();
    const names = [];

    try {
        const count = output.getPortCount();
        for (let i = 0; i < count; i++) {
            names.push(output.getPortName(i));
        }
    } finally {
        output.closePort();
    }

    return names;
}

function findOutputPortIndexByName(output, deviceName) {
    const count = output.getPortCount();
    for (let i = 0; i < count; i++) {
        if (output.getPortName(i) === deviceName) {
            return i;
        }
    }
    return -1;
}

function getOrOpenOutput(deviceName) {
    const cached = openOutputsByDeviceName.get(deviceName);
    if (cached) {
        return cached;
    }

    const output = new midi.Output();
    const portIndex = findOutputPortIndexByName(output, deviceName);

    if (portIndex === -1) {
        return null;
    }

    output.openPort(portIndex);
    openOutputsByDeviceName.set(deviceName, output);
    return output;
}

function sendMidiForEffectEvent(effectEvent) {
    if (!effectEvent?.midiEnabled || !effectEvent.midiDeviceName) {
        return;
    }

    let output;
    try {
        output = getOrOpenOutput(effectEvent.midiDeviceName);
    } catch (error) {
        console.warn(`⚠️ MIDI デバイスを開けませんでした (${effectEvent.midiDeviceName}):`, error.message);
        openOutputsByDeviceName.delete(effectEvent.midiDeviceName);
        return;
    }

    if (!output) {
        return;
    }

    const status = MIDI_MESSAGE_STATUS[effectEvent.midiMessageType] || MIDI_MESSAGE_STATUS.noteon;
    const channel = Math.max(1, Math.min(16, Number(effectEvent.midiChannel) || 1)) - 1;
    const statusByte = status | channel;
    const data1 = Math.max(0, Math.min(127, Number(effectEvent.midiData1) || 0));

    try {
        if (effectEvent.midiMessageType === 'pc') {
            output.sendMessage([statusByte, data1]);
        } else if (effectEvent.midiMessageType === 'noteonoff') {
            const data2 = Math.max(0, Math.min(127, Number(effectEvent.midiData2) || 0));
            output.sendMessage([statusByte, data1, data2]);
            const noteOffStatusByte = MIDI_MESSAGE_STATUS.noteoff | channel;
            setTimeout(() => {
                try {
                    output.sendMessage([noteOffStatusByte, data1, 0]);
                } catch (error) {
                    console.warn(`⚠️ MIDI ノートOFFの送信に失敗しました (${effectEvent.midiDeviceName}):`, error.message);
                }
            }, NOTE_ON_OFF_GAP_MS);
        } else {
            const data2 = Math.max(0, Math.min(127, Number(effectEvent.midiData2) || 0));
            output.sendMessage([statusByte, data1, data2]);
        }
    } catch (error) {
        console.warn(`⚠️ MIDI 送信に失敗しました (${effectEvent.midiDeviceName}):`, error.message);
        // デバイスが切断された可能性があるため、次回の送信で開き直す
        try { output.closePort(); } catch { /* noop */ }
        openOutputsByDeviceName.delete(effectEvent.midiDeviceName);
    }
}

function closeAllMidiOutputs() {
    for (const output of openOutputsByDeviceName.values()) {
        try { output.closePort(); } catch { /* noop */ }
    }
    openOutputsByDeviceName.clear();
}

module.exports = {
    listMidiOutputDevices,
    sendMidiForEffectEvent,
    closeAllMidiOutputs
};
