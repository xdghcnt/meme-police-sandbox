"use strict";

/* `wsServer.users` — the part of the engine a game module talks to.
   Same wire protocol and room lifecycle as on the site; everything a game
   can't observe (rate limits, IP bookkeeping, stats, Discord, databases)
   is left out. Where the site would silently misbehave, the sandbox warns. */

const
    EventEmitter = require("events"),
    crypto = require("crypto"),
    fs = require("fs"),
    path = require("path"),
    {RoomState, LIVE_CONFIG_FIELDS} = require("./room"),
    {games, achievements, badges} = require("./data");

const REQUIRED_ROOM_METHODS = ["userJoin", "userLeft", "userEvent", "getPlayerCount", "getActivePlayerCount",
    "getLastInteraction", "getSnapshot", "setSnapshot"];

function warn(message) {
    console.warn(`\x1b[33m[sandbox] ${message}\x1b[0m`);
}

function makeId() {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let text = "";
    for (let i = 0; i < 5; i++)
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    return text;
}

class UserRegistry extends EventEmitter {
    constructor(serverWrapper, config, app) {
        super();
        this.config = config;
        this.config.startTime = Date.now();
        this.app = app;
        this.users = new Map();
        this.sessionTokens = new Set();
        this.roomManagers = new Map();
        this.restoredRoomData = {};
        this.RoomState = RoomState;
        this.games = games;
        this.achievements = achievements;
        this.badges = badges;
        this.makeId = makeId;
        this.fakeLogins = new Map();
        this.authUsers = this.createAuthUsers();

        serverWrapper.on("connection", (socket) => {
            socket.on("message", (event) => this.onMessage(socket, event));
        });
        this.on("user-joined", (channel, id, data) =>
            this.log(`${channel} - ${data.roomId} - ${id} - joined - ${data.userName}`));
        this.on("user-left", (channel, id, reason, data) =>
            this.log(`${channel} - ${data.roomId} - ${id} - left${reason ? ` - ${reason}` : ""}`));
        if (this.config.logEvents)
            this.on("user-event", (channel, id, name, data) => {
                if (name !== "pong")
                    this.log(`${channel} - ${id} - ${name} - ${JSON.stringify(data)}`);
            });
        if (this.config.dumpFile)
            setInterval(() => this.dumpManagedRooms(), this.config.dumpInterval).unref();
        process.on("uncaughtException", (error) => {
            /* The site keeps running after an exception in a game handler too,
               but the room is probably in a broken state now */
            console.error(error);
            warn("необработанное исключение — сайт в таком случае продолжает работать, но комната может сломаться");
        });
    }

    onMessage(socket, event) {
        let parsed;
        try {
            parsed = JSON.parse(event.data);
        } catch (error) {
            return socket.disconnect(1000, "Invalid data");
        }
        if (!parsed || !parsed.a)
            return;
        const
            channel = parsed.c,
            args = Object.values(parsed.a),
            name = args.shift(),
            data = args[0];
        if (!name || !channel)
            return;
        if (name === "init" && data && data.userId && data.token) {
            const
                known = this.users.get(data.userId),
                isReconnect = !!(known && data.reconnectToken && known.token === data.token
                    && known.reconnectToken === data.reconnectToken);
            if (!String(data.userId).match(/^[a-z0-9]+$/))
                return socket.disconnect(1000, "Invalid userId");
            if (this.sessionTokens.has(data.wssToken) || isReconnect)
                return this.join(data.userId, data.token, channel, data, socket);
            this.log(`${channel} - ${data.userId} - page token expired`);
            return socket.disconnect(1000, "Page token expired");
        }
        if (socket.userRegistryUserId)
            this.emit("user-event", channel, socket.userRegistryUserId, name, args, this.users.get(socket.userRegistryUserId).initialData);
        else
            socket.disconnect(1000, "no init for not registered user");
    }

    join(id, token, channel, data, socket) {
        this.sessionTokens.delete(data.wssToken);
        const user = this.users.get(id);
        if (!user) {
            this.users.set(id, {
                token,
                reconnectToken: crypto.randomBytes(16).toString("hex"),
                socket,
                initialData: data
            });
        } else if (user.token === token) {
            const prevSocket = user.socket;
            user.socket = socket;
            user.initialData = data;
            if (prevSocket && prevSocket !== socket && prevSocket.isConnected)
                prevSocket.disconnect(1000, "Other session started");
        } else
            return socket.disconnect(1008, "Wrong auth");
        socket.userRegistryUserId = id;
        if (!socket.userRegistryBound) {
            socket.userRegistryBound = true;
            socket.on("disconnect", (event) => {
                const current = this.users.get(id);
                if (current && current.socket !== socket)
                    return;
                this.emit("user-left", channel, id, event && event.reason, data);
            });
        }
        this.sendUser(id, channel, "server-start-time", this.config.startTime);
        this.sendUser(id, channel, "reconnect-token", this.users.get(id).reconnectToken);
        this.emit("user-joined", channel, id, data);
    }

    send(target, channel, event, data) {
        if (event === "state" && data && typeof data === "object")
            LIVE_CONFIG_FIELDS.forEach((key) => data[key] = this.config[key] ?? null);
        if (!target)
            return;
        if (target.forEach)
            target.forEach((id) => this.sendUser(id, channel, event, data));
        else
            this.sendUser(target, channel, event, data);
    }

    sendUser(id, channel, event, data) {
        const user = this.users.get(id);
        if (user && user.socket && user.socket.isConnected)
            user.socket.of(channel).emit(event, data);
    }

    disconnect(target, reason, code) {
        (target.forEach ? [...target] : [target]).forEach((id) => {
            const user = this.users.get(id);
            if (user && user.socket)
                user.socket.disconnect(code || 1000, reason);
        });
    }

    of(channel) {
        return {
            send: (target, event, data) => this.send(target, channel, event, data),
            on: (eventName, callback) => this.on(eventName, (eventChannel, ...rest) => {
                if (eventChannel === channel)
                    callback(...rest);
            }),
            registry: this,
            get: (id) => this.users.get(id)
        };
    }

    checkUserToken(id, token) {
        const user = this.users.get(id);
        return !!user && user.token === token;
    }

    createRoomManager(roomPath, GameStateClass) {
        if (this.roomManagers.has(roomPath))
            return this.log(`Error: Duplicated RoomManager for path ${roomPath}`);
        this.roomManagers.set(roomPath, new RoomManager(this.of(roomPath), roomPath, GameStateClass));
    }

    handleAppPage(pagePath, filePath, viteManifestPath, viteStaticPath, entryPoint = "src/main.ts") {
        const
            depsPath = path.join(__dirname, "public", "deps.html"),
            sandboxScript = `<script src="/sandbox/client.js?${this.config.startTime}"></script>`;
        this.app.get(pagePath, (req, res) => {
            /* Unlike the site, files are re-read on every load, so page edits
               need no restart. The site reads them once at startup. */
            let page, deps, viteDeps = "";
            try {
                page = fs.readFileSync(filePath, "utf8");
                deps = fs.readFileSync(depsPath, "utf8");
                if (viteManifestPath) {
                    if (this.config.viteDev)
                        viteDeps = `<script type="module" src="http://localhost:5173/@vite/client"></script>
                            <script type="module" src="http://localhost:5173/${entryPoint}"></script>`;
                    else {
                        const manifest = JSON.parse(fs.readFileSync(viteManifestPath, "utf8"));
                        viteDeps = `<link rel="stylesheet" href="${viteStaticPath}${manifest[entryPoint].css}" />
                            <script type="module" src="${viteStaticPath}${manifest[entryPoint].file}"></script>`;
                    }
                }
            } catch (error) {
                warn(`страница ${pagePath}: ${error.message}`);
                return res.status(500).send(`<pre>${error.message}</pre>`);
            }
            const token = makeId();
            this.sessionTokens.add(token);
            setTimeout(() => this.sessionTokens.delete(token), this.config.sessionTTL);
            res.set("Cache-Control", "no-cache, no-store, must-revalidate");
            res.send(`
                <script>window.wssToken = "${token}";
                window.metrics = false;
                window.sentryDsn = "";
                window.reconnectEnabled = ${this.config.reconnect !== false};
                </script>
                ${deps.replace(/%startTime%/g, this.config.startTime)}
                ${sandboxScript}
                ${page.replace(/%startTime%/g, this.config.startTime)}
                ${viteDeps}`);
        });
    }

    restoreManagedRooms() {
        const file = this.config.dumpFile;
        if (file && fs.existsSync(file)) {
            try {
                this.restoredRoomData = JSON.parse(fs.readFileSync(file, "utf8")).data || {};
                const count = Object.values(this.restoredRoomData).reduce((sum, rooms) => sum + Object.keys(rooms).length, 0);
                if (count)
                    this.log(`restored ${count} room(s) from ${path.basename(file)}, they come back on first join`);
            } catch (error) {
                warn(`не удалось прочитать дамп комнат: ${error.message}`);
            }
        }
        return Promise.resolve();
    }

    getRestoredRoom(roomPath, roomId) {
        const rooms = this.restoredRoomData[roomPath];
        if (rooms && rooms[roomId]) {
            const data = rooms[roomId];
            delete rooms[roomId];
            return data;
        }
    }

    dumpManagedRooms() {
        const dump = {timestamp: Date.now(), data: {}};
        for (const [roomPath, manager] of this.roomManagers) {
            dump.data[roomPath] = {};
            for (const [roomId, room] of manager.rooms) {
                try {
                    // Round-trip like the site does: the snapshot must survive JSON
                    dump.data[roomPath][roomId] = JSON.parse(JSON.stringify(room.getSnapshot()));
                } catch (error) {
                    if (!room.sandboxDumpWarned) {
                        room.sandboxDumpWarned = true;
                        warn(`${roomPath}#${roomId}: getSnapshot() не сериализуется в JSON (${error.message.split("\n")[0]}). `
                            + "На сайте из-за этого после перезапуска теряются все комнаты сервера, не только эта");
                    }
                }
            }
        }
        for (const [roomPath, rooms] of Object.entries(this.restoredRoomData))
            Object.assign(dump.data[roomPath] = dump.data[roomPath] || {}, rooms);
        try {
            fs.mkdirSync(path.dirname(this.config.dumpFile), {recursive: true});
            fs.writeFileSync(this.config.dumpFile, JSON.stringify(dump));
        } catch (error) {
            warn(`не удалось записать дамп: ${error.message}`);
        }
    }

    /* Discord login is faked: the sandbox client script makes the account
       button log in instantly, and every auth call answers with a local
       profile. Enough to see the logged-in UI: profile buttons, synced names. */
    createAuthUsers() {
        const registry = this;
        return {
            fakeProfile(token, name) {
                if (!registry.fakeLogins.has(token))
                    registry.fakeLogins.set(token, {
                        _id: `sandbox-${crypto.createHash("md5").update(token).digest("hex").slice(0, 8)}`,
                        name: name || "Sandbox user",
                        avatar: "",
                        bio: "",
                        subscribeLevel: 0,
                        gameSettings: {}
                    });
                return registry.fakeLogins.get(token);
            },
            findByToken(token) {
                return registry.fakeLogins.get(token);
            },
            logout(token) {
                registry.fakeLogins.delete(token);
            },
            fullProfile(authId) {
                const profile = [...registry.fakeLogins.values()].find((it) => it._id === authId);
                return profile ? {
                    ...profile, comments: [], miniProfiles: {},
                    badgesResolved: [], gameStatsResolved: [], achievementsResolved: []
                } : null;
            },
            processAchievement(context, achievementId) {
                registry.log(`achievement ${achievementId} for ${context && context.user}`);
            }
        };
    }

    log(message) {
        const time = new Date().toTimeString().slice(0, 8);
        console.log(`${time} ${message}`);
    }
}

class RoomManager {
    constructor(users, roomPath, GameStateClass) {
        const
            registry = users.registry,
            config = registry.config,
            rooms = this.rooms = new Map(),
            roomsPerUser = new Map(),
            pings = new Set(),
            banned = new Set(),
            kickCounts = new Map(),
            checkRoom = (room) => {
                const missing = REQUIRED_ROOM_METHODS.filter((name) => typeof room[name] !== "function");
                if (missing.length)
                    warn(`${roomPath}: у комнаты нет методов ${missing.join(", ")} — движок сайта их вызывает и упадёт`);
                if (room.room && room.room.gameId && typeof room.room.gameId === "object")
                    warn(`${roomPath}: room.gameId — объект, а должен быть id игры или null`);
                const online = room.room && room.room.onlinePlayers;
                if (online instanceof Set && JSON.stringify(online) === "{}")
                    warn(`${roomPath}: room.onlinePlayers — обычный Set, в JSON он станет {}. `
                        + "Движок шлёт this.room как есть (updatePublicState), нужен Set с toJSON, возвращающим массив");
            },
            attachRoom = (roomId, room) => {
                rooms.set(roomId, room);
                room.on("host-changed", () => {
                });
                room.on("user-kicked", (userId) => {
                    registry.disconnect(userId, "You was removed");
                    const count = (kickCounts.get(roomId + userId) || 0) + 1;
                    kickCounts.set(roomId + userId, count);
                    if (count >= 2)
                        users.send(room.room.hostId, "ban-confirm", {userId});
                });
            };

        setInterval(() => {
            roomsPerUser.forEach((roomId, id) => {
                const
                    user = users.get(id),
                    room = rooms.get(roomId),
                    pingId = makeId();
                if (!user || !user.socket || !user.socket.isConnected)
                    return;
                users.send(id, "ping", pingId);
                pings.add(pingId);
                setTimeout(() => {
                    if (!pings.delete(pingId)) return;
                    warn(`${roomPath}: ${id} не ответил на ping за ${config.pingTimeout / 1000} с и отключён (Ping timeout). `
                        + `Клиент игры должен отвечать: this.socket.on("ping", (id) => this.socket.emit("pong", id))`);
                    roomsPerUser.delete(id);
                    if (room) room.userLeft(id);
                    user.socket.disconnect(1000, "Ping timeout");
                }, config.pingTimeout);
            });
        }, config.pingInterval).unref();

        users.on("user-joined", (id, data) => {
            if (!data.roomId)
                return;
            const restored = registry.getRestoredRoom(roomPath, data.roomId);
            if (restored && !rooms.has(data.roomId)) {
                try {
                    const room = new GameStateClass(id, data, users, registry);
                    room.setSnapshot(restored);
                    room.updateSnapshot();
                    room.wasRestored = new Date();
                    attachRoom(data.roomId, room);
                } catch (error) {
                    console.error(error);
                    warn(`${roomPath}#${data.roomId}: setSnapshot() упал — на сайте комната после перезапуска потеряется`);
                }
            }
            if (!rooms.has(data.roomId)) {
                try {
                    const room = new GameStateClass(id, data, users, registry);
                    attachRoom(data.roomId, room);
                    checkRoom(room);
                } catch (error) {
                    console.error(error);
                    warn(`${roomPath}: конструктор комнаты упал`);
                    return registry.disconnect(id, "Room error");
                }
            }
            const room = rooms.get(data.roomId);
            if (banned.has(data.roomId + id))
                return registry.disconnect(id, "You was banned in this room");
            if (config.maxUsersPerRoom && room.getPlayerCount() >= config.maxUsersPerRoom)
                return registry.disconnect(id, `Room player limit reached (${config.maxUsersPerRoom})`);
            data.userName = data.userName || "null";
            room.userJoin(data);
            room.userJoinCommon(data);
            if (room.wasRestored && Date.now() - room.wasRestored < 30000)
                users.send(id, "message", `Server was restarted. Room restored from ${room.wasRestored}`);
            const prevRoom = rooms.get(roomsPerUser.get(id));
            if (prevRoom && prevRoom !== room)
                prevRoom.userLeft(id);
            roomsPerUser.set(id, data.roomId);
        });

        users.on("user-left", (id) => {
            const room = rooms.get(roomsPerUser.get(id));
            if (room)
                room.userLeft(id);
            roomsPerUser.delete(id);
        });

        users.on("user-event", (id, event, data) => {
            const room = rooms.get(roomsPerUser.get(id));
            if (!room)
                return;
            room.lastSandboxEvent = Date.now();
            if (event === "pong")
                return pings.delete(data[0]);
            if (event === "ban-user-in-room") {
                if (room.room.hostId === id && data[0]) {
                    banned.add(room.room.roomId + data[0]);
                    registry.disconnect(data[0], "You was banned in this room");
                }
                return;
            }
            if (event === "set-room-mode")
                return room.setRoomMode(data[0], id);
            room.userEvent(id, event, data);
        });
    }
}

module.exports = UserRegistry;
