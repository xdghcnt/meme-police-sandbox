"use strict";

/* On the site these are fixed lists in the engine: `games` for play time and
   profile stats, `achievements` and `badges` for the profile. A game that
   reads `registry.games.<id>` crashes there if nobody added the entry.
   The sandbox hands out any id, but says once that the site needs it. */

const warned = new Set();

function openList(kind, hint) {
    const known = {};
    return new Proxy(known, {
        get(target, key) {
            if (typeof key !== "string" || key === "then" || key === "toJSON")
                return undefined;
            if (!warned.has(key)) {
                warned.add(key);
                console.warn(`[sandbox] ${kind}.${key} — ${hint}`);
            }
            if (!target[key])
                target[key] = {id: key, title: key, icon: ""};
            return target[key];
        }
    });
}

exports.games = openList("games",
    "на сайте такой записи может не быть в data.js движка: попросите её добавить или передавайте null вместо id игры");
exports.achievements = openList("achievements",
    "на сайте ачивка должна быть заведена в data.js движка");
exports.badges = openList("badges",
    "на сайте бейдж должен быть заведён в data.js движка");
