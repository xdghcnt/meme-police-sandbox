#!/usr/bin/env node
"use strict";

/* meme-police sandbox: runs game modules the way the site does, on a
   lightweight version of ws-server-engine.

       node server.js [options] <game-dir>[=/bg/path] [...]

   Options:
       --port <n>          HTTP port (default 8090)
       --ping <seconds>    engine ping interval (default 20; the site uses 60)
       --vite-dev          pages with a Vite manifest load from the Vite dev server (localhost:5173)
       --no-restore        don't keep rooms across restarts
       --log-events        print every client event
*/

const fs = require("fs");
const path = require("path");
const {pathToFileURL} = require("url");
const WsServer = require("./engine");
const registerSiteRoutes = require("./site/routes");
const checkGameCss = require("./engine/css-check");

function parseArgs(argv) {
    const options = {port: 8090, ping: 20, viteDev: false, restore: true, logEvents: false, games: []};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--port") options.port = Number(argv[++i]);
        else if (arg === "--ping") options.ping = Number(argv[++i]);
        else if (arg === "--vite-dev") options.viteDev = true;
        else if (arg === "--no-restore") options.restore = false;
        else if (arg === "--log-events") options.logEvents = true;
        else if (arg === "--help" || arg === "-h") options.help = true;
        else if (arg.startsWith("--")) throw new Error(`Неизвестный параметр ${arg}`);
        else {
            const [dir, gamePath] = arg.split("=");
            options.games.push({dir: path.resolve(dir), path: gamePath});
        }
    }
    return options;
}

function gameEntry(dir) {
    const packageFile = path.join(dir, "package.json");
    if (!fs.existsSync(packageFile))
        throw new Error(`В ${dir} нет package.json`);
    const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
    const name = pkg.name.replace(/(-game)?-web$/, "");
    return {name, file: path.join(dir, pkg.main || "index.js")};
}

function printCssHints(dir) {
    const {clashes, bareTags} = checkGameCss(dir);
    if (clashes.size)
        console.log(`  CSS: классы, которые стилизует и движок: ${[...clashes.keys()].join(" ")}\n`
            + "       если это ваш собственный элемент — переименуйте; если перекрашиваете UI движка — всё в порядке");
    if (bareTags.size)
        console.log(`  CSS: правила на всю страницу по тегу: ${[...bareTags.keys()].join(" ")}\n`
            + "       они задевают и кнопки/иконки движка — лучше вложить под корневой класс игры");
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help || !options.games.length) {
        console.log(fs.readFileSync(__filename, "utf8").match(/\/\* meme-police sandbox[\s\S]*?\*\//)[0]);
        process.exit(options.help ? 0 : 1);
    }

    // Same limits as the site's config where a game can run into them
    const wsServer = new WsServer({
        port: options.port,
        maxPayload: 10000,
        maxUsersPerRoom: 25,
        sessionTTL: 15000,
        pingInterval: options.ping * 1000,
        pingTimeout: 5000,
        reconnect: true,
        updatesVersion: 1,
        datingEnabled: true,
        greetingMessage: null,
        siteEvent: null,
        viteDev: options.viteDev,
        logEvents: options.logEvents,
        dumpFile: options.restore ? path.join(__dirname, ".sandbox", `rooms-${options.port}.json`) : null,
        dumpInterval: 5000
    });
    registerSiteRoutes(wsServer.app, options.games);

    await wsServer.users.restoreManagedRooms();
    for (const game of options.games) {
        const entry = gameEntry(game.dir);
        game.path = game.path || `/bg/${entry.name}`;
        const loaded = await import(pathToFileURL(entry.file).href);
        const init = loaded.default;
        if (typeof init !== "function")
            throw new Error(`${entry.file} должен экспортировать функцию (module.exports или export default)`);
        // The site passes (wsServer, path, moderKey, ...) — the key is empty here
        await init(wsServer, game.path, "");
        console.log(`игра ${entry.name}: ${game.path}`);
        printCssHints(game.dir);
    }

    await wsServer.listen(options.port);
    console.log(`\nОткрыть: http://localhost:${options.port}/bg`);
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
