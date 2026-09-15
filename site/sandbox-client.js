/* Loaded into every game page by the sandbox, right after the engine's own
   scripts. Only replaces what can't work without the real site. */
(function () {
    /* ?name=Bob sets the nickname up front: without it the engine asks with
       prompt(), which blocks automated browsers. The engine drops the query
       string from the address itself. */
    var name = new URLSearchParams(location.search).get("name");
    if (name)
        localStorage.userName = name;

    // "Войти через Discord" logs in instantly with a local fake profile
    var patchLogin = function () {
        if (typeof CommonRoom === "undefined")
            return false;
        CommonRoom.prototype.login = function () {
            this.app.socket.emit("check-auth", localStorage.userToken);
        };
        return true;
    };
    var timer = setInterval(function () {
        if (patchLogin())
            clearInterval(timer);
    }, 50);
})();
