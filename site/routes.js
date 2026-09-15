"use strict";

/* What the site itself (not the engine) answers and the engine's UI calls:
   the game list at /bg, update notes, dating badge, avatars, uploads. */

const path = require("path");

const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" fill="#3a4a57"/><circle cx="32" cy="25" r="12" fill="#9eb1bd"/>
<path d="M10 60c3-14 12-20 22-20s19 6 22 20z" fill="#9eb1bd"/></svg>`;

module.exports = function registerSiteRoutes(app, games) {
    app.get("/", (req, res) => res.redirect("/bg"));
    app.get("/bg", (req, res) => {
        const room = Math.random().toString(36).slice(2, 7);
        res.send(`<!doctype html><meta charset="utf-8"><title>meme-police sandbox</title>
<style>body{font:16px system-ui;margin:40px;background:#1b2229;color:#e6edf2}a{color:#ffd26d}li{margin:8px 0}</style>
<h1>meme-police sandbox</h1>
<ul>${games.map((game) => `<li><a href="${game.path}#${room}">${game.path}</a> <small>${game.dir}</small></li>`).join("")}</ul>
<p>Второго игрока открывайте в другом браузере, в приватном окне или через другой адрес:
<code>localhost</code> ↔ <code>127.0.0.1</code> — вкладки одного адреса делят localStorage и будут одним игроком.</p>`);
    });
    app.get(["/bg/updates", "/updates"], (req, res) =>
        res.send(`<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:16px">
            Здесь на сайте показывается журнал обновлений.</body>`));
    app.get("/dating/api/badge", (req, res) => res.json({showBadge: false}));
    app.get("/sw.js", (req, res) => res.type("application/javascript").send(""));
    app.get(["/user-data/users/:id/avatar.png", "/user-data/avatars/:file"], (req, res) =>
        res.type("image/svg+xml").send(AVATAR_SVG));
    app.post("/common/upload-image", (req, res) => res.status(403).send("Загрузка картинок в песочнице недоступна"));
    app.get("/sandbox/client.js", (req, res) => res.sendFile(path.join(__dirname, "sandbox-client.js")));
};
