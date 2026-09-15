# meme-police sandbox — инструкции для агента

Песочница запускает модуль игры так же, как это делает сайт meme-police, на
облегчённой версии его движка `ws-server-engine`. Клиентская часть движка
(`engine/public`, `engine/ws-client.js`) — настоящая, скопирована с сайта.
Серверная (`engine/*.js`) — заменитель с тем же поведением для игры.

Твоя задача обычно — править **игру** (соседний репозиторий), а песочницей её
проверять. Файлы в `engine/` не правь: если песочница ведёт себя не так, как
написано ниже, опиши расхождение людям, а не подгоняй заменитель под игру.

## Запуск

Установка и первые шаги — в разделе «Если ты агент…» в [README.md](README.md).

```bash
# рядом лежат: ./meme-police-sandbox и ./<игра>
cd meme-police-sandbox
npm install
node --watch server.js ../<игра>            # http://localhost:8090/bg
node server.js ../a ../b=/bg/custom-path    # несколько игр, свой путь
node server.js --help
```

- `--watch` перезапускает сервер при правке серверного кода игры. HTML-страница
  и статика перечитываются на каждой загрузке без перезапуска.
- Комнаты переживают перезапуск (дамп в `.sandbox/`, как на сайте) — это и
  проверка, что `getSnapshot`/`setSnapshot` работают. `--no-restore` отключает.
- Путь игры по умолчанию — `/bg/<name из package.json без -web>`.
- Желтые строки `[sandbox] …` в консоли — это то, что на сайте сломается
  молча. Их надо чинить, а не игнорировать.

### Несколько игроков

Вкладки одного адреса делят `localStorage` и становятся **одним** игроком.
Второй игрок: другой адрес (`localhost` ↔ `127.0.0.1`), приватное окно или
отдельный browser context в Playwright.

Имя без диалога: `http://localhost:8090/bg/<игра>?name=Bob#room1`. Без `name`
движок спрашивает ник через `prompt()` — в автоматическом браузере вкладка
зависнет.

Комната — это часть после `#`. Смена `#` перезагружает страницу.

Кнопка «Аккаунт → Войти через Discord» в песочнице логинит мгновенно
фейковым профилем. Проверяй игру и **залогиненным**, и нет: у залогиненных
движок рисует рядом с именем кнопку профиля.

## Как сайт подключает игру

`site/app.js` делает `require("<игра>")(wsServer, "/bg/<игра>", moderKey)` —
для ESM `(await import("<игра>")).default(...)`. Модуль (поле `main` в
`package.json`) экспортирует функцию, которая:

1. Отдаёт статику: `wsServer.app.use("/<игра>", wsServer.static(dir))`.
2. Регистрирует страницу: `wsServer.users.handleAppPage(path, "public/app.html")`.
   Движок сам вставляет перед ней свои скрипты и стили (`engine/public/deps.html`):
   React 16.13, ReactDOM, Babel standalone (`<script type="text/babel">`),
   `classnames` как `cs`, `popup` (alert/confirm/prompt/textarea), `Toastify`,
   `moment`, `linkify`, общий UI (`client-react.jsx`). Для Vite-сборки есть
   третий и четвёртый аргументы — путь к manifest и префикс статики.
3. Создаёт менеджер комнат: `wsServer.users.createRoomManager(path, GameState)`.

## Сервер: комната

```js
class GameState extends wsServer.users.RoomState {
    constructor(hostId, hostData, userRegistry) {
        super(hostId, hostData, userRegistry, null, path); // null — id игры, см. ниже
        this.room = {...this.room, /* поля игры */ onlinePlayers: new JSONSet(), spectators: new JSONSet(), playerNames: {}};
    }
}
```

- **`super(...)` с `...this.room`.** Базовый класс кладёт в `this.room` общие поля
  (`authUsers`, `playerAvatars`, `chatEnabled` и т.д.), их нельзя терять.
- **Id игры.** Четвёртый аргумент — id из списка игр движка или `null`. Список живёт
  в `data.js` движка сайта: новой игры там нет, и `registry.games.<игра>.id` на сайте
  упадёт. Передавай `null`. Никогда не клади туда объект.
- **Обязательные методы** (движок вызывает их сам): `userJoin(data)`, `userLeft(userId)`,
  `userEvent(userId, event, args)`, `getPlayerCount()`, `getActivePlayerCount()`,
  `getLastInteraction()`, `getSnapshot()`, `setSnapshot(snapshot)`.
- **Множества в `this.room`.** Движок сам отправляет `this.room` как есть
  (`updatePublicState()` — при логине, аватарке, настройках комнаты). Обычный `Set`
  в JSON превращается в `{}`, и клиент падает. Нужен `Set` с
  `toJSON() { return [...this]; }`. Лучше переопределить `updatePublicState()`,
  чтобы он слал то же, что и твоя рассылка состояния.
- **Общие события.** В начале `userEvent` передавай их движку:
  `if (this.eventHandlers[event]) return this.eventHandlers[event](userId, ...args);`.
  Это чат, смена имени, логин, профиль, аватарки. Без этого на сайте не работает
  половина UI движка.
- **События, которые игра обрабатывает сама**, потому что их шлёт UI движка:
  - `"remove-player"` — кик хостом; для зрителя — `this.emit("user-kicked", id)`;
  - `"give-host"` — передача хоста; обязательно `this.emit("host-changed", old, new)`.
- **Что движок перехватывает до игры:** `"set-room-mode"` (диалог настроек комнаты),
  `"ban-user-in-room"`, `"pong"`.
- **Отправка:** `this.send(target, event, data)`, где `target` — id игрока или
  множество id. Личные данные (руки, секреты) — только адресно, не в `this.room`.
- **Снимок.** `getSnapshot()` должен проходить через `JSON.stringify`: без циклов, без
  таймеров и сокетов. На сайте один несериализуемый снимок роняет сохранение **всех**
  комнат сервера. В `setSnapshot` восстанавливай множества из массивов и сбрасывай
  `onlinePlayers`.
- **Лимиты сайта:**
  - одно сообщение клиента — не больше 10 000 байт (`maxPayload`), больше — соединение рвётся;
  - не больше 25 человек в комнате;
  - около 10 сообщений в секунду с одного IP.

## Клиент

Опорные примеры — открытые игры сайта:
[citadels-web](https://github.com/xdghcnt/citadels-web) и
[who-am-i-web](https://github.com/xdghcnt/who-am-i-web) (`module.js` и `public/app.jsx`).
Они старше этих правил, поэтому в CSS им не подражай — там правила выше.

```jsx
componentDidMount() {
    const initArgs = CommonRoom.roomInit(this);       // сокет, id игрока, комната
    this.socket.on("state", (state) => {
        CommonRoom.processCommonRoom(state, this.state, {maxPlayers: 8, largeImageKey: "<игра>", details: "<Игра>"}, this);
        this.setState({...state, userId: this.userId});
    });
    this.socket.on("ping", (id) => this.socket.emit("pong", id)); // иначе движок выкидывает по «Ping timeout»
    this.socket.on("message", (text) => popup.alert({content: text}));
    this.socket.emit("init", initArgs);
}
render() {
    return <React.Fragment>
        <CommonRoom state={this.state} app={this}/>        {/* меню, чат, профиль, диалог настроек */}
        <HostControls app={this} data={this.state} timerControls={[]}
            emitEvent={(...args) => this.socket.emit(...args)}/> {/* шестерёнка: настройки комнаты, имя */}
        {/* игра */}
    </React.Fragment>;
}
```

- **Без `alert()`, `confirm()`, `prompt()` в коде игры** — только `popup.*`. Нативные
  диалоги вешают вкладку.
- **Имена игроков** выводи через `<PlayerName data={state} id={userId}/>`: он учитывает
  ник из профиля и добавляет кнопку профиля `<i class="material-icons profile-button">`.
- **Хост-контролы у игроков** — `window.commonRoom.handleGiveHost(id, evt)` и
  `handleRemovePlayer(id, evt)`, они сами спрашивают подтверждение.
- **Тёмная тема движка** — `<body class="dark-theme">` в `app.html`, если игра тёмная.

### CSS — главный источник поломок

UI движка рендерится внутри твоей страницы и делит с ней стили.

- **Классы.** Не называй свои элементы классами движка: `panel`, `host-controls`,
  `settings-button`, `room-menu`, `common-room`, `chat*`, `profile*`, `host-button`
  и прочими. Полный список — в `engine/public/client.css`. Перед тем как завести
  класс, проверь: `grep -n "\.имя\b" engine/public/client.css`. При старте песочница
  печатает совпадения.
- **Теги.** Не стили голые теги на всю страницу (`button {}`, `a {}`). Не пиши широких
  правил вроде `.row i` или `.row span` там, где внутри может оказаться компонент
  движка (`PlayerName`, кнопки хоста). Давай своим элементам свои классы.
- **Корневой класс.** Общие правила вешай под корневой класс игры. Если не хочешь
  поднимать специфичность — используй `:where(.my-game) button`.
- **Фиксированная раскладка.** Меню движка висит сверху слева (`position: fixed`,
  высота около 40px), шестерёнка — снизу справа, кнопка чата — снизу слева. Не ставь
  туда свои фиксированные панели.

## Чем песочница отличается от сайта

- **Серверного кода движка сайта в открытом доступе нет.** Не пытайся поставить
  `ws-server-engine` из GitHub или npm и не ищи его исходники: всё, что нужно игре,
  есть в песочнице. Игре и не нужно импортировать движок: сайт передаёт его
  аргументом `wsServer`. Серверное поведение описано выше в этом файле
  и видно в `engine/*.js`.
- Логин фейковый. Профили без статистики, ачивок и комментариев, аватарки —
  заглушка, загрузка картинок выключена.
- Голосовой чат (Discord, встроенный) не работает. Текстовый чат работает.
- Нет паков слов, админки `/manage`, публичных комнат на главной, лимитов по IP и
  rate limit.
- Пинг по умолчанию каждые 20 секунд, на сайте — раз в минуту. Так ошибка
  с `pong` видна сразу.
- Страницы перечитываются при каждой загрузке. Сайт читает их один раз при старте.

## Перед PR

1. Игра запускается в песочнице без жёлтых `[sandbox]`-предупреждений.
2. Двое игроков (разные адреса или контексты) проходят партию, один из них залогинен.
3. Проверено у хоста: шестерёнка → настройки комнаты, передача хоста, кик зрителя.
4. Перезапуск песочницы посреди партии — комната восстанавливается.
5. Экран 1440px и узкий (~800px): меню движка, шестерёнка и кнопка чата не
   перекрывают игру и не перекрываются ею.
