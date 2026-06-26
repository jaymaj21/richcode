const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const VIEW_TYPE = 'spectralweb.richEditor';

function activate(context) {
    const provider = new SpectralWebEditorProvider(context);

    context.subscriptions.push(vscode.window.registerCustomEditorProvider(
        VIEW_TYPE,
        provider,
        {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false
        }
    ));

    context.subscriptions.push(vscode.commands.registerCommand('spectralweb.openRichEditor', async (uri) => {
        const target = uri || vscode.window.activeTextEditor?.document.uri;
        if (!target) {
            vscode.window.showInformationMessage('Open a source file first.');
            return;
        }
        await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('spectralweb.saveRichLayer', async () => {
        await provider.saveActiveRichLayer();
    }));

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document) => {
        await provider.saveRichLayerForDocument(document);
    }));
}

function deactivate() {}

class SpectralWebEditorProvider {
    constructor(context) {
        this.context = context;
        this.panelsByDocument = new Map();
        this.stateByDocument = new Map();
        this.applyingEdit = new Set();
    }

    async resolveCustomTextEditor(document, webviewPanel) {
        const key = document.uri.toString();
        this.panelsByDocument.set(key, webviewPanel);

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                vscode.Uri.joinPath(this.context.extensionUri, 'plugins')
            ]
        };

        const editorHtml = await this.loadInitialEditorHtml(document);
        this.stateByDocument.set(key, {
            editorHtml,
            plainText: document.getText()
        });

        webviewPanel.webview.html = this.getWebviewHtml(webviewPanel.webview, document, editorHtml);

        webviewPanel.webview.onDidReceiveMessage(async (message) => {
            if (!message || typeof message.type !== 'string') {
                return;
            }

            if (message.type === 'changed') {
                await this.applyWebviewChange(document, message);
                return;
            }

            if (message.type === 'saveRichLayer') {
                await this.saveRichLayerForDocument(document);
                return;
            }

            if (message.type === 'saveAll') {
                await this.applyWebviewChange(document, message);
                await this.saveDocumentAndRichLayer(document);
                return;
            }

            if (message.type === 'readSvgFile') {
                await this.handleReadSvgFile(webviewPanel.webview, document, message);
                return;
            }

            if (message.type === 'readFileContent') {
                await this.handleReadFileContent(webviewPanel.webview, document, message);
                return;
            }

            if (message.type === 'renderPlantUmlSvg') {
                await this.handleRenderPlantUmlSvg(webviewPanel.webview, document, message);
                return;
            }

        });

        const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.uri.toString() !== key || this.applyingEdit.has(key)) {
                return;
            }
            webviewPanel.webview.postMessage({
                type: 'externalTextChanged',
                plainText: event.document.getText()
            });
        });

        webviewPanel.onDidDispose(() => {
            this.panelsByDocument.delete(key);
            changeSubscription.dispose();
        });
    }

    async applyWebviewChange(document, message) {
        const key = document.uri.toString();
        const plainText = typeof message.plainText === 'string' ? message.plainText : '';
        const editorHtml = typeof message.editorHtml === 'string' ? message.editorHtml : '';

        this.stateByDocument.set(key, { plainText, editorHtml });

        if (plainText === document.getText()) {
            return;
        }

        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );

        this.applyingEdit.add(key);
        try {
            edit.replace(document.uri, fullRange, plainText);
            await vscode.workspace.applyEdit(edit);
        } finally {
            this.applyingEdit.delete(key);
        }
    }

    async saveActiveRichLayer() {
        const activePanel = [...this.panelsByDocument.entries()].find(([, panel]) => panel.active);
        if (!activePanel) {
            vscode.window.showInformationMessage('No active Spectral Web rich editor.');
            return;
        }

        const documentUri = vscode.Uri.parse(activePanel[0]);
        const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === documentUri.toString());
        if (!document) {
            vscode.window.showInformationMessage('The active Spectral Web document is not available.');
            return;
        }

        await this.saveRichLayerForDocument(document);
    }

    async saveRichLayerForDocument(document) {
        const key = document.uri.toString();
        const state = this.stateByDocument.get(key);
        if (!state) {
            return;
        }

        const companionUri = companionHtmlUri(document.uri);
        const html = buildSpectralHtmlDocument({
            sourceFileName: basename(document.uri),
            sourceUri: document.uri.toString(),
            plainText: document.getText(),
            editorHtml: state.editorHtml || textToSpectralHtml(document.getText())
        });

        await vscode.workspace.fs.writeFile(companionUri, Buffer.from(html, 'utf8'));
        vscode.window.setStatusBarMessage(`Spectral Web HTML layer saved: ${basename(companionUri)}`, 3000);
    }

    async saveDocumentAndRichLayer(document) {
        if (document.isDirty) {
            await document.save();
        }
        await this.saveRichLayerForDocument(document);
    }

    async loadInitialEditorHtml(document) {
        const companionUri = companionHtmlUri(document.uri);
        try {
            const bytes = await vscode.workspace.fs.readFile(companionUri);
            const html = Buffer.from(bytes).toString('utf8');
            const editorHtml = extractEditorInnerHtml(html);
            if (editorHtml !== null) {
                return editorHtml;
            }
        } catch {
            // Missing companion files are normal.
        }
        return textToSpectralHtml(document.getText());
    }

    async handleReadSvgFile(webview, document, message) {
        const requestId = typeof message.requestId === 'string' ? message.requestId : '';
        try {
            const uri = this.resolveSvgFileUri(document, message.filename);
            const bytes = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(bytes).toString('utf8');
            await webview.postMessage({
                type: 'svgFileReadResult',
                requestId,
                ok: true,
                text
            });
        } catch (error) {
            await webview.postMessage({
                type: 'svgFileReadResult',
                requestId,
                ok: false,
                error: error && error.message ? error.message : String(error)
            });
        }
    }

    async handleReadFileContent(webview, document, message) {
        const requestId = typeof message.requestId === 'string' ? message.requestId : '';
        try {
            const uri = this.resolveFileUri(document, message.filename);
            const bytes = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(bytes).toString('utf8');
            await webview.postMessage({
                type: 'fileContentReadResult',
                requestId,
                ok: true,
                text
            });
        } catch (error) {
            await webview.postMessage({
                type: 'fileContentReadResult',
                requestId,
                ok: false,
                error: error && error.message ? error.message : String(error)
            });
        }
    }

    async handleRenderPlantUmlSvg(webview, document, message) {
        const requestId = typeof message.requestId === 'string' ? message.requestId : '';
        try {
            const source = await this.resolvePlantUmlSource(document, message);
            const svg = await this.renderPlantUmlSourceToSvg(source);
            await webview.postMessage({
                type: 'plantUmlSvgResult',
                requestId,
                ok: true,
                svg
            });
        } catch (error) {
            await webview.postMessage({
                type: 'plantUmlSvgResult',
                requestId,
                ok: false,
                error: error && error.message ? error.message : String(error)
            });
        }
    }

    async resolvePlantUmlSource(document, message) {
        if (typeof message.source === 'string' && message.source.trim()) {
            return message.source;
        }
        if (typeof message.filename === 'string' && message.filename.trim()) {
            const uri = this.resolveFileUri(document, message.filename);
            const bytes = await vscode.workspace.fs.readFile(uri);
            return Buffer.from(bytes).toString('utf8');
        }
        throw new Error('No PlantUML source supplied.');
    }

    async renderPlantUmlSourceToSvg(source) {
        const jarPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'plantuml.jar').fsPath;
        if (!fs.existsSync(jarPath)) {
            throw new Error(`PlantUML jar not found: ${jarPath}`);
        }

        const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'spectralweb-plantuml-'));
        const inputPath = path.join(tempDir, 'diagram.puml');
        const outputPath = path.join(tempDir, 'diagram.svg');
        try {
            await fs.promises.writeFile(inputPath, source, 'utf8');
            await execFilePromise('java', ['-jar', jarPath, '-tsvg', inputPath], {
                cwd: tempDir,
                timeout: 30000,
                maxBuffer: 20 * 1024 * 1024
            });
            const svg = await fs.promises.readFile(outputPath, 'utf8');
            if (!/<svg[\s>]/i.test(svg)) {
                throw new Error('PlantUML did not produce SVG output.');
            }
            return svg;
        } finally {
            await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
    }

    resolveSvgFileUri(document, filename) {
        const raw = String(filename || '').trim();
        if (!raw) {
            throw new Error('No SVG filename supplied.');
        }
        if (!/\.svg$/i.test(raw)) {
            throw new Error('insertSvgFile only reads .svg files.');
        }
        return this.resolveFileUri(document, raw);
    }

    resolveFileUri(document, filename) {
        const raw = String(filename || '').trim();
        if (!raw) {
            throw new Error('No filename supplied.');
        }
        if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('/')) {
            return vscode.Uri.file(raw);
        }
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
            return vscode.Uri.parse(raw);
        }

        const baseDir = document.uri.with({ path: dirnamePath(document.uri.path) });
        const parts = raw.split(/[\\/]+/).filter(Boolean);
        return vscode.Uri.joinPath(baseDir, ...parts);
    }

    getWebviewHtml(webview, document, initialEditorHtml) {
        const nonce = getNonce();
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.css'));
        const pluginScriptTags = this.getPluginScriptTags(webview, nonce);
        const state = JSON.stringify({
            sourceFileName: basename(document.uri),
            richLayerFileName: `${basename(document.uri)}.html`,
            initialEditorHtml
        }).replace(/[<>&]/g, char => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' }[char]));

        return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; media-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Spectral Web Rich Editor</title>
</head>
<body>
  <script id="spectralweb-state" type="application/json">${state}</script>
  <main class="shell">
    <div class="toolbars" id="top_toolbars" style="display: none;">
      <div class="toolbar" role="toolbar" aria-label="Spectral Web formatting toolbar">
        <button type="button" data-command="bold" id="boldButton" title="Boldface the selection">B</button>
        <button type="button" data-command="italic" id="italicsButton" title="Italicize the selection">I</button>
        <button type="button" data-command="underline" id="underlineButton" title="Underline the selection">U</button>
        <button type="button" data-remove-style="fontWeight" id="removeBoldButton" title="Remove boldface from selection">not B</button>
        <button type="button" data-remove-style="fontStyle" id="removeItalicsButton" title="Remove italics from selection">not I</button>
        <button type="button" data-remove-style="textDecoration" id="removeUnderlineButton" title="Remove underline from selection">not U</button>
        <button type="button" id="first-half-bold" title="Make left half of words bold faced">Bold L</button>
        <button type="button" id="second-half-bold" title="Make right half of words bold faced">Bold R</button>
        <button type="button" id="set-target" title="Set target">Target</button>
        <button type="button" id="link-target" title="Create link to target">Link</button>
        <button type="button" id="external-link" title="Create external link">Ext Link</button>
        <button type="button" data-command="removeFormat" title="Clear highlighting/formatting from selection">Clear Formatting</button>
        <button type="button" id="clear-highlights" title="Clear temporary highlighting">Clear Highlights</button>
        <button type="button" id="iconize-images" title="Replace selected images with reveal buttons">Iconize Images</button>
        <button type="button" id="scale-images" title="Scale selected or nearest image by percent">Scale Images</button>
        <button type="button" id="insert-media-file" title="Embed an audio or video file">+ Media</button>
        <button type="button" id="insert-svg-file" title="Insert an inline SVG file">+ SVG</button>
        <input type="color" id="editorBgColor" title="Editor Background Color" value="#ffffff">
        <button type="button" id="set-default-font" title="Set default font and size">DF</button>
        <button type="button" id="copy-editor" title="Copy editor content to clipboard">Copy</button>
        <button type="button" id="insert-html" title="Insert literal HTML or convert selected text to HTML">HTML</button>
        <button type="button" id="render-markdown" title="Render editor Markdown to HTML">Render MD</button>
        <button type="button" id="copy-markdown" title="Copy selection or editor as Markdown">Copy MD</button>
        <button type="button" id="js-command" title="Run JavaScript command inside the Spectral webview">JS Cmd</button>
        <button type="button" id="insert-note" title="Create note">Note</button>
        <button type="button" id="insert-attachment" title="Add attachment">Attach</button>
      </div>
      <div class="toolbar" role="toolbar" aria-label="Spectral Web options toolbar">
        <select id="fontChooser" title="Font for highlighters">
          <option value="No Selection">No Font Selection</option>
          <option value="Arial">Arial</option>
          <option value="Verdana">Verdana</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Courier New">Courier New</option>
          <option value="OpenDyslexic">OpenDyslexic</option>
          <option value="OpenDyslexicMono">OpenDyslexicMono</option>
        </select>
        <select id="sizeChooser" title="Font size for highlighters">
          <option value="0" selected>No Size Selection</option>
          <option value="1">Small</option>
          <option value="3">Normal</option>
          <option value="5">Large</option>
          <option value="7">Huge</option>
        </select>
        <input type="color" id="colorChooser" title="Foreground color for highlighters" value="#000000">
        <label><input type="checkbox" id="editableToggle" checked> Editable</label>
        <label><input type="checkbox" id="wrapToggle" checked> Wrap lines</label>
        <label><input type="checkbox" id="caseInsensitive" checked> Ignore Case</label>
        <button type="button" id="find-replace" title="Find and replace">Find & Replace</button>
        <button type="button" id="speak-selection" title="Read aloud the selected text">Speak Selection</button>
        <button type="button" id="stop-speaking" title="Stop reading aloud">Stop Speech</button>
        <button type="button" data-transform-case="upper" title="Uppercase selection">UC</button>
        <button type="button" data-transform-case="lower" title="Lowercase selection">LC</button>
        <button type="button" data-transform-case="title" title="Title-case selection">TC</button>
        <button type="button" data-transform-case="camel" title="Camel-case selection">camel</button>
        <button type="button" data-transform-case="snake" title="Snake-case selection">snake</button>
        <button type="button" data-transform-case="kebab" title="Kebab-case selection">kebab</button>
        <button type="button" id="increment-integers" title="Increment integers inside regex matches">Incr Int</button>
        <button type="button" id="word-count-selection" title="Word count for selection">WC</button>
        <button type="button" id="reflow-selection" title="Reflow selected text to a column width">Reflow</button>
        <button type="button" id="explain-selection" title="Add explanation around selection">Explain</button>
        <button type="button" id="reverse-lines" title="Reverse selected lines, or all lines with no selection">Reverse Lines</button>
        <button type="button" id="toggleCursorModeBtn" title="Add cursors to selection or interactively add cursors">Add n-Cursors</button>
        <button type="button" id="clear-cursors" title="Clear all cursors">Clear n-Cursors</button>
        <button type="button" id="enumerate-cursors" title="Insert incrementing labels at cursors">Enum Cursors</button>
        <button type="button" id="alignWithCursorsBtn" title="Align with cursors">Align /w Cursors</button>
        <button type="button" id="sanitize-html" title="Sanitize">Sanitize</button>
        <button type="button" id="clean-instrumentation" title="Remove mprewriter scope probes">Instr Clean</button>
        <button type="button" id="help-button" title="Help screen">Help</button>
      </div>
      <div class="toolbar" role="toolbar" aria-label="Spectral Web regex highlighter toolbar">
        <input type="text" id="searchBox1" data-search-colid="1" placeholder="Enter regex, press enter">
        <button type="button" data-highlight="#f0f583" data-colid="1" id="hlButton1" class="hlButton" title="Highlight 1">H</button>
        <input type="text" id="searchBox2" data-search-colid="2" placeholder="Enter regex, press enter">
        <button type="button" data-highlight="#fd9f9f" data-colid="2" id="hlButton2" class="hlButton" title="Highlight 2">H</button>
        <input type="text" id="searchBox3" data-search-colid="3" placeholder="Enter regex, press enter">
        <button type="button" data-highlight="#aafba2" data-colid="3" id="hlButton3" class="hlButton" title="Highlight 3">H</button>
        <input type="text" id="searchBox4" data-search-colid="4" placeholder="Enter regex, press enter">
        <button type="button" data-highlight="#a5f8f8" data-colid="4" id="hlButton4" class="hlButton" title="Highlight 4">H</button>
        <input type="text" id="searchBox5" data-search-colid="5" placeholder="Enter regex, press enter">
        <button type="button" data-highlight="#f997f9" data-colid="5" id="hlButton5" class="hlButton" title="Highlight 5">H</button>
        <input type="text" id="searchBox6" data-search-colid="6" placeholder="Enter regex, press enter">
        <button type="button" data-highlight="#ccddf7" data-colid="6" id="hlButton6" class="hlButton" title="Highlight 6">H</button>
        <input type="text" id="searchBox7" data-search-colid="7" placeholder="Enter regex, press enter">
        <button type="button" data-highlight="#ffffff" data-colid="7" id="hlButton7" class="hlButton" title="Highlight 7">H</button>
        <button type="button" id="multi-regex-highlight" title="Highlight multiple regexes">H*</button>
        <label><input type="checkbox" id="showSearchResults" title="Show listing of search results"> Results</label>
      </div>
      <div class="toolbar" id="statusBar">
        <textarea id="statusText" rows="2" readonly></textarea>
        <span id="status" aria-live="polite"></span>
      </div>
      <div class="toolbar spectral-plugin-toolbar" id="spectral-plugin-toolbar" role="toolbar" aria-label="Spectral Web plugin toolbar"></div>
    </div>
    <div id="editor" class="editor" contenteditable="true" spellcheck="false" aria-label="Spectral Web editor"></div>
  </main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
  ${pluginScriptTags}
</body>
</html>`;
    }

    getPluginScriptTags(webview, nonce) {
        const pluginDir = vscode.Uri.joinPath(this.context.extensionUri, 'plugins');
        let entries = [];
        try {
            entries = fs.readdirSync(pluginDir.fsPath, { withFileTypes: true });
        } catch {
            return '';
        }

        const pluginFiles = entries
            .filter(entry => entry.isFile())
            .map(entry => entry.name)
            .filter(name => name === 'plugins.js' || /^plugin_.*\.js$/i.test(name))
            .sort((a, b) => {
                if (a === 'plugins.js') return -1;
                if (b === 'plugins.js') return 1;
                return a.localeCompare(b);
            });

        return pluginFiles.map(name => {
            const uri = webview.asWebviewUri(vscode.Uri.joinPath(pluginDir, name));
            return `<script nonce="${nonce}" src="${escapeHtml(String(uri))}"></script>`;
        }).join('\n  ');
    }
}

function companionHtmlUri(sourceUri) {
    return vscode.Uri.joinPath(sourceUri.with({ path: dirnamePath(sourceUri.path) }), `${basename(sourceUri)}.html`);
}

function dirnamePath(path) {
    const index = path.lastIndexOf('/');
    return index <= 0 ? '/' : path.slice(0, index);
}

function basename(uri) {
    const path = typeof uri === 'string' ? uri : uri.path;
    const index = path.lastIndexOf('/');
    return index >= 0 ? decodeURIComponent(path.slice(index + 1)) : decodeURIComponent(path);
}

function execFilePromise(file, args, options) {
    return new Promise((resolve, reject) => {
        execFile(file, args, options, (error, stdout, stderr) => {
            if (error) {
                const detail = String(stderr || stdout || error.message || error).trim();
                reject(new Error(detail || `Command failed: ${file}`));
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

function textToSpectralHtml(text) {
    return escapeHtml(text)
        .replace(/\r\n/g, '<br/>')
        .replace(/\n/g, '<br/>');
}

function extractEditorInnerHtml(html) {
    const match = html.match(/<div\b[^>]*id=["']editor["'][^>]*>([\s\S]*)<\/div>\s*(?:<script\b|<\/body>|<\/html>|$)/i);
    if (!match) {
        return null;
    }
    return match[1].trim();
}

function buildSpectralHtmlDocument({ sourceFileName, sourceUri, plainText, editorHtml }) {
    const metadata = JSON.stringify({
        format: 'spectralweb-vscode-html',
        version: 1,
        sourceFileName,
        sourceUri,
        savedAt: new Date().toISOString(),
        plainText
    }, null, 2).replace(/[<>&]/g, char => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' }[char]));

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="generator" content="Spectral Web Rich Editor for VS Code">
  <title>${escapeHtml(sourceFileName)} Spectral Web layer</title>
</head>
<body>
${spectralInlineStyle()}
${spectralInlineScript()}
${textPopupHtml()}
${imageViewerHtml()}
<div id="editor" class="editor" contenteditable="true" data-source-file="${escapeHtml(sourceFileName)}">
${editorHtml}
</div>
<script id="spectralweb-metadata" type="application/json">${metadata}</script>
</body>
</html>
`;
}

function spectralInlineStyle() {
    return `<style id="inline-style">
body { font-family: Arial, sans-serif; margin: 20px; background: #ffffff; color: #111111; }
.editor { font-family: "Courier New", Courier, monospace; border: 1px solid #ccc; min-height: 600px; padding: 10px; margin-top: 5px; outline: none; width: 100%; box-sizing: border-box; overflow: auto; white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; background: #ffffff; color: #111111; }
abbrev { text-decoration: underline dotted #888; text-underline-offset: 2px; cursor: help; }
.line-number { font-family: monospace; color: #777; margin-right: 0.5em; user-select: none; }
.image-button-reveal { display: inline-block; padding: 2px 6px; margin: 0 2px; border: 1px solid #888; border-radius: 4px; background: #eee; color: #111; cursor: pointer; font: 12px/1 Arial, sans-serif; }
audio { vertical-align: middle; }
video { max-width: 100%; background: #000; }
.note-button { width: 24px; height: 24px; background-color: #ffeb3b; border: 1px solid #999; border-radius: 4px; cursor: pointer; font-size: 14px; line-height: 1; text-align: center; padding: 0; }
.highlight1 { background-color: #f0f583; }
.highlight2 { background-color: #fd9f9f; }
.highlight3 { background-color: #aafba2; }
.highlight4 { background-color: #a5f8f8; }
.highlight5 { background-color: #f997f9; }
.highlight6 { background-color: #ccddf7; }
.highlight7 { background-color: #ffffff; }
.spectral-attachment { color: blue; text-decoration: underline; cursor: pointer; }
#textPopup { display: none; position: fixed; top: 15%; left: 50%; transform: translateX(-50%); width: min(760px, calc(100vw - 32px)); background: #fffef8; color: #111111; border: 1px solid #777; box-shadow: 0 2px 18px rgba(0,0,0,0.35); padding: 10px; z-index: 10; }
#popupTextarea { box-sizing: border-box; width: 100%; height: 260px; resize: vertical; margin-bottom: 8px; font-family: "Courier New", Courier, monospace; }
#imageViewerPopup { display: none; position: fixed; inset: 24px; background: #fff; color: #111; border: 1px solid #777; box-shadow: 0 2px 18px rgba(0,0,0,0.35); z-index: 11; }
.image-viewer-header { padding: 6px 10px; border-bottom: 1px solid #ddd; }
#imageViewerBody { height: calc(100% - 42px); display: flex; align-items: center; justify-content: center; overflow: auto; background: #f8f8f8; }
#imageViewerBody img { max-width: 100%; max-height: 100%; height: auto; }
</style>`;
}

function spectralInlineScript() {
    return `<script id="inline-script">
var Base64 = {
  encode: function(input) { return btoa(unescape(encodeURIComponent(String(input || '')))); },
  decode: function(input) { try { return decodeURIComponent(escape(atob(input || ''))); } catch (err) { return ''; } }
};
var textPopupCallback = null;
function showTextPopup(callback, heading, initialText) {
  textPopupCallback = callback;
  document.getElementById('popupTextAreaHeading').innerText = heading || '';
  document.getElementById('popupTextarea').value = initialText || '';
  document.getElementById('textPopup').style.display = 'block';
  document.getElementById('popupTextarea').focus();
}
function submitTextPopup() {
  var text = document.getElementById('popupTextarea').value;
  closeTextPopup();
  if (textPopupCallback) textPopupCallback(text);
}
function closeTextPopup() { document.getElementById('textPopup').style.display = 'none'; }
function showImageFromButton(btn) {
  var html = Base64.decode(btn.getAttribute('data-imghtml') || '');
  var viewer = document.getElementById('imageViewerPopup');
  var body = document.getElementById('imageViewerBody');
  if (!viewer || !body) return;
  body.innerHTML = html;
  viewer.style.display = 'block';
}
function closeImageViewer() { document.getElementById('imageViewerPopup').style.display = 'none'; }
function dataUrlToBlob(dataURL) {
  var parts = String(dataURL || '').split(',');
  var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'application/octet-stream';
  var binary = atob(parts[1] || '');
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
function hydrateEmbeddedVideoSources(root) {
  (root || document).querySelectorAll('video[data-spectral-video-src], video[src^="data:video/"]').forEach(function(video) {
    var dataURL = video.getAttribute('data-spectral-video-src') || video.getAttribute('src') || '';
    if (!dataURL || dataURL.indexOf('data:video/') !== 0) return;
    video.setAttribute('data-spectral-video-src', dataURL);
    video.src = URL.createObjectURL(dataUrlToBlob(dataURL));
    video.load();
  });
}
function showNoteEditPopup(event) {
  var target = event.currentTarget || event.target;
  var initialMsg = Base64.decode(target.getAttribute('data-message') || '');
  showTextPopup(function(text) {
    target.setAttribute('data-message', Base64.encode(text));
  }, 'Edit Note:', initialMsg);
}
function noteButtonClickHandler(event) {
  event.preventDefault();
  showNoteEditPopup(event);
}
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('#editor .note-button').forEach(function(btn) {
    btn.addEventListener('click', noteButtonClickHandler);
  });
  document.querySelectorAll('#editor a[data-select-id]').forEach(function(anchor) {
    anchor.addEventListener('click', function(event) {
      event.preventDefault();
      selectText(anchor.getAttribute('data-select-id'));
    });
  });
  document.querySelectorAll('#editor .image-button-reveal').forEach(function(btn) {
    btn.addEventListener('click', function() { showImageFromButton(btn); });
  });
  hydrateEmbeddedVideoSources(document.getElementById('editor'));
});
function selectText(containerid) {
  var element = document.getElementById(containerid);
  if (!element) return;
  var range = document.createRange();
  range.selectNode(element);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  element.scrollIntoView();
}
</script>`;
}

function textPopupHtml() {
    return `<div id="textPopup">
  <div id="popupTextAreaHeading">Note</div>
  <textarea id="popupTextarea"></textarea>
  <div>
    <button type="button" onclick="submitTextPopup()">OK</button>
    <button type="button" onclick="closeTextPopup()">Cancel</button>
  </div>
</div>`;
}

function imageViewerHtml() {
    return `<div id="imageViewerPopup">
  <div class="image-viewer-header"><button type="button" onclick="closeImageViewer()">Close</button></div>
  <div id="imageViewerBody"></div>
</div>`;
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getNonce() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
        text += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return text;
}

module.exports = { activate, deactivate };
