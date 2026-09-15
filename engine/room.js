"use strict";

/* Base class for game rooms: `wsServer.users.RoomState`.
   Mirrors what a game sees of the site's engine — the room fields it seeds,
   the common events (chat, name, room settings) and the helpers. Discord
   login is faked so the logged-in UI can be seen; profile editing, comments,
   uploads and word packs are accepted and do nothing. */

const EventEmitter = require("events");

const
    CHAT_HISTORY_LIMIT = 100,
    CHAT_LAST_MESSAGES_LIMIT = 6,
    // Refreshed from the server config on every "state" broadcast, see UserRegistry.send
    LIVE_CONFIG_FIELDS = ["greetingMessage", "siteEvent", "datingEnabled", "updatesVersion"];

function pushLimited(list, item, limit) {
    if (list.length > limit + 1)
        list.shift();
    list.push(item);
}

class GlobalChat extends EventEmitter {
    constructor() {
        super();
        this.messages = [];
        this.setMaxListeners(0);
    }

    addMessage(message) {
        pushLimited(this.messages, message, CHAT_HISTORY_LIMIT);
        this.emit("message", message);
    }
}

const globalChat = new GlobalChat();

class RoomState extends EventEmitter {
    constructor(hostId, hostData, userRegistry, gameId, path) {
        super();
        this.userRegistry = userRegistry;
        this.registry = userRegistry.registry;
        this.authUsers = this.registry.authUsers;
        this.chatMessages = [];
        this.chatLastMessages = [];
        const config = this.registry.config;
        this.room = {
            path,
            gameId,
            roomId: hostData.roomId,
            createTime: Date.now(),
            updatesVersion: config.updatesVersion,
            chatLastMessages: this.chatLastMessages,
            playerAvatars: {},
            authUsers: {},
            konfaMode: false,
            siteEvent: config.siteEvent,
            datingEnabled: config.datingEnabled,
            greetingMessage: config.greetingMessage
        };
        globalChat.on("message", (message) => {
            if (this.room.chatEnabled)
                this.send(this.room.onlinePlayers, "chat-message", {message, chat: "global"});
        });
        const noop = () => {
        };
        this.eventHandlers = {
            "toggle-mute-self": (user) => {
                this.room.userMuteSelf = this.room.userMuteSelf || {};
                this.room.userMuteSelf[user] = !this.room.userMuteSelf[user];
                this.updatePublicState();
            },
            "get-chat-history": (user, chat) => {
                if (this.room.chatEnabled && ["local", "global"].includes(chat))
                    this.send(user, "chat-history", {
                        chat,
                        messages: chat === "local" ? this.chatMessages : globalChat.messages
                    });
            },
            "send-chat-message": (user, text, chat) => {
                if (!this.room.chatEnabled || !text || !text.trim || !text.trim() || text.length > 164
                    || !["local", "global"].includes(chat))
                    return;
                if (chat !== "global" && this.room.chatOnlyPlayers && this.room.spectators && this.room.spectators.has(user))
                    return;
                const message = {datetime: new Date(), text, sender: this.getPlayerName(user) || "null"};
                if (chat === "local") {
                    pushLimited(this.chatMessages, message, CHAT_HISTORY_LIMIT);
                    pushLimited(this.chatLastMessages, message, CHAT_LAST_MESSAGES_LIMIT);
                    this.send(this.room.onlinePlayers, "chat-message", {chat, message});
                } else
                    globalChat.addMessage(message);
            },
            "change-name": (user, value) => {
                if (value && value.substr) {
                    this.room.playerNames[user] = value.substr(0, 60);
                    this.updatePublicState();
                }
            },
            "update-image": (user, type, token, id) => {
                if (type === "avatar")
                    this.room.playerAvatars[user] = `${token}.png?${id}`;
                this.updatePublicState();
            },
            "words-pack-list": (user) => this.send(user, "words-pack-list", []),
            "view-words-pack": (user) => this.send(user, "message", "Паки слов в песочнице недоступны"),
            // Fake Discord login, see UserRegistry.createAuthUsers
            "check-auth": (user, token) => {
                if (!token) return;
                this.room.authUsers[user] = this.authUsers.fakeProfile(token, this.getPlayerName(user));
                this.updatePublicState();
            },
            "logout-auth": (user, token) => {
                this.authUsers.logout(token);
                delete this.room.authUsers[user];
                this.updatePublicState();
            },
            "change-profile-name": (user, value) => {
                if (this.room.authUsers[user] && value && value.substr) {
                    this.room.authUsers[user].name = value.substr(0, 60);
                    this.updatePublicState();
                }
            },
            "get-profile": (user, target) => this.send(user, "profile", {id: target, profile: this.authUsers.fullProfile(target)}),
            "disable-cringe": noop,
            "redirectedFromRu": noop,
            "change-bio": noop,
            "add-comment": noop,
            "remove-comment": noop,
            "toggle-profile-setting": noop,
            "set-profile-setting-value": noop
        };
    }

    getPlayerName(id) {
        return this.room.playerNames && this.room.playerNames[id];
    }

    async sendProfile() {
    }

    async userJoinCommon(data) {
        // On the site a remembered Discord session is picked up on join
        const profile = this.authUsers.findByToken(data.token);
        if (profile) {
            this.room.authUsers[data.userId] = profile;
            this.updatePublicState();
        }
    }

    async userProcessAuth() {
    }

    async checkAuth() {
    }

    onUserAuth() {
    }

    async updateUserGameProfile() {
    }

    updatePublicState() {
        this.send(this.room.onlinePlayers, "state", this.room);
    }

    send(target, event, data) {
        this.userRegistry.send(target, event, data);
    }

    disableKonfaMode() {
        this.room.konfaMode = false;
        this.room.roomImage = null;
        this.room.discordLink = null;
        this.room.publicMode = false;
        this.updatePublicState();
    }

    getPublicStats() {
        return null;
    }

    async setRoomMode(data, user) {
        if (data === false) {
            // Host reopens the room settings dialog
            this.room.publicMode = undefined;
            this.updatePublicState();
            return;
        }
        if (data && (!data.publicMode || data.voiceEnabled
            || (data.discordLink && data.discordLink.match && data.discordLink.match(/^\w+?$/)))) {
            this.room.publicMode = data.publicMode;
            this.room.voiceEnabled = data.voiceEnabled;
            this.room.managedVoice = data.managedVoice;
            this.room.chatEnabled = data.chatEnabled;
            this.room.chatOnlyPlayers = !!data.chatOnlyPlayers;
            if (!this.room.voiceEnabled)
                this.room.userVoice = {};
            this.room.discordLink = !data.voiceEnabled ? data.discordLink : null;
            this.room.publicDescription = data.publicDescription;
            this.updatePublicState();
            return;
        }
        this.userRegistry.send(user, "message", "Invalid room data");
    }

    updateSnapshot() {
        this.room.updatesVersion = this.registry.config.updatesVersion;
    }
}

exports.RoomState = RoomState;
exports.LIVE_CONFIG_FIELDS = LIVE_CONFIG_FIELDS;
