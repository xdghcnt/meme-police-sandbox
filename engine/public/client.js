window.pageLoadStartTime = new Date();
const CLIENT_MESSAGE = "ClientMessage";
const renderErrorPanel = (errorText, eventId, isCritical) => {
    return `<div class="error-dialog">
                <div class="error-header">Произошла ошибка</div>
                <div class="error-message">Оповещение уже отправлено разработчику</div>
                ${errorText ? `<pre class="error-text">${errorText}</pre>` : ``}
                <div class="error-options">
                    <a href="#" onclick="sentryReportDialog('${eventId}', true)">
                        Описать подробности (может помочь в исправлении)
                    </a>
                    <a target="_blank" href="https://discord.gg/Z3YfHSD">Зайти в Discord-конференцию поддержки</a>
                    ${isCritical ? `<a onclick="resetStorageAndReload()">Очистить данные сессии и перезагрузить старинцу</a>` : ``}  
                </div>
            </div>`;
};
const renderUnsupportedPanel = (eventId) => {
    return `<div class="error-dialog">
                <div class="error-header">Браузер не поддерживается</div>
                <div class="error-message">Ваш браузер слишком старый и на нём не должен работать сайт</div>
                <div class="error-message">(!) Если вы используете iPhone или iPad, обновите операционную систему устройства</div>
                <div class="error-options">
                    <a href="#" onclick="sentryReportDialog('${eventId}', true)">
                        Сообщить об ошибке (Мой браузер не старый!)
                    </a>
                    <a target="_blank" href="https://discord.gg/Z3YfHSD">Зайти в Discord-конференцию поддержки</a>
                    <a target="_blank" href="https://www.google.com/chrome/">Установить <i>настоящий</i> браузер</a>  
                </div>
            </div>`;
};
const renderErrorPageLayout = (errorPanel, showRefreshButton) => {
    return `<div class="error-page">
                ${errorPanel}
                ${showRefreshButton ? `<div class="error-refresh-page" onclick="location.reload(true)">Обновить страницу</div>` : ``}
            </div>`;
};
const renderLoading = () => {
    setTimeout(() => {
        const loadingProblemsNode = document.querySelector(".loading-problems");
        if (loadingProblemsNode)
            loadingProblemsNode.classList.add("active");
    }, 5000);
    return `<div class="loading-page text-theme-color">
                <div class="loading-title"> Загрузка ${document.title} <img src="/common/media/loading-anim.gif" style="
                    height: 20px;
                    vertical-align: middle;
                    margin-top: -3px;
                "/>               
                </div>
                <div class="loading-problems">
                    <div class="loading-problems-title">
                        Проблемы с доступом к meme-police? 
                    </div>
                    <div class="loading-problems-options">
                        <a onclick="resetStorageAndReload()">Очистить данные сессии и перезагрузить старинцу</a>  
                        <a target="_blank" href="https://antizapret.prostovpn.org/">Попробовать расширение для обхода блокировок</a> 
                        <a target="_blank" href="https://www.google.com/chrome/">Попробовать установить <i>нормальный</i> браузер</a>  
                        <a target="_blank" href="https://discord.gg/Z3YfHSD">Зайти в Discord-конференцию поддержки</a>
                        <a onclick="sentryReportDialog()">Сообщить о проблеме</a>
                    </div>  
                </div>
            </div>`;
};

try {
    eval(`const a = true; const b = {...a, b: true}; const c = b?.e;`);
} catch {
    unsupported = true;
    document.addEventListener("DOMContentLoaded", function () {
        document.body.innerHTML = renderErrorPageLayout(renderUnsupportedPanel());
    }, false);
    throw new Error("Unsupported browser");
}

document.addEventListener("DOMContentLoaded", function () {
    const rootNode = document.getElementById("root");
    if (rootNode)
        rootNode.innerHTML = renderLoading();
}, false);

const communityIgnoreErrors = [
    // Random plugins/extensions
    "top.GLOBALS",
    // See: http://blog.errorception.com/2012/03/tale-of-unfindable-js-error.html
    "originalCreateNotification",
    "canvas.contentDocument",
    "MyApp_RemoveAllHighlights",
    "http://tt.epicplay.com",
    "Can't find variable: ZiteReader",
    "jigsaw is not defined",
    "ComboSearch is not defined",
    "http://loading.retry.widdit.com/",
    "atomicFindClose",
    // Facebook borked
    "fb_xd_fragment",
    // ISP "optimizing" proxy - `Cache-Control: no-transform` seems to
    // reduce this. (thanks @acdha)
    // See http://stackoverflow.com/questions/4113268
    "bmi_SafeAddOnload",
    "EBCallBackMessageReceived",
    // See http://toolbar.conduit.com/Developer/HtmlAndGadget/Methods/JSInjection.aspx
    "conduitPage",
    // See: https://stackoverflow.com/a/50387233
    "ResizeObserver loop limit exceeded"
];
const communityIgnoreUrls = [
    // Facebook flakiness
    /graph\.facebook\.com/i,
    // Facebook blocked
    /connect\.facebook\.net\/en_US\/all\.js/i,
    // Woopra flakiness
    /eatdifferent\.com\.woopra-ns\.com/i,
    /static\.woopra\.com\/js\/woopra\.js/i,
    // Chrome extensions
    /extensions\//i,
    /^chrome:\/\//i,
    // Other plugins
    /127\.0\.0\.1:4001\/isrunning/i, // Cacaoweb
    /webappstoolbarba\.texthelp\.com\//i,
    /metrics\.itunes\.apple\.com\.edgesuite\.net\//i,
];

if (window.sentryDsn)
    Sentry.init({
        dsn: window.sentryDsn,
        tracesSampleRate: 1.0,
        ignoreErrors: [
            ...communityIgnoreErrors,
            "topMsg is not defined",
            "play() failed because the user didn't interact",
            "The play() request was interrupted",
            "The request is not allowed by the user agent",
            "The play method is not allowed by the user agent",
            "NotAllowedError",
            "NotSupportedError",
            "InvalidStateError",
            "caps is not an object",
            "The string did not match the expected pattern",
            "The element has no supported sources",
            "peer closed",
            "transport closed",
            "illegal character",
            "Invalid or unexpected token",
            "Requested device not found",
            "WebSocket is not connected and send queue is full"
        ],
        ignoreUrls: [
            ...communityIgnoreUrls,
            /interact\.min\.js/
        ],
        beforeSend(event) {
            const unsupportedFeatures = [
                "Unsupported browser",
                "Unexpected token .",
                "Unexpected token '.'",
                "expected expression, got '.'"
            ];
            event.extra = {
                localStorageDump: JSON.stringify(localStorage),
                pageLocation: location.toString(),
                pageLoadStartTime: window.pageLoadStartTime,
                currentTime: new Date()
            };
            if (event.exception) {
                const errorName = event.exception.values[0] && event.exception.values[0].value;
                const unsupported = unsupportedFeatures.includes(errorName);
                const renderException = (rootNode) => {
                    if (unsupported) {
                        rootNode.innerHTML = renderErrorPageLayout(renderUnsupportedPanel(event.event_id));
                        return false;
                    }
                    const isCritical = errorName.startsWith("Critical") || !rootNode.hasChildNodes();
                    const errorPanel = renderErrorPanel(errorName, event.event_id, isCritical);
                    if (!isCritical)
                        popup.alert({
                            modal_size: "large",
                            backdrop_close: false,
                            content: errorPanel
                        });
                    else
                        rootNode.innerHTML = renderErrorPageLayout(errorPanel, true);
                };
                const rootNode = document.getElementById("root");
                if (rootNode)
                    renderException(rootNode);
                else
                    document.addEventListener("DOMContentLoaded", function () {
                        renderException(document.getElementById("root") || document.body);
                    }, false);
                if (unsupported)
                    return false;
            } else if (event.message === CLIENT_MESSAGE) {
                sentryReportDialog(event.event_id);
            }
            if (window.location.hostname !== "localhost")
                return event;
            else
                return false;
        }
    });

if (window.socket)
    window.socket.on("disconnect", (event) => {
        if (event.code === 7001) {
            document.body.innerHTML = '<div class="text-theme-color" style="\n' +
                '    padding: 20px;\n' +
                '    text-align: center;\n' +
                '    font-size: 28px;\n' +
                '    line-height: 45px;' +
                '        width: 665px;' +
                '        margin: auto;">' +
                'Теперь играть можно только в Оффициальной discord-конфе <img style="vertical-align: sub" src="/icon.png" height="28" /> Meme Police ' +
                '<div ><img style="vertical-align: middle"src="/common/media/discord-white.png" height="24" /> <a href="https://discord.gg/Z3YfHSD">Перейти</a></div>' +
                '</div>';
        }
        if (event.reason.startsWith("Invalid data")) {
            throw new Error(`Critical - Socket disconnect: ${event.reason}`);
        } else if (event.reason.includes("Server restarted")) {
            setTimeout(() => {
                location.reload();
            }, 2000 + (Math.random() * 2000));
        }
    });

function sentryReportDialog(eventId, isError) {
    if (!eventId)
        Sentry.captureMessage("ClientMessage");
    else {
        Sentry.showReportDialog({
            eventId,
            user: {
                email: "optional@mail.com",
                name: localStorage.userName || "optional"
            },
            title: isError ? "Отчёт об ошибке" : "Сообщить о проблеме или предложить улучшение",
            subtitle: isError ? "Разработчик уже оповещён." : "",
            subtitle2: isError ? "Если вы хотите помочь, опишите, что произошло" : "",
            labelName: "Имя (необязательно)",
            labelEmail: "Email (необязательно)",
            labelComments: isError ? "Как произошла ошибка" : "Описание",
            labelClose: "Закрыть",
            labelSubmit: "Отправить",
            errorGeneric: "Неизвестная ошибка",
            errorFormEntry: "Неверный формат",
            successMessage: "Ваш отчёт успешно отправлен. Спасибо!"
        });
    }
}

function resetStorageAndReload() {
    localStorage.clear();
    location.reload(true);
}
