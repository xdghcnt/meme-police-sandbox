function makeId() {
    let text = "";
    const possible = "abcdefghijklmnopqrstuvwxyz0123456789";

    for (let i = 0; i < 5; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

/* Marker for the auto-reconnect states reported by window.socket.reconnect:
   spinning arrows in the corner and nothing else - the game stays as it was.
   Details go into the tooltip, clicking it retries immediately. A click
   anywhere else flashes it, since those clicks go nowhere while we're offline.
   Plain DOM on purpose: it has to work while the game's React tree is showing
   stale state, and it's shared by the React and the Vue based games. */
const ConnectionStatus = {
    /* Shown on every drop, however short, so that someone with a flaky connection
       can tell a reconnect apart from the server just being slow to answer. A blink
       would be a single frame though, hence the minimum time on screen. */
    MIN_VISIBLE: 400,
    FLASH_TIME: 500,
    // Past this the corner marker alone leaves people guessing - explain and offer a way out
    ESCALATE_AFTER: 10000,

    show(status, info) {
        // "terminated" - kicked or banned; the game shows its own screen, we get out of the way
        if (status === "connected" || status === "terminated") {
            this.hide();
            return;
        }
        this.mount();
        const seconds = status === "waiting" && info.delay ? Math.round(info.delay / 1000) : 0;
        this.node.title = info.announcement || (seconds
            ? `Соединение потеряно. Повтор через ${seconds} с — нажмите, чтобы сейчас`
            : "Соединение потеряно, идёт переподключение");
        /* A planned restart is announced and takes tens of seconds: say so at once
           instead of leaving people to guess whether the site just fell over. */
        if (info.announcement)
            this.escalate(info.announcement);
        this.countdown(seconds);
    },

    mount() {
        if (!this.node) {
            this.node = document.createElement("div");
            this.node.className = "reconnect-mark";
            this.node.innerHTML = `<i class="material-icons">sync</i>`;
            this.node.addEventListener("click", () => window.socket.reconnect.now());
            // Capture, so a game handler calling stopPropagation can't hide the click from us
            document.addEventListener("click", () => this.flash(), true);
            document.body.appendChild(this.node);
        }
        // A drop while fading out cancels the hide
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
        if (this.visible)
            return;
        this.visible = true;
        this.shownAt = Date.now();
        this.node.classList.add("visible");
        document.body.classList.add("ws-disconnected");
        this.escalateTimer = setTimeout(() => this.escalate(), this.ESCALATE_AFTER);
    },

    /* Full screen styled like the initial loading page. Shown at once when the server
       announced why it dropped us, otherwise only for outages long enough that the game
       underneath is useless anyway. Built lazily - most drops never get here. */
    escalate(announcement) {
        // Called directly on an announced drop, so the scheduled one must be dropped too -
        // otherwise it fires later and puts the overlay back after we've reconnected
        clearTimeout(this.escalateTimer);
        this.escalateTimer = null;
        if (announcement)
            this.announcement = announcement;
        if (!this.overlay) {
            this.overlay = document.createElement("div");
            this.overlay.className = "reconnect-overlay";
            this.overlay.innerHTML = `<div class="loading-page text-theme-color">
                <div class="loading-title"><span class="reconnect-title"></span> <img src="/common/media/loading-anim.gif" style="
                    height: 20px;
                    vertical-align: middle;
                    margin-top: -3px;
                "/>
                </div>
                <div class="reconnect-note"></div>
                <div class="loading-problems active">
                    <div class="loading-problems-title">
                        Не получается подключиться к серверу
                    </div>
                    <div class="loading-problems-options">
                        <a class="reconnect-retry">Попробовать сейчас</a>
                        <a onclick="location.reload(true)">Обновить страницу</a>
                        <a onclick="resetStorageAndReload()">Очистить данные сессии и перезагрузить страницу</a>
                        <a target="_blank" href="https://discord.gg/Z3YfHSD">Зайти в Discord-конференцию поддержки</a>
                    </div>
                </div>
            </div>`;
            this.overlay.querySelector(".reconnect-retry")
                .addEventListener("click", () => window.socket.reconnect.now());
            this.overlayNote = this.overlay.querySelector(".reconnect-note");
            this.overlayTitle = this.overlay.querySelector(".reconnect-title");
            document.body.appendChild(this.overlay);
        }
        this.overlayTitle.textContent = this.announcement || "Переподключение";
        // Nothing is broken during a planned restart - don't offer troubleshooting
        this.overlay.classList.toggle("announced", !!this.announcement);
        this.overlay.classList.add("visible");
        document.body.classList.add("ws-stuck");
    },

    countdown(seconds) {
        clearInterval(this.countdownTimer);
        if (!this.overlayNote)
            return;
        const tick = () => this.overlayNote.textContent = seconds > 0
            ? `Повтор через ${seconds}…`
            : "Переподключение…";
        tick();
        if (seconds > 0)
            this.countdownTimer = setInterval(() => {
                seconds--;
                tick();
                if (seconds <= 0)
                    clearInterval(this.countdownTimer);
            }, 1000);
    },

    flash() {
        if (!this.visible)
            return;
        clearTimeout(this.flashTimer);
        this.node.classList.remove("flash");
        void this.node.offsetWidth; // restart the animation on repeated clicks
        this.node.classList.add("flash");
        this.flashTimer = setTimeout(() => this.node.classList.remove("flash"), this.FLASH_TIME);
    },

    hide() {
        if (this.visible) {
            // Keep it on screen long enough to be noticed even if the drop was instant
            const left = this.MIN_VISIBLE - (Date.now() - this.shownAt);
            if (left > 0) {
                clearTimeout(this.hideTimer);
                this.hideTimer = setTimeout(() => this.hide(), left);
                return;
            }
        }
        clearTimeout(this.hideTimer);
        clearTimeout(this.flashTimer);
        clearTimeout(this.escalateTimer);
        clearInterval(this.countdownTimer);
        this.hideTimer = this.flashTimer = this.escalateTimer = null;
        this.announcement = null;
        this.visible = false;
        document.body.classList.remove("ws-disconnected", "ws-stuck");
        if (this.node)
            this.node.classList.remove("visible", "flash");
        if (this.overlay)
            this.overlay.classList.remove("visible");
    },
};

class CommonRoom extends React.Component {
    constructor() {
        super();
        moment.locale('ru');
        window.commonRoom = this;
        this.state = {achievements: []};

        if (window.metrics) {
            const google_script = document.createElement("script");
            google_script.setAttribute("src", "https://www.googletagmanager.com/gtag/js?id=UA-165998098-1");
            document.head.appendChild(google_script);

            (function (m, e, t, r, i, k, a) {
                m[i] = m[i] || function () {
                    (m[i].a = m[i].a || []).push(arguments)
                };
                m[i].l = 1 * new Date();
                k = e.createElement(t), a = e.getElementsByTagName(t)[0], k.async = 1, k.src = r, a.parentNode.insertBefore(k, a)
            })(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
            ym(62684383, "init", {clickmap: true, trackLinks: true, accurateTrackBounce: true});

            window.dataLayer = window.dataLayer || [];

            function gtag() {
                dataLayer.push(arguments);
            }

            gtag('js', new Date());

            gtag('config', 'UA-165998098-1');
        }
    }

    static getPlayerNameStatic(id, data) {
        if (!data) return "";
        if (data.authUsers[id]?.gameSettings?.syncName)
            return data.authUsers[id].name;
        else
            return data.playerNames[id];
    }

    isSubscribed(level) {
        return this.app.state.authUsers[this.app.userId]?.subscribeLevel >= (level || 1);
    }

    subscribePopup() {
        popup.alert({
            content: '<div class="sub-alert">Функция доступна только с' +
                ' <a href="https://boosty.to/meme-police.ru" target="_blank">подпиской</a>' +
                '<a href="https://boosty.to/meme-police.ru" target="_blank">' +
                '<img class="sub-image" src="/common/media/sub-icon.png">' +
                '</a></div>'
        })
    }

    subscribeOrKonfaPopup(name) {
        popup.alert({
            content: '<div class="sub-alert">' +
                (name || 'Функция доступна') +
                ' только с' +
                ' <a href="https://boosty.to/meme-police.ru" target="_blank">подпиской</a>' +
                ' или при игре в <a href="https://discord.gg/Z3YfHSD" target="_blank">конфе</a>' +
                '<a href="https://boosty.to/meme-police.ru" target="_blank">' +
                '<img class="sub-image" src="/common/media/sub-or-konfa-icon.png">' +
                '</a></div>'
        })
    }

    subscribePopup2() {
        const name = this.getPlayerName(this.app.userId);
        popup.alert({
            content: '<div class="sub-alert">Кринжевые анимированные ники доступны только с ' +
                '<a href="https://boosty.to/meme-police.ru" target="_blank">подпиской второго уровня</a>' +
                '<a href="https://boosty.to/meme-police.ru" target="_blank">' +
                '<img class="sub-image" src="/common/media/sub-icon.png"></a>' +
                '<div class="name-effect-preview">' +
                '<div class="name-effect-preview-desc">В данный момент доступны такие эффекты как:' +
                ' взлом жепы, мрачный кукож, чилловый градиент, неоновый демон и ебучий танцор из ада. ' +
                'Список будет пополняться.</div>' +
                ['glitch', 'kukozh', 'animate-character', 'sign', 'blazing'].map((it) =>
                    `<div class="${it}" data-text="${name}">${name}</div>`).join('') +
                '</div></div>'
        });
    }

    getPlayerName(id) {
        return CommonRoom.getPlayerNameStatic(id, this.app.state);
    }

    getPlayerAvatarURL(id) {
        const data = this.app.state;
        const authUser = data.authUsers[id];
        if (authUser?.gameSettings?.syncAvatar)
            return `/user-data/users/${authUser._id}/avatar.png?${authUser.avatar}`;
        else if (data.playerAvatars[id])
            return `/user-data/avatars/${data.playerAvatars[id]}`;
    }

    handleRemovePlayer(id, evt) {
        evt.stopPropagation();
        popup.confirm({content: `Removing ${this.getPlayerName(id)}?`}, (evt) => evt.proceed && this.app.socket.emit("remove-player", id));
    }

    handleGiveHost(id, evt) {
        evt.stopPropagation();
        popup.confirm({content: `Give host ${this.getPlayerName(id)}?`}, (evt) => evt.proceed && this.app.socket.emit("give-host", id));
    }

    handleClickChangeName() {
        popup.prompt({content: "New name", value: this.getPlayerName(this.app.userId) || ""}, (evt) => {
            if (evt.proceed && evt.input_value.trim()) {
                this.app.socket.emit("change-name", evt.input_value.trim());
                localStorage.userName = evt.input_value.trim();
            }
        });
    }

    renderHelpMenu(gameName, gameGuide, isHost, hostName) {
        return `<div class="help-menu-modal">
            <div class="help-menu-title">『🤔』</div>
            <div class="help-menu-options">
                <details><summary class="help-menu-summary">Куда нажать?</summary>
                    <div class="help-menu-guide">
                        <div class="help-menu-section">
                            <div class="help-menu-section-title">Общее для всех игр</div>
                            <div class="help-menu-section-content">
                                <p>Всё управление происходит через меню <i class="material-icons">settings</i> (в правом нижнем углу экрана).</p>
                                <p>Там же можно сменить никнейм <i class="material-icons">edit</i>, включить тёмную тему 
                                <i class="material-icons">brightness_2</i> и настроить громкость <i class="material-icons">volume_up</i> в некоторых играх.</p>
                                <p>Настройками, запуском <i class="material-icons">play_arrow</i>, перезапуском <i class="material-icons">sync</i> 
                                и остановкой <i class="material-icons">pause</i> игры управляет <b>хост</b> <i class="material-icons">stars</i> — человек,
                                 который создал комнату, то есть первым в неё зашёл (в данный момент это <b>${isHost ? "вы" : hostName}</b>).</p>
                                <p>Хост может передавать роль хоста другому человеку <i class="material-icons">vpn_key</i>, или кикнуть кого-нибудь <i class="material-icons">delete_forever</i>.
                                Может в любое время блокировать <i class="material-icons">lock_outline</i> и разблокировать <i class="material-icons">lock_open</i> 
                                игровые слоты (чтобы пустить или не пускать новых людей), а так же управлять настройками публичности комнаты <i class="material-icons">store</i>.</p>
                                <p>В некоторых играх есть функция перемешивания игроков <i class="material-icons">casino</i>.</p>
                            </div>
                        </div>
                        ${gameGuide ? `<div class="help-menu-section help-menu-section-game">
                            <div class="help-menu-section-title">Для этой игры (${gameName})</div>
                            <div class="help-menu-section-content">${gameGuide}</div>
                        </div>` : ``}
                    </div>
                </details>
                <a target="_blank" href="https://meme-police.ru/bg#rules/${gameName}">Правила игры (${gameName})</a>
                <a onClick="sentryReportDialog()">Сообщить о проблеме или предложить улучшение</a>
                <a target="_blank" href="https://discord.gg/Z3YfHSD">Discord-конференция поддержки</a>
            </div>
        </div>`;
    }

    toggleShowUpdates(evt) {
        evt.stopPropagation();
        this.state.showUpdates = !this.state.showUpdates;
        this.state.profileOpened = null;
        this.setState(this.state);
    }

    toggleShowProfile(userId, evt) {
        evt?.stopPropagation();
        this.state.showUpdates = false;
        if (this.state.profileOpened === userId)
            this.state.profileOpened = null;
        else {
            if (userId === this.app.userId && !this.isLoggedIn()) {
                this.state.profileOpened = this.app.userId;
            } else {
                if (this.state.profileOpened)
                    this.app.socket.emit('get-profile', userId);
                this.state.profileOpened = userId;
            }
        }
        this.setState(this.state);
    }

    removeDatingBadge() {
        this.setState({datingBadge: 0});
    }

    isLoggedIn() {
        return this.app.userId && this.app.state.authUsers[this.app.userId];
    }

    handleClickLogin() {
        this.state.profileOpened = null;
        this.setState(this.state);
        this.login();
    }

    login() {
        const redirect = `https://discord.com/api/oauth2/authorize?client_id=587347620574265498&redirect_uri=${encodeURIComponent(window.origin)}%2Fdiscord-auth-redirect&response_type=code&scope=identify`
        const loginWindow = window.open(redirect, '_blank');
        const popupTick = setInterval(() => {
            if (loginWindow.closed) {
                clearInterval(popupTick);
                this.app.socket.emit('check-auth', localStorage.userToken);
            }
        }, 500);
    }

    render() {
        const
            data = this.props.state,
            app = this.props.app,
            isHost = data.userId === data.hostId;
        this.app = app;
        
        if (this.isLoggedIn() && localStorage.redirectFromRu === '1' && localStorage.migratedGreetingShown === '1') {
            let claimed = [];
            try { claimed = JSON.parse(localStorage.migratedClaimedUserIds || "[]"); } catch (e) {}
            const authUserId = app.state.authUsers[data.userId]?._id;
            if (authUserId && !claimed.includes(authUserId)) {
                this.app.socket.emit('redirectedFromRu');
                claimed.push(authUserId);
                localStorage.migratedClaimedUserIds = JSON.stringify(claimed);
            }
        }

        if (!this.updatesProcessed && data.inited && data.updatesVersion
            && (!localStorage.updatesVersion || data.updatesVersion > parseInt(localStorage.updatesVersion))) {
            localStorage.updatesVersion = data.updatesVersion;
            this.state.showUpdates = true;
        }
        this.updatesProcessed = true;
        return <div className="common-room">
            <div class="room-menu">
                <div className="room-main-link panel">
                    <a href={`${window.location.origin}/bg`}>
                        <i className="material-icons">exit_to_app</i>
                        {window.location.hostname}/bg</a>
                    <i className="material-icons share-button" onClick={() => {
                        navigator.clipboard.writeText(location);
                        Toastify({
                            text: 'Ссылка на комнату скопирована',
                            duration: 2000,
                            style: {
                                background: "#333",
                                color: "white",
                                "box-shadow": "0 1px 15px rgba(0, 0, 0, 0.4)"
                            },
                        }).showToast();
                    }}>share</i>
                </div>
                <div className="updates-menu panel" onClick={(evt) => this.toggleShowUpdates(evt)}>
                    <span className="updates-icon">
                        <svg x="0" y="0" className="icon-22AiRD" aria-hidden="false" width="16" height="16"
                             viewBox="0 0 24 24">
                            <path d="M3.9 8.26H2V15.2941H3.9V8.26Z" fill="currentColor"/>
                            <path
                                d="M19.1 4V5.12659L4.85 8.26447V18.1176C4.85 18.5496 5.1464 18.9252 5.5701 19.0315L9.3701 19.9727C9.4461 19.9906 9.524 20 9.6 20C9.89545 20 10.1776 19.8635 10.36 19.6235L12.7065 16.5242L19.1 17.9304V19.0588H21V4H19.1ZM9.2181 17.9944L6.75 17.3826V15.2113L10.6706 16.0753L9.2181 17.9944Z"
                                fill="currentColor"/>
                        </svg>
                    </span>
                    {this.state.showUpdates
                        ? <div className="updates-container">
                            <div className="updates-container-tab panel"/>
                            <iframe className="updates-container-frame panel" src="./updates"/>
                            <div className="updates-container-close panel"
                                 onClick={(evt) => this.toggleShowUpdates(evt)}>Закрыть
                            </div>
                        </div>
                        : ""
                    }
                </div>
                <div className="help-menu panel" onClick={() => {
                    popup.alert({
                        content: this.renderHelpMenu(app.gameName, app.getGuide && app.getGuide(), isHost, data.playerNames[data.hostId]),
                        modal_size: "large"
                    });
                }}>
                    <span className="help-icon">?</span>
                </div>
                <a title="Донат" className="donate-menu panel" href="https://boosty.to/meme-police.ru"
                   target="_blank">
                    <span className="currency-icon">₽</span>
                </a>
                <a className={cs("konfa-menu panel", {turik: data.siteEvent?.turik})}
                   title={data.siteEvent ? data.siteEvent?.desc : "Оффициальная конфа для игр"}
                   href={data.siteEvent?.link || "https://discord.gg/Z3YfHSD"}
                   target="_blank">
                    {(data.siteEvent?.image || !data.siteEvent?.title) ? <img width="23" className={cs({
                        'konfa-icon': !data.siteEvent,
                    })} src={data.siteEvent?.image || "/common/media/discord-white.png"}/> : ""}
                    <span>&nbsp;{data.siteEvent?.title || 'Discord'}</span>
                </a>
                {data.datingEnabled ?
                    <a className="dating-menu panel" href={this.state.datingBadge ? "/dating#matches" : "/dating"}
                       onClick={(evt) => this.removeDatingBadge()}
                       target="_blank">
                        <i className="material-icons">favorite</i>
                        <span>&nbsp;Dating</span>
                        {this.state.datingBadge ? <span className="dating-badge" style={{
                            background: '#ff4040',
                            color: 'white',
                            borderRadius: '50%',
                            width: '16px',
                            height: '16px',
                            fontSize: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 'bold',
                            marginLeft: '6px',
                            marginRight: '3px'
                        }}>{this.state.datingBadge}</span> : ""}
                    </a> : ""}
                <div className="login-menu panel" onClick={(evt) => this.toggleShowProfile(this.app.userId, evt)}>
                    <i className="material-icons">person</i><span>&nbsp;Аккаунт&nbsp;</span>
                    {this.state.profileOpened && this.state.profileOpened && this.state.profileOpened === this.app.userId
                        ? (this.isLoggedIn() ?
                            <div className="profile-container" onClick={(evt) => evt.stopPropagation()}>
                                <div className="profile-container-tab panel"/>
                                <Profile app={app} userId={this.state.profileOpened}/>
                                <div className="profile-container-close panel"
                                     onClick={(evt) => this.toggleShowProfile(this.state.profileOpened, evt)}>Закрыть
                                </div>
                            </div> : <div className="profile-container" onClick={(evt) => evt.stopPropagation()}>
                                <div className="profile-container-tab panel"/>
                                <div className="profile-container-frame panel no-logged">
                                    <div className="login-discord-button" onClick={() => this.handleClickLogin()}>
                                        <img src="/common/media/Discord-Logo-White.png"/> Войти через Discord
                                    </div>
                                </div>
                                <div className="profile-container-close panel"
                                     onClick={(evt) => this.toggleShowProfile(this.state.profileOpened, evt)}>Закрыть
                                </div>
                            </div>)
                        : ""
                    }
                </div>
                {this.state.profileOpened && this.state.profileOpened !== this.app.userId ?
                    <div className="login-menu panel"
                         onClick={(evt) => this.toggleShowProfile(this.state.profileOpened, evt)}>
                        <i className="material-icons">person</i><span>&nbsp;{app.state.authUsers[this.state.profileOpened].name}&nbsp;</span>
                        {this.state.profileOpened
                            ? <div className="profile-container" onClick={(evt) => evt.stopPropagation()}>
                                <div className="profile-container-tab panel"/>
                                <Profile app={app} userId={this.state.profileOpened}/>
                                <div className="profile-container-close panel"
                                     onClick={(evt) => this.toggleShowProfile(this.state.profileOpened, evt)}>Закрыть
                                </div>
                            </div>
                            : ""
                        }
                    </div> : ""}
            </div>
            <input accept="image/*" style={{display: 'none'}} id="image-input" type="file"
                   onInput={evt => this.handleSetImage(evt)}/>
            {data.showWatermark ? <div className="watermark">{window.location.hostname}/bg</div> : ""}
            {(data.discordLink || data.voiceEnabled) ? (<AudioMode app={app}/>) : ""}
            <RoomModeDialog state={data} app={app}/>
            {data.chatEnabled ? <Chat state={data} app={app}/> : ""}
            <div className="achievement-toast-container">
                {this.state.achievements.map((it) => <div className="achievement-last"><Achievement data={it}/></div>)}
            </div>
            <div className="svg-effects" style={{display: 'none'}}>
                <svg xmlns="http://www.w3.org/2000/svg" version="1.1">
                    <defs>
                        <filter id="squiggly-0">
                            <feTurbulence id="turbulence" baseFrequency="0.02" numOctaves="3" result="noise" seed="0"/>
                            <feDisplacementMap id="displacement" in="SourceGraphic" in2="noise" scale="1"/>
                        </filter>
                        <filter id="squiggly-1">
                            <feTurbulence id="turbulence" baseFrequency="0.02" numOctaves="3" result="noise" seed="1"/>
                            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1"/>
                        </filter>

                        <filter id="squiggly-2">
                            <feTurbulence id="turbulence" baseFrequency="0.02" numOctaves="3" result="noise" seed="2"/>
                            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1"/>
                        </filter>
                        <filter id="squiggly-3">
                            <feTurbulence id="turbulence" baseFrequency="0.02" numOctaves="3" result="noise" seed="3"/>
                            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1"/>
                        </filter>

                        <filter id="squiggly-4">
                            <feTurbulence id="turbulence" baseFrequency="0.02" numOctaves="3" result="noise" seed="4"/>
                            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1"/>
                        </filter>
                    </defs>
                </svg>
            </div>
        </div>;
    }

    //<div title="Убрать кринж" className="disable-ng-cringe" onClick={() => this.disableCringe()}></div>
    disableCringe() {
        document.body.classList.add('no-ng-cringe');
        this.app.socket.emit("disable-cringe");
        localStorage[`cringe-disabled`] = 1;
    }

    static roomInit(app) {
        localStorage.userToken = localStorage.userToken || makeId();

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('redirectFromRu') === '1') {
            localStorage.redirectFromRu = '1';
            const newUrl = window.location.origin + window.location.pathname + window.location.hash;
            window.history.replaceState(null, '', newUrl);
        }

        const initArgs = {};
        const gameId = `${app.gameName}UserId`;
        if (!localStorage[gameId]) {
            while (!location.hash.includes("crowd=1") && !localStorage.userName)
                localStorage.userName = prompt("Твой ник");
            localStorage[gameId] = makeId();
        }
        if (!location.hash)
            history.replaceState(undefined, undefined, location.origin + location.pathname + "#" + makeId());
        else
            history.replaceState(undefined, undefined, location.origin + location.pathname + location.hash);
        if (localStorage.acceptDelete) {
            initArgs.acceptDelete = localStorage.acceptDelete;
            delete localStorage.acceptDelete;
        }
        if (location.hash.includes("masterKey"))
            initArgs.masterToken = location.hash.substr(location.hash.indexOf("masterKey=") + 10);
        initArgs.roomId = this.roomId = location.hash.substr(1, ~location.hash.indexOf("?")
            ? (location.hash.indexOf("?") - 1) : undefined);
        initArgs.userId = app.userId = localStorage[gameId];
        initArgs.userName = localStorage.userName;
        initArgs.token = app.userToken = localStorage.userToken;
        initArgs.wssToken = window.wssToken;
        initArgs.avatarId = localStorage.avatarId;
        app.socket = window.socket.of(location.pathname);
        app.roomId = initArgs.roomId;

        window.socket.on("disconnect", (event) => {
            if (event.reason === 'Wrong auth') {
                delete localStorage[gameId];
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            }
        });

        /* Reload instead of resuming if we came back to a restarted server:
           the page assets are versioned by its start time, so the client is stale. */
        app.socket.on("server-start-time", (time) => {
            if (window.serverStartTime && window.serverStartTime !== time)
                location.reload();
            else
                window.serverStartTime = time;
        });

        /* Deliberately a local, not localStorage: holding it in memory is what proves
           this page has been alive since a real load, and keeps it out of reach of a
           script that just copies values out of the browser's storage. */
        let reconnectToken;
        app.socket.on("reconnect-token", (token) => reconnectToken = token);

        /* Every game goes through roomInit, so this is the one place that has to
           know how to re-join: re-sending `init` makes the server treat us as a
           reconnect and push the full room state back. */
        if (window.socket.reconnect)
            window.socket.reconnect.setup({
                // Kill switch: `reconnect: false` in the server config restores the old behaviour
                enabled: window.reconnectEnabled !== false,
                onReconnect: () => {
                    // Name/avatar/token could have changed since the page was loaded
                    initArgs.userId = localStorage[gameId];
                    initArgs.userName = localStorage.userName;
                    initArgs.token = localStorage.userToken;
                    initArgs.avatarId = localStorage.avatarId;
                    initArgs.reconnectToken = reconnectToken;
                    app.socket.emit("init", initArgs);
                },
                onStatus: (status, info) => ConnectionStatus.show(status, info),
            });

        document.body.classList.add("first-period");
        if (localStorage[`last-visited-room-${app.gameName}`] !== app.roomId) {
            localStorage[`last-visited-room-${app.gameName}`] = app.roomId;
            document.body.classList.add("show-link-first-period");
            app.firstVisited = true;
            delete localStorage[`cringe-disabled`];
        }
        if (localStorage[`cringe-disabled`])
            document.body.classList.add("no-ng-cringe");
        setTimeout(() => {
            document.body.classList.remove("first-period");
            document.body.classList.remove("show-link-first-period");
        }, 12000);
        addEventListener('hashchange', () => location.reload());

        return initArgs;
    }

    static processPresenceData(state, presenceData) {
        const playersCount = state.onlinePlayers.filter((user) => {
            return !state.spectators.includes(user);
        }).length;
        window.presenceData = {
            smallImageKey: "meme-police",
            smallImageText: "meme-police.ru",
            details: presenceData.details,
            largeImageKey: presenceData.largeImageKey,
            state: `[${playersCount}/${presenceData.maxPlayers}] ${state.roomId}`,
            startTimestamp: state.createTime
        };
    }

    static processCommonRoom(state, prevState, presenceData, app) {
        if (localStorage.redirectFromRu === '1' && !localStorage.migratedGreetingShown) {
            localStorage.migratedGreetingShown = '1';
            popup.alert({content: `<div style="text-align: center;">
    <div style="font-size: 20px; margin-bottom: 10px;">Приветики! ✨</div>
    <div style="font-size: 18px; margin-bottom: 10px;">
        Сайт переехал на <b>meme-police.com</b><br>
        Так что придётся заново залогиниться тем, кто логинится
    </div>
    <div style="font-size: 16px; color: #888;">
        Старый домен (.ru) теперь будет автоматически перенаправлять сюда.
        Резервный сервер теперь на beta.meme-police.com
    </div>
</div>`});
        }
        
        if (app.firstVisited) {
            if (state.greetingMessage) {
                popup.alert({content: state.greetingMessage});
            }
            app.firstVisited = false;
        }
        CommonRoom.processPresenceData(state, presenceData);
        RoomModeDialog.processRoomModeDialog(state, prevState);
        AudioMode.processAudioMode(state, prevState);
        app.socket.on('change-tokens', (data) => {
            localStorage[`${app.gameName}UserId`] = data.id;
            localStorage.userToken = data.token;
            location.reload();
        });
    }

    sendImage(file, type, input) {
        const
            uri = "/common/upload-image",
            xhr = new XMLHttpRequest(),
            fd = new FormData(),
            fileSize = ((file.size / 1024) / 1024).toFixed(4); // MB
        const subscribeLevel = this.app.state.authUsers[this.app.userId]?.subscribeLevel;
        let exceedLimit;
        const showExceedLimitPopup = (content) => {
            exceedLimit = true;
            popup.alert({content})
        };

        if (fileSize >= 2 && subscribeLevel < 1)
            showExceedLimitPopup('Размер файла не должен превышать 2 мб. Повышенный лимит доступен с <a href="https://boosty.to/meme-police.ru" target="_blank">подпиской</a>')
        else if (fileSize >= 5 && subscribeLevel < 2)
            showExceedLimitPopup('Размер файла не должен превышать 5 мб. Лимит в 10мб досутпен с <a href="https://boosty.to/meme-police.ru" target="_blank">подпиской второго уровня</a>');
        else if (fileSize >= 10)
            showExceedLimitPopup('Размер файла не должен превышать 10 мб')
        if (exceedLimit)
            return;

        xhr.open("POST", uri, true);
        xhr.onreadystatechange = () => {
            if (xhr.readyState === 4 && xhr.status === 200) {
                if (type === 'avatar')
                    localStorage.avatarId = `${+new Date()}`;
                this.app.socket.emit("update-image", type, this.app.userToken, localStorage.avatarId);
                input.value = null;
            } else if (xhr.readyState === 4 && xhr.responseText === 'FILE_TYPE_ONLY_SUB')
                popup.alert({
                    content: 'Анимированные картинки можно ставить' +
                        ' только с <a href="https://boosty.to/meme-police.ru" target="_blank">подпиской</a>'
                });
            else if (xhr.readyState === 4 && xhr.status !== 200)
                popup.alert({content: 'Ошибка загрузки'});
        };
        fd.append("image", file);
        fd.append("kind", type);
        fd.append("userId", this.app.userId);
        fd.append("roomId", this.app.state.roomId);
        fd.append("userToken", this.app.userToken);
        xhr.send(fd);
    }

    handleSetImage(event) {
        const input = event.target;
        if (input.files && input.files[0])
            this.sendImage(input.files[0], this.setImageMode, input);
    }

    handleClickSetImage(type) {
        if (type === 'roomImage' && !this.app.state.konfaMode && !window.commonRoom.isSubscribed())
            this.subscribeOrKonfaPopup();
        else {
            if (type === 'avatar' && this.app.state.authUsers[this.app.state.userId]?.gameSettings?.syncAvatar)
                type = 'userAvatar';
            this.setImageMode = type;
            document.getElementById("image-input").click();
        }
    }

    pollDatingBadge() {
        if (this.props.state.datingEnabled && (this.app.userToken || localStorage.userToken)) {
            fetch(`/dating/api/badge`, {
                headers: {
                    'X-User-Token': this.app.userToken || localStorage.userToken
                }
            })
                .then(r => r.json())
                .then(data => {
                    const count = data.showBadge ? 1 : null;
                    if (count !== this.state.datingBadge)
                        this.setState({datingBadge: count});
                }).catch(() => {
            });
        }
    }

    componentDidMount() {
        setTimeout(() => this.pollDatingBadge(), 30000);
        const onAchievement = (achievement) => {
            this.state.achievements.push({
                toast: true,
                ...achievement
            });
            this.setState(this.state, () => {
                Toastify({
                    node: document.querySelector('.achievement-last div'),
                    escapeMarkup: false,
                    className: 'achievement-toast',
                    duration: 3000,
                }).showToast();
            });
        };
        this.app.socket.on('achievement-completed', onAchievement);
        this.app.socket.on('achievement-progress', onAchievement);
        this.app.socket.on('ban-confirm', ({userId}) => {
            popup.confirm({content: `Забанить ${this.getPlayerName(userId) || userId}? <br/><b>⚠️ Он больше не сможет зайти</b>`}, (evt) => {
                if (evt.proceed) this.app.socket.emit("ban-user-in-room", userId);
            });
        });
    }
}

class Profile extends React.Component {
    constructor() {
        super();
        this.state = {profileTab: 'profile', showSettings: !parseInt(localStorage.hideProfileSettings)};
    }

    editName() {
        popup.prompt({content: "Новое имя", value: this.state.profile.name || ""}, (evt) => {
            if (evt.proceed && evt.input_value.trim()) {
                this.app.socket.emit("change-profile-name", evt.input_value.trim());
                localStorage.userName = evt.input_value.trim();
            }
        });
    }

    editBio() {
        popup.textarea({content: "Информация о себе", value: this.state.profile.bio || ""}, (evt) => {
            if (evt.proceed) {
                this.app.socket.emit("change-bio", evt.input_value.trim());
            }
        });
    }

    addComment() {
        if (!window.commonRoom.isLoggedIn())
            window.commonRoom.login();
        popup.textarea({content: "Комментарий", value: ""}, (evt) => {
            if (evt.proceed && evt.input_value.trim()) {
                this.app.socket.emit("add-comment", this.state.profile._id, evt.input_value.trim());
            }
        });
    }

    removeComment(profileId, commentId) {
        popup.confirm({content: "Удалить комментарий?"}, (evt) => evt.proceed && this.app.socket.emit("remove-comment", profileId, commentId));
    }

    toggleSettings() {
        this.state.showSettings = !this.state.showSettings;
        localStorage.hideProfileSettings = this.state.showSettings ? 0 : 1;
        this.setState(this.state);
    }

    onSettingToggle(setting) {
        if (['nameColor', 'nameGlowColor', 'codenamesIcon', 'profileImage'].includes(setting) && !window.commonRoom.isSubscribed())
            window.commonRoom.subscribePopup();
        else if (setting === 'nameEffect' && !window.commonRoom.isSubscribed(2))
            window.commonRoom.subscribePopup2();
        else
            this.app.socket.emit('toggle-profile-setting', setting);
    }

    onSettingChange(event, setting) {
        this.debouncedEmit('set-profile-setting-value', setting, event.target.value);
    }

    debouncedEmit(...args) {
        clearTimeout(this.debouncedEmitTimer);
        this.debouncedEmitTimer = setTimeout(() => {
            this.app.socket.emit(...args);
        }, 500);
    }

    toggleExpandAchievements() {
        this.state.expandAchievements = !this.state.expandAchievements;
        this.setState(this.state);
    }

    handleClickSetImage(type) {
        if (['codenamesIcon', 'profileImage'].includes(type) && !window.commonRoom.isSubscribed())
            window.commonRoom.subscribePopup();
        else
            window.commonRoom.handleClickSetImage(type);
    }

    handleClickSetNameEffect() {
        if (window.commonRoom.isSubscribed(2)) {
            let nameEffect = (this.app.state.authUsers[this.app.userId]?.gameSettings?.nameEffect || 0) + 1;
            if (nameEffect > 5)
                nameEffect = 1;
            this.app.socket.emit('set-profile-setting-value', 'nameEffect', nameEffect);
        } else window.commonRoom.subscribePopup2();
    }

    handleClickLogout() {
        window.commonRoom.toggleShowProfile(null);
        this.app.socket.emit('logout-auth', localStorage.userToken);
    }

    render() {
        this.app = this.props.app;
        const profile = this.state.profile;
        if (profile && !profile._id) {
            return <div className="profile-container-frame panel">
                <div className="profile-content">
                    <div className="profile-loading">Профиль не найден</div>
                </div>
            </div>;
        }
        const authId = this.app.state.authUsers[this.app.userId]?._id;
        const isUser = profile?._id === authId;
        const badgesResolved = profile?.badgesResolved || [];
        const maxSub = badgesResolved
            .filter(b => b.id.startsWith('sub'))
            .reduce((max, b) => Math.max(max, parseInt(b.id.replace('sub', '')) || 0), 0);

        const targetSubLevel = profile?.subscribeLevel || maxSub;

        const badges = badgesResolved
            .filter(it => !it.id.startsWith('sub') || it.id === 'sub' + targetSubLevel)
            .map((it) => {
                const isSub = it.id.startsWith('sub');
                const inactive = isSub && profile.subscribeLevel !== parseInt(it.id.replace('sub', ''));
                let title = it.title;
                if (inactive)
                    title += ' (бывший)';
                return {
                    inactive,
                    icon: it.icon,
                    title,
                };
            })
        const gameSettings = (isUser ? this.app.state.authUsers[this.app.userId]?.gameSettings : profile?.gameSettings) || {};
        return <div className="profile-container-frame panel">
            <div className="profile-content">
                {this.state.profile ?
                    <div className={cs('profile-wrap', {
                        hasBackground: !!gameSettings.profileImage
                    })} style={{
                        background: !!gameSettings.profileImage
                            ? `top center / contain url(/user-data/users/${profile._id}/profileImage.png?${gameSettings.profileImage})`
                            : 'inherit',
                    }}>
                        <div className="profile-main">
                            {isUser ? <i className="material-icons profile-edit-button profile-logout"
                                         onClick={() => this.handleClickLogout()}>logout</i> : ''}
                            <div className="profile-avatar-wrap">
                                <img className="profile-avatar"
                                     src={`/user-data/users/${profile._id}/avatar.png?${profile.avatar}`}/>
                                {isUser ?
                                    <div className="profile-avatar-edit">
                                        <i className="material-icons profile-edit-button profile-name-edit"
                                           onClick={() => this.handleClickSetImage('userAvatar')}>edit</i>
                                    </div> : ''}
                            </div>

                            <div className="profile-main-col">
                                <div className="profile-name">
                                    <PlayerName name={profile.name} gameSettings={gameSettings}/>
                                    {isUser ?
                                        <i className="material-icons profile-edit-button profile-name-edit"
                                           onClick={() => this.editName()}>edit</i> : ''} </div>
                                <div className="profile-bio">
                                    <span dangerouslySetInnerHTML={{
                                        __html:
                                            profile.bio
                                                ? linkifyStr(profile.bio.replace(/>/g, '&gt;').replace(/</g, '&lt;'), {
                                                    target: '_blank',
                                                    truncate: 42
                                                })
                                                : 'Информация отсутствует'
                                    }}/>&nbsp;
                                    {isUser ?
                                        <i className="material-icons profile-edit-button profile-name-edit"
                                           onClick={() => this.editBio()}>edit</i> : ''}</div>
                            </div>
                        </div>

                        <div className="profile-extra">
                            {isUser ?
                                <div className="profile-settings">
                                    <span className="profile-settings-button"
                                          onClick={() => this.toggleSettings('settings')}>
                                        <i className="material-icons">settings</i>
                                        Настройки
                                        <i className="material-icons">{this.state.showSettings ? 'expand_less' : 'expand_more'}</i>
                                    </span>
                                    {this.state.showSettings && isUser ? <div className="profile-settings-content">
                                        <div className="profile-settings-item">
                                            <input className="toggle" type="checkbox" id="s5"
                                                   checked={!!gameSettings.syncName}
                                                   onChange={(e) => this.onSettingToggle('syncName')}/>
                                            <label htmlFor="s5">Использовать в играх никнейм профиля</label>
                                        </div>
                                        <div className="profile-settings-item">
                                            <input className="toggle" type="checkbox" id="s6"
                                                   checked={!!gameSettings.syncAvatar}
                                                   onChange={(e) => this.onSettingToggle('syncAvatar')}/>
                                            <label htmlFor="s6">Использовать в играх аватарку профиля</label>
                                        </div>
                                        <div className="profile-settings-item">
                                            <input className="toggle" type="checkbox" id="s7"
                                                   checked={!!gameSettings.hideComments}
                                                   onChange={(e) => this.onSettingToggle('hideComments')}/>
                                            <label htmlFor="s6">Скрыть комментарии</label>
                                        </div>
                                        <div className="profile-settings-item">
                                            <i title="Доступно с подпиской"
                                               className="material-icons profile-premium-icon">workspace_premium</i>
                                            <input className="toggle" type="checkbox" id="s1"
                                                   checked={!!gameSettings.nameColor}
                                                   onChange={() => this.onSettingToggle('nameColor')}/>
                                            <label htmlFor="s1">Цвет никнейма</label>
                                            <input type="color" disabled={!gameSettings.nameColor}
                                                   value={gameSettings.nameColor || '#ffffff'}
                                                   onChange={(e) => this.onSettingChange(e, 'nameColor')}/>
                                        </div>
                                        <div className="profile-settings-item">
                                            <i title="Доступно с подпиской"
                                               className="material-icons profile-premium-icon">workspace_premium</i>
                                            <input className="toggle" type="checkbox" id="s1"
                                                   checked={!!gameSettings.nameGlowColor}
                                                   onChange={() => this.onSettingToggle('nameGlowColor')}/>
                                            <label htmlFor="s1">Цвет свечения никнейма</label>
                                            <input type="color" disabled={!gameSettings.nameGlowColor}
                                                   value={gameSettings.nameGlowColor || '#ffffff'}
                                                   onChange={(e) => this.onSettingChange(e, 'nameGlowColor')}/>
                                        </div>
                                        <div className="profile-settings-item">
                                            <i title="Доступно с подпиской"
                                               className="material-icons profile-premium-icon">workspace_premium</i>
                                            <input className="toggle" type="checkbox" id="s3"
                                                   checked={!!gameSettings.codenamesIcon}
                                                   onChange={(e) => this.onSettingToggle('codenamesIcon')}/>
                                            <label htmlFor="s3">Иконка в кружочке Codenames</label>
                                            <i className="material-icons profile-upload-image"
                                               onClick={() => gameSettings.codenamesIcon && this.handleClickSetImage('codenamesIcon')}>upload_file</i>
                                        </div>
                                        <div className="profile-settings-item">
                                            <i title="Доступно с подпиской"
                                               className="material-icons profile-premium-icon">workspace_premium</i>
                                            <input className="toggle" type="checkbox" id="s4"
                                                   checked={!!gameSettings.profileImage}
                                                   onChange={(e) => this.onSettingToggle('profileImage')}/>
                                            <label htmlFor="s4">Картинка профиля</label>
                                            <i className="material-icons profile-upload-image"
                                               onClick={() => gameSettings.profileImage && this.handleClickSetImage('profileImage')}>upload_file</i>
                                        </div>
                                        <div className="profile-settings-item">
                                            <i title="Доступно с подпиской 2-го уровня"
                                               className="material-icons profile-premium-icon second-tier">workspace_premium</i>
                                            <input className="toggle" type="checkbox" id="s4"
                                                   checked={!!gameSettings.nameEffect}
                                                   onChange={(e) => this.onSettingToggle('nameEffect')}/>
                                            <label htmlFor="s4">Эффект никнейма</label>
                                            <i className="material-icons profile-upload-image"
                                               onClick={() => this.handleClickSetNameEffect()}>flare</i>
                                        </div>
                                    </div> : ''}
                                </div> : ''}
                            {profile.badgesResolved.length ? (<div className="badges">
                                <div className="profile-section-title">Значки</div>
                                <div className="profile-badges-list">
                                    {badges.map((badge) =>
                                        <img className={cs("profile-badge", {
                                            inactive: badge.inactive
                                        })}
                                             src={`/common/media/badge//${badge.icon}`}
                                             title={badge.title}/>)}
                                </div>
                            </div>) : ""}
                            <div className="profile-games">
                                <div className="profile-section-title">Игры</div>
                                <div className="profile-games-list">
                                    {profile.gameStatsResolved.map((gameStats) => (gameStats.time ?
                                        <div className="profile-game-time-item">
                                            <img className="profile-game-icon" src={`${gameStats.icon}`}/>
                                            <div>
                                                <div className='profile-game-title'>{gameStats.title}</div>
                                                <div
                                                    className='profile-game-time'>{Math.max((gameStats.time / 60), 0.1).toFixed(1)} ч.
                                                    всего
                                                </div>
                                            </div>
                                        </div> : ""))}

                                </div>
                            </div>
                            <div className={cs("achievements", {
                                expanded: this.state.expandAchievements
                            })}>
                                <div className="profile-section-title">Достижения</div>
                                <div className="profile-achievements-list">
                                    {profile.achievementsResolved.filter((it) => !it.countFrom || it.countFrom <= it.count)
                                        .map((achievement) => <Achievement
                                            data={achievement}/>)}
                                </div>
                                <div className="profile-achievement-expand-button-wrap">
                                    <div className="profile-achievement-expand-button"
                                         onClick={() => this.toggleExpandAchievements()}>
                                        {!this.state.expandAchievements ? 'Показать все' : 'Свернуть'}
                                    </div>
                                </div>
                            </div>
                            {!gameSettings.hideComments ? <div className="profile-comments">
                                <div className="profile-section-title">Комментарии
                                    <span className="profile-add-comment" onClick={() => this.addComment()}>
                                        <i className="material-icons profile-edit-button profile-name-edit">add_comment</i>
                                        &nbsp;Добавить
                                    </span>
                                </div>
                                {!(profile.comments?.length) ?
                                    <div className="comments-placeholder">Ничего нет</div> : ''}
                                {profile.comments?.map((comment) => {
                                    let date = comment.date;
                                    if (new Date(date) > new Date())
                                        date = new Date();
                                    return (<div className="profile-comment">
                                        <img
                                            onClick={() => this.loadProfile(comment.author)}
                                            src={`/user-data/users/${comment.author}/avatar.png?${profile.miniProfiles[comment.author]?.avatar}`}
                                            className="profile-comment-avatar"/>
                                        <div className="profile-comment-content">
                                            <div className="profile-comment-info">
                                                <span
                                                    onClick={() => this.loadProfile(comment.author)}
                                                    className="profile-comment-author">{profile.miniProfiles[comment.author]?.name || comment.author}</span>
                                                <span
                                                    className="profile-comment-time">{moment(date).fromNow()}</span>
                                                {(isUser || comment.author === authId) ?
                                                    <i className="material-icons profile-edit-button"
                                                       onClick={() => this.removeComment(profile?._id, comment.id)}>delete</i> : ''}

                                            </div>
                                            <div className="profile-comment-text">{comment.text}</div>

                                        </div>
                                    </div>)
                                })}
                            </div> : ''}
                        </div>
                    </div>
                    : (<div className="profile-loading">Загрузка...</div>)}
            </div>
        </div>;
    }

    componentDidMount() {
        const userAuthId = this.props.authId || this.app.state.authUsers[this.props.userId]?._id || this.props.userId;
        this.profileToLoad = userAuthId;
        this.app.socket.emit('get-profile', userAuthId);
        if (!this.loadHandlerSet) {
            this.loadHandlerSet = true;
            this.app.socket.on('profile', (data) => {
                if (data.id === this.profileToLoad) {
                    this.setState({profile: data.profile});
                    document.getElementsByClassName('profile-content')[0]?.scrollTo(0, 0);
                }
            });
        }
    }

    componentWillUpdate(nextProps, nextState) {
        if (this.props.userId !== nextProps.userId || this.props.authId !== nextProps.authId)
            this.loadProfile(nextProps.authId || this.app.state.authUsers[nextProps.userId]?._id || nextProps.userId);
    }

    loadProfile(id) {
        this.profileToLoad = id;
        this.app.socket.emit('get-profile', id);
    }
}

class Achievement extends React.Component {
    render() {
        const achievement = this.props.data;
        const iconList = [`/common/media/achievement.png`];
        if (achievement.icon)
            iconList.push(`/common/media/achievement/${achievement.icon}`);
        else
            iconList.push(achievement.gameIcon);
        const achievementColor = `rgb(${achievement.color.join(',')})`;
        const achievementColorAlpha = `rgba(${achievement.color.join(',')}, 0.3)`;
        const achievementStyle = {
            background: `${iconList.map((it) => `center / contain no-repeat url(${it})`).join(', ')}, 
            linear-gradient(45deg, ${achievementColorAlpha}, ${achievementColorAlpha})`,
            'box-shadow': `0 0 4px 1px ${achievementColor}`
        };
        let title = `Есть у ${achievement.rarity
            ? (achievement.rarity >= 0.1 ? achievement.rarity.toFixed(1) : '<0.1')
            : 0}% из игроков`;
        if (achievement.date)
            title = `${title} / Получено ${moment(achievement.date).format('L')}`
        return <div
            title={title}
            className={cs("profile-achievement", {
                unlocked: achievement.completion,
            })}>
            <div className="profile-achievement-icon" style={achievementStyle}/>
            <div className="profile-achievement-content">
                <div className='profile-achievement-title'>{(!achievement.toast || achievement.completion !== 1)
                    ? achievement.name
                    : <><strong
                        className="achievement-player">{window.commonRoom.getPlayerName(achievement.userId)}</strong> получает
                        достижение <strong style={{
                            color: achievementColor
                        }} className="achievement-name">{achievement.name}</strong></>
                }</div>
                {achievement.description ?
                    <div
                        className='profile-achievement-description'>{achievement.description}</div> : ''}
                {achievement.countTo && achievement.completion !== 1 ?
                    <div className="profile-achievement-track-wrap">
                        <div className='profile-achievement-track'
                             style={{width: `${achievement.completion * 100}%`}}/>
                        <div className='profile-achievement-track-counter'>
                            {Math.ceil(achievement.completion * achievement.countTo) || 0} / {achievement.countTo}
                        </div>
                    </div> : ''}
            </div>
        </div>
    }
}

class AudioMode extends React.Component {
    constructor() {
        super();
        this.producers = {};
        this.userVoiceC = {};
        this.harks = {};
        this.state = {media: {audioTracks: {}}};
        this.noiseGateThreshold = localStorage.noiseGateThreshold ? parseInt(localStorage.noiseGateThreshold) : -50;
    }

    componentWillUnmount() {
        this.render();
    }

    render() {
        this.app = this.props.app;
        this.appState = this.app.state;
        this.appState.userVoiceC = this.appState.userVoiceC || {};

        [...new Set([...Object.keys(this.userVoiceC), ...Object.keys(this.appState.userVoiceC)])].forEach((user) => {
            if (this.producers[user] && this.userVoiceC[user] !== this.appState.userVoiceC[user])
                if (this.appState.userVoiceC[user])
                    this.producers[user].resume();
                else
                    this.producers[user].pause();
        });

        this.userVoiceC = {...this.appState.userVoiceC};
        const data = this.appState;

        if (data.needEnableMediaRoom && !this.mediaRoomEnabled) {
            data.needEnableMediaRoom = false;
            this.enableMediaSoup();
        }

        if (data.needDisableMediaRoom && this.mediaRoomEnabled) {
            data.needDisableMediaRoom = false;
            this.disableMediaSoup();
        }

        return <div className={cs("audio-mode panel", {discord: !!data.discordLink, voice: !data.discordLink})}
                    onMouseEnter={() => this.setMeterVisible(true)}
                    onMouseLeave={() => this.setMeterVisible(false)}>
            <i onClick={() => this.toggleMuteSelf()}
               title={!data.discordLink ? (data.userMuteSelf && data.userMuteSelf[data.userId]
                   ? "Включить микрофон" : "Выключить микрофон") : ""}
               className={cs("material-icons", {
                   voiceInactive: !(data.userVoice && data.userVoice[data.userId])
               })}>{data.discordLink
                ? "headset_mic"
                : data.userMuteSelf && data.userMuteSelf[data.userId]
                    ? "mic_off"
                    : "mic"}</i>
            <div className="audio-link">
                {data.discordLink
                    ? <a className="discord-link" target="_blank"
                         href={`
        https://discord.gg/${data.discordLink}`}>{`https://discord.gg/${data.discordLink}`}</a>
                    :
                    ""
                }

            </div>
            <div className="audio-settings">
                {!data.discordLink
                    ? <div>
                        <div className="audio-meter-title">Порог активации микрофона&nbsp;
                            <i className="material-icons audio-meter-title-help"
                               title="Порог должен был выше уровня фонового шума, но ниже громкости вашего голоса">help</i>
                        </div>
                        <div className="audio-meter">
                            <div className="meter-track"/>
                            <input className="noise-gate-slider" type="range" defaultValue={this.noiseGateThreshold}
                                   min="-100"
                                   max="0"
                                   onChange={(evt) =>
                                       this.handleNoiseGateThresholdChange(evt.target.valueAsNumber)}/>
                        </div>
                    </div>
                    : ""}
            </div>
            <div className="audio-elems">
                {this.state.media && Object.keys(this.state.media.audioTracks)
                    .filter((user) => user != data.userId)
                    .map((user) => (
                        <UserAudio audioTrack={this.state.media.audioTracks[user]}/>
                    ))}
            </div>
        </div>;
    }

    handleNoiseGateThresholdChange(value) {
        if (this.noisegateProcessor)
            this.noisegateProcessor.threshold = value;
        this.noiseGateThreshold = localStorage.noiseGateThreshold = value;
    }

    toggleMuteSelf() {
        this.app.socket.emit("toggle-mute-self");
    }

    async publishUserAudio() {
        this.unpublishUserAudio();
        try {
            const source = await navigator.mediaDevices
                .getUserMedia({audio: true});
            this.userSource = source;
            const noiseGatedTrack = this.applyNoiseGate(source);
            this.producers[this.appState.userId] = await this.mediaRoom.sendAudio(noiseGatedTrack);
            if (!this.appState.userVoiceC[this.appState.userId])
                this.producers[this.appState.userId].pause();
            this.handleSpeakerDetection(source.getAudioTracks()[0], this.appState.userId, true, noiseGatedTrack);
        } catch (e) {
            console.error("publish audio error", e);
            this.alertMediaSoupError("publish audio error", e.message);
            localStorage.audioEnabled = 0;
        }
        this.updateAppState();
    }

    applyNoiseGate(track) {
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(track);
        this.noisegateProcessor = new NoiseGate(audioCtx, {
            channelCount: 1,
            attack: 0.1,
            release: 0.1,
            threshold: this.noiseGateThreshold
        });
        const streamOutput = audioCtx.createMediaStreamDestination();
        source.connect(this.noisegateProcessor.input);
        this.noisegateProcessor.output.connect(streamOutput);
        return streamOutput.stream.getAudioTracks()[0];
    }

    handleSpeakerDetection(track, user, self, noiseGatedTrack) {
        if (this.selfTrackHandled)
            this.handleSpeakerDetectionInner(track, user, self, noiseGatedTrack);
        else {
            if (user === this.appState.userId) {
                this.selfTrackHandled = true;
                this.handleSpeakerDetectionInner(noiseGatedTrack, user);
                this.handleSpeakerVolumeChange(track);
                (this.otherTracks || []).forEach((it) => {
                    this.handleSpeakerDetectionInner(it.track, it.user);
                });
            } else {
                this.otherTracks = this.otherTracks || [];
                this.otherTracks.push({track, user});
            }
        }
    }

    handleSpeakerDetectionInner(track, user) {
        const stream = new MediaStream();
        stream.addTrack(track);
        const speechEvents = this.harks[user] = hark(stream, {threshold: -100, interval: 30});
        speechEvents.on("speaking", () => {
            this.setSpeaking(user, true);
        });
        speechEvents.on("stopped_speaking", () => {
            this.setSpeaking(user, false);
        });
    }

    handleSpeakerVolumeChange(track) {
        const stream = new MediaStream();
        stream.addTrack(track);
        const speechEvents = this.harks["self_track"] = hark(stream, {threshold: -100, interval: 30});
        speechEvents.on("volume_change", (volume) => {
            this.setSelfVolume(volume);
        });
    }

    setSpeaking(user, state) {
        if (!state || (this.appState.userVoice[user] && !this.appState.userMuteSelf[user])) {
            const playerNode = document.querySelector(`.user-audio-marker.user-audio-marker-${user}`);
            if (playerNode)
                playerNode.classList[state ? "add" : "remove"]("speaking");
        }
    }

    setMeterVisible(state) {
        this.meterVisible = state;
    }

    setSelfVolume(volume) {
        if (this.meterVisible) {
            const trackNode = document.querySelector(".meter-track");
            if (trackNode)
                trackNode.style.width = `${volume + 100}%`;
        }
    }

    unpublishUserAudio() {
        if (this.userSource && this.userSource.getTracks()[0])
            this.userSource.getTracks()[0].stop();
        if (this.harks["self_track"]) {
            this.harks["self_track"].stop();
            delete this.harks["self_track"];
        }
        if (this.producers[this.appState.userId]) {
            this.producers[this.appState.userId].close();
            delete this.producers[this.appState.userId];
            this.updateState();
        }
    }

    updateState() {
        this.setState(Object.assign({}, this.state));
    }

    updateAppState() {
        this.app.setState(Object.assign({}, this.app.state));
    }

    alertMediaSoupError(type, reason) {
        popup.alert({content: `mediasoup error - ${type} - ${reason}`});
    }

    enableMediaSoup() {
        const roomId = `${this.app.gameName}-${this.app.roomId}-audio`;
        this.mediaRoomEnabled = true;
        this.mediaRoom = new window.MediaSoupRoom(
            `wss://beta.meme-police.com:2345/?roomId=${roomId}&userId=${this.appState.userId}`
        );
        this.mediaRoom.join();
        setTimeout(() => {
            this.publishUserAudio();
        }, 1000);

        this.mediaRoom.on("error", (type, reason) => {
            this.alertMediaSoupError(type, reason);
        });

        this.mediaRoom.on("@peerClosed", ({peerId}) => {
            delete this.state.media.audioTracks[peerId];
            if (this.harks[peerId]) {
                this.harks[peerId].stop();
                delete this.harks[peerId];
            }
            if (this.producers[peerId])
                this.producers[peerId].close();
            this.updateState();
        });

        this.mediaRoom.on("@consumer", async consumer => {
            const {
                appData: {peerId},
                track
            } = consumer;
            console.log("receive consumer", consumer);

            if (track.kind === "audio") {
                this.state.media.audioTracks[peerId] = track;
                this.producers[peerId] = consumer;
                this.handleSpeakerDetection(track, peerId);
                if (!this.appState.userVoiceC[peerId])
                    this.producers[peerId].pause();
            }
            this.updateState();
        });
    }

    disableMediaSoup() {
        this.mediaRoomEnabled = false;
        this.appState.needDisableMediaRoom = false;
        this.unpublishUserAudio();
        this.mediaRoom.peer.close();
    }

    static processAudioMode(state, prevState) {
        if (state.voiceEnabled && !prevState.voiceEnabled)
            state.needEnableMediaRoom = true;
        else if (!state.voiceEnabled && prevState.voiceEnabled)
            state.needDisableMediaRoom = true;
        Object.keys(state.userVoice || {}).forEach((user) => {
            state.userMuteSelf = state.userMuteSelf || {};
            state.userVoiceC = state.userVoiceC || {};
            state.userVoiceC[user] = state.userVoice[user] && !state.userMuteSelf[user];
        });
    }
}

class UserAudio extends React.Component {
    render() {
        return <audio
            ref='audioElem'
            controls={false}
            className="audio"
        />
    }

    componentDidMount() {
        this._processState();
    }

    componentDidUpdate() {
        this._processState();
    }

    async _processState() {
        const {audioElem} = this.refs;
        const {audioTrack, paused} = this.props;
        this._setTrack(audioTrack);
        if (audioElem.paused !== paused) {
            if (paused)
                audioElem.pause();
            else {
                try {
                    await audioElem.play();
                } catch (e) {
                    console.log("EEE", e);
                }
            }
        }
    }

    _setTrack(audioTrack) {
        if (this._audioTrack === audioTrack)
            return;
        this._audioTrack = audioTrack;
        const {audioElem} = this.refs;
        const stream = new MediaStream;

        stream.addTrack(audioTrack);
        audioElem.srcObject = stream;
        audioElem.play()
            .catch((error) => console.warn('audioElem.play() failed:%o', error));
        let deafened = false;
        window.addEventListener('self-deafen', () => {
            if (!deafened) {
                deafened = true;
                audioElem.volume = 0;
            }
        });
        window.addEventListener('self-undeafen', () => {
            if (deafened) {
                deafened = false;
                audioElem.volume = 1;
            }
        });

    }
}

class UserAudioMarker extends React.Component {
    render() {
        const
            data = this.props.data,
            user = this.props.user;
        return <div
            className={cs("user-audio-marker-elem", ...UserAudioMarker.getAudioMarkerClasses(data, user))}
        />;
    }

    static getAudioMarkerClasses(data, user) {
        const
            hasVoice = data.voiceEnabled && data.userVoice && data.userVoice[user],
            muted = data.voiceEnabled && data.userMuteSelf && data.userMuteSelf[user];
        return ["user-audio-marker", `user-audio-marker-${user}`, {
            muted,
            hasVoice
        }];
    }
}

class RoomModeDialog extends React.Component {
    constructor(props) {
        super(props);
        this.state = {};
    }

    componentDidMount() {
        if (this.appState.roomImage)
            this.setRoomImage(this.appState.roomImage);

        this.app.socket.on('state', (state) => {
            if (state.roomImage !== this.roomImage) {
                this.setRoomImage(state.roomImage);
            }
        });
        this.inited = true;
    }

    setRoomImage(image) {
        this.roomImage = image;
        if (image) {
            document.body.style.background = `url(/user-data/rooms/${this.appState.roomId}.png?${image}) center`;
            document.body.classList.add('has-room-image');
        } else
            document.body.style.background = null;
    }

    handleClickSetRoomImage() {
        window.commonRoom.handleClickSetImage('roomImage');
    }

    render() {
        this.voiceChatAvailable = true;
        this.appState = this.props.state;
        this.app = this.props.app;
        const
            data = this.props.state,
            isHost = data.userId === data.hostId;
        if (!this.state.inited && this.appState.inited) {
            const {chatEnabled, chatOnlyPlayers, publicMode, voiceEnabled, discordLink, publicDescription, managedVoice} = this.appState;
            this.state = {
                chatEnabled,
                chatOnlyPlayers,
                publicMode,
                voiceEnabled,
                discordLink,
                publicDescription,
                managedVoice, ...this.state
            };
            if (this.state.publicMode === undefined) {
                this.state.publicMode = false;
                this.state.chatEnabled = false;
                this.state.chatOnlyPlayers = false;
            }
        }
        return (isHost && this.appState.showRoomModeDialog) ? <div className="room-mode-dialog">
            <div className="room-mode-dialog-container panel">
                <div className="room-mode-title">Настройки комнаты</div>
                <div className="room-mode-select-items">
                    <div className="room-mode-select-item" onClick={() => this.setRoomMode({
                        publicMode: false
                    })}>
                        <i className="material-icons room-mode-select-option">{
                            this.state.publicMode !== true
                                ? "radio_button_checked"
                                : "radio_button_unchecked"
                        }</i>
                        <span className="room-mode-select-item-title">&nbsp;Доступ по ссылке</span>
                        <div className="room-mode-description">
                            Используйте этот режим, если играете с компанией друзей или в своей конференции.
                            Никто не зайдёт в вашу игру, кроме тех, у кого есть на неё ссылка.
                        </div>
                    </div>
                    <div className="room-mode-select-item" onClick={() => this.setRoomMode({
                        publicMode: true
                    })}>
                        <i className="material-icons room-mode-select-option">{
                            this.state.publicMode
                                ? "radio_button_checked"
                                : "radio_button_unchecked"
                        }</i>
                        <span className="room-mode-select-item-title">&nbsp;Публичная комната&nbsp;
                            <i className="material-icons room-mode-select-option">fiber_new</i></span>
                        <div className="room-mode-description">
                            Используйте этот режим, чтобы найти новых игроков.
                            Ссылка на игру будет опубликована на главной странице (<a target="_blank"
                                                                                      href="https://meme-police.ru/bg">https://meme-police.ru/bg</a>)
                            {this.state.publicMode
                                ? <input maxLength="40"
                                         className="public-room-description text-color"
                                         ref="publicDescription"
                                         defaultValue={data.publicDescription}
                                         placeholder="Описание комнаты (необязательно)"/> : ""}

                        </div>
                    </div>
                </div>
                <div className="voice-mode-select-items">
                    <div className="voice-mode-select-item" onClick={() => this.setRoomMode({
                        voiceEnabled: false
                    })}>
                        <i className="material-icons room-mode-select-option">{
                            !this.state.voiceEnabled
                                ? "radio_button_checked"
                                : "radio_button_unchecked"
                        }</i>
                        <span className="room-mode-select-item-title">&nbsp;Голосовой чат Discord</span>
                        <div className="room-mode-description">
                            В режиме публичной комнаты придётся указать ссылку на Discord-конференцию
                            {this.state.publicMode && !this.state.voiceEnabled
                                ? <input maxLength="40"
                                         className="discord-link-input text-color"
                                         ref="discordLink"
                                         defaultValue={data.discordLink ? `https://discord.gg/${data.discordLink}` : ""}
                                         placeholder="Ссылка на Discord-конференцию"/> : ""}
                        </div>
                    </div>
                    <div className={cs("voice-mode-select-item", {
                        disabled: !this.voiceChatAvailable
                    })} onClick={() => this.voiceChatAvailable && this.setRoomMode({
                        voiceEnabled: true
                    })}>
                        <i className="material-icons room-mode-select-option">{
                            this.state.voiceEnabled
                                ? "radio_button_checked"
                                : "radio_button_unchecked"
                        }</i>
                        <span className="room-mode-select-item-title">&nbsp;Встроенный голосовой чат (beta)</span>
                        <div className="room-mode-description">
                            Без регистрации и SMS
                        </div>
                    </div>
                    {this.state.voiceEnabled
                        ? <div className="voice-chat-mode-select">
                            <div className="voice-chat-mode-select-item" onClick={() => this.setRoomMode({
                                managedVoice: true
                            })}>
                                <i className="material-icons voice-chat-mode-select-option">{
                                    this.state.managedVoice
                                        ? "radio_button_checked"
                                        : "radio_button_unchecked"
                                }</i>
                                <span className="voice-chat-mode-select-item-title">&nbsp;Управляемый</span>
                                <div className="voice-chat-mode-description">
                                    Можно говорить только в свой ход
                                </div>
                            </div>
                            <div className="voice-chat-mode-select-item"
                                 onClick={() => this.voiceChatAvailable && this.setRoomMode({
                                     managedVoice: false
                                 })}>
                                <i className="material-icons voice-chat-mode-select-option">{
                                    !this.state.managedVoice
                                        ? "radio_button_checked"
                                        : "radio_button_unchecked"
                                }</i>
                                <span
                                    className="voice-chat-mode-select-item-title">&nbsp;Свободный</span>
                                <div className="voice-chat-mode-description">
                                    Все говорят когда хотят
                                </div>
                            </div>
                        </div>
                        : ""}
                </div>
                <div className="text-chat-enabled" style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", cursor: "pointer" }}
                         onClick={() => this.setRoomMode({
                             chatEnabled: !this.state.chatEnabled
                         })}>
                        <i className="material-icons voice-chat-mode-select-option">{
                            this.state.chatEnabled
                                ? "check_box"
                                : "check_box_outline_blank"
                        }</i>
                        <span
                            className="voice-chat-mode-select-item-title">&nbsp;Текстовый чат</span>
                    </div>
                    {this.state.chatEnabled && (
                        <span className="chat-only-players-toggle"
                              onClick={() => this.setRoomMode({
                                  chatOnlyPlayers: !this.state.chatOnlyPlayers
                              })}>
                            {this.state.chatOnlyPlayers ? "Для игроков" : "Для всех"}
                        </span>
                    )}
                </div>
                <div className="set-room-image"
                     onClick={() => this.handleClickSetRoomImage()}>
                    <i className="material-icons">image</i>
                    <span className="voice-chat-mode-select-item-title">&nbsp;Установить фон комнаты&nbsp;<i
                        className="material-icons">fiber_new</i></span>
                </div>
                <div className="room-mode-dialog-ok panel-accent" onClick={() => this.saveRoomMode()}>
                    Готово
                </div>
            </div>
        </div> : "";
    }

    setRoomMode(state) {
        Object.assign(this.state, state);
        this.setState(this.state);
    }

    saveRoomMode() {
        this.state.publicDescription = this.refs.publicDescription && this.refs.publicDescription.value;
        if (this.refs.discordLink) {
            this.refs.discordLink.value = this.refs.discordLink.value.trim();
            const match = this.refs.discordLink.value.match(/^https:\/\/discord.gg\/(\w+?)$/);
            if (match && match[1]) {
                this.state.discordLink = match[1];
                this.app.socket.emit("set-room-mode", this.state);
                delete this.appState.showRoomModeDialog;
            } else
                popup.alert({content: "Укажите ссылку на Discord-конференцию в формате https://discord.gg/[...]"});
        } else {
            this.app.socket.emit("set-room-mode", this.state);
            delete this.appState.showRoomModeDialog;
            this.setState(this.state);
        }
    }

    static processRoomModeDialog(state) {
        state.showRoomModeDialog = state.publicMode === undefined;
    }
}

class HostControls extends React.Component {
    componentDidMount() {
        if (this.props.hasDarkTheme) {
            const gameName = this.props.app.gameName;
            this.darkThemeStorageName = `darkTheme${gameName.charAt(0).toUpperCase() + gameName.slice(1)}`;
            const darkThemeValue = parseInt(localStorage[this.darkThemeStorageName]);
            if (this.props.defaultDarkTheme ? !darkThemeValue : darkThemeValue)
                document.body.classList.add("dark-theme");
        }
        if (this.props.hasSound && localStorage.volumeLevel === undefined)
            localStorage.volumeLevel = 3;
    }

    static playSound(elem, interactiveVolume) {
        if (parseInt(localStorage.volumeLevel)) {
            if (!elem.baseVolume || interactiveVolume)
                elem.baseVolume = elem.volume;
            elem.volume = elem.baseVolume / 3 * parseInt(localStorage.volumeLevel);
            elem.play();
        }
    }

    handleTuneVolume() {
        localStorage.volumeLevel = parseInt(localStorage.volumeLevel) + 1;
        if (localStorage.volumeLevel === "4")
            localStorage.volumeLevel = 0;
        this.props.app.setState(Object.assign(this.props.app.state));
    }

    render() {
        const data = this.props.data;
        const timerControls = this.props.timerControls;
        const isHost = data.hostId === data.userId;
        const inProcess = this.props.inProcess;
        return <div className="host-controls" onTouchStart={(e) => e.target.focus()}>
            <div className="host-controls-menu">
                {(timerControls.length || this.props.topSection) ? <div className="little-controls">
                    <div className="game-settings">
                        {timerControls.map((it) => <div className={cs("number-control", {hidden: it.show === false})}>
                            <i title={it.title}
                               className="material-icons">{it.icon}</i>
                            {(isHost && !inProcess) ? (<input type="number"
                                                              defaultValue={data[it.field]}
                                                              min={it.min}
                                                              max={it.max}
                                                              onChange={evt => !isNaN(evt.target.valueAsNumber)
                                                                  && this.handleChangeParam(evt.target.valueAsNumber, it)}
                            />) : (<span className="value">{data[it.field] || it.placeHolder}</span>)}
                        </div>)}
                    </div>
                    {this.props.topSection}
                </div> : ""}

                {this.props.middleSection}
            </div>

            <div className="side-buttons">
                {this.props.bottomSection}
                {isHost ?
                    <i onClick={() => this.props.emitEvent("set-room-mode", false)}
                       className="material-icons exit settings-button">store</i> : ""}
                {this.props.sideButtons}
                <i onClick={() => this.handleClickChangeName()}
                   className="toggle-theme material-icons settings-button">edit</i>
                {this.props.hasSound
                    ? (<i onClick={() => this.handleTuneVolume()}
                          className="toggle-theme material-icons settings-button">{[
                        "volume_off",
                        "volume_mute",
                        "volume_down",
                        "volume_up"
                    ][parseInt(localStorage.volumeLevel)]}</i>)
                    : ""}
                {this.props.hasDarkTheme ? (!parseInt(localStorage[this.darkThemeStorageName])
                    ? (<i onClick={() => this.handleToggleTheme()}
                          className="toggle-theme material-icons settings-button">brightness_2</i>)
                    : (<i onClick={() => this.handleToggleTheme()}
                          className="toggle-theme material-icons settings-button">wb_sunny</i>)) : ""}
            </div>
            <i className="settings-hover-button material-icons">settings</i>
        </div>;
    }

    handleChangeParam(value, it) {
        clearTimeout(this.debouncedEmitTimer);
        this.debouncedEmitTimer = setTimeout(() => {
            this.props.handleChangeParam(it.field, value);
        }, 100);
    }

    handleClickChangeName() {
        popup.prompt({content: "New name", value: this.props.data.playerNames[this.props.data.userId] || ""}, (evt) => {
            if (evt.proceed && evt.input_value.trim()) {
                this.props.emitEvent("change-name", evt.input_value.trim());
                localStorage.userName = evt.input_value.trim();
            }
        });
    }

    handleToggleTheme() {
        localStorage[this.darkThemeStorageName] = !parseInt(localStorage[this.darkThemeStorageName]) ? 1 : 0;
        document.body.classList.toggle("dark-theme");
        this.props.app.setState(Object.assign(this.props.app.state));
        const hasAuth = this.props.app.state.authUsers[this.props.app.state.userId];
        if (this.props.emitToggleTheme && !this.toggleThemeEmitted && hasAuth) {
            this.props.emitEvent("toggle-theme", parseInt(localStorage[this.darkThemeStorageName]));
            this.toggleThemeEmitted = true;
        }
    }
}

class Chat extends React.Component {
    constructor(props) {
        super(props);
        this.app = this.props.app;
        this.state = {
            activeChat: "local",
            historyLoaded: {
                local: false,
                global: false
            },
            history: {
                local: this.app.state.chatLastMessages,
                global: []
            },
            hasUnreadMessages: {
                local: false,
                global: false
            }
        };
    }

    componentDidMount() {
        this.chatMessageSound = new Audio("/common/media/chat-message.mp3");
        this.chatMessageSound.volume = 0.1;
        this.app.socket.on("chat-history", (history, globalChat) => this.processChatHistory(history, globalChat));
        this.app.socket.on("chat-message", (message, globalChat) => this.processChatMessage(message, globalChat));
        this.updateChatContainer();
    }

    processChatHistory(historyItem) {
        this.state.historyLoaded[historyItem.chat] = true;
        const firstStoredDatetime = this.state.history[historyItem.chat][0] && this.state.history[historyItem.chat][0].datetime;
        historyItem.messages.reverse().forEach((message) => {
            if (!firstStoredDatetime || message.datetime < firstStoredDatetime)
                this.state.history[historyItem.chat].unshift(message);
        });
        this.setState(this.state, () => {
            this.updateChatContainer();
        });
    }

    processChatMessage(messageItem) {
        this.state.history[messageItem.chat].push(messageItem.message);
        if (messageItem.chat !== this.state.activeChat) {
            if (!this.state.active && messageItem.chat === "local") {
                this.state.activeChat = "local";
                this.state.hasUnreadMessages.local = false;
            } else
                this.state.hasUnreadMessages[messageItem.chat] = true;
        }
        if (!this.state.active || this.state.activeChat !== messageItem.chat) {
            if (messageItem.chat === 'local')
                this.chatMessageSound.play();
            else if (messageItem.chat === 'global' && !this.globalChatSoundCooldown) {
                this.chatMessageSound.play();
                this.globalChatSoundCooldown = true;
                setTimeout(() => this.globalChatSoundCooldown = false, 15000);
            }
        }
        this.setState(this.state, () => {
            this.updateChatContainer();
            if (messageItem.chat === this.state.activeChat && !this.state.active) {
                const chatContainer = document.querySelector(".chat-messages");
                chatContainer.classList.add("new-message");
                setTimeout(() => {
                    const remove = () => {
                        chatContainer.classList.remove("new-message");
                        window.removeEventListener("focus", remove);
                    };
                    if (window.document.hasFocus())
                        remove();
                    else
                        window.addEventListener("focus", remove);
                }, 10);
            }
        });
    }

    updateChatContainer() {
        const chatContainer = document.getElementById("chat-messages");
        if (chatContainer)
            chatContainer.scrollTop = chatContainer.scrollHeight - chatContainer.clientHeight;
    }

    handleSelectChat(chat) {
        if (this.state.activeChat !== chat || !this.state.historyLoaded[chat] || !this.state.active) {
            this.state.active = true;
            this.state.activeChat = chat;
            this.state.hasUnreadMessages[chat] = false;
            if (!this.state.historyLoaded[chat])
                this.getActiveChatHistory();
            this.setState(this.state, () => {
                this.updateChatContainer();
            });
        } else {
            this.state.active = false;
            this.setState(this.state, () => {
                this.updateChatContainer();
            });
        }
    }

    handleSendMessage() {
        const
            chatInput = document.getElementById("chat-input");
        if (!chatInput || chatInput.disabled) return;
        
        const messageText = chatInput.value.trim();
        if (messageText) {
            chatInput.value = "";
            this.app.socket.emit("send-chat-message", messageText, this.state.activeChat);
        }
    }

    getActiveChatHistory() {
        this.app.socket.emit("get-chat-history", this.state.activeChat);
    }

    handleCloseChat() {
        this.state.active = false;
        this.setState(this.state);
    }

    hideLinks(text) {
        return text && text.replaceAll && text.replaceAll(
            new RegExp(/(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})/gi),
            "[ДАННЫЕ УДАЛЕНЫ]"
        );
    }

    processLinks(text) {
        let matchStart, matched;
        text.replace(new RegExp(`(${location.origin}[^ ]+) ?`, "g"), (all, matchedPart, position) => {
            matched = matchedPart;
            matchStart = position;
        });
        if (!matched)
            return this.hideLinks(text);
        return <>
            {this.hideLinks(text.substr(0, matchStart))}
            <a href={matched} target="_blank">{matched}</a>
            {this.hideLinks(text.substr(matchStart + matched.length))}
        </>;
    }

    render() {
        const
            chatTypes = ["global", "local"],
            chatTypeNames = {global: "location_city", local: "store"};
        return <div className={cs("chat", {active: this.state.active})}>
            <div className="chat-tab-containers">
                <div className="chat-tab-container">
                    <div className="chat-messages panel" id="chat-messages">
                        {this.state.history[this.state.activeChat].length
                            ? this.state.history[this.state.activeChat].map((message) =>
                                <div className="chat-message">
                                    {this.state.activeChat === "global" ? <span className="chat-datetime"
                                                                                title={new Date(message.datetime).toLocaleDateString()}>
                                    {new Date(message.datetime).toLocaleTimeString()}&nbsp;|&nbsp;
                                </span> : ""}
                                    [<span className="chat-username"
                                           title={this.state.activeChat === "local"
                                               ? new Date(message.datetime).toLocaleTimeString()
                                               : ""}>
                                {message.sender}</span>]:&nbsp;
                                    <span className="chat-message-text">{this.processLinks(message.text)}</span>
                                </div>
                            )
                            : (
                                this.state.active
                                    ? <div className="chat-messages-placeholder">Сообщений нет</div>
                                    : ""
                            )}
                    </div>
                    <div className="chat-send-box">
                        <div className="chat-tab-buttons">
                            <div className="chat-tab-button chat-close-button"
                                 onClick={() => this.handleCloseChat()}>
                                {<i className="material-icons">highlight_off</i>}
                            </div>
                            {chatTypes.map((chat) =>
                                <div className={cs("chat-tab-button", {
                                    panel: this.state.activeChat === chat,
                                    active: this.state.activeChat === chat,
                                    unread: this.state.hasUnreadMessages[chat]
                                })}
                                     onClick={() => this.handleSelectChat(chat)}>
                                    {<i className="material-icons">{chatTypeNames[chat]}</i>}
                                    {this.state.hasUnreadMessages[chat]
                                        ? <div className="chat-unread-icon"/>
                                        : ""}
                                </div>)}
                        </div>
                        {(() => {
                            const isSpectator = this.props.state.spectators && this.props.state.spectators.includes(this.props.state.userId);
                            const disabled = this.state.activeChat === "local" && this.props.state.chatOnlyPlayers && isSpectator;
                            return <input className="chat-send-input panel text-theme-color" id="chat-input" autoComplete="off"
                                   maxLength={164}
                                   disabled={disabled}
                                   placeholder={disabled ? "Только для игроков" : ""}
                                   onKeyDown={(evt) => evt.key === "Enter"
                                       && this.handleSendMessage()}/>;
                        })()}
                        <div className="chat-send-button panel-accent" onClick={() => this.handleSendMessage()}>
                            <i className="material-icons">send</i>
                        </div>
                    </div>
                </div>
            </div>
        </div>;
    }
}

class PlayerProfileButton extends React.Component {
    render() {
        return this.props.data.authUsers[this.props.id] ?
            <i className="material-icons host-button profile-button" title="Профиль"
               onClick={(evt) => window.commonRoom.toggleShowProfile(this.props.id, evt)}>person</i> : '';
    }
}

class PlayerName extends React.Component {
    render() {
        const nameStyle = {};
        const gameSettings = this.props.gameSettings || this.props.data?.authUsers[this.props.id]?.gameSettings;
        if (gameSettings?.nameColor)
            nameStyle.color = gameSettings.nameColor;
        if (gameSettings?.nameGlowColor)
            nameStyle.textShadow = `0 0 10px ${gameSettings.nameGlowColor}`;
        const playerName = this.props.name || CommonRoom.getPlayerNameStatic(this.props.id, this.props.data);
        const className = gameSettings?.nameEffect ? ['glitch', 'kukozh', 'animate-character', 'sign', 'blazing'][gameSettings.nameEffect - 1] : "";
        return <>
            <span className={className} data-text={playerName} style={nameStyle}>{playerName}</span>
            {this.props.data ? <PlayerProfileButton data={this.props.data} id={this.props.id}/> : ""}
        </>;
    }
}

class WordPackSelector extends React.Component {
    componentDidMount() {
        this.app.setState(Object.assign({
            wordPacks: this.app.state.wordPacks || {},
            newWordPacks: this.app.state.newWordPacks || {},
        }, this.app.state))
        this.app.socket.on("words-pack-list", (list) => {
            list.forEach((item) => {
                // старый сервер присылал просто имена строками
                const packName = (item && item.name) || item;
                this.app.state.newWordPacks[packName] = !!(item && item.isNew);
                this.app.state.wordPacks[packName] = this.app.state.wordPacks[packName] || null;
            });
            this.app.setState(this.app.state);
        });
        this.app.socket.on("words-pack", (data) => {
            if (data.index != null) {
                const wordReport = this.app.state.wordReportData.words[data.index];
                wordReport.wordList = data.wordList;
                wordReport.loading = false;
            } else
                this.app.state.wordPacks[data.packName] = data;
            this.app.setState(Object.assign(this.app.state));
        });
    }

    handleClickCloseCustom() {
        this.app.setState(Object.assign({}, this.app.state, {
            customModalActive: false,
            customPackSelected: null
        }));
    }

    handleSelectCustom(name) {
        if (name && !this.app.state.wordPacks[name])
            this.app.socket.emit("view-words-pack", name);
        this.app.setState(Object.assign({}, this.app.state, {
            customPackSelected: name
        }), () => {
            if (!name && document.getElementById("custom-word-area"))
                document.getElementById("custom-word-area").focus();
        });
    }

    handleCustomWordsChange(value) {
        this.app.setState(Object.assign({}, this.app.state, {
            wordCustomCount: (value && value.split("\n").length) || 0
        }));
    }

    handleClickSetCustomWords() {
        if (this.app.state.customPackSelected
            || (this.app.state.wordCustomCount > 0 && this.app.state.wordCustomCount <= this.app.state.customWordsLimit)) {
            if (this.app.state.customPackSelected)
                this.app.socket.emit("setup-words-preset", this.app.state.customPackSelected);
            else
                this.app.socket.emit("setup-words", document.getElementById("custom-words-pack-name").value, document.getElementById("custom-word-area").value.split("\n"));
            this.handleClickCloseCustom();
        }
    }

    render() {
        this.app = this.props.app;
        const data = this.props.data;
        const settingsMode = this.props.available;
        return data.customModalActive ? <div className="word-report-modal custom">
            <div className="word-report-modal-content custom">
                <div className="word-report-title">Custom word packs
                    {data.wordPacks[data.customPackSelected] ? (
                        <div className="word-report-modal-stats">
                            Words<span
                            className="word-report-stat-num">{data.wordPacks[data.customPackSelected].wordCount || data.wordPacks[data.customPackSelected].wordList.length}</span>
                            Author<span
                            className="word-report-stat-num">{data.wordPacks[data.customPackSelected].author}</span>
                        </div>) : ""}
                    {settingsMode && !data.wordPacks[data.customPackSelected] ? (
                        <input
                            className="custom-words-pack-name"
                            maxLength="40"
                            id="custom-words-pack-name"
                            placeholder="Pack name"
                        />) : ""}
                    <div className="word-report-modal-close"
                         onClick={() => this.handleClickCloseCustom()}>✕
                    </div>
                </div>
                <div className="custom-packs">
                    <div className="custom-pack-list">
                        {settingsMode ? (
                            <div
                                onClick={() => this.handleSelectCustom()}
                                className={cs("custom-pack-list-item", {selected: data.customPackSelected == null})}>
                                &lt;Custom&gt;</div>) : ""}
                        {Object.keys(data.wordPacks).sort((a, b) => {
                            /* Свежие паки — наверх и по алфавиту между собой;
                               остальные сохраняют порядок, в котором их прислал
                               сервер (sort стабильна, поэтому 0 его не трогает). */
                            const aNew = !!(data.newWordPacks && data.newWordPacks[a]),
                                bNew = !!(data.newWordPacks && data.newWordPacks[b]);
                            if (aNew !== bNew)
                                return aNew ? -1 : 1;
                            /* локаль прибита гвоздями: иначе порядок кириллицы
                               и латиницы зависит от языка браузера зрителя */
                            return aNew ? a.localeCompare(b, "ru") : 0;
                        }).map((name) => (
                            <div onClick={() => this.handleSelectCustom(name)}
                                 className={cs("custom-pack-list-item", {selected: data.customPackSelected === name})}>
                                {data.newWordPacks && data.newWordPacks[name]
                                    ? <i className="material-icons custom-pack-new-icon">fiber_new</i> : ""}
                                {name}</div>))}
                    </div>
                    <div className="custom-pack-pane">
                        {(settingsMode && data.customPackSelected == null)
                            ? (<textarea
                                id="custom-word-area"
                                onChange={((event) => this.handleCustomWordsChange(event.target.value))}
                                className="custom-word-textarea text-color"/>)
                            : data.customPackSelected != null
                                ? (<div className="custom-pack-word-list">
                                    {data.wordPacks[data.customPackSelected] != null
                                        ? data.wordPacks[data.customPackSelected].wordList.map((word) => (
                                            <div
                                                className="custom-pack-word-list-item">{word}</div>))
                                        : "Loading"}
                                </div>) : ""}
                    </div>
                </div>
                <div className="word-report-manage-buttons">
                    {settingsMode && data.customPackSelected == null ? (<div
                        className={cs("word-add-count", {
                            overflow: data.wordCustomCount > data.customWordsLimit
                        })}>{data.wordCustomCount}/{data.customWordsLimit}
                    </div>) : ""}
                    {settingsMode ? <div
                        className={cs("word-report-save-button", "button", {
                            inactive: !(data.customPackSelected != null
                                || (data.wordCustomCount > 0
                                    && data.wordCustomCount <= data.customWordsLimit))
                        })}
                        onClick={() => this.handleClickSetCustomWords()}>Select
                    </div> : ""}
                </div>
            </div>
        </div> : ""
    }
}
