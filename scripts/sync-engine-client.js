#!/usr/bin/env node
"use strict";

/* Copies the engine's browser side into the sandbox: the files every visitor
   of the site downloads anyway (deps.html, client-react.jsx, client.css,
   libs, media, ws-client.js). The engine's server code stays private.

   Run by someone with access to ws-server-engine:
       node scripts/sync-engine-client.js [path/to/ws-server-engine]
   then commit the result. */

const fs = require("fs");
const path = require("path");
const {execSync} = require("child_process");

const
    root = path.resolve(__dirname, ".."),
    engineDir = path.resolve(process.argv[2] || path.join(root, "..", "ws-server-engine")),
    source = path.join(engineDir, "public"),
    target = path.join(root, "engine", "public"),
    // Admin panel client and the Discord login page: not part of a game page
    EXCLUDED = new Set(["app.html", "app.jsx", "login.html", "profile-page.html"]);

if (!fs.existsSync(path.join(source, "deps.html"))) {
    console.error(`Не нашёл движок в ${engineDir} — укажите путь к ws-server-engine аргументом`);
    process.exit(1);
}

fs.rmSync(target, {recursive: true, force: true});
fs.mkdirSync(target, {recursive: true});
for (const entry of fs.readdirSync(source))
    if (!EXCLUDED.has(entry) && !entry.startsWith("."))
        fs.cpSync(path.join(source, entry), path.join(target, entry), {
            recursive: true,
            filter: (file) => !path.basename(file).startsWith(".")
        });
fs.copyFileSync(path.join(engineDir, "ws-client.js"), path.join(root, "engine", "ws-client.js"));

let version = "unknown";
try {
    version = execSync("git log -1 --format='%h %cs %s'", {cwd: engineDir}).toString().trim();
} catch (error) {
}
fs.writeFileSync(path.join(root, "engine", "ENGINE_VERSION"), `${version}\n`);
console.log(`Клиент движка скопирован: ${version}`);
