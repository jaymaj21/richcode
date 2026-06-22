(function () {
    if (!window.Spectral) {
        return;
    }

    Spectral.registerCommand('appendStamp', () => {
        Spectral.insertText('end', `Stamped ${new Date().toISOString()}\n`);
    });

    /*Spectral.addToolbarButton('Stamp', () => Spectral.runCommand('appendStamp'), {
        title: 'Append a timestamp at the end of the editor'
    });*/
})();
