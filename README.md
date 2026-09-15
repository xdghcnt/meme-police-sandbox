# meme-police sandbox

Локальный запуск игр meme-police в настоящей обвязке сайта: меню комнаты, чат,
шестерёнка хоста, профиль, переподключение, восстановление комнат после
рестарта — без установки самого сайта.

## Если ты агент и тебе дали ссылку на этот репозиторий

Тебя просят проверять игру в обвязке meme-police. Сделай по порядку:

1. **Найди игру.** Обычно это текущий рабочий репозиторий: в `package.json` есть
   `main`, модуль экспортирует функцию `(wsServer, path, ...)` и вызывает
   `wsServer.users.createRoomManager`. Если игр несколько или не уверен — спроси.
2. **Склонируй песочницу рядом с игрой**, в соседнюю папку (Node 20+):
   ```bash
   git clone https://github.com/xdghcnt/meme-police-sandbox.git ../meme-police-sandbox
   cd ../meme-police-sandbox && npm install
   ```
   Уже есть — обнови: `git -C ../meme-police-sandbox pull && npm install --prefix ../meme-police-sandbox`.
3. **Прочитай [AGENTS.md](AGENTS.md) целиком.** Там контракт игры с сайтом, правила
   CSS, как тестировать нескольких игроков и чек-лист перед PR. Это не справка
   «на всякий случай»: большинство поломок на сайте — нарушения оттуда.
4. **Пропиши указатель в репозиторий игры**, чтобы в следующих сессиях правила
   подхватывались сами. Добавь в `AGENTS.md` игры (и в `CLAUDE.md`, если он есть)
   строку, если её там ещё нет:
   ```
   Игра проверяется в песочнице ../meme-police-sandbox — перед правками прочитай ../meme-police-sandbox/AGENTS.md.
   ```
5. **Запусти игру в песочнице в фоне** и открой её:
   ```bash
   cd ../meme-police-sandbox && node --watch server.js ../<папка-игры>
   # http://localhost:8090/bg
   ```
6. **Разбери вывод консоли.** Жёлтые `[sandbox] …` — то, что на сайте ломается молча,
   их надо чинить в игре. Строки `CSS: …` — пересечения со стилями движка,
   посмотри каждое.
7. **Дальше работай как обычно**, проверяя изменения в песочнице. Перед PR пройди
   чек-лист в конце AGENTS.md.

Файлы в `engine/` песочницы не правь. Если песочница ведёт себя не так, как
описано, — скажи об этом человеку.

## Для людей

```bash
git clone https://github.com/xdghcnt/meme-police-sandbox.git
cd meme-police-sandbox && npm install
node --watch server.js ../my-game     # http://localhost:8090/bg
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

Делают мейнтейнеры сайта, из рабочей копии `ws-server-engine`:

```bash
node scripts/sync-engine-client.js ../ws-server-engine
git add engine && git commit -m "Клиент движка: $(cat engine/ENGINE_VERSION)"
```

Если меняется серверное поведение движка, которое видят игры (события,
поля комнаты, порядок вызовов), его нужно повторить в `engine/*.js` руками.
