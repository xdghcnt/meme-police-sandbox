"use strict";

/* The engine's own UI (room menu, host gear, chat, profile, player names)
   renders inside the game page and shares its CSS. Two ways a game breaks it
   without noticing:
   - reusing a class the engine already styles (`.panel`, `.host-controls`) —
     the engine's rules land on the game's element and vice versa;
   - styling bare tags globally (`button { … }`) — every engine button and
     icon on the page picks the rules up.
   Games also restyle engine classes on purpose (theming the host gear), so
   this is a prompt to look, not a verdict. */

const fs = require("fs");
const path = require("path");

const
    // Engine classes a game is expected to use as-is, and generic state words
    ALLOWED_SHARED = new Set(["material-icons", "dark-theme", "active", "selected", "inactive", "disabled",
        "value", "toggle", "hidden", "speaking"]),
    TAGS = "a|aside|b|button|div|em|footer|h[1-6]|header|i|img|input|label|li|main|nav|ol|p|section|select|small|span|strong|table|td|textarea|th|tr|ul",
    // A selector that is only a tag, maybe with pseudo-classes: applies to the whole page
    GLOBAL_TAG = new RegExp(`^(${TAGS})(:[\\w-]+(\\([^)]*\\))?)*$`);

function listCss(dir, found = []) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        if (entry.name === "node_modules" || entry.name.startsWith("."))
            continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory())
            listCss(full, found);
        else if (entry.name.endsWith(".css"))
            found.push(full);
    }
    return found;
}

function selectors(css) {
    const result = [];
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /([^{}@]+)\{/g;
    let match;
    while ((match = rule.exec(clean)))
        match[1].split(",").map((it) => it.trim()).filter(Boolean).forEach((it) => result.push(it));
    return result;
}

function engineClasses(engineCss) {
    const classes = new Set();
    for (const selector of selectors(fs.readFileSync(engineCss, "utf8")))
        for (const match of selector.matchAll(/\.([a-zA-Z][\w-]*)/g))
            classes.add(match[1]);
    return classes;
}

function checkGameCss(gameDir) {
    const
        engine = engineClasses(path.join(__dirname, "public", "client.css")),
        clashes = new Map(),
        bareTags = new Map();
    for (const file of listCss(gameDir)) {
        if (/[\\/](dist|build)[\\/]/.test(file) && !/[\\/]public[\\/]/.test(file))
            continue;
        const relative = path.relative(gameDir, file);
        for (const selector of selectors(fs.readFileSync(file, "utf8"))) {
            if (selector.includes(":where(") || /^(from|to|\d+%)$/.test(selector))
                continue;
            for (const match of selector.matchAll(/\.([a-zA-Z][\w-]*)/g))
                if (engine.has(match[1]) && !ALLOWED_SHARED.has(match[1]))
                    clashes.set(`.${match[1]}`, relative);
            if (GLOBAL_TAG.test(selector))
                bareTags.set(selector, relative);
        }
    }
    return {clashes, bareTags};
}

module.exports = checkGameCss;
