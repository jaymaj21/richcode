(function () {
    if (!window.Spectral) return;

    async function startCmdServer(portnum) {
        const port = await Spectral.startCmdServer(portnum);
        Spectral.setStatus(`Command server listening on 127.0.0.1:${port}.`);
        return port;
    }

    async function stopCmdServer(portnum) {
        const port = await Spectral.stopCmdServer(portnum);
        Spectral.setStatus(`Command server on port ${port} stopped.`);
        return port;
    }

    Spectral.registerCommand('startCmdServer', startCmdServer);
    Spectral.registerCommand('stopCmdServer', stopCmdServer);
    window.startCmdServer = startCmdServer;
    window.stopCmdServer = stopCmdServer;
})();
