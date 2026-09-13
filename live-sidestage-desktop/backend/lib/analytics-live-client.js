"use strict";

const EventEmitter = require("events");
const { io } = require("socket.io-client");

function mapGiftPayload(payload) {
    return {
        giftType: payload.isCombo ? 1 : 0,
        repeatEnd: Boolean(payload.repeatEnd),
        repeatCount: Number(payload.repeatCount) || 1,
        groupId: payload.comboId || payload.groupId || null,
        uniqueId: payload.tiktokHandle || "",
        nickname: payload.nickname || payload.tiktokHandle || "",
        profilePictureUrl: payload.profilePictureUrl || "",
        giftId: payload.giftId || "",
        giftName: payload.giftName || "",
        diamondCount: Number(payload.diamondCount) || 0,
        msgId: payload.msgId || null,
        eventId: payload.msgId || null,
        createTime: payload.occurredAt || payload.receivedAt || null
    };
}

function mapActorPayload(payload, extras = {}) {
    return {
        uniqueId: payload.tiktokHandle || "",
        nickname: payload.nickname || payload.tiktokHandle || "",
        profilePictureUrl: payload.profilePictureUrl || "",
        userId: payload.tiktokUid || "",
        comment: payload.comment || payload.text || "",
        msgId: payload.msgId || null,
        ...extras
    };
}

class AnalyticsLiveClient extends EventEmitter {
    constructor(options) {
        super();
        this._getConfig = options.getConfig;
        this._refreshAccessToken = options.refreshAccessToken;
        this._socket = null;
        this._connected = false;
        this.clientParams = {};
    }

    async connect() {
        if (this._connected && this._socket?.connected) {
            const err = new Error("Already connected");
            err.name = "AlreadyConnectedError";
            throw err;
        }

        const config = await this._getConfig();
        if (!config?.baseUrl || !config?.token) {
            const err = new Error("analytics credentials missing");
            err.name = "AnalyticsNotConfiguredError";
            throw err;
        }

        await new Promise((resolve, reject) => {
            const socket = io(config.baseUrl, {
                transports: ["websocket", "polling"],
                auth: { client: "desktop", token: config.token },
                autoConnect: false
            });
            this._socket = socket;

            const onError = (err) => {
                cleanup();
                const wrapped = new Error(err?.message || "analytics socket unauthorized");
                wrapped.data = err?.data;
                wrapped.name = err?.data === "STREAMER_NOT_REGISTERED"
                    ? "StreamerNotRegisteredError"
                    : "AnalyticsSocketAuthError";
                reject(wrapped);
            };

            const onConnect = () => {
                cleanup();
                this._connected = true;
                this._bindEvents(socket);
                resolve({ isConnected: true });
            };

            const cleanup = () => {
                socket.off("connect", onConnect);
                socket.off("connect_error", onError);
            };

            socket.on("connect", onConnect);
            socket.on("connect_error", onError);
            socket.connect();
        });

        return { isConnected: true };
    }

    _bindEvents(socket) {
        socket.on("desktop:gift", (payload) => {
            this.emit("gift", mapGiftPayload(payload || {}));
        });
        socket.on("desktop:comment", (payload) => {
            this.emit("chat", mapActorPayload(payload || {}));
        });
        socket.on("desktop:follow", (payload) => {
            this.emit("follow", mapActorPayload(payload || {}));
        });
        socket.on("desktop:like", (payload) => {
            this.emit("like", mapActorPayload(payload || {}, {
                likeCount: Number(payload?.likeCount) || 0
            }));
        });
        socket.on("desktop:feed", (payload) => {
            const kind = payload?.kind;
            if (!kind) return;
            this.emit(kind, mapActorPayload(payload || {}, { text: payload.text }));
        });
        socket.on("desktop:listener", (payload) => {
            const activity = payload?.activity;
            const status = payload?.status;
            if (activity === "offline" || status === "idle") {
                this.emit("streamEnd", payload);
                return;
            }
            if (status === "error" || status === "retrying") {
                const err = new Error(payload?.message || "analytics listener retrying");
                err.name = "AnalyticsListenerError";
                this.emit("error", err);
            }
        });
        socket.on("disconnect", (reason) => {
            this._connected = false;
            this.emit("disconnected", reason);
        });
    }

    disconnect() {
        this._connected = false;
        if (this._socket) {
            this._socket.removeAllListeners();
            this._socket.disconnect();
            this._socket = null;
        }
    }
}

function createAnalyticsLiveClient(options) {
    return new AnalyticsLiveClient(options);
}

module.exports = {
    AnalyticsLiveClient,
    createAnalyticsLiveClient,
    mapGiftPayload,
    mapActorPayload
};