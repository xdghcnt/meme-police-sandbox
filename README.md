# meme-police sandbox

Локальный запуск игр meme-police в настоящей обвязке сайта: меню комнаты, чат,
шестерёнка хоста, профиль, переподключение, восстановление комнат после
рестарта — без доступа к закрытому `ws-server-engine`.

```bash
git clone <этот репозиторий> meme-police-sandbox
git clone <игра> my-game
cd meme-police-sandbox && npm install
node --watch server.js ../my-game
# http://localhost:8090/bg
```

Нужен Node 20+. Как устроено подключение игры, что проверять и чем песочница
отличается от сайта — в [AGENTS.md](AGENTS.md). Этот же файл читают
агенты (Claude Code, Codex, Cursor). Чтобы агент видел его, работая в
репозитории игры, добавь в её `AGENTS.md` или `CLAUDE.md` строку:

```
Игра проверяется в ../meme-police-sandbox — прочитай ../meme-police-sandbox/AGENTS.md перед правками.
```

## Устройство

```
server.js              запуск: игры из аргументов, как site/app.js
engine/index.js        заменитель ws-server-engine: app, static, users
engine/user-registry.js  протокол сокета, RoomManager, пинг, дамп комнат
engine/room.js         RoomState и общие события (чат, имя, логин, настройки комнаты)
engine/css-check.js    подсказки о пересечении CSS игры с CSS движка
engine/public, engine/ws-client.js   клиент движка с сайта (не править руками)
site/                  маршруты сайта, которые дёргает UI движка, и скрипт песочницы
```

## Обновление клиента движка

Делает тот, у кого есть доступ к `ws-server-engine`:

```bash
node scripts/sync-engine-client.js ../ws-server-engine
git add engine && git commit -m "Клиент движка: $(cat engine/ENGINE_VERSION)"
```

Если меняется серверное поведение движка, которое видят игры (события,
поля комнаты, порядок вызовов), его нужно повторить в `engine/*.js` руками.
