"use strict";

/* Stand-in for `ws-server-engine`: the object a game module receives as
   `wsServer` — `app`, `static` and `users`. */

const
    http = require("http"),
    path = require("path"),
    express = require("express"),
    WebSocket = require("ws"),
    WebSocketServerWrapper = require("ws-server-wrapper"),
    UserRegistry = require("./user-registry");

class WsServer {
    constructor(config) {
        this.app = express();
        this.app.use(express.json());
        this.server = http.createServer(this.app);
        const wss = new WebSocket.Server({server: this.server, maxPayload: config.maxPayload});
        this.app.get("/ws-client.js", (req, res) => res.sendFile(path.join(__dirname, "ws-client.js")));
        this.app.use("/common", express.static(path.join(__dirname, "public")));
        this.users = new UserRegistry(new WebSocketServerWrapper(wss), config, this.app);
        this.static = (dir) => express.static(dir);
    }

    listen(port) {
        return new Promise((resolve, reject) => {
            this.server.once("error", reject);
            this.server.listen(port, resolve);
        });
    }
}

module.exports = WsServer;
