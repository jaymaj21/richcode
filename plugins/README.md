# Spectral Web Plugins

Plugin scripts in this directory are loaded into the editor webview after `media/editor.js`.

Loaded files:

- `plugins.js`
- `plugin_*.js`, in filename sort order

Each plugin can use `window.Spectral` to register commands or add toolbar buttons.

Example:

```js
Spectral.registerCommand('appendStamp', () => {
    Spectral.insertText('end', `Stamped ${new Date().toISOString()}\n`);
});

Spectral.addToolbarButton('Stamp', () => Spectral.runCommand('appendStamp'), {
    title: 'Append a timestamp'
});
```

Commands registered with `Spectral.registerCommand(...)` can be run from JS Cmd by name.

## Command server

`plugin_cmd_server.js` exposes these JS Cmd functions:

```js
startCmdServer(32123)
stopCmdServer(32123)
```

The TCP listener is implemented by the extension host and binds only to
`127.0.0.1`. Each client command is UTF-8 text terminated by a null byte. This
allows a command to contain newlines. Replies are also null-terminated and have
the form `Result: value` or `Error: message`.

The command server deliberately evaluates input with the same interpreter as JS
Cmd. Any local process able to connect to the chosen port can therefore execute
commands in that editor webview. Stop the server when it is not needed; closing
the editor also stops its server automatically.

Use the included Node client to send either a command-line string or a UTF-8
file. The file form is convenient for multiline commands:

```powershell
node .\cmd_client.js 32123 -c "getIndex()"
node .\cmd_client.js 32123 -f .\command.js
```
