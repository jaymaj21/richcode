(function () {
    const vscode = acquireVsCodeApi();
    const editor = document.getElementById('editor');
    const status = document.getElementById('status');
    const statusText = document.getElementById('statusText');
    const stateEl = document.getElementById('spectralweb-state');
    const initialState = JSON.parse(stateEl.textContent || '{}');

    let sendTimer = null;
    let savedEditorRange = null;
    let textPopup = null;
    let popupHeading = null;
    let popupTextarea = null;
    let textPopupCallback = null;
    let activeNoteButton = null;
    let lastTargetId = null;
    let findReplaceDialog = null;
    let cursorInsertMode = false;
    let cursors = [];
    let savedEditorRangeForAbbrev = null;
    let lineNumbersShown = false;
    let toolbarsVisible = false;
    let undoStack = [];
    let redoStack = [];
    let imageViewerPopup = null;
    let imageViewerBody = null;
    let helpPopup = null;
    let mediaRecorder = null;
    let audioChunks = [];
    let videoMediaRecorder = null;
    let videoChunks = [];
    let videoStream = null;
    let videoRecordingStartedAt = 0;
    let recordingPopup = null;
    let recordingStatus = null;
    let recordingStopButton = null;
    let mediaFileInput = null;
    let jsCommandPopup = null;
    let jsCommandInput = null;
    let searchResultsPopup = null;
    let searchResultsTitle = null;
    let searchResultsList = null;
    let speechRunId = 0;
    let diffNotesPopup = null;
    let diffNotesBody = null;
    let diffNotesGranularity = null;
    let diffNotesPickState = null;
    let diffContext = null;
    const jsCommandHistory = [];
    const pluginCommands = new Map();
    let jsCommandHistoryIndex = -1;

    editor.innerHTML = initialState.initialEditorHtml || '';
    hydrateEditorControls(editor);
    hydrateEmbeddedVideoSources(editor);
    setStatus(`${initialState.sourceFileName || 'source'} -> ${initialState.richLayerFileName || 'rich layer'}`);

    document.querySelectorAll('[data-command]').forEach(button => {
        button.addEventListener('click', () => {
            editor.focus();
            document.execCommand(button.dataset.command, false, null);
            scheduleSend();
        });
    });

    document.querySelectorAll('[data-highlight]').forEach(button => {
        button.addEventListener('click', () => {
            editor.focus();
            document.execCommand('hiliteColor', false, button.dataset.highlight);
            scheduleSend();
        });
    });

    document.querySelectorAll('[data-remove-style]').forEach(button => {
        button.addEventListener('click', () => {
            editor.focus();
            removeInlineStyle(button.dataset.removeStyle);
            scheduleSend();
        });
    });

    document.querySelectorAll('[data-transform-case]').forEach(button => {
        button.addEventListener('click', () => {
            transformSelectedText(button.dataset.transformCase);
        });
    });

    document.querySelectorAll('[data-unported]').forEach(button => {
        button.addEventListener('click', () => {
            setStatus(`${button.dataset.unported} is visible for Spectral parity but is not ported yet.`);
        });
    });

    document.querySelectorAll('[data-search-colid]').forEach(input => {
        input.addEventListener('keydown', event => {
            if (event.key !== 'Enter') {
                return;
            }
            event.preventDefault();
            const count = highlightSearchPattern(input.value, Number(input.dataset.searchColid));
            setStatus(`${count} match${count === 1 ? '' : 'es'} highlighted for search box ${input.dataset.searchColid}.`);
            scheduleSend();
        });
    });

    document.getElementById('editorBgColor').addEventListener('input', event => {
        editor.style.backgroundColor = event.target.value;
        scheduleSend();
    });

    document.getElementById('fontChooser').addEventListener('change', event => {
        if (event.target.value !== 'No Selection') {
            editor.focus();
            document.execCommand('fontName', false, event.target.value);
            scheduleSend();
        }
    });

    document.getElementById('sizeChooser').addEventListener('change', event => {
        if (event.target.value !== '0') {
            editor.focus();
            document.execCommand('fontSize', false, event.target.value);
            scheduleSend();
        }
    });

    document.getElementById('colorChooser').addEventListener('input', event => {
        editor.focus();
        document.execCommand('foreColor', false, event.target.value);
        scheduleSend();
    });

    document.getElementById('editableToggle').addEventListener('change', event => {
        editor.contentEditable = event.target.checked ? 'true' : 'false';
        editor.style.backgroundColor = event.target.checked ? document.getElementById('editorBgColor').value : '#fafafa';
        setStatus(event.target.checked ? 'Editor is editable.' : 'Editor is read-only.');
    });

    document.getElementById('wrapToggle').addEventListener('change', event => {
        editor.style.whiteSpace = event.target.checked ? 'pre-wrap' : 'pre';
        editor.style.overflowX = event.target.checked ? 'hidden' : 'auto';
        setStatus(event.target.checked ? 'Line wrap enabled.' : 'Line wrap disabled.');
    });

    document.getElementById('set-default-font').addEventListener('click', () => {
        editor.style.fontFamily = '"Courier New", Courier, monospace';
        editor.style.fontSize = '14px';
        setStatus('Default editor font restored.');
        scheduleSend();
    });

    document.getElementById('first-half-bold').addEventListener('click', () => {
        firstHalfBoldWords(editor);
        setStatus('Bolded the first half of longer words.');
        scheduleSend();
    });

    document.getElementById('second-half-bold').addEventListener('click', () => {
        secondHalfBoldWords(editor);
        setStatus('Bolded the second half of longer words.');
        scheduleSend();
    });

    document.getElementById('set-target').addEventListener('click', () => {
        target();
    });

    document.getElementById('link-target').addEventListener('click', () => {
        link();
    });

    document.getElementById('external-link').addEventListener('click', () => {
        xlink();
    });

    document.getElementById('clear-highlights').addEventListener('click', () => {
        clearAllHighlight();
    });

    document.getElementById('iconize-images').addEventListener('click', () => {
        replaceImagesInSelectionWithButtons();
    });

    document.getElementById('scale-images').addEventListener('click', () => {
        showImageScalingPopup();
    });

    document.getElementById('insert-media-file').addEventListener('click', () => {
        insertMediaFileAtSavedRange();
    });

    document.getElementById('copy-editor').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(editor.innerHTML);
            setStatus(`Copied editor HTML (${editor.innerHTML.length} chars).`);
        } catch (error) {
            setStatus(`Clipboard copy failed: ${error.message}`);
        }
    });

    document.getElementById('insert-html').addEventListener('click', () => {
        insertOrConvertHtml();
    });

    document.getElementById('render-markdown').addEventListener('click', () => {
        renderMarkdown();
    });

    document.getElementById('copy-markdown').addEventListener('click', () => {
        copyMarkdownToClipboard();
    });

    document.getElementById('js-command').addEventListener('click', () => {
        saveEditorRange();
        showJsCommandPopup();
    });

    document.getElementById('speak-selection').addEventListener('click', () => {
        speakSelection();
    });

    document.getElementById('stop-speaking').addEventListener('click', () => {
        stopSpeaking();
    });

    document.getElementById('word-count-selection').addEventListener('click', () => {
        wordCountSelection();
    });

    document.getElementById('increment-integers').addEventListener('click', () => {
        showIncrementIntegersPopup();
    });

    document.getElementById('reflow-selection').addEventListener('click', () => {
        showReflowPopup();
    });

    document.getElementById('explain-selection').addEventListener('click', () => {
        insertAbbrevAroundSelection();
    });

    document.getElementById('reverse-lines').addEventListener('click', () => {
        reverseLines();
    });

    document.getElementById('find-replace').addEventListener('click', () => {
        showFindReplaceDialog();
    });

    document.getElementById('toggleCursorModeBtn').addEventListener('click', () => {
        toggleCursorInsertMode();
    });

    document.getElementById('toggleCursorModeBtn').addEventListener('contextmenu', event => {
        event.preventDefault();
        cursorsAtSelectionLineEnds();
    });

    document.getElementById('clear-cursors').addEventListener('click', () => {
        clearAllCursors();
    });

    document.getElementById('enumerate-cursors').addEventListener('click', () => {
        enumerateCursors();
    });

    document.getElementById('alignWithCursorsBtn').addEventListener('click', () => {
        alignWithCursors();
    });

    document.getElementById('alignWithCursorsBtn').addEventListener('contextmenu', event => {
        event.preventDefault();
        alignWithCursorsFromLeft();
    });

    document.getElementById('sanitize-html').addEventListener('click', () => {
        sanitizeHtml();
    });

    document.getElementById('clean-instrumentation').addEventListener('click', () => {
        cleanInstrumentation();
    });

    document.getElementById('multi-regex-highlight').addEventListener('click', () => {
        showMultiRegexHighlightPopup();
    });

    document.getElementById('help-button').addEventListener('click', () => {
        showHelpPopup();
    });

    document.getElementById('insert-note').addEventListener('click', () => {
        editor.focus();
        saveEditorRange();
        showNoteInputPopup();
    });

    document.getElementById('insert-attachment').addEventListener('click', () => {
        editor.focus();
        insertDownloadLinkAtSavedRange();
    });

    editor.addEventListener('input', scheduleSend);
    editor.addEventListener('copy', handleEditorCopy);
    editor.addEventListener('paste', handleEditorPaste);
    editor.addEventListener('keyup', saveEditorRange);
    editor.addEventListener('keydown', saveEditorRange);
    editor.addEventListener('click', saveEditorRange);
    editor.addEventListener('click', insertCursorOnMouseDown);
    editor.addEventListener('mouseup', saveEditorRange);
    editor.addEventListener('focus', saveEditorRange);
    editor.addEventListener('dblclick', handleEditorDoubleClick);

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && diffNotesPickState) {
            event.preventDefault();
            cancelDiffNotesMode('diffnotes: note selection cancelled.');
        } else if (event.key === 'F7') {
            event.preventDefault();
            diffnotes();
        } else if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
            event.preventDefault();
            window.clearTimeout(sendTimer);
            vscode.postMessage({
                type: 'saveAll',
                plainText: getPlainText(),
                editorHtml: getEditorHtmlForSave()
            });
        } else if (event.ctrlKey && event.altKey && event.key === 'K') {
            event.preventDefault();
            keepHighlightLines();
        } else if (event.ctrlKey && event.altKey && event.key === 'D') {
            event.preventDefault();
            deleteHighlightLines();
        } else if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            keepCursorLines();
        } else if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'd') {
            event.preventDefault();
            deleteCursorLines();
        } else if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'm') {
            event.preventDefault();
            matchAndHighlightBrackets();
        } else if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'c') {
            event.preventDefault();
            clearAllHighlight();
        } else if (event.ctrlKey && event.altKey && event.key === '1') {
            event.preventDefault();
            insertAbbrevAroundSelection();
        } else if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'n') {
            event.preventDefault();
            toggleLineNumbers();
        } else if (event.ctrlKey && event.altKey && event.key === '/') {
            event.preventDefault();
            showMultiRegexHighlightPopup();
        } else if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'q') {
            event.preventDefault();
            insertDownloadLinkAtSavedRange();
        } else if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'r') {
            event.preventDefault();
            speakSelection();
        } else if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'l') {
            event.preventDefault();
            startVideoRecording();
        } else if (event.ctrlKey && event.altKey && event.key === 'S') {
            event.preventDefault();
            saveSnapshot();
        } else if (event.ctrlKey && event.altKey && event.key === 'p') {
            event.preventDefault();
            showImageScalingPopup();
        } else if (event.ctrlKey && event.altKey && event.key === 'P') {
            event.preventDefault();
            replaceImagesInSelectionWithButtons();
        } else if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            undoSnapshot();
        } else if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'y') {
            event.preventDefault();
            redoSnapshot();
        } else if (event.ctrlKey && event.altKey && event.key === 'V') {
            event.preventDefault();
            if (cursors.length > 0) {
                pasteClipboardHtmlAtCursors();
            } else {
                pasteSegmentsAcrossLines('end');
            }
        } else if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'v') {
            event.preventDefault();
            if (cursors.length > 0) {
                pasteClipboardHtmlAtCursors();
            } else {
                pasteSegmentsAcrossLines('start');
            }
        } else if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'm') {
            event.preventDefault();
            saveEditorRange();
            showNoteInputPopup();
        } else if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'q') {
            event.preventDefault();
            showJsCommandPopup();
        } else if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'l') {
            event.preventDefault();
            startRecording();
        } else if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'i') {
            event.preventDefault();
            insertOrConvertHtml();
        } else if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'b') {
            event.preventDefault();
            toggleTools();
        } else if ((event.ctrlKey || event.metaKey) && !event.altKey && /^[1-7]$/.test(event.key)) {
            event.preventDefault();
            sendSelectionToSearchBox(event.key);
        } else if (cursors.length === 0 && event.key === 'Enter' && event.target.closest('#editor') && editor.innerHTML !== '') {
            event.preventDefault();
            smartReturnPress();
        } else if (cursors.length === 0 && (event.key === '{' || event.key === '}') && event.target.closest('#editor')) {
            if (handleBraceKey(event.key)) {
                event.preventDefault();
            }
        } else if (cursors.length === 0 && event.key === 'Tab' && event.target.closest('#editor')) {
            event.preventDefault();
            indentSelectedLines(!event.shiftKey);
        } else if (cursors.length > 0 && !event.ctrlKey && !event.metaKey && event.target.closest('#editor')) {
            handleCursorKeydown(event);
        }
    });

    window.addEventListener('message', event => {
        const message = event.data;
        if (!message || typeof message.type !== 'string') {
            return;
        }
        if (message.type === 'externalTextChanged') {
            setStatus('Plain source changed outside rich editor; rich HTML layer not merged.');
        }
    });

    scheduleSend();

    function scheduleSend() {
        window.clearTimeout(sendTimer);
        sendTimer = window.setTimeout(sendChangeNow, 300);
    }

    function toggleTools() {
        toolbarsVisible = !toolbarsVisible;
        document.getElementById('top_toolbars').style.display = toolbarsVisible ? '' : 'none';
        setStatus(toolbarsVisible ? 'Toolbars shown.' : 'Toolbars hidden.');
    }

    function showJsCommandPopup() {
        ensureJsCommandPopup();
        jsCommandInput.value = '';
        jsCommandHistoryIndex = jsCommandHistory.length;
        jsCommandPopup.style.display = 'flex';
        jsCommandInput.focus();
    }

    function hideJsCommandPopup() {
        ensureJsCommandPopup();
        jsCommandPopup.style.display = 'none';
    }

    function ensureJsCommandPopup() {
        if (jsCommandPopup) {
            return;
        }
        jsCommandPopup = document.createElement('div');
        jsCommandPopup.className = 'js-command-popup';

        const label = document.createElement('label');
        label.htmlFor = 'jsCommandInput';
        label.textContent = 'Cmd';

        jsCommandInput = document.createElement('input');
        jsCommandInput.id = 'jsCommandInput';
        jsCommandInput.type = 'text';
        jsCommandInput.autocomplete = 'off';
        jsCommandInput.spellcheck = false;
        jsCommandInput.addEventListener('keydown', handleJsCommandKeydown);

        jsCommandPopup.appendChild(label);
        jsCommandPopup.appendChild(jsCommandInput);
        document.body.appendChild(jsCommandPopup);
    }

    function handleJsCommandKeydown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            runJsCommand(jsCommandInput.value);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (jsCommandHistoryIndex > 0) {
                jsCommandHistoryIndex -= 1;
                jsCommandInput.value = jsCommandHistory[jsCommandHistoryIndex];
            }
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (jsCommandHistoryIndex < jsCommandHistory.length - 1) {
                jsCommandHistoryIndex += 1;
                jsCommandInput.value = jsCommandHistory[jsCommandHistoryIndex];
            } else {
                jsCommandHistoryIndex = jsCommandHistory.length;
                jsCommandInput.value = '';
            }
        } else if (event.key === 'Escape') {
            event.preventDefault();
            jsCommandInput.value = '';
            jsCommandInput.focus();
        }
    }

    async function runJsCommand(rawCommand) {
        const command = String(rawCommand || '').trim();
        if (!command) {
            jsCommandInput.focus();
            return;
        }
        jsCommandHistory.push(command);
        jsCommandHistoryIndex = jsCommandHistory.length;

        try {
            const result = await evaluateJsCommand(command);
            setStatus(result === undefined ? `JS Cmd ran: ${command}` : `JS Cmd result: ${String(result)}`);
            scheduleSend();
            jsCommandInput.value = '';
            jsCommandInput.focus();
        } catch (error) {
            setStatus(`JS Cmd error: ${error.message}`);
            console.error('[JS Cmd Error]', error);
        }
    }

    function hideCmd() {
        hideJsCommandPopup();
        return '';
    }

    function evaluateJsCommand(command) {
        const normalizedCommand = command.replace(/\(\s*\)$/, '');
        const shortcut = command.match(/^(\d*)([yd])$/);
        if (shortcut) {
            const count = Number.parseInt(shortcut[1], 10) || 1;
            return shortcut[2] === 'y' ? yankLinesFromCaret(count) : deleteYankLinesFromCaret(count);
        }

        const aliases = {
            uc: () => transformSelectedText('upper'),
            lc: () => transformSelectedText('lower'),
            tc: () => transformSelectedText('title'),
            camel: () => transformSelectedText('camel'),
            snake: () => transformSelectedText('snake'),
            kebab: () => transformSelectedText('kebab'),
            wc: () => wordCountSelection(),
            clear: () => clearAllHighlight(),
            clearhl: () => clearAllHighlight(),
            mdrender: () => renderMarkdown(),
            tomd: () => copyMarkdownToClipboard(),
            reflow: () => showReflowPopup(),
            insertmedia: () => insertMediaFileAtSavedRange(),
            media: () => insertMediaFileAtSavedRange(),
            cmdhelp: () => cmdhelp(),
            hideCmd: () => hideCmd(),
            delete_empty_lines: () => delete_empty_lines(),
            block_color: () => block_color(),
            nested_block_color: () => nested_block_color()
        };
        if (Object.prototype.hasOwnProperty.call(aliases, normalizedCommand)) {
            return aliases[normalizedCommand]();
        }
        if (pluginCommands.has(normalizedCommand)) {
            return runPluginCommand(normalizedCommand);
        }

        let toEval = command;
        if (!/[()=]/.test(toEval)) {
            toEval += '()';
        }
        return eval(toEval);
    }

    function registerPluginCommand(name, fn) {
        const commandName = String(name || '').trim();
        if (!commandName || typeof fn !== 'function') {
            throw new Error('Spectral.registerCommand(name, fn) requires a command name and function.');
        }
        pluginCommands.set(commandName, fn);
        return commandName;
    }

    function runPluginCommand(name, ...args) {
        const commandName = String(name || '').trim();
        const fn = pluginCommands.get(commandName);
        if (!fn) {
            throw new Error(`Unknown plugin command: ${commandName}`);
        }
        return fn(...args);
    }

    function addPluginToolbarButton(label, handler, options = {}) {
        if (typeof handler !== 'function') {
            throw new Error('Spectral.addToolbarButton(label, handler) requires a handler function.');
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = String(label || 'Plugin');
        if (options.id) {
            button.id = String(options.id);
        }
        if (options.title) {
            button.title = String(options.title);
        }
        button.addEventListener('click', () => {
            try {
                const result = handler();
                if (result !== undefined) {
                    setStatus(String(result));
                }
                scheduleSend();
            } catch (error) {
                setStatus(`Plugin button error: ${error.message}`);
                console.error('[Spectral Plugin Button Error]', error);
            }
        });

        const toolbar = document.getElementById('spectral-plugin-toolbar')
            || document.querySelector('#top_toolbars .toolbar');
        if (!toolbar) {
            throw new Error('Plugin toolbar target not found.');
        }
        toolbar.appendChild(button);
        return button;
    }

    function saveSnapshot() {
        undoStack.push({
            html: getEditorHtmlForSave(),
            selection: savedEditorRange ? savedEditorRange.cloneRange() : null
        });
        redoStack = [];
        setStatus(`Snapshot saved. undo=${undoStack.length} redo=${redoStack.length}`);
    }

    function undoSnapshot() {
        if (!undoStack.length) {
            setStatus('No snapshot available to undo.');
            return;
        }
        redoStack.push({
            html: getEditorHtmlForSave(),
            selection: savedEditorRange ? savedEditorRange.cloneRange() : null
        });
        restoreSnapshot(undoStack.pop(), 'Snapshot undo restored.');
    }

    function redoSnapshot() {
        if (!redoStack.length) {
            setStatus('No snapshot available to redo.');
            return;
        }
        undoStack.push({
            html: getEditorHtmlForSave(),
            selection: savedEditorRange ? savedEditorRange.cloneRange() : null
        });
        restoreSnapshot(redoStack.pop(), 'Snapshot redo restored.');
    }

    function restoreSnapshot(snapshot, message) {
        if (!snapshot) {
            return;
        }
        clearAllCursors(false);
        lineNumbersShown = false;
        editor.innerHTML = snapshot.html || '';
        hydrateEditorControls(editor);
        if (snapshot.selection && editor.contains(snapshot.selection.commonAncestorContainer)) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(snapshot.selection);
            savedEditorRange = snapshot.selection.cloneRange();
        } else {
            savedEditorRange = null;
        }
        setStatus(`${message} undo=${undoStack.length} redo=${redoStack.length}`);
        scheduleSend();
    }

    function sendChangeNow() {
        window.clearTimeout(sendTimer);
        vscode.postMessage({
            type: 'changed',
            plainText: getPlainText(),
            editorHtml: getEditorHtmlForSave()
        });
    }

    function getEditorHtmlForSave() {
        const clone = editor.cloneNode(true);
        clone.querySelectorAll('.cursor').forEach(span => span.remove());
        clone.querySelectorAll('.cursor-marker').forEach(span => span.remove());
        clone.querySelectorAll('.line-number').forEach(span => span.remove());
        materializeEmbeddedVideoSources(clone);
        return clone.innerHTML;
    }

    function setStatus(text) {
        status.textContent = text;
        if (statusText) {
            statusText.value = text;
        }
    }

    const popupTextSearchStates = {};

    function getPopupTextSearchState(targetId) {
        if (!popupTextSearchStates[targetId]) {
            popupTextSearchStates[targetId] = {
                bg: '#fff2a8',
                fg: '#000000',
                last: '',
                pos: -1
            };
        }
        return popupTextSearchStates[targetId];
    }

    function popupSearchControlId(targetId, suffix) {
        return `${targetId}_popupSearch_${suffix}`;
    }

    function popupTextSearchOverlayId(targetId) {
        return `${targetId}_popupSearch_overlay`;
    }

    function ensurePopupTextSearchControls(popup, target, insertBefore = target) {
        if (!popup || !target || !target.id) return null;
        const targetId = target.id;
        const existing = document.getElementById(popupSearchControlId(targetId, 'bar'));
        if (existing) return existing;

        const state = getPopupTextSearchState(targetId);
        const bar = document.createElement('div');
        bar.id = popupSearchControlId(targetId, 'bar');
        bar.className = 'popup-text-search-controls';
        bar.innerHTML = [
            `<label for="${popupSearchControlId(targetId, 'input')}">Find:</label>`,
            `<input id="${popupSearchControlId(targetId, 'input')}" type="text" class="popup-text-search-input">`,
            `<label>BG <input id="${popupSearchControlId(targetId, 'bg')}" type="color" value="${state.bg}"></label>`,
            `<label>FG <input id="${popupSearchControlId(targetId, 'fg')}" type="color" value="${state.fg}"></label>`,
            `<button type="button" id="${popupSearchControlId(targetId, 'clear')}">Clear</button>`,
            `<span id="${popupSearchControlId(targetId, 'count')}" class="popup-text-search-count"></span>`
        ].join('');

        popup.insertBefore(bar, insertBefore || target);

        const input = document.getElementById(popupSearchControlId(targetId, 'input'));
        const bg = document.getElementById(popupSearchControlId(targetId, 'bg'));
        const fg = document.getElementById(popupSearchControlId(targetId, 'fg'));
        const clear = document.getElementById(popupSearchControlId(targetId, 'clear'));

        input.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            popupTextSearchNext(targetId, event.shiftKey ? -1 : 1);
        });
        input.addEventListener('input', () => {
            if (input.value === '') popupTextSearchClear(targetId);
        });
        bg.addEventListener('input', () => {
            state.bg = bg.value;
            popupTextSearchRehighlight(targetId);
        });
        fg.addEventListener('input', () => {
            state.fg = fg.value;
            popupTextSearchRehighlight(targetId);
        });
        clear.addEventListener('click', () => popupTextSearchClear(targetId));

        return bar;
    }

    function popupTextSearchSetCount(targetId, text) {
        const count = document.getElementById(popupSearchControlId(targetId, 'count'));
        if (count) count.textContent = text || '';
    }

    function popupTextSearchRestoreInputFocus(targetId) {
        const input = document.getElementById(popupSearchControlId(targetId, 'input'));
        if (!input) return;
        window.requestAnimationFrame(() => {
            input.focus();
            const end = input.value.length;
            input.setSelectionRange(end, end);
        });
    }

    function popupTextSearchClear(targetId) {
        const state = getPopupTextSearchState(targetId);
        const input = document.getElementById(popupSearchControlId(targetId, 'input'));
        const target = document.getElementById(targetId);
        if (input) input.value = '';
        state.last = '';
        state.pos = -1;
        if (target && target.matches('textarea,input')) {
            target.setSelectionRange(target.selectionStart || 0, target.selectionStart || 0);
        }
        popupTextSearchClearDomHighlights(targetId);
        popupTextSearchSetCount(targetId, '');
    }

    function popupTextSearchClearDomHighlights(targetId) {
        const target = document.getElementById(targetId);
        if (!target) return;
        if (target.matches('textarea,input')) {
            const overlay = document.getElementById(popupTextSearchOverlayId(targetId));
            if (overlay) {
                overlay.innerHTML = '';
                overlay.style.display = 'none';
            }
            target.classList.remove('popup-search-text-input');
            return;
        }
        target.querySelectorAll('span.popup-search-hit').forEach(span => {
            if (span.dataset.popupSearchTarget === targetId) {
                span.replaceWith(document.createTextNode(span.textContent || ''));
            }
        });
        target.normalize();
    }

    function popupTextSearchRehighlight(targetId) {
        const state = getPopupTextSearchState(targetId);
        const input = document.getElementById(popupSearchControlId(targetId, 'input'));
        if (!state.last && !(input && input.value)) return;
        const previous = state.pos;
        state.last = '';
        state.pos = previous - 1;
        popupTextSearchNext(targetId, 1);
    }

    function popupTextSearchNext(targetId, direction = 1) {
        const target = document.getElementById(targetId);
        const input = document.getElementById(popupSearchControlId(targetId, 'input'));
        if (!target || !input) return;

        const needle = input.value;
        if (!needle) {
            popupTextSearchClear(targetId);
            return;
        }

        const state = getPopupTextSearchState(targetId);
        if (needle !== state.last) {
            state.last = needle;
            state.pos = direction < 0 ? 0 : -1;
        }

        if (target.matches('textarea,input')) {
            popupTextSearchNextInTextInput(target, targetId, needle, direction);
        } else {
            popupTextSearchNextInElement(target, targetId, needle, direction);
        }
    }

    function popupTextSearchNextInTextInput(target, targetId, needle, direction) {
        const state = getPopupTextSearchState(targetId);
        const text = target.value || '';
        const starts = [];
        let idx = text.indexOf(needle);
        while (idx !== -1) {
            starts.push(idx);
            idx = text.indexOf(needle, idx + Math.max(needle.length, 1));
        }

        if (!starts.length) {
            popupTextSearchSetCount(targetId, '0');
            popupTextSearchClearDomHighlights(targetId);
            popupTextSearchRestoreInputFocus(targetId);
            return;
        }

        state.pos = (state.pos + direction + starts.length) % starts.length;
        const start = starts[state.pos];
        target.setSelectionRange(start, start);
        popupTextSearchRenderTextInputHighlights(target, targetId, starts, state.pos, needle.length, state.bg, state.fg);
        target.classList.add('popup-search-text-input');
        target.style.setProperty('--popup-search-bg', state.bg);
        target.style.setProperty('--popup-search-fg', state.fg);
        popupTextSearchSetCount(targetId, `${state.pos + 1}/${starts.length}`);
        popupTextSearchRestoreInputFocus(targetId);
    }

    function popupTextSearchEnsureTextInputOverlay(target, targetId) {
        let overlay = document.getElementById(popupTextSearchOverlayId(targetId));
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = popupTextSearchOverlayId(targetId);
        overlay.className = 'popup-text-search-overlay';
        overlay.style.display = 'none';
        popupTextSearchBindTemporaryDoubleClickHighlights(overlay);
        target.parentNode.insertBefore(overlay, target);
        return overlay;
    }

    function popupTextSearchRenderTextInputHighlights(target, targetId, starts, currentIndex, needleLength, bg, fg) {
        const overlay = popupTextSearchEnsureTextInputOverlay(target, targetId);
        const text = target.value || '';
        overlay.innerHTML = '';
        overlay.style.display = 'block';

        let cursor = 0;
        starts.forEach((start, index) => {
            if (start > cursor) {
                overlay.appendChild(document.createTextNode(text.slice(cursor, start)));
            }
            const span = document.createElement('span');
            span.className = index === currentIndex ? 'popup-search-hit popup-search-current' : 'popup-search-hit';
            span.dataset.popupSearchTarget = targetId;
            span.style.backgroundColor = bg;
            span.style.color = fg;
            if (index === currentIndex) span.style.textDecoration = 'underline';
            span.textContent = text.slice(start, start + needleLength);
            overlay.appendChild(span);
            cursor = start + needleLength;
        });
        if (cursor < text.length) {
            overlay.appendChild(document.createTextNode(text.slice(cursor)));
        }

        const current = overlay.querySelector('.popup-search-current');
        if (current) {
            window.requestAnimationFrame(() => current.scrollIntoView({ block: 'center', inline: 'nearest' }));
        }
    }

    function popupTextSearchBindTemporaryDoubleClickHighlights(element) {
        if (!element || element.dataset.popupTempDblclickBound === 'true') return;
        element.dataset.popupTempDblclickBound = 'true';
        element.addEventListener('dblclick', popupTextSearchTemporaryHighlightDoubleClick);
    }

    function popupTextSearchTemporaryHighlightDoubleClick(event) {
        const root = event.currentTarget;
        const selection = window.getSelection();
        const word = selection ? selection.toString().trim() : '';
        if (!word) return;
        popupTextSearchHighlightTemporaryOccurrences(root, word);
    }

    function popupTextSearchHighlightTemporaryOccurrences(root, word) {
        const color = randomHilightColor();
        const matches = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const parent = node.parentElement;
                if (!node.nodeValue || !parent || parent.closest('.popup-overlay-temp-highlight')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        let node = walker.nextNode();
        while (node) {
            collectWholeWordMatches(node, word).forEach(match => matches.push(match));
            node = walker.nextNode();
        }

        matches.reverse().forEach(match => {
            const range = document.createRange();
            range.setStart(match.node, match.start);
            range.setEnd(match.node, match.end);
            const span = document.createElement('span');
            span.className = 'popup-overlay-temp-highlight';
            span.style.backgroundColor = color;
            range.surroundContents(span);
        });
    }

    function popupTextSearchNodeFilter(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('.popup-text-search-controls, .popup-search-hit, script, style, textarea, input, select, button')) {
            return NodeFilter.FILTER_REJECT;
        }
        return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }

    function popupTextSearchBuildIndex(target) {
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, { acceptNode: popupTextSearchNodeFilter });
        const textNodes = [];
        let text = '';
        let node;
        while ((node = walker.nextNode())) {
            const start = text.length;
            text += node.nodeValue;
            textNodes.push({ node, start, end: text.length });
        }
        return { text, textNodes };
    }

    function popupTextSearchNextInElement(target, targetId, needle, direction) {
        const state = getPopupTextSearchState(targetId);
        popupTextSearchClearDomHighlights(targetId);

        const { text, textNodes } = popupTextSearchBuildIndex(target);
        const ranges = [];
        let idx = text.indexOf(needle);
        while (idx !== -1) {
            ranges.push({ start: idx, end: idx + needle.length });
            idx = text.indexOf(needle, idx + Math.max(needle.length, 1));
        }

        if (!ranges.length) {
            popupTextSearchSetCount(targetId, '0');
            return;
        }

        state.pos = (state.pos + direction + ranges.length) % ranges.length;
        popupTextSearchApplyElementHighlights(targetId, textNodes, ranges, state.pos, state.bg, state.fg);
        const current = Array.from(target.querySelectorAll('span.popup-search-current'))
            .find(span => span.dataset.popupSearchTarget === targetId);
        if (current) current.scrollIntoView({ block: 'center', inline: 'nearest' });
        popupTextSearchSetCount(targetId, `${state.pos + 1}/${ranges.length}`);
        popupTextSearchRestoreInputFocus(targetId);
    }

    function popupTextSearchApplyElementHighlights(targetId, textNodes, ranges, currentIndex, bg, fg) {
        const pieces = [];
        ranges.forEach((range, rangeIndex) => {
            textNodes.forEach(({ node, start, end }, order) => {
                if (end <= range.start || start >= range.end) return;
                pieces.push({
                    node,
                    order,
                    rangeIndex,
                    spanStart: Math.max(range.start, start) - start,
                    spanEnd: Math.min(range.end, end) - start
                });
            });
        });

        pieces.sort((a, b) => {
            if (a.order !== b.order) return b.order - a.order;
            return b.spanStart - a.spanStart;
        });

        pieces.forEach(({ node, rangeIndex, spanStart, spanEnd }) => {
            if (!node.parentNode || spanStart >= spanEnd) return;
            const range = document.createRange();
            range.setStart(node, spanStart);
            range.setEnd(node, spanEnd);
            const span = document.createElement('span');
            span.className = rangeIndex === currentIndex ? 'popup-search-hit popup-search-current' : 'popup-search-hit';
            span.dataset.popupSearchTarget = targetId;
            span.style.backgroundColor = bg;
            span.style.color = fg;
            if (rangeIndex === currentIndex) span.style.textDecoration = 'underline';
            try {
                range.surroundContents(span);
            } catch (_) {
                const fragment = range.extractContents();
                span.appendChild(fragment);
                range.insertNode(span);
            }
        });
    }

    function removeInlineStyle(styleName) {
        const commandByStyle = {
            fontWeight: 'bold',
            fontStyle: 'italic',
            textDecoration: 'underline'
        };
        const command = commandByStyle[styleName];
        if (!command) {
            return;
        }
        if (!document.queryCommandState || document.queryCommandState(command)) {
            document.execCommand(command, false, null);
        }
    }

    function saveEditorRange() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return;
        }
        const range = selection.getRangeAt(0);
        if (editor.contains(range.commonAncestorContainer)) {
            savedEditorRange = range.cloneRange();
        }
    }

    function getInsertionRange() {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (editor.contains(range.commonAncestorContainer) && range.collapsed) {
                return range.cloneRange();
            }
        }
        if (savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer)) {
            return savedEditorRange.cloneRange();
        }
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (editor.contains(range.commonAncestorContainer)) {
                return range.cloneRange();
            }
        }
        return null;
    }

    function getEditorSelectionRange() {
        const selection = window.getSelection();
        if (selection && selection.rangeCount) {
            const range = selection.getRangeAt(0);
            if (editor.contains(range.commonAncestorContainer)) {
                return range;
            }
        }
        if (savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer)) {
            return savedEditorRange.cloneRange();
        }
        return null;
    }

    function toggleCursorInsertMode() {
        if (savedEditorRange && !savedEditorRange.collapsed) {
            cursorsAtSelectionLineStarts();
            return;
        }

        cursorInsertMode = !cursorInsertMode;
        const button = document.getElementById('toggleCursorModeBtn');
        button.classList.toggle('active', cursorInsertMode);
        editor.style.cursor = cursorInsertMode ? 'crosshair' : '';
        setStatus(cursorInsertMode ? 'Click in the editor to add cursors.' : 'Cursor insertion mode off.');
    }

    function insertCursorOnMouseDown(event) {
        if (!cursorInsertMode) {
            return;
        }
        event.preventDefault();

        const range = rangeFromPoint(event.clientX, event.clientY);
        if (!range || !editor.contains(range.commonAncestorContainer)) {
            setStatus('Could not determine cursor location.');
            return;
        }

        range.collapse(true);
        addCursorAtRange(range);
        setStatus(`Cursor added. Total: ${cursors.length}`);
        scheduleSend();
    }

    function rangeFromPoint(x, y) {
        if (document.caretRangeFromPoint) {
            return document.caretRangeFromPoint(x, y);
        }
        if (document.caretPositionFromPoint) {
            const position = document.caretPositionFromPoint(x, y);
            if (!position) {
                return null;
            }
            const range = document.createRange();
            range.setStart(position.offsetNode, position.offset);
            return range;
        }
        return null;
    }

    function addCursorAtRange(range) {
        const normalized = range.cloneRange();
        normalized.collapse(true);
        const span = document.createElement('span');
        span.className = 'cursor';
        span.setAttribute('contenteditable', 'false');
        normalized.insertNode(span);

        const after = document.createRange();
        after.setStartAfter(span);
        after.collapse(true);
        cursors.push({ span, range: after });
    }

    function cursorsAtSelectionLineStarts() {
        cursorsAtSelectionLineEdges('start');
    }

    function cursorsAtSelectionLineEnds() {
        cursorsAtSelectionLineEdges('end');
    }

    function cursorsAtSelectionLineEdges(edge) {
        const range = savedEditorRange && savedEditorRange.cloneRange();
        if (!range || range.collapsed || !editor.contains(range.commonAncestorContainer)) {
            setStatus('No selected lines for cursor placement.');
            return;
        }

        const selectedText = extractTextWithLineBreaks(range.cloneContents());
        if (!selectedText) {
            setStatus('No selected lines for cursor placement.');
            return;
        }

        const plain = getPlainTextForIndexing();
        const start = plainOffsetForRangeStart(range);
        const end = start + selectedText.replace(/\r\n|\r/g, '\n').length;
        if (start < 0) {
            setStatus('Could not map selection to text offsets.');
            return;
        }

        const offsets = selectedLineEdgeOffsets(plain, start, end, edge);

        clearAllCursors(false);
        offsets.reverse().forEach(offset => {
            const position = getTextPositionForPlainOffset(offset);
            if (position) {
                const cursorRange = document.createRange();
                cursorRange.setStart(position.node, position.offset);
                cursorRange.collapse(true);
                addCursorAtRange(cursorRange);
            }
        });
        setStatus(`Added ${cursors.length} cursor(s) at selected line ${edge}s.`);
        scheduleSend();
    }

    function selectedLineEdgeOffsets(plainText, startOffset, endOffset, edge = 'start') {
        const text = String(plainText || '');
        const start = Math.max(0, Math.min(Number.parseInt(startOffset, 10) || 0, text.length));
        const end = Math.max(start, Math.min(Number.parseInt(endOffset, 10) || start, text.length));
        const firstLineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
        const offsets = [];
        let lineStart = firstLineStart;

        while (lineStart <= text.length && lineStart <= end) {
            const newline = text.indexOf('\n', lineStart);
            const lineEnd = newline < 0 ? text.length : newline;
            if (lineEnd >= start && lineStart <= end) {
                offsets.push(edge === 'end' ? lineEnd : lineStart);
            }
            if (newline < 0 || newline + 1 > end) {
                break;
            }
            lineStart = newline + 1;
        }

        return Array.from(new Set(offsets)).sort((a, b) => a - b);
    }

    function clearAllCursors(report = true) {
        cursors.forEach(cursor => {
            if (cursor.span && cursor.span.parentNode) {
                cursor.span.remove();
            }
        });
        editor.querySelectorAll('.cursor').forEach(span => span.remove());
        editor.normalize();
        cursors = [];
        cursorInsertMode = false;
        document.getElementById('toggleCursorModeBtn').classList.remove('active');
        editor.style.cursor = '';
        if (report) {
            setStatus('All cursors removed.');
            scheduleSend();
        }
    }

    function alignWithCursors() {
        alignWithCursorsByDeleting('right');
    }

    function alignWithCursorsFromLeft() {
        alignWithCursorsByDeleting('left');
    }

    function alignWithCursorsByDeleting(side) {
        if (!cursors.length) {
            setStatus('No cursors to align with.');
            return;
        }

        const offsets = cursors.map(cursor => plainOffsetForRangeStart(cursor.range))
            .filter(offset => offset >= 0)
            .sort((a, b) => b - a);

        clearAllCursors(false);
        const newRanges = [];
        let changed = 0;
        offsets.forEach(offset => {
            const edit = computeAlignWhitespaceEdit(getPlainTextForIndexing(), offset, side);
            if (edit.changed && deletePlainRange(edit.deleteStart, edit.deleteEnd)) {
                changed += 1;
            }

            const position = getTextPositionForPlainOffset(Math.min(edit.cursorOffset, getPlainTextForIndexing().length));
            if (position) {
                newRanges.push(createCollapsedRange(position.node, position.offset));
            }
        });

        hydrateEditorControls(editor);
        newRanges.reverse().forEach(range => addCursorAtRange(range));

        setStatus(`Aligned with cursors by deleting ${changed} ${side === 'left' ? 'preceding' : 'following'} space/tab character${changed === 1 ? '' : 's'}.`);
        scheduleSend();
    }

    function computeAlignWhitespaceEdit(plainText, offset, side = 'right') {
        const text = String(plainText || '');
        const cursorOffset = Math.max(0, Math.min(Number.parseInt(offset, 10) || 0, text.length));
        const direction = side === 'left' ? 'left' : 'right';
        const deleteStart = direction === 'left' ? cursorOffset - 1 : cursorOffset;

        if (deleteStart < 0 || deleteStart >= text.length) {
            return {
                changed: false,
                cursorOffset,
                deleteStart: -1,
                deleteEnd: -1
            };
        }

        const charToDelete = text.charAt(deleteStart);
        if (charToDelete !== ' ' && charToDelete !== '\t') {
            return {
                changed: false,
                cursorOffset,
                deleteStart: -1,
                deleteEnd: -1
            };
        }

        return {
            changed: true,
            cursorOffset: direction === 'left' ? deleteStart : cursorOffset,
            deleteStart,
            deleteEnd: deleteStart + 1
        };
    }

    function handleCursorKeydown(event) {
        if (event.key === 'Alt' || event.key === 'Shift' || event.key === 'Control' || event.key === 'Meta') {
            return;
        }

        if (event.key === 'Backspace') {
            event.preventDefault();
            editAtCursors('backspace');
        } else if (event.key === 'Delete') {
            event.preventDefault();
            editAtCursors('delete');
        } else if (event.key === 'Enter') {
            event.preventDefault();
            editAtCursors('insert', '\n');
        } else if (event.key === 'Tab') {
            event.preventDefault();
            editAtCursors('insert', '    ');
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            moveCursors('left');
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            moveCursors('right');
        } else if (event.key.length === 1) {
            event.preventDefault();
            editAtCursors('insert', event.key);
        }
    }

    function handleEditorPaste(event) {
        if (!cursors.length) {
            window.setTimeout(scheduleSend, 0);
            return;
        }

        event.preventDefault();
        const dataTransfer = event.clipboardData;
        if (!dataTransfer) {
            setStatus('Clipboard data is unavailable for multi-cursor paste.');
            return;
        }

        const html = dataTransfer.getData('text/html');
        if (html) {
            pasteHtmlAtCursors(html);
            return;
        }

        const imageFile = Array.from(dataTransfer.files || []).find(file => file.type && file.type.startsWith('image/'));
        if (imageFile) {
            const reader = new FileReader();
            reader.onload = () => {
                pasteHtmlAtCursors(`<img src="${escapeHtmlAttribute(reader.result || '')}" />`);
            };
            reader.onerror = () => setStatus('Image paste failed.');
            reader.readAsDataURL(imageFile);
            return;
        }

        const text = dataTransfer.getData('text/plain');
        if (text) {
            editAtCursors('insert', text);
            setStatus(`Pasted plain text into ${cursors.length} cursor${cursors.length === 1 ? '' : 's'}.`);
            return;
        }

        setStatus('Clipboard is empty.');
    }

    function handleEditorCopy(event) {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) {
            return;
        }
        const range = selection.getRangeAt(0);
        if (!editor.contains(range.commonAncestorContainer) || !event.clipboardData) {
            return;
        }

        event.preventDefault();
        const container = document.createElement('div');
        container.appendChild(range.cloneContents());
        container.querySelectorAll('.cursor, .cursor-marker, .line-number').forEach(node => node.remove());
        container.querySelectorAll('.note-button').forEach(button => {
            if (button.dataset.message) {
                button.setAttribute('data-message', button.dataset.message);
            }
        });
        container.querySelectorAll('a[data-select-id]').forEach(anchor => {
            anchor.setAttribute('data-select-id', anchor.getAttribute('data-select-id'));
        });

        const html = postProcessForEmail(container.innerHTML);
        const plainText = extractTextWithLineBreaks(container).replace(/\r\n|\r/g, '\n');
        event.clipboardData.setData('text/html', html);
        event.clipboardData.setData('text/plain', plainText);
        setStatus('Copied selected Spectral content.');
    }

    function editAtCursors(operation, text) {
        if (!cursors.length) {
            return;
        }

        const offsets = cursors.map(cursor => plainOffsetForRangeStart(cursor.range))
            .filter(offset => offset >= 0)
            .sort((a, b) => b - a);

        clearAllCursors(false);
        const newRanges = [];

        offsets.forEach(offset => {
            if (operation === 'insert') {
                const inserted = insertPlainTextAtOffset(offset, text);
                if (inserted) {
                    const position = getTextPositionForPlainOffset(offset + text.length);
                    if (position) {
                        newRanges.push(createCollapsedRange(position.node, position.offset));
                    }
                }
            } else if (operation === 'backspace') {
                if (offset > 0 && deletePlainRange(offset - 1, offset)) {
                    const position = getTextPositionForPlainOffset(offset - 1);
                    if (position) {
                        newRanges.push(createCollapsedRange(position.node, position.offset));
                    }
                } else {
                    const position = getTextPositionForPlainOffset(offset);
                    if (position) {
                        newRanges.push(createCollapsedRange(position.node, position.offset));
                    }
                }
            } else if (operation === 'delete') {
                deletePlainRange(offset, offset + 1);
                const position = getTextPositionForPlainOffset(offset);
                if (position) {
                    newRanges.push(createCollapsedRange(position.node, position.offset));
                }
            }
        });

        hydrateEditorControls(editor);
        newRanges.reverse().forEach(range => addCursorAtRange(range));

        setStatus(`Edited ${cursors.length} cursor${cursors.length === 1 ? '' : 's'}.`);
        scheduleSend();
    }

    function insertPlainTextAtOffset(offset, text) {
        const position = getTextPositionForPlainOffset(offset);
        if (!position) {
            return false;
        }
        const range = document.createRange();
        range.setStart(position.node, position.offset);
        range.collapse(true);
        range.insertNode(document.createTextNode(text));
        return true;
    }

    function deletePlainRange(startOffset, endOffset) {
        const plainLength = getPlainTextForIndexing().length;
        const start = Math.max(0, Math.min(startOffset, plainLength));
        const end = Math.max(start, Math.min(endOffset, plainLength));
        if (start === end) {
            return false;
        }
        if (end === start + 1 && getPlainTextForIndexing().charAt(start) === '\n') {
            const br = findBrAtPlainOffset(start);
            if (br) {
                br.remove();
                return true;
            }
        }
        const startPosition = getTextPositionForPlainOffset(start);
        const endPosition = getTextPositionForPlainOffset(end);
        if (!startPosition || !endPosition) {
            return false;
        }
        const range = document.createRange();
        range.setStart(startPosition.node, startPosition.offset);
        range.setEnd(endPosition.node, endPosition.offset);
        range.deleteContents();
        return true;
    }

    function findBrAtPlainOffset(targetOffset) {
        const target = Math.max(0, targetOffset);
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
            acceptNode(node) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.matches && node.matches('.line-number, .cursor, .cursor-marker')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return node.tagName && node.tagName.toUpperCase() === 'BR'
                        ? NodeFilter.FILTER_ACCEPT
                        : NodeFilter.FILTER_SKIP;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        let total = 0;
        let node = walker.nextNode();
        while (node) {
            if (node.nodeType === Node.TEXT_NODE) {
                total += node.textContent.length;
            } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName.toUpperCase() === 'BR') {
                if (total === target) {
                    return node;
                }
                total += 1;
            }
            node = walker.nextNode();
        }
        return null;
    }

    function enumerateCursors(countStart = 1) {
        if (!cursors.length) {
            setStatus('No multi-cursors present.');
            return;
        }

        const offsets = cursors.map(cursor => plainOffsetForRangeStart(cursor.range))
            .filter(offset => offset >= 0)
            .sort((a, b) => b - a);
        const labels = enumerateCursorLabels(offsets.length, countStart);

        clearAllCursors(false);
        const newRanges = [];
        offsets.forEach((offset, index) => {
            const position = getTextPositionForPlainOffset(offset);
            if (!position || position.node.nodeType !== Node.TEXT_NODE) {
                return;
            }
            const label = labels[index] || '';
            const node = position.node;
            const current = node.textContent || '';
            node.textContent = current.slice(0, position.offset) + label + current.slice(position.offset);
            newRanges.push(createCollapsedRange(node, position.offset + label.length));
        });

        hydrateEditorControls(editor);
        newRanges.reverse().forEach(range => addCursorAtRange(range));
        setStatus(`Enumerated ${cursors.length} cursor${cursors.length === 1 ? '' : 's'}.`);
        scheduleSend();
    }

    function enumerateCursorLabels(cursorCount, countStart) {
        const count = Math.max(0, Number.parseInt(cursorCount, 10) || 0);
        const start = Number.parseInt(countStart, 10) || 1;
        let counter = count + start - 1;
        return Array.from({ length: count }, () => `#${counter--} `);
    }

    function moveCursors(direction) {
        if (!cursors.length) {
            return;
        }

        const textLength = getPlainTextForIndexing().length;
        const offsets = cursors.map(cursor => plainOffsetForRangeStart(cursor.range))
            .filter(offset => offset >= 0)
            .map(offset => direction === 'left' ? Math.max(0, offset - 1) : Math.min(textLength, offset + 1));

        clearAllCursors(false);
        offsets.reverse().forEach(offset => {
            const position = getTextPositionForPlainOffset(offset);
            if (!position) {
                return;
            }
            const range = document.createRange();
            range.setStart(position.node, position.offset);
            range.collapse(true);
            addCursorAtRange(range);
        });

        setStatus(`Moved ${cursors.length} cursor${cursors.length === 1 ? '' : 's'} ${direction}.`);
    }

    function pasteHtmlAtCursors(html) {
        if (!cursors.length) {
            setStatus('No cursors available for HTML paste.');
            return;
        }

        const offsets = cursors.map(cursor => plainOffsetForRangeStart(cursor.range))
            .filter(offset => offset >= 0)
            .sort((a, b) => b - a);

        clearAllCursors(false);
        const newRanges = [];
        offsets.forEach(offset => {
            const position = getTextPositionForPlainOffset(offset);
            if (!position) {
                return;
            }

            const range = document.createRange();
            range.setStart(position.node, position.offset);
            range.collapse(true);

            const fragment = document.createRange().createContextualFragment(html);
            const lastNode = fragment.lastChild;
            range.insertNode(fragment);

            const newRange = document.createRange();
            if (lastNode && lastNode.parentNode) {
                if (lastNode.nodeType === Node.TEXT_NODE) {
                    newRange.setStart(lastNode, lastNode.textContent.length);
                } else {
                    newRange.setStartAfter(lastNode);
                }
                newRange.collapse(true);
                newRanges.push(newRange);
            }
        });

        hydrateEditorControls(editor);
        newRanges.reverse().forEach(range => addCursorAtRange(range));
        setStatus(`Pasted HTML into ${cursors.length} cursor${cursors.length === 1 ? '' : 's'}.`);
        scheduleSend();
    }

    async function pasteClipboardHtmlAtCursors() {
        if (!cursors.length) {
            setStatus('No cursors available for clipboard paste.');
            return;
        }

        try {
            const html = await readClipboardHtmlOrImageOrTextAsHtml();
            if (!html) {
                setStatus('Clipboard is empty.');
                return;
            }
            pasteHtmlAtCursors(html);
        } catch (error) {
            setStatus(`Clipboard paste failed: ${error.message}`);
        }
    }

    async function pasteSegmentsAcrossLines(position) {
        if (!savedEditorRange || !editor.contains(savedEditorRange.commonAncestorContainer)) {
            setStatus('Cursor is not inside the editor.');
            return;
        }

        try {
            const content = await readClipboardTextLikeContent();
            const segments = splitClipboardIntoSegments(content);
            if (!segments.length) {
                setStatus('Clipboard content is empty after splitting.');
                return;
            }

            const plain = getPlainText();
            const lines = plain.split('\n');
            const cursorOffset = getPlainProjectionOffsetForRange(savedEditorRange);
            if (cursorOffset < 0) {
                setStatus("Couldn't locate cursor in text flow.");
                return;
            }

            const lineIndex = plain.slice(0, Math.min(cursorOffset, plain.length)).split('\n').length - 1;
            segments.forEach((segment, index) => {
                const targetIndex = lineIndex + index;
                if (targetIndex >= lines.length) {
                    return;
                }
                lines[targetIndex] = position === 'start'
                    ? `${segment} ${lines[targetIndex]}`
                    : `${lines[targetIndex]} ${segment}`;
            });

            clearAllCursors(false);
            editor.innerHTML = textToSpectralHtml(lines.join('\n'));
            hydrateEditorControls(editor);
            setStatus(position === 'start'
                ? `Prepended ${segments.length} segment(s) at line starts.`
                : `Pasted ${segments.length} segment(s) line-wise.`);
            scheduleSend();
        } catch (error) {
            setStatus(`Error accessing clipboard: ${error.message}`);
        }
    }

    async function readClipboardHtmlOrImageOrTextAsHtml() {
        if (navigator.clipboard && navigator.clipboard.read) {
            const items = await navigator.clipboard.read();
            for (const item of items) {
                if (item.types.includes('text/html')) {
                    return (await item.getType('text/html')).text();
                }
            }
            for (const item of items) {
                const imageType = item.types.find(type => type.startsWith('image/'));
                if (imageType) {
                    const blob = await item.getType(imageType);
                    return `<img src="${escapeHtmlAttribute(await blobToDataUrl(blob))}" />`;
                }
            }
        }

        if (navigator.clipboard && navigator.clipboard.readText) {
            const text = await navigator.clipboard.readText();
            return text ? textToSpectralHtml(text) : '';
        }
        return '';
    }

    async function readClipboardTextLikeContent() {
        if (navigator.clipboard && navigator.clipboard.read) {
            const items = await navigator.clipboard.read();
            for (const item of items) {
                if (item.types.includes('text/html')) {
                    return (await item.getType('text/html')).text();
                }
            }
        }
        if (navigator.clipboard && navigator.clipboard.readText) {
            return navigator.clipboard.readText();
        }
        return '';
    }

    function splitClipboardIntoSegments(content) {
        return String(content || '')
            .split(/\r?\n|\r|<br\s*\/?>|<\/p>|<\/div>/i)
            .map(segment => segment.replace(/<[^>]+>/g, '').trim())
            .filter(segment => segment.length > 0);
    }

    function getPlainProjectionOffsetForRange(range) {
        const preRange = document.createRange();
        preRange.selectNodeContents(editor);
        try {
            preRange.setEnd(range.startContainer, range.startOffset);
        } catch (error) {
            return -1;
        }
        return cleanInvisibleCharsForOffset(extractTextWithLineBreaks(preRange.cloneContents())).length;
    }

    function cleanInvisibleCharsForOffset(text) {
        return String(text || '').replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
            .replace(/\r\n|\r/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n');
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result || '');
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    function escapeHtmlAttribute(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function keepCursorLines() {
        filterCursorLines(true);
    }

    function deleteCursorLines() {
        filterCursorLines(false);
    }

    function keepHighlightLines() {
        filterHighlightLines(true);
    }

    function deleteHighlightLines() {
        filterHighlightLines(false);
    }

    function indentSelectedLines(indent) {
        const selection = window.getSelection();
        const range = selection && selection.rangeCount ? selection.getRangeAt(0) : savedEditorRange;
        if (!range || !editor.contains(range.commonAncestorContainer)) {
            setStatus('No editor selection available for indentation.');
            return;
        }

        if (range.collapsed) {
            tabPressedNoSelection(indent, range);
            scheduleSend();
            return;
        }

        const originalText = extractTextWithLineBreaks(range.cloneContents());
        if (!originalText) {
            return;
        }

        const textNode = document.createTextNode(indentTextLines(originalText, indent));
        range.deleteContents();
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        savedEditorRange = range.cloneRange();
        setStatus(indent ? 'Indented selected lines.' : 'Unindented selected lines.');
        scheduleSend();
    }

    function tabPressedNoSelection(indent, range) {
        if (!indent) {
            const deleteRange = getRangeBeforeCursor(range, 4);
            const content = deleteRange.toString();
            if (content === '    ') {
                deleteRange.deleteContents();
                normalizeRangeContainer(deleteRange);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                savedEditorRange = range.cloneRange();
            }
            return;
        }

        const spaces = document.createTextNode('    ');
        range.insertNode(spaces);
        range.setStartAfter(spaces);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        savedEditorRange = range.cloneRange();
    }

    function indentTextLines(text, indent) {
        return String(text || '').split(/\r?\n/).map(line => {
            if (indent) {
                return `    ${line}`;
            }
            return unindentTextLine(line);
        }).join('\n');
    }

    function unindentTextLine(line) {
        if (line.startsWith('    ')) {
            return line.slice(4);
        }
        if (line.startsWith('   ')) {
            return line.slice(3);
        }
        if (line.startsWith('  ')) {
            return line.slice(2);
        }
        if (line.startsWith(' ') || line.startsWith('\t')) {
            return line.slice(1);
        }
        return line;
    }

    function transformSelectedText(mode) {
        const selection = window.getSelection();
        const range = getEditorSelectionRange();
        if (!range || !editor.contains(range.commonAncestorContainer)) {
            setStatus('No editor selection available for text transformation.');
            return;
        }

        const selectedText = extractTextWithLineBreaks(range.cloneContents());
        if (!selectedText) {
            setStatus('Selection is empty.');
            return;
        }

        const transformed = transformTextCase(selectedText, mode);
        const textNode = document.createTextNode(transformed);
        range.deleteContents();
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        savedEditorRange = range.cloneRange();
        setStatus(`Transformed selection: ${mode}.`);
        scheduleSend();
    }

    function wordCountSelection() {
        const range = getEditorSelectionRange();
        if (!range || !editor.contains(range.commonAncestorContainer)) {
            setStatus('No editor selection available for word count.');
            return 0;
        }

        const selectedText = range.toString().trim();
        if (!selectedText) {
            setStatus('No text selected.');
            return 0;
        }

        const count = selectedText.split(/\s+/).length;
        setStatus(`Word count: ${count}`);
        return count;
    }

    function showIncrementIntegersPopup() {
        showTextPopup(raw => {
            const parsed = parseIncrementIntegerRequest(raw);
            if (!parsed) {
                setStatus('Use: regex, delta. Example: item\\d+, 1');
                return;
            }
            incrementIntegers(parsed.pattern, parsed.delta);
        }, 'Increment integers in regex matches (regex, delta):', '-?\\d+, 1');
    }

    function parseIncrementIntegerRequest(raw) {
        const text = String(raw || '').trim();
        if (!text) {
            return null;
        }
        const comma = text.lastIndexOf(',');
        if (comma < 0) {
            return { pattern: text, delta: 1 };
        }
        const pattern = text.slice(0, comma).trim();
        const delta = Number.parseInt(text.slice(comma + 1).trim(), 10);
        if (!pattern || !Number.isFinite(delta)) {
            return null;
        }
        return { pattern, delta };
    }

    function incrementIntegers(pattern, delta) {
        let regex;
        try {
            regex = new RegExp(pattern, 'g');
        } catch (error) {
            setStatus(`Invalid regex: ${error.message}`);
            return;
        }

        const selection = window.getSelection();
        const range = selection && selection.rangeCount ? selection.getRangeAt(0) : savedEditorRange;
        if (range && !range.collapsed && editor.contains(range.commonAncestorContainer)) {
            incrementIntegersInRange(range, regex, delta);
            setStatus(`Incremented integers in selected matches by ${delta}.`);
        } else {
            incrementIntegersInRoot(editor, regex, delta);
            setStatus(`Incremented integers in editor matches by ${delta}.`);
        }
        scheduleSend();
    }

    function incrementIntegersInRoot(root, regex, delta) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                return isEditableTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        });
        let node = walker.nextNode();
        while (node) {
            node.textContent = incrementIntegersInMatches(node.textContent, regex, delta);
            node = walker.nextNode();
        }
    }

    function incrementIntegersInRange(range, regex, delta) {
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                return isEditableTextNode(node) && range.intersectsNode(node)
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            }
        });
        let node = walker.nextNode();
        while (node) {
            const length = node.textContent.length;
            const start = range.startContainer === node ? range.startOffset : 0;
            const end = range.endContainer === node ? range.endOffset : length;
            const before = node.textContent.slice(0, start);
            const middle = node.textContent.slice(start, end);
            const after = node.textContent.slice(end);
            node.textContent = before + incrementIntegersInMatches(middle, regex, delta) + after;
            node = walker.nextNode();
        }
    }

    function incrementIntegersInMatches(text, userPattern, delta = 1) {
        const source = String(text || '');
        const amount = Number.parseInt(delta, 10) || 0;
        const regex = userPattern instanceof RegExp
            ? new RegExp(userPattern.source, userPattern.flags.includes('g') ? userPattern.flags : `${userPattern.flags}g`)
            : new RegExp(String(userPattern || '-?\\d+'), 'g');

        return source.replace(regex, match => bumpIntegersInsideString(match, amount));
    }

    function bumpIntegersInsideString(text, delta) {
        return String(text || '').replace(/-?\d+/g, numberText => {
            const negative = numberText[0] === '-';
            const digits = negative ? numberText.slice(1) : numberText;
            const padded = digits.length > 1 && digits[0] === '0';
            const next = Number.parseInt(numberText, 10) + delta;
            const absolute = Math.abs(next).toString();

            if (padded && next >= 0) {
                return absolute.length >= digits.length ? absolute : absolute.padStart(digits.length, '0');
            }
            if (negative && next >= 0) {
                return absolute;
            }
            return next < 0 ? `-${absolute}` : absolute;
        });
    }

    function isEditableTextNode(node) {
        const parent = node && node.parentElement;
        return Boolean(parent) && !parent.closest('button, a, textarea, #textPopup, .recording-popup, .js-command-popup');
    }

    function insertOrConvertHtml() {
        const handled = convertSelectionTextToHtml();
        if (handled === true) {
            return;
        }
        if (handled === null) {
            setStatus('Selection is outside the editor.');
            return;
        }
        showHtmlInsertPrompt();
    }

    function insertMediaFileAtSavedRange() {
        saveEditorRange();
        ensureMediaFileInput();
        mediaFileInput.click();
    }

    function ensureMediaFileInput() {
        if (mediaFileInput) {
            return;
        }
        mediaFileInput = document.createElement('input');
        mediaFileInput.type = 'file';
        mediaFileInput.accept = 'audio/*,video/*';
        mediaFileInput.style.display = 'none';
        mediaFileInput.addEventListener('change', event => {
            const file = event.target.files && event.target.files[0];
            if (!file) {
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const dataURL = reader.result || '';
                const isVideo = /^video\//i.test(file.type) || String(dataURL).startsWith('data:video/');
                const isAudio = /^audio\//i.test(file.type) || String(dataURL).startsWith('data:audio/');
                if (!isVideo && !isAudio) {
                    setStatus(`Unsupported media file: ${file.name}`);
                    return;
                }

                const media = document.createElement(isVideo ? 'video' : 'audio');
                media.controls = true;
                media.setAttribute('data-spectral-media-name', file.name);
                if (isVideo) {
                    media.preload = 'metadata';
                    media.setAttribute('data-spectral-video-src', dataURL);
                    media.src = URL.createObjectURL(dataUrlToBlob(dataURL));
                    media.setAttribute('style', 'max-width: 100%; width: 360px; height: auto; display: inline-block; background: #000;');
                } else {
                    media.src = dataURL;
                    media.setAttribute('style', 'width: 120px; height: 28px; background: #aafba2;');
                }
                insertNodeAtSelection(media);
                setStatus(`Inserted media file: ${file.name}`);
            };
            reader.onerror = () => setStatus(`Could not read media file: ${file.name}`);
            reader.readAsDataURL(file);
            event.target.value = '';
        });
        document.body.appendChild(mediaFileInput);
    }

    function replaceImagesInSelectionWithButtons() {
        const selection = window.getSelection();
        const range = selection && selection.rangeCount ? selection.getRangeAt(0) : savedEditorRange;
        if (!range || range.collapsed || !editor.contains(range.commonAncestorContainer)) {
            setStatus('No selected editor range with images.');
            return;
        }

        const images = Array.from(editor.querySelectorAll('img')).filter(img => {
            try {
                return range.intersectsNode(img);
            } catch {
                return false;
            }
        });
        if (!images.length) {
            setStatus('No images found in selection.');
            return;
        }

        let replaced = 0;
        images.reverse().forEach(img => {
            img.replaceWith(makeImageButtonFromImg(img));
            replaced += 1;
        });
        hydrateEditorControls(editor);
        setStatus(`Replaced ${replaced} image${replaced === 1 ? '' : 's'} with reveal button${replaced === 1 ? '' : 's'}.`);
        scheduleSend();
    }

    function showImageScalingPopup() {
        showTextPopup(value => {
            const scale = Number.parseFloat(String(value || '').trim());
            if (!Number.isFinite(scale) || scale <= 0) {
                setStatus('Image scale must be a positive number.');
                return;
            }
            applyImageScaling(scale);
        }, 'Scale images (%):', '50');
    }

    function applyImageScaling(scale) {
        const images = selectedImages();
        if (images.length) {
            images.forEach(img => scaleImageElement(img, scale));
            setStatus(`Scaled ${images.length} selected image${images.length === 1 ? '' : 's'} to ${scale}%.`);
            scheduleSend();
            return;
        }

        const nearest = nearestImageToSavedRange();
        if (!nearest) {
            setStatus('No selected or nearby image found.');
            return;
        }
        scaleImageElement(nearest, scale);
        setStatus(`Scaled nearest image to ${scale}%.`);
        scheduleSend();
    }

    function selectedImages() {
        const selection = window.getSelection();
        const range = selection && selection.rangeCount ? selection.getRangeAt(0) : savedEditorRange;
        if (!range || !editor.contains(range.commonAncestorContainer)) {
            return [];
        }
        return Array.from(editor.querySelectorAll('img')).filter(img => {
            try {
                return range.intersectsNode(img);
            } catch {
                return false;
            }
        });
    }

    function nearestImageToSavedRange() {
        if (!savedEditorRange || !editor.contains(savedEditorRange.commonAncestorContainer)) {
            return null;
        }
        const reference = savedEditorRange.startContainer;
        let nearest = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        editor.querySelectorAll('img').forEach(img => {
            const distance = Math.abs(img.compareDocumentPosition(reference));
            if (distance < bestDistance) {
                nearest = img;
                bestDistance = distance;
            }
        });
        return nearest;
    }

    function scaleImageElement(img, scale) {
        const currentWidth = Number.parseFloat(img.getAttribute('width')) || img.naturalWidth || img.getBoundingClientRect().width;
        if (currentWidth > 0) {
            img.setAttribute('width', String(Math.max(1, Math.round(currentWidth * (scale / 100)))));
        } else {
            img.style.maxWidth = `${scale}%`;
        }
        img.removeAttribute('height');
        img.style.height = 'auto';
    }

    function makeImageButtonFromImg(imgEl) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'image-button-reveal';
        button.title = 'Show original image';
        button.textContent = imageButtonLabel(imgEl);
        button.setAttribute('data-imghtml', base64EncodeUtf8(imgEl.outerHTML));
        button.setAttribute('onclick', 'showImageFromButton(this)');
        button.addEventListener('click', () => showImageFromButton(button));
        return button;
    }

    function imageButtonLabel(imgEl) {
        const width = imgEl.getAttribute('width') || imgEl.naturalWidth || '';
        const height = imgEl.getAttribute('height') || imgEl.naturalHeight || '';
        return width && height ? `image ${width}x${height}` : 'image';
    }

    function showImageFromButton(button) {
        ensureImageViewer();
        imageViewerBody.innerHTML = base64DecodeUtf8(button.getAttribute('data-imghtml') || '');
        imageViewerPopup.style.display = 'block';
    }

    function ensureImageViewer() {
        if (imageViewerPopup) {
            return;
        }
        imageViewerPopup = document.createElement('div');
        imageViewerPopup.className = 'image-viewer-popup';
        const header = document.createElement('div');
        header.className = 'image-viewer-header';
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.textContent = 'Close';
        closeButton.addEventListener('click', () => {
            imageViewerPopup.style.display = 'none';
        });
        header.appendChild(closeButton);
        imageViewerBody = document.createElement('div');
        imageViewerBody.className = 'image-viewer-body';
        imageViewerPopup.appendChild(header);
        imageViewerPopup.appendChild(imageViewerBody);
        document.body.appendChild(imageViewerPopup);
    }

    function showHelpPopup() {
        ensureHelpPopup();
        helpPopup.style.display = 'block';
    }

    function commandHelpSections() {
        return [
            {
                title: 'Core',
                commands: [
                    ['cmdhelp()', 'Show this command reference.'],
                    ['hideCmd()', 'Hide the bottom JS command bar.'],
                    ['Spectral.commandNames()', 'List plugin commands registered with Spectral.registerCommand().'],
                    ['clear()', 'Clear temporary highlights.'],
                    ['reflow(60)', 'Rewrap selected text near the requested column.'],
                    ['delete_empty_lines()', 'Delete whitespace-only editor lines.']
                ]
            },
            {
                title: 'Notes',
                commands: [
                    ['createNote("3.7", "note text")', 'Create a note button at a line.character, line.end, or end index.'],
                    ['diffnotes()', 'Click two note buttons and compare their contents. F7 starts the same mode.'],
                    ['diffnotes({ granularity: "word" })', 'Compare notes by word; use "line", "word", or "char".'],
                    ['setDiffContext(2, 2)', 'Show changed lines plus context in line note diffs.'],
                    ['clearDiffContext()', 'Clear line-diff context.']
                ]
            },
            {
                title: 'Brace Blocks',
                commands: [
                    ['block_color(3, ["TODO"])', 'Color top-level brace blocks whose text matches every regex.'],
                    ['block_color("sel", ["TODO", "-done"])', 'Select matching brace blocks; prefix string regexes with - to negate them.'],
                    ['nested_block_color(1, 2, ["if", "return"])', 'Color matching brace blocks at nesting level 1.'],
                    ['nested_block_color(2, "#ccffdd", ["case"], 10, 80)', 'Only scan lines 10 through 80 for level-2 brace blocks.']
                ]
            },
            {
                title: 'Text',
                commands: [
                    ['insertTextAtIndex("3.7", "text")', 'Insert text at an explicit index.'],
                    ['inserText("end", "text")', 'Short alias for insertTextAtIndex().'],
                    ['uc, lc, tc', 'Uppercase, lowercase, or titlecase selected text.'],
                    ['camel, snake, kebab', 'Convert selected text case.'],
                    ['mdrender()', 'Render Markdown in the editor.'],
                    ['incrint("-?\\\\d+", 1)', 'Increment integers inside regex matches.']
                ]
            }
        ];
    }

    function renderCommandHelpHtml() {
        return commandHelpSections().map(section => {
            const rows = section.commands.map(([command, description]) =>
                `<tr><td><code>${escapeHtml(command)}</code></td><td>${escapeHtml(description)}</td></tr>`).join('');
            return `<h3>${escapeHtml(section.title)}</h3><table>${rows}</table>`;
        }).join('');
    }

    function cmdhelp() {
        ensureHelpPopup();
        helpPopup.querySelector('.help-popup-body').innerHTML = renderCommandHelpHtml();
        helpPopup.style.display = 'block';
        ensurePopupTextSearchControls(helpPopup, helpPopup.querySelector('.help-popup-body'), helpPopup.querySelector('.help-popup-body'));
    }

    function ensureHelpPopup() {
        if (helpPopup) {
            return;
        }
        helpPopup = document.createElement('div');
        helpPopup.className = 'help-popup';
        const header = document.createElement('div');
        header.className = 'help-popup-header';
        const title = document.createElement('strong');
        title.textContent = 'Spectral Web Commands';
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.textContent = 'Close';
        closeButton.addEventListener('click', () => {
            helpPopup.style.display = 'none';
        });
        header.appendChild(title);
        header.appendChild(closeButton);

        const body = document.createElement('div');
        body.id = 'helpPopupBody';
        body.className = 'help-popup-body';
        body.innerHTML = `<pre>${escapeHtml([
            'Ctrl+S            Save source and companion HTML layer',
            'Ctrl+i            Insert HTML / convert selected literal HTML',
            'Ctrl+m            Insert note',
            'Ctrl+q            Open JS command popup',
            'F7                Diff two note buttons',
            'Ctrl+l            Record audio into the editor',
            'Ctrl+b            Toggle all toolbars',
            'Render MD         Convert editor Markdown into rich HTML',
            'Copy MD           Copy selection/editor as Markdown',
            'JS Cmd            Run JavaScript command in webview',
            'cmdhelp           Show command reference',
            'Incr Int          Increment integers inside regex matches',
            'Ctrl+1..7         Send selection to regex search box',
            'Ctrl+Alt+1        Add explanation around selection',
            'Ctrl+Alt+/        Multi-regex highlight popup',
            'Ctrl+Alt+S        Save local snapshot',
            'Ctrl+Alt+z/y      Undo/redo local snapshot',
            'Ctrl+Alt+c        Clear temporary highlights',
            'Ctrl+Alt+m        Match brackets',
            'Ctrl+Alt+l        Record webcam video into the editor',
            'Ctrl+Alt+n        Toggle transient line numbers',
            'Ctrl+Alt+P        Iconize selected images',
            'Ctrl+Alt+q        Attach embedded file',
            'Ctrl+Alt+r        Speak selected text',
            'Stop Speech       Cancel speech output',
            'Ctrl+Alt+v/V      Paste segments at line starts/ends',
            'Ctrl+Alt+k/d      Keep/delete cursor lines',
            'Ctrl+Alt+K/D      Keep/delete highlighted lines',
            'Yank/DD Lines     Copy or copy-delete current line',
            'Tab / Shift+Tab   Indent / unindent',
            'Enter             Smart return indentation'
        ].join('\n'))}</pre>`;

        helpPopup.appendChild(header);
        helpPopup.appendChild(body);
        document.body.appendChild(helpPopup);
        ensurePopupTextSearchControls(helpPopup, body, body);
    }

    function showHtmlInsertPrompt() {
        showTextPopup(html => {
            insertHtmlAtSavedRange(html);
        }, 'Insert HTML at cursor:', '');
    }

    function insertHtmlAtSavedRange(html) {
        const range = getInsertionRange();
        if (!range) {
            setStatus('No saved cursor position to insert HTML.');
            return;
        }
        const fragment = createFragmentFromHtml(html, range);
        const lastNode = fragment.lastChild;
        range.deleteContents();
        range.insertNode(fragment);
        if (lastNode) {
            range.setStartAfter(lastNode);
            range.collapse(true);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            savedEditorRange = range.cloneRange();
        }
        hydrateEditorControls(editor);
        setStatus('HTML inserted at cursor.');
        scheduleSend();
    }

    function convertSelectionTextToHtml() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return false;
        }
        const range = selection.getRangeAt(0);
        if (!editor.contains(range.commonAncestorContainer)) {
            return null;
        }
        if (selection.isCollapsed) {
            return false;
        }

        const literal = range.toString();
        if (!literal) {
            return false;
        }

        const fragment = createFragmentFromHtml(literal, range);
        const lastNode = fragment.lastChild;
        range.deleteContents();
        range.insertNode(fragment);

        const after = document.createRange();
        if (lastNode) {
            after.setStartAfter(lastNode);
        } else {
            after.setStart(range.startContainer, range.startOffset);
        }
        after.collapse(true);
        selection.removeAllRanges();
        selection.addRange(after);
        savedEditorRange = after.cloneRange();
        hydrateEditorControls(editor);
        setStatus('Inserted selection as HTML.');
        scheduleSend();
        return true;
    }

    function createFragmentFromHtml(html, rangeForContext) {
        if (rangeForContext && typeof rangeForContext.createContextualFragment === 'function') {
            return rangeForContext.createContextualFragment(String(html || ''));
        }
        const template = document.createElement('template');
        template.innerHTML = String(html || '');
        return template.content;
    }

    function renderMarkdown() {
        const markdown = getPlainTextForIndexing();
        editor.innerHTML = markdownToHtml(markdown);
        hydrateEditorControls(editor);
        hydrateEmbeddedVideoSources(editor);
        setStatus('Rendered Markdown to HTML.');
        scheduleSend();
    }

    async function copyMarkdownToClipboard() {
        const markdown = exportSelectionOrEditorToMarkdown();
        if (!markdown) {
            setStatus('No editor content to export as Markdown.');
            return;
        }

        try {
            await navigator.clipboard.writeText(markdown);
            setStatus(`Copied Markdown (${markdown.length} chars).`);
        } catch (error) {
            setStatus(`Markdown copy failed: ${error.message}`);
        }
    }

    function exportSelectionOrEditorToMarkdown() {
        const root = getMarkdownExportRoot();
        cleanExportRoot(root);
        return normalizeMarkdown(childrenToMarkdown(root, { inPre: false }));
    }

    function getMarkdownExportRoot() {
        const selection = window.getSelection();
        const container = document.createElement('div');
        if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (editor.contains(range.commonAncestorContainer)) {
                container.appendChild(range.cloneContents());
                return container;
            }
        }
        container.appendChild(editor.cloneNode(true));
        return container;
    }

    function cleanExportRoot(root) {
        root.querySelectorAll('.cursor, .cursor-marker, .line-number').forEach(node => node.remove());
    }

    function childrenToMarkdown(node, context) {
        return Array.from(node.childNodes || []).map(child => nodeToMarkdown(child, context)).join('');
    }

    function nodeToMarkdown(node, context) {
        if (node.nodeType === Node.TEXT_NODE) {
            return context.inPre ? node.textContent || '' : escapeMarkdownText(node.textContent || '');
        }
        if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
            return '';
        }
        if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            return childrenToMarkdown(node, context);
        }

        if (node.matches('.cursor, .cursor-marker, .line-number')) {
            return '';
        }

        const tag = node.tagName.toUpperCase();
        if (tag === 'SCRIPT' || tag === 'STYLE') {
            return '';
        }
        if (node.matches('.note-button')) {
            const message = base64DecodeUtf8(node.getAttribute('data-message') || '');
            return message ? `[note: ${escapeMarkdownText(message)}]` : '[note]';
        }
        if (node.matches('.image-button-reveal')) {
            const imageHtml = base64DecodeUtf8(node.getAttribute('data-imghtml') || '');
            const template = document.createElement('template');
            template.innerHTML = imageHtml;
            const image = template.content.querySelector('img');
            return image ? nodeToMarkdown(image, context) : escapeMarkdownText(node.textContent || '');
        }

        if (/^H[1-6]$/.test(tag)) {
            return block(`${'#'.repeat(Number(tag[1]))} ${childrenToMarkdown(node, context).trim()}`);
        }
        if (tag === 'BR') {
            return '\n';
        }
        if (tag === 'HR') {
            return block('---');
        }
        if (tag === 'P' || tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') {
            return block(childrenToMarkdown(node, context).trim());
        }
        if (tag === 'PRE') {
            return fencedCode(node.textContent || '');
        }
        if (tag === 'CODE') {
            return context.inPre ? node.textContent || '' : wrapInlineCode(node.textContent || '');
        }
        if (tag === 'STRONG' || tag === 'B') {
            return `**${childrenToMarkdown(node, context).trim()}**`;
        }
        if (tag === 'EM' || tag === 'I') {
            return `*${childrenToMarkdown(node, context).trim()}*`;
        }
        if (tag === 'DEL' || tag === 'S') {
            return `~~${childrenToMarkdown(node, context).trim()}~~`;
        }
        if (tag === 'U') {
            return `<u>${childrenToMarkdown(node, context).trim()}</u>`;
        }
        if (tag === 'A') {
            const label = childrenToMarkdown(node, context).trim() || escapeMarkdownText(node.textContent || '');
            const href = node.getAttribute('href') || (node.dataset.selectId ? `#${node.dataset.selectId}` : '');
            return href ? `[${label}](${href})` : label;
        }
        if (tag === 'IMG') {
            const alt = escapeMarkdownText(node.getAttribute('alt') || '');
            const src = node.getAttribute('src') || '';
            return src ? `![${alt}](${src})` : alt;
        }
        if (tag === 'UL' || tag === 'OL') {
            return listToMarkdown(node, tag === 'OL');
        }
        if (tag === 'LI') {
            return `- ${childrenToMarkdown(node, context).trim()}`;
        }
        if (tag === 'BLOCKQUOTE') {
            const text = childrenToMarkdown(node, context).trim();
            return block(text.split('\n').map(line => `> ${line}`).join('\n'));
        }
        if (tag === 'TABLE') {
            return tableToMarkdown(node);
        }

        return childrenToMarkdown(node, context);
    }

    function listToMarkdown(list, ordered) {
        const items = Array.from(list.children || []).filter(child => child.tagName && child.tagName.toUpperCase() === 'LI');
        return block(items.map((item, index) => {
            const marker = ordered ? `${index + 1}.` : '-';
            return `${marker} ${childrenToMarkdown(item, { inPre: false }).trim()}`;
        }).join('\n'));
    }

    function tableToMarkdown(table) {
        const rows = Array.from(table.querySelectorAll('tr')).map(row =>
            Array.from(row.children).filter(cell => ['TD', 'TH'].includes(cell.tagName.toUpperCase()))
                .map(cell => tableCellMarkdown(cell))
        ).filter(row => row.length);
        if (!rows.length) {
            return '';
        }
        const header = rows[0];
        const separator = header.map(() => '---');
        const body = rows.slice(1);
        return block([header, separator].concat(body).map(row => `| ${row.join(' | ')} |`).join('\n'));
    }

    function tableCellMarkdown(cell) {
        return childrenToMarkdown(cell, { inPre: false }).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
    }

    function fencedCode(code) {
        const text = String(code || '').replace(/\r\n|\r/g, '\n');
        const fence = text.includes('```') ? '~~~' : '```';
        return `${fence}\n${text}\n${fence}\n\n`;
    }

    function block(text) {
        const value = String(text || '').trim();
        return value ? `${value}\n\n` : '';
    }

    function normalizeMarkdown(markdown) {
        return String(markdown || '')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function escapeMarkdownText(text) {
        return String(text || '').replace(/([\\`*_{}\[\]()#+\-.!|>])/g, '\\$1');
    }

    function wrapInlineCode(text) {
        const value = String(text || '');
        const longestRun = (value.match(/`+/g) || ['']).reduce((longest, run) => Math.max(longest, run.length), 0);
        const fence = '`'.repeat(longestRun + 1);
        return `${fence}${value}${fence}`;
    }

    function markdownToHtml(markdown) {
        const codeBlocks = [];
        const lines = String(markdown || '').replace(/\r\n|\r/g, '\n').split('\n');
        const protectedLines = [];
        for (let index = 0; index < lines.length; index += 1) {
            const open = lines[index].match(/^\s*([`~]{3,})\s*([^\s`~]+)?\s*$/);
            if (!open) {
                protectedLines.push(lines[index]);
                continue;
            }
            const fenceChar = open[1][0];
            const fenceLen = open[1].length;
            const lang = (open[2] || '').trim().split(/\s+/)[0] || '';
            const buffer = [];
            index += 1;
            const closeRe = new RegExp(`^\\s*${escapeRegex(fenceChar)}{${fenceLen},}\\s*$`);
            while (index < lines.length && !closeRe.test(lines[index])) {
                buffer.push(lines[index]);
                index += 1;
            }
            const id = codeBlocks.push({ lang, code: buffer.join('\n') }) - 1;
            protectedLines.push(`@@CODEBLOCK${id}@@`);
        }

        const rendered = renderMarkdownBlocks(protectedLines.join('\n'));
        return rendered.replace(/@@CODEBLOCK(\d+)@@/g, (_match, id) => {
            const block = codeBlocks[Number(id)] || { lang: '', code: '' };
            return `<pre><code${block.lang ? ` class="language-${escapeHtml(block.lang)}"` : ''}>${escapeHtml(block.code)}</code></pre>`;
        });
    }

    function renderMarkdownBlocks(text) {
        const lines = String(text || '').split('\n');
        const out = [];
        let paragraph = [];
        let listType = null;

        function flushParagraph() {
            if (paragraph.length) {
                out.push(`<p>${inlineMarkdown(paragraph.join(' ').trim())}</p>`);
                paragraph = [];
            }
        }

        function closeList() {
            if (listType) {
                out.push(`</${listType}>`);
                listType = null;
            }
        }

        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) {
                flushParagraph();
                closeList();
                return;
            }
            if (/^@@CODEBLOCK\d+@@$/.test(trimmed)) {
                flushParagraph();
                closeList();
                out.push(trimmed);
                return;
            }
            const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
            if (heading) {
                flushParagraph();
                closeList();
                const level = heading[1].length;
                out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
                return;
            }
            if (/^([-*_]){3,}$/.test(trimmed)) {
                flushParagraph();
                closeList();
                out.push('<hr/>');
                return;
            }
            if (trimmed.startsWith('>')) {
                flushParagraph();
                closeList();
                out.push(`<blockquote>${inlineMarkdown(trimmed.replace(/^>\s?/, ''))}</blockquote>`);
                return;
            }
            const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
            const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
            if (unordered || ordered) {
                flushParagraph();
                const nextType = unordered ? 'ul' : 'ol';
                if (listType !== nextType) {
                    closeList();
                    listType = nextType;
                    out.push(`<${listType}>`);
                }
                out.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`);
                return;
            }
            paragraph.push(line);
        });

        flushParagraph();
        closeList();
        return out.join('\n');
    }

    function inlineMarkdown(text) {
        const spans = [];
        let escaped = escapeHtml(text);
        escaped = escaped.replace(/`([^`]+)`/g, (_match, code) => {
            const id = spans.push(`<code>${code}</code>`) - 1;
            return `@@SPAN${id}@@`;
        });
        escaped = escaped.replace(/!\[([^\]]*)\]\((\S+?)(?:\s+&quot;(.*?)&quot;)?\)/g, (_match, alt, src, title) =>
            `<img src="${src}" alt="${alt}"${title ? ` title="${title}"` : ''}/>`);
        escaped = escaped.replace(/\[([^\]]+)\]\((\S+?)(?:\s+&quot;(.*?)&quot;)?\)/g, (_match, label, href, title) =>
            `<a href="${href}"${title ? ` title="${title}"` : ''} target="_blank" rel="noopener noreferrer">${label}</a>`);
        escaped = escaped.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
        escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        escaped = escaped.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        return escaped.replace(/@@SPAN(\d+)@@/g, (_match, id) => spans[Number(id)] || '');
    }

    function speakSelection() {
        const text = getSelectedTextInsideEditor().trim();
        if (!text) {
            setStatus('No selected text to speak.');
            return;
        }
        if (!window.speechSynthesis) {
            setStatus('Speech synthesis is not available in this webview.');
            return;
        }
        window.speechSynthesis.cancel();
        speechRunId += 1;
        const runId = speechRunId;
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => {
            if (runId === speechRunId) {
                setStatus('Finished speaking selected text.');
            }
        };
        window.speechSynthesis.speak(utterance);
        setStatus('Speaking selected text.');
    }

    function stopSpeaking() {
        if (!window.speechSynthesis) {
            setStatus('Speech synthesis is not available in this webview.');
            return;
        }
        speechRunId += 1;
        window.speechSynthesis.cancel();
        setStatus('Speech stopped.');
    }

    function startRecording() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
            setStatus('Audio recording is not available in this webview.');
            return;
        }
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = event => {
                if (event.data && event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };
            mediaRecorder.onstop = () => {
                stream.getTracks().forEach(track => track.stop());
                const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
                if (audioBlob.size === 0) {
                    hideRecordingPopup();
                    setStatus('Audio recording produced no data.');
                    return;
                }
                const reader = new FileReader();
                reader.onloadend = () => {
                    const audio = document.createElement('audio');
                    audio.controls = true;
                    audio.src = reader.result;
                    audio.setAttribute('style', 'width: 120px; height: 28px; background: #aafba2;');
                    insertNodeAtSelection(audio);
                    audioChunks = [];
                    hideRecordingPopup();
                    setStatus(`Audio recording inserted (${Math.round(audioBlob.size / 1024)} KB).`);
                };
                reader.readAsDataURL(audioBlob);
            };
            mediaRecorder.start();
            showRecordingPopup('Recording audio.', stopRecording);
            setStatus('Audio recording started.');
        }).catch(error => {
            setStatus(explainMediaAccessError(error, 'Microphone'));
        });
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        } else {
            hideRecordingPopup();
        }
    }

    function getSupportedVideoMimeType(preferredMimeType = '') {
        if (preferredMimeType) {
            return preferredMimeType;
        }
        const types = [
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=opus',
            'video/webm',
            'video/mp4'
        ];
        if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
            return '';
        }
        return types.find(type => MediaRecorder.isTypeSupported(type)) || '';
    }

    function getDataUrlSafeVideoMimeType(mimeType) {
        const containerType = String(mimeType || 'video/webm').split(';')[0].trim();
        return containerType || 'video/webm';
    }

    function startVideoRecording(options = {}) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
            setStatus('Camera recording is not available in this webview.');
            return;
        }
        const constraints = options.constraints || {
            video: true,
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };

        navigator.mediaDevices.getUserMedia(constraints).then(stream => {
            videoStream = stream;
            videoChunks = [];
            videoRecordingStartedAt = Date.now();
            const audioTrackCount = stream.getAudioTracks().length;
            const videoTrackCount = stream.getVideoTracks().length;
            const selectedMimeType = options.mimeType || getSupportedVideoMimeType();
            const mimeType = selectedMimeType && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(selectedMimeType) ? selectedMimeType : '';
            videoMediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

            videoMediaRecorder.ondataavailable = event => {
                if (event.data && event.data.size > 0) {
                    videoChunks.push(event.data);
                    setRecordingStatus(`Recording video. Last chunk ${Math.round(event.data.size / 1024)} KB.`);
                }
            };
            videoMediaRecorder.onerror = event => {
                setStatus(`Video recorder error: ${(event.error && event.error.message) || event.type || event}`);
            };
            videoMediaRecorder.onstop = () => finishVideoRecording(mimeType, audioTrackCount);

            videoMediaRecorder.start(1000);
            showRecordingPopup(`Recording video (${videoTrackCount} video, ${audioTrackCount} audio).`, stopVideoRecording);
            setStatus(`Video recording started. Recorder MIME: '${videoMediaRecorder.mimeType || 'browser default'}'.`);
        }).catch(error => {
            stopVideoStreamTracks();
            setStatus(explainMediaAccessError(error, 'Camera/microphone'));
        });
    }

    function explainMediaAccessError(error, label) {
        const message = error && error.message ? error.message : String(error || 'unknown error');
        if (/permission|notallowed|denied|policy/i.test(message)) {
            return `${label} access denied or blocked by VS Code webview permissions policy. Use JS Cmd: insertMediaFileAtSavedRange() to embed a recorded media file instead.`;
        }
        return `${label} access unavailable: ${message}`;
    }

    function finishVideoRecording(mimeType, audioTrackCount) {
        const recordedType = videoMediaRecorder ? videoMediaRecorder.mimeType || mimeType || 'video/webm' : mimeType || 'video/webm';
        const videoBlob = new Blob(videoChunks, { type: recordedType });
        const persistedVideoBlob = new Blob(videoChunks, { type: getDataUrlSafeVideoMimeType(recordedType) });
        const elapsedSeconds = Math.max(0, Math.round((Date.now() - videoRecordingStartedAt) / 1000));

        if (videoBlob.size === 0) {
            videoChunks = [];
            stopVideoStreamTracks();
            hideRecordingPopup();
            setStatus(`Video recording produced no data after ${elapsedSeconds}s.`);
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            const dataURL = normalizeVideoDataUrl(reader.result);
            const video = document.createElement('video');
            video.controls = true;
            video.preload = 'metadata';
            video.src = URL.createObjectURL(videoBlob);
            video.setAttribute('data-spectral-video-src', dataURL);
            video.setAttribute('data-spectral-video-type', recordedType);
            video.setAttribute('data-spectral-audio-tracks', String(audioTrackCount));
            video.setAttribute('style', 'max-width: 100%; width: 360px; height: auto; display: inline-block; background: #000;');
            insertNodeAtSelection(video);
            video.load();
            videoChunks = [];
            stopVideoStreamTracks();
            hideRecordingPopup();
            setStatus(`Video recording inserted (${Math.round(videoBlob.size / 1024)} KB, ${elapsedSeconds}s).`);
        };
        reader.readAsDataURL(persistedVideoBlob);
    }

    function stopVideoStreamTracks() {
        if (videoStream) {
            videoStream.getTracks().forEach(track => track.stop());
            videoStream = null;
        }
    }

    function stopVideoRecording() {
        if (videoMediaRecorder && videoMediaRecorder.state !== 'inactive') {
            try {
                videoMediaRecorder.requestData();
            } catch (error) {
                setStatus(`Could not request final video chunk: ${error.message}`);
            }
            videoMediaRecorder.stop();
        } else {
            stopVideoStreamTracks();
            hideRecordingPopup();
        }
    }

    function showRecordingPopup(message, stopCallback) {
        ensureRecordingPopup();
        setRecordingStatus(message);
        recordingStopButton.onclick = stopCallback;
        recordingPopup.style.display = 'block';
    }

    function setRecordingStatus(message) {
        ensureRecordingPopup();
        recordingStatus.textContent = message;
    }

    function hideRecordingPopup() {
        ensureRecordingPopup();
        recordingPopup.style.display = 'none';
    }

    function ensureRecordingPopup() {
        if (recordingPopup) {
            return;
        }
        recordingPopup = document.createElement('div');
        recordingPopup.className = 'recording-popup';
        recordingStatus = document.createElement('span');
        recordingStopButton = document.createElement('button');
        recordingStopButton.type = 'button';
        recordingStopButton.textContent = 'Stop';
        recordingPopup.appendChild(recordingStatus);
        recordingPopup.appendChild(recordingStopButton);
        document.body.appendChild(recordingPopup);
    }

    function sendSelectionToSearchBox(key) {
        const input = document.getElementById(`searchBox${key}`);
        if (!input) {
            return;
        }
        const selection = window.getSelection();
        if (selection && selection.rangeCount && !selection.isCollapsed) {
            input.value = selection.toString();
        }
        input.focus();
        setStatus(`Search box ${key} focused${input.value ? ' with selected text' : ''}.`);
    }

    function showReflowPopup() {
        showTextPopup(value => {
            const maxColumn = Number.parseInt(value, 10);
            if (!Number.isFinite(maxColumn) || maxColumn < 1) {
                setStatus('Reflow column must be a positive integer.');
                return;
            }
            reflowSelection(maxColumn);
        }, 'Reflow selected text to column:', '72');
    }

    function reflow(maxColumn) {
        const column = Number.parseInt(maxColumn, 10);
        if (!Number.isFinite(column) || column < 1) {
            showReflowPopup();
            return;
        }
        reflowSelection(column);
    }

    function reflowSelection(maxColumn) {
        const selection = window.getSelection();
        const range = selection && selection.rangeCount ? selection.getRangeAt(0) : savedEditorRange;
        if (!range || !editor.contains(range.commonAncestorContainer)) {
            setStatus('No editor selection available for reflow.');
            return;
        }

        const selectedText = extractTextWithLineBreaks(range.cloneContents());
        if (!selectedText.trim()) {
            setStatus('Selection is empty.');
            return;
        }

        const textNode = document.createTextNode(reflowText(selectedText, maxColumn));
        range.deleteContents();
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        savedEditorRange = range.cloneRange();
        setStatus(`Reflowed selected text to ${maxColumn} columns.`);
        scheduleSend();
    }

    function reflowText(text, maxColumn) {
        const column = Number(maxColumn);
        if (!Number.isFinite(column) || column < 1) {
            return String(text || '');
        }

        const normalized = String(text || '').replace(/\s*\r?\n\s*/g, ' ');
        let output = '';
        let col = 0;

        for (let index = 0; index < normalized.length; index += 1) {
            const ch = normalized[index];
            if (ch === ' ' || ch === '\t') {
                if (col > column) {
                    output += '\n';
                    col = 0;
                } else {
                    output += ch;
                    col += 1;
                }
            } else {
                output += ch;
                col += 1;
            }
        }

        return output;
    }

    function insertAbbrevAroundSelection() {
        const selection = window.getSelection();
        if (!selection.rangeCount || selection.isCollapsed || !editor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
            setStatus('Select something first to add an explanation.');
            return;
        }

        savedEditorRangeForAbbrev = selection.getRangeAt(0).cloneRange();
        showTextPopup(explanation => {
            if (!explanation || !savedEditorRangeForAbbrev) {
                return;
            }

            const range = savedEditorRangeForAbbrev;
            if (!editor.contains(range.commonAncestorContainer)) {
                setStatus('Saved selection is no longer available for explanation.');
                return;
            }

            const abbrev = document.createElement('abbrev');
            abbrev.setAttribute('title', explanation);
            abbrev.appendChild(range.extractContents());
            range.insertNode(abbrev);

            range.setStartAfter(abbrev);
            range.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            savedEditorRange = range.cloneRange();
            savedEditorRangeForAbbrev = null;
            setStatus('Explanation inserted.');
            scheduleSend();
        }, 'Enter explanation:', '');
    }

    function toggleLineNumbers() {
        if (lineNumbersShown) {
            removeLineNumbers(editor);
            lineNumbersShown = false;
            setStatus('Line numbers hidden.');
            scheduleSend();
            return;
        }

        removeLineNumbers(editor);
        const lines = editor.innerHTML.split(/<br\s*\/?>/i);
        const padWidth = String(lines.length).length;
        editor.innerHTML = lines.map((line, index) => {
            const label = String(index + 1).padStart(padWidth, '0');
            return `<span class="line-number" contenteditable="false">${label} </span>${line}`;
        }).join('<br>');
        hydrateEditorControls(editor);
        lineNumbersShown = true;
        setStatus('Line numbers shown.');
        scheduleSend();
    }

    function removeLineNumbers(root) {
        root.querySelectorAll('.line-number').forEach(span => span.remove());
    }

    function reverseLines() {
        if (lineNumbersShown) {
            removeLineNumbers(editor);
            lineNumbersShown = false;
        }

        const selection = window.getSelection();
        const range = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
        if (range && !range.collapsed && editor.contains(range.commonAncestorContainer)) {
            markRangeForLineOperation(range);
        }

        const result = reverseHtmlLines(editor.innerHTML);
        editor.innerHTML = result.html;
        hydrateEditorControls(editor);
        setStatus(result.selectedOnly
            ? `Reversed ${result.reversedLineCount} selected line${result.reversedLineCount === 1 ? '' : 's'}.`
            : `Reversed ${result.reversedLineCount} line${result.reversedLineCount === 1 ? '' : 's'}.`);
        scheduleSend();
    }

    async function yankLinesFromCaret(count = 1) {
        const range = rangeForLineBlockFromCaret(count);
        if (!range) {
            setStatus('No single caret line to yank.');
            return;
        }
        if (await copyRangeToClipboard(range)) {
            setStatus(`Yanked ${count} line${count === 1 ? '' : 's'}.`);
        }
    }

    async function deleteYankLinesFromCaret(count = 1) {
        const range = rangeForLineBlockFromCaret(count);
        if (!range) {
            setStatus('No single caret line to delete.');
            return;
        }
        if (!await copyRangeToClipboard(range)) {
            return;
        }
        range.deleteContents();
        savedEditorRange = null;
        hydrateEditorControls(editor);
        setStatus(`Deleted and yanked ${count} line${count === 1 ? '' : 's'}.`);
        scheduleSend();
    }

    function rangeForLineBlockFromCaret(count) {
        const selection = window.getSelection();
        const sourceRange = selection && selection.rangeCount ? selection.getRangeAt(0) : savedEditorRange;
        if (!sourceRange || !sourceRange.collapsed || !editor.contains(sourceRange.commonAncestorContainer)) {
            return null;
        }
        const block = computeLineBlockRange(getPlainTextForIndexing(), plainOffsetForRangeStart(sourceRange), count);
        const start = getTextPositionForPlainOffset(block.start);
        const end = getTextPositionForPlainOffset(block.end);
        if (!start || !end) {
            return null;
        }
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        return range;
    }

    function plainOffsetForRangeStart(range) {
        const before = document.createRange();
        before.selectNodeContents(editor);
        before.setEnd(range.startContainer, range.startOffset);
        return extractTextWithLineBreaks(before.cloneContents()).replace(/\r\n|\r/g, '\n').length;
    }

    async function copyRangeToClipboard(range) {
        const container = document.createElement('div');
        container.appendChild(range.cloneContents());
        container.querySelectorAll('.cursor, .cursor-marker, .line-number').forEach(node => node.remove());
        container.querySelectorAll('.note-button').forEach(button => {
            if (button.dataset.message) {
                button.setAttribute('data-message', button.dataset.message);
            }
        });
        container.querySelectorAll('a[onclick]').forEach(anchor => {
            const onclick = anchor.getAttribute('onclick') || '';
            const match = onclick.match(/selectText\(['"]([^'"]+)['"]\)/);
            if (match) {
                anchor.setAttribute('data-select-id', match[1]);
            }
            anchor.removeAttribute('onclick');
        });

        const html = postProcessForEmail(container.innerHTML);
        const plainText = cleanInvisibleChars(extractTextWithLineBreaks(container));
        try {
            if (window.ClipboardItem && navigator.clipboard.write) {
                await navigator.clipboard.write([
                    new ClipboardItem({
                        'text/plain': new Blob([plainText], { type: 'text/plain' }),
                        'text/html': new Blob([html], { type: 'text/html' })
                    })
                ]);
            } else {
                await navigator.clipboard.writeText(plainText);
            }
            return true;
        } catch (error) {
            setStatus(`Clipboard copy failed: ${error.message}`);
            return false;
        }
    }

    function markRangeForLineOperation(range) {
        const startMarker = document.createElement('span');
        const endMarker = document.createElement('span');
        startMarker.id = 'selection-start';
        endMarker.id = 'selection-end';

        const endRange = range.cloneRange();
        endRange.collapse(false);
        endRange.insertNode(endMarker);

        const startRange = range.cloneRange();
        startRange.collapse(true);
        startRange.insertNode(startMarker);
    }

    function reverseHtmlLines(html) {
        const lines = String(html || '').split(/<br\s*\/?>|\n/i);
        const startPattern = markerByIdPattern('selection-start');
        const endPattern = markerByIdPattern('selection-end');
        let startIndex = -1;
        let endIndex = -1;

        const cleanedLines = lines.map((line, index) => {
            startPattern.lastIndex = 0;
            endPattern.lastIndex = 0;
            if (startPattern.test(line)) {
                startIndex = index;
            }
            if (endPattern.test(line)) {
                endIndex = index;
            }
            return line
                .replace(markerByIdPattern('selection-start'), '')
                .replace(markerByIdPattern('selection-end'), '');
        });

        if (startIndex < 0 || endIndex < 0) {
            return {
                html: cleanedLines.reverse().join('<br>'),
                reversedLineCount: cleanedLines.length,
                selectedOnly: false
            };
        }

        if (startIndex > endIndex) {
            [startIndex, endIndex] = [endIndex, startIndex];
        }

        const before = cleanedLines.slice(0, startIndex);
        const selected = cleanedLines.slice(startIndex, endIndex + 1).reverse();
        const after = cleanedLines.slice(endIndex + 1);
        return {
            html: before.concat(selected, after).join('<br>'),
            reversedLineCount: selected.length,
            selectedOnly: true
        };
    }

    function markerByIdPattern(id) {
        const escaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`<span\\b[^>]*id=["']${escaped}["'][^>]*><\\/span>`, 'gi');
    }

    function showInsertAtIndexPopup() {
        showTextPopup(raw => {
            const parsed = parseIndexTextInput(raw);
            if (!parsed) {
                setStatus('Use first line for index, following lines for inserted text.');
                return;
            }
            insertTextAtIndex(parsed.index, parsed.text);
        }, 'Insert at index: first line is line.character, rest is text', '1.0\n');
    }

    function showCursorAtIndexPopup() {
        showTextPopup(raw => {
            const index = String(raw || '').trim();
            if (!index) {
                setStatus('No index supplied.');
                return;
            }
            addCursorAtIndex(index);
        }, 'Add cursor at index:', '1.0');
    }

    function showSelectByIndexPopup() {
        showTextPopup(raw => {
            const lines = String(raw || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
            if (lines.length < 2) {
                setStatus('Use two lines: start index, end index.');
                return;
            }
            selectRangeByIndex(lines[0], lines[1]);
        }, 'Select by indexes: first line start, second line end', '1.0\n1.end');
    }

    function parseIndexTextInput(raw) {
        const lines = String(raw || '').split(/\r?\n/);
        const index = (lines.shift() || '').trim();
        if (!index) {
            return null;
        }
        return { index, text: lines.join('\n') };
    }

    function insertTextAtIndex(indexStr, text) {
        const range = rangeFromIndex(indexStr);
        if (!range) {
            setStatus(`Invalid index: ${indexStr}`);
            return;
        }
        const textNode = document.createTextNode(String(text || ''));
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        savedEditorRange = range.cloneRange();
        setStatus(`Inserted text at ${indexStr}.`);
        scheduleSend();
    }

    function insertText(indexStr, text) {
        return insertTextAtIndex(indexStr, text);
    }

    function inserText(indexStr, text) {
        return insertTextAtIndex(indexStr, text);
    }

    function createNote(indexStr, text, label = '') {
        const range = rangeFromIndex(indexStr);
        if (!range) {
            setStatus(`Invalid index: ${indexStr}`);
            return null;
        }
        const button = makeMessageButton(label, base64EncodeUtf8(String(text || '')));
        range.insertNode(button);
        range.setStartAfter(button);
        range.collapse(true);

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        savedEditorRange = range.cloneRange();
        setStatus(`Created note at ${indexStr}.`);
        scheduleSend();
        return button;
    }

    function addCursorAtIndex(indexStr) {
        const range = rangeFromIndex(indexStr);
        if (!range) {
            setStatus(`Invalid index: ${indexStr}`);
            return;
        }
        addCursorAtRange(range);
        setStatus(`Cursor added at ${indexStr}.`);
    }

    function selectRangeByIndex(fromIndex, toIndex) {
        const fromRange = rangeFromIndex(fromIndex);
        const toRange = rangeFromIndex(toIndex);
        if (!fromRange || !toRange) {
            setStatus(`Invalid index range: ${fromIndex}, ${toIndex}`);
            return;
        }
        const range = document.createRange();
        range.setStart(fromRange.startContainer, fromRange.startOffset);
        range.setEnd(toRange.startContainer, toRange.startOffset);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        savedEditorRange = range.cloneRange();
        setStatus(`Selected range from ${fromIndex} to ${toIndex}.`);
    }

    function rangeFromIndex(indexStr) {
        const offset = indexToTextOffset(getPlainTextForIndexing(), indexStr);
        if (offset < 0) {
            return null;
        }
        const position = getTextPositionForPlainOffset(offset);
        if (!position) {
            return null;
        }
        const range = document.createRange();
        range.setStart(position.node, position.offset);
        range.collapse(true);
        return range;
    }

    function getPlainTextForIndexing() {
        const clone = editor.cloneNode(true);
        removeLineNumbers(clone);
        clone.querySelectorAll('.cursor').forEach(span => span.remove());
        clone.querySelectorAll('.cursor-marker').forEach(span => span.remove());
        return extractTextWithLineBreaks(clone).replace(/\r\n|\r/g, '\n');
    }

    function getTextPositionForPlainOffset(targetOffset) {
        const target = Math.max(0, targetOffset);
        if (target >= getPlainTextForIndexing().length) {
            return { node: editor, offset: editor.childNodes.length };
        }
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
            acceptNode(node) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.matches && node.matches('.line-number, .cursor, .cursor-marker')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return node.tagName && node.tagName.toUpperCase() === 'BR'
                        ? NodeFilter.FILTER_ACCEPT
                        : NodeFilter.FILTER_SKIP;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        let total = 0;
        let lastText = null;
        let node = walker.nextNode();
        while (node) {
            if (node.nodeType === Node.TEXT_NODE) {
                const length = node.textContent.length;
                if (target <= total + length) {
                    return { node, offset: Math.max(0, Math.min(target - total, length)) };
                }
                total += length;
                lastText = node;
            } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName.toUpperCase() === 'BR') {
                if (target <= total + 1) {
                    const nextText = getNextTextNodeAfterElement(node);
                    if (nextText) {
                        return { node: nextText, offset: 0 };
                    }
                    if (lastText) {
                        return { node: lastText, offset: lastText.textContent.length };
                    }
                }
                total += 1;
            }
            node = walker.nextNode();
        }

        if (lastText) {
            return { node: lastText, offset: lastText.textContent.length };
        }
        const textNode = document.createTextNode('');
        editor.appendChild(textNode);
        return { node: textNode, offset: 0 };
    }

    function getNextTextNodeAfterElement(element) {
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
        let node = walker.nextNode();
        while (node) {
            if (element.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
                return node;
            }
            node = walker.nextNode();
        }
        return null;
    }

    function indexToTextOffset(text, indexStr) {
        const value = String(indexStr || '').trim();
        const source = String(text || '').replace(/\r\n|\r/g, '\n');
        if (value === 'end') {
            return source.length;
        }
        const match = value.match(/^(\d+)\.(\d+|end)$/);
        if (!match) {
            return -1;
        }
        const lineNumber = Number.parseInt(match[1], 10);
        if (!Number.isFinite(lineNumber) || lineNumber < 1) {
            return -1;
        }
        const lines = source.split('\n');
        if (lineNumber > lines.length) {
            return -1;
        }
        const lineStart = lines.slice(0, lineNumber - 1).reduce((sum, line) => sum + line.length + 1, 0);
        const line = lines[lineNumber - 1] || '';
        if (match[2] === 'end') {
            return lineStart + line.length;
        }
        const charOffset = Number.parseInt(match[2], 10);
        if (!Number.isFinite(charOffset) || charOffset < 0) {
            return -1;
        }
        return lineStart + Math.min(charOffset, line.length);
    }

    function smartReturnPress() {
        const selection = window.getSelection();
        const range = selection && selection.rangeCount ? selection.getRangeAt(0) : savedEditorRange;
        if (!range || !editor.contains(range.commonAncestorContainer)) {
            return;
        }

        const beforeRange = document.createRange();
        beforeRange.selectNodeContents(editor);
        beforeRange.setEnd(range.startContainer, range.startOffset);
        const beforeCursor = extractTextWithLineBreaks(beforeRange.cloneContents());

        const afterRange = document.createRange();
        afterRange.selectNodeContents(editor);
        afterRange.setStart(range.startContainer, range.startOffset);
        const afterCursor = extractTextWithLineBreaks(afterRange.cloneContents());
        const insertion = computeSmartReturnInsertion(beforeCursor, afterCursor);

        range.deleteContents();
        const textNode = document.createTextNode(insertion.text);
        range.insertNode(textNode);

        const newRange = document.createRange();
        newRange.setStart(textNode, insertion.caretOffset);
        newRange.setEnd(textNode, insertion.caretOffset);
        selection.removeAllRanges();
        selection.addRange(newRange);
        savedEditorRange = newRange.cloneRange();
        editor.scrollTop = editor.scrollHeight;
        scheduleSend();
    }

    function handleBraceKey(key) {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) {
            return false;
        }

        const range = selection.getRangeAt(0);
        if (!editor.contains(range.commonAncestorContainer)) {
            return false;
        }

        if (key === '{') {
            range.deleteContents();
            const textNode = document.createTextNode('{}');
            range.insertNode(textNode);
            const newRange = document.createRange();
            newRange.setStart(textNode, 1);
            newRange.setEnd(textNode, 1);
            selection.removeAllRanges();
            selection.addRange(newRange);
            savedEditorRange = newRange.cloneRange();
            scheduleSend();
            return true;
        }

        if (key !== '}') {
            return false;
        }

        const point = normalizeTextPoint(range.startContainer, range.startOffset);
        if (!point) {
            return false;
        }

        const lineStart = point.node.textContent.lastIndexOf('\n', point.offset - 1) + 1;
        const lineBeforeCaret = point.node.textContent.slice(lineStart, point.offset);
        if (!/^[ \t]*$/.test(lineBeforeCaret)) {
            return false;
        }

        const dedented = dedentClosingBraceLine(lineBeforeCaret);
        point.node.textContent = point.node.textContent.slice(0, lineStart) +
            dedented +
            '}' +
            point.node.textContent.slice(point.offset);

        const newOffset = lineStart + dedented.length + 1;
        const newRange = document.createRange();
        newRange.setStart(point.node, newOffset);
        newRange.setEnd(point.node, newOffset);
        selection.removeAllRanges();
        selection.addRange(newRange);
        savedEditorRange = newRange.cloneRange();
        scheduleSend();
        return true;
    }

    function normalizeTextPoint(container, offset) {
        if (container.nodeType === Node.TEXT_NODE) {
            return { node: container, offset };
        }

        if (container.nodeType !== Node.ELEMENT_NODE) {
            return null;
        }

        const before = container.childNodes[offset - 1];
        if (before && before.nodeType === Node.TEXT_NODE) {
            return { node: before, offset: before.textContent.length };
        }

        const after = container.childNodes[offset];
        if (after && after.nodeType === Node.TEXT_NODE) {
            return { node: after, offset: 0 };
        }

        const textNode = document.createTextNode('');
        container.insertBefore(textNode, after || null);
        return { node: textNode, offset: 0 };
    }

    function dedentClosingBraceLine(lineBeforeCaret) {
        return String(lineBeforeCaret || '').replace(/^ {1,4}/, '');
    }

    function computeSmartReturnInsertion(beforeCursor, afterCursor) {
        const before = String(beforeCursor || '');
        const inputToLeft = before.slice(before.lastIndexOf('\n') + 1);
        const trimmed = inputToLeft.trim();
        const lastChar = trimmed.charAt(trimmed.length - 1);
        const numLParen = (trimmed.match(/\(/g) || []).length;
        const numRParen = (trimmed.match(/\)/g) || []).length;
        const extraIndent = lastChar === '{' || lastChar === ':' || numLParen > numRParen ? '    ' : '';
        const lineIndentMatch = inputToLeft.match(/^\s*/);
        const lineIndent = lineIndentMatch ? lineIndentMatch[0] : '';
        const newLine = `\n${extraIndent}${lineIndent}`;

        if (String(afterCursor || '').trimStart().startsWith('}')) {
            return {
                text: `${newLine}\n${lineIndent}`,
                caretOffset: newLine.length
            };
        }

        return {
            text: newLine,
            caretOffset: newLine.length
        };
    }

    function transformTextCase(text, mode) {
        const value = String(text || '');
        if (mode === 'upper') {
            return value.toUpperCase();
        }
        if (mode === 'lower') {
            return value.toLowerCase();
        }
        if (mode === 'title') {
            return value.replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
        }
        if (mode === 'camel') {
            const words = splitWords(value);
            if (!words.length) {
                return '';
            }
            return words[0] + words.slice(1).map(capitalize).join('');
        }
        if (mode === 'snake') {
            return splitWords(value).join('_');
        }
        if (mode === 'kebab') {
            return splitWords(value).join('-');
        }
        return value;
    }

    function splitWords(text) {
        return String(text || '')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[_-]+/g, ' ')
            .toLowerCase()
            .trim()
            .split(/\s+/)
            .filter(Boolean);
    }

    function capitalize(word) {
        return word.charAt(0).toUpperCase() + word.slice(1);
    }

    function filterCursorLines(keep) {
        if (!cursors.length) {
            setStatus('No cursors available for line filtering.');
            return;
        }

        markCursors();
        const result = filterHtmlLinesByCursorMarkers(editor.innerHTML, keep);
        if (!result.cursorLineCount) {
            editor.querySelectorAll('.cursor-marker').forEach(marker => marker.remove());
            setStatus('No cursor lines found.');
            return;
        }

        clearAllCursors(false);
        editor.innerHTML = result.html;
        hydrateEditorControls(editor);
        setStatus(keep ? 'Kept only lines containing cursors.' : 'Deleted lines containing cursors.');
        scheduleSend();
    }

    function markCursors() {
        cursors.forEach(cursor => {
            if (!cursor.range || !editor.contains(cursor.range.commonAncestorContainer)) {
                return;
            }
            const marker = document.createElement('span');
            marker.className = 'cursor-marker';
            marker.setAttribute('contenteditable', 'false');
            cursor.range.cloneRange().insertNode(marker);
        });
    }

    function filterHtmlLinesByCursorMarkers(html, keep) {
        const lines = String(html || '').split(/<br\s*\/?>|\n/i);
        const cursorLines = new Set();
        const cleanedLines = lines.map((line, index) => {
            if (containsCursorMarker(line)) {
                cursorLines.add(index);
            }
            return removeCursorMarkers(line);
        });
        return {
            html: cleanedLines.filter((_, index) => keep ? cursorLines.has(index) : !cursorLines.has(index)).join('<br>'),
            cursorLineCount: cursorLines.size
        };
    }

    function containsCursorMarker(html) {
        return cursorMarkerPattern().test(String(html || ''));
    }

    function removeCursorMarkers(html) {
        return String(html || '').replace(cursorMarkerPattern(), '');
    }

    function cursorMarkerPattern() {
        return /<span\b[^>]*class=["'][^"']*\bcursor-marker\b[^"']*["'][^>]*><\/span>/gi;
    }

    function filterHighlightLines(keep) {
        const result = filterHtmlLinesByHighlights(editor.innerHTML, keep);
        if (!result.highlightedLineCount) {
            setStatus('No highlighter spans found in any line.');
            return;
        }

        clearAllCursors(false);
        editor.innerHTML = result.html;
        hydrateEditorControls(editor);
        setStatus(keep ? 'Kept only lines containing highlights.' : 'Deleted lines containing highlights.');
        scheduleSend();
    }

    function filterHtmlLinesByHighlights(html, keep) {
        const lines = String(html || '').split(/<br\s*\/?>|\n/i);
        const highlightedLines = new Set();
        lines.forEach((line, index) => {
            if (containsHighlight(line)) {
                highlightedLines.add(index);
            }
        });
        return {
            html: lines.filter((_, index) => keep ? highlightedLines.has(index) : !highlightedLines.has(index)).join('<br>'),
            highlightedLineCount: highlightedLines.size
        };
    }

    function containsHighlight(html) {
        const value = String(html || '');
        return /<span\b[^>]*class=["'][^"']*\bhighlight\d*\b[^"']*["'][^>]*>/i.test(value) ||
            /<span\b[^>]*style=["'][^"']*background(?:-color)?\s*:/i.test(value) ||
            /<tspan\b[^>]*data-spectral-svg-hl\b/i.test(value);
    }

    function blockColorResolveColor(colorSpec) {
        const spec = String(colorSpec == null ? '' : colorSpec).trim();
        const fixed = {
            1: '#f0f583',
            2: '#fd9f9f',
            3: '#aafba2',
            4: '#a5f8f8',
            5: '#f997f9',
            7: '#ffffff'
        };
        if (/^\d+$/.test(spec)) {
            const n = Number.parseInt(spec, 10);
            if (n === 6) {
                return document.getElementById('colorChooser')?.value || '#ccddf7';
            }
            if (fixed[n]) return fixed[n];
        }
        return spec || '#ccddf7';
    }

    function blockColorRegexes(regexes) {
        const list = Array.isArray(regexes) ? regexes : [regexes];
        return list
            .filter(item => item != null && String(item).length > 0)
            .map(item => {
                if (item instanceof RegExp) return { regex: item, negate: false };
                let pattern = String(item);
                let negate = false;
                if (pattern.startsWith('-')) {
                    if (pattern.startsWith('--')) {
                        pattern = pattern.slice(1);
                    } else {
                        negate = true;
                        pattern = pattern.slice(1);
                    }
                }
                return { regex: new RegExp(pattern, 'm'), negate };
            });
    }

    function blockColorMatches(text, regexes) {
        return regexes.every(({ regex, negate }) => {
            regex.lastIndex = 0;
            const matched = regex.test(text);
            return negate ? !matched : matched;
        });
    }

    function blockColorLineOffsets(text, startLineNum = 1, endLineNum = 'end') {
        const lineStarts = [0];
        for (let i = 0; i < text.length; i += 1) {
            if (text[i] === '\n') lineStarts.push(i + 1);
        }
        const startLine = Math.max(1, Number.parseInt(startLineNum, 10) || 1);
        const start = lineStarts[Math.min(startLine - 1, lineStarts.length - 1)] ?? text.length;
        if (endLineNum === 'end' || endLineNum == null) {
            return { start, stop: text.length };
        }
        const endLine = Math.max(startLine, Number.parseInt(endLineNum, 10) || startLine);
        return { start, stop: lineStarts[endLine] == null ? text.length : lineStarts[endLine] };
    }

    function findBraceBlocksAtLevel(text, level, start, stop) {
        let depth = 0;
        let blockStart = null;
        const blocks = [];
        for (let pos = start; pos < stop; pos += 1) {
            const ch = text[pos];
            if (ch === '{') {
                if (depth === level) blockStart = pos;
                depth += 1;
            } else if (ch === '}') {
                if (depth > 0) {
                    const closingLevel = depth - 1;
                    depth -= 1;
                    if (closingLevel === level && blockStart != null) {
                        blocks.push({ start: blockStart, end: pos + 1, text: text.slice(blockStart, pos + 1) });
                        blockStart = null;
                    }
                }
            }
        }
        return blocks;
    }

    function rangeForPlainOffsets(startOffset, endOffset) {
        const start = getTextPositionForPlainOffset(startOffset);
        const end = getTextPositionForPlainOffset(endOffset);
        if (!start || !end) return null;
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        return range;
    }

    function applyBlockColorRanges(ranges, color, level) {
        if (color === 'sel') {
            const selection = window.getSelection();
            selection.removeAllRanges();
            ranges.forEach(rangeInfo => {
                const range = rangeForPlainOffsets(rangeInfo.start, rangeInfo.end);
                if (range) selection.addRange(range);
            });
            if (selection.rangeCount) {
                savedEditorRange = selection.getRangeAt(selection.rangeCount - 1).cloneRange();
            }
            return;
        }

        ranges.slice().reverse().forEach(rangeInfo => {
            const range = rangeForPlainOffsets(rangeInfo.start, rangeInfo.end);
            if (!range || range.collapsed) return;
            const span = document.createElement('span');
            span.className = 'block-color-highlight';
            span.style.backgroundColor = color;
            span.dataset.blockColorLevel = String(level);
            try {
                range.surroundContents(span);
            } catch (_) {
                const fragment = range.extractContents();
                span.appendChild(fragment);
                range.insertNode(span);
            }
        });
    }

    function nested_block_color(level = 0, colorSpec = 1, regexes = [], startLineNum = 1, endLineNum = 'end') {
        const parsedLevel = Number.parseInt(level, 10);
        if (!Number.isInteger(parsedLevel) || parsedLevel < 0) {
            throw new Error('nested_block_color level must be a non-negative integer');
        }
        let compiledRegexes;
        try {
            compiledRegexes = blockColorRegexes(regexes);
        } catch (error) {
            setStatus(`nested_block_color: invalid regex: ${error.message}`);
            return 0;
        }
        const text = getPlainTextForIndexing();
        const { start, stop } = blockColorLineOffsets(text, startLineNum, endLineNum);
        const blocks = findBraceBlocksAtLevel(text, parsedLevel, start, stop);
        const matches = compiledRegexes.length === 0
            ? blocks
            : blocks.filter(block => blockColorMatches(block.text, compiledRegexes));
        const color = String(colorSpec).trim() === 'sel' ? 'sel' : blockColorResolveColor(colorSpec);
        applyBlockColorRanges(matches, color, parsedLevel);
        if (color !== 'sel') {
            hydrateEditorControls(editor);
            scheduleSend();
        }
        setStatus(`nested_block_color: ${color === 'sel' ? 'selected' : 'colored'} ${matches.length} block(s) at level ${parsedLevel}.`);
        return matches.length;
    }

    function block_color(colorSpec = 1, regexes = [], startLineNum = 1, endLineNum = 'end') {
        return nested_block_color(0, colorSpec, regexes, startLineNum, endLineNum);
    }

    function createCollapsedRange(node, offset) {
        const range = document.createRange();
        range.setStart(node, Math.max(0, Math.min(offset, node.textContent.length)));
        range.collapse(true);
        return range;
    }

    function clearAllHighlight() {
        editor.normalize();

        const selectors = [
            '.highlight',
            '.highlight1',
            '.highlight2',
            '.highlight3',
            '.highlight4',
            '.highlight5',
            '.highlight6',
            '.highlight7',
            '.block-color-highlight'
        ];
        let removed = 0;

        selectors.forEach(selector => {
            editor.querySelectorAll(selector).forEach(span => {
                unwrapElement(span);
                removed += 1;
            });
        });

        editor.querySelectorAll('span[style]').forEach(span => {
            if (span.style.backgroundColor) {
                span.style.backgroundColor = '';
                if (!span.getAttribute('style')) {
                    unwrapElement(span);
                }
                removed += 1;
            }
        });

        editor.querySelectorAll('tspan[data-spectral-svg-hl]').forEach(tspan => {
            tspan.replaceWith(document.createTextNode(tspan.textContent || ''));
            removed += 1;
        });
        editor.querySelectorAll('rect[data-spectral-svg-hl-rect]').forEach(rect => {
            rect.remove();
            removed += 1;
        });

        editor.normalize();
        setStatus(`Removed ${removed} highlight element${removed === 1 ? '' : 's'}.`);
        scheduleSend();
    }

    function unwrapElement(element) {
        element.replaceWith(...Array.from(element.childNodes));
    }

    function matchAndHighlightBrackets() {
        if (!savedEditorRange || !editor.contains(savedEditorRange.commonAncestorContainer)) {
            setStatus('No saved cursor position for bracket matching.');
            return;
        }

        const text = editor.textContent || '';
        const cursorOffset = getTextOffsetForRangePoint(savedEditorRange.startContainer, savedEditorRange.startOffset);
        if (cursorOffset < 0 || text.length === 0) {
            setStatus('Could not locate cursor for bracket matching.');
            return;
        }

        const brackets = {
            '(': ')',
            '[': ']',
            '{': '}',
            ')': '(',
            ']': '[',
            '}': '{'
        };
        const openSet = new Set(['(', '[', '{']);
        const closeSet = new Set([')', ']', '}']);

        let startOffset = cursorOffset;
        let char = text.charAt(startOffset);
        if (!brackets[char] && cursorOffset > 0) {
            startOffset = cursorOffset - 1;
            char = text.charAt(startOffset);
        }
        if (!brackets[char]) {
            setStatus('No bracket at cursor.');
            return;
        }

        const matchChar = brackets[char];
        const isOpening = openSet.has(char);
        const isClosing = closeSet.has(char);
        let depth = 0;
        let matchOffset = -1;

        if (isOpening) {
            for (let index = startOffset + 1; index < text.length; index += 1) {
                const current = text.charAt(index);
                if (current === char) {
                    depth += 1;
                } else if (current === matchChar) {
                    if (depth === 0) {
                        matchOffset = index;
                        break;
                    }
                    depth -= 1;
                }
            }
        } else if (isClosing) {
            for (let index = startOffset - 1; index >= 0; index -= 1) {
                const current = text.charAt(index);
                if (current === char) {
                    depth += 1;
                } else if (current === matchChar) {
                    if (depth === 0) {
                        matchOffset = index;
                        break;
                    }
                    depth -= 1;
                }
            }
        }

        if (matchOffset === -1) {
            setStatus(`No matching bracket found for ${char}.`);
            return;
        }

        const color = randomHilightColor();
        [startOffset, matchOffset].sort((a, b) => b - a).forEach(offset => {
            highlightCharacterAtOffset(offset, color);
        });
        selectFlatTextRange(Math.min(startOffset, matchOffset) + 1, Math.max(startOffset, matchOffset));
        setStatus(`Matched ${char} with ${matchChar}.`);
        scheduleSend();
    }

    function selectFlatTextRange(startOffset, endOffset) {
        const start = getTextPositionForOffset(startOffset);
        const end = getTextPositionForOffset(endOffset);
        if (!start || !end) return false;
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        savedEditorRange = range.cloneRange();
        return true;
    }

    function highlightCharacterAtOffset(offset, color) {
        const position = getTextPositionForOffset(offset);
        if (!position || position.node.nodeType !== Node.TEXT_NODE || position.offset >= position.node.textContent.length) {
            return;
        }

        const range = document.createRange();
        range.setStart(position.node, position.offset);
        range.setEnd(position.node, position.offset + 1);
        const span = document.createElement('span');
        span.className = 'highlight';
        span.style.backgroundColor = color;
        range.surroundContents(span);
    }

    function getPreviousTextNode(node) {
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
        let previous = null;
        let current = walker.nextNode();
        while (current) {
            if (current === node) {
                return previous;
            }
            previous = current;
            current = walker.nextNode();
        }
        return null;
    }

    function getRangeBeforeCursor(range, count) {
        const result = document.createRange();
        let container = range.startContainer;
        let offset = range.startOffset;
        let remaining = count;

        result.setStart(container, offset);
        result.setEnd(container, offset);

        while (remaining > 0) {
            if (container.nodeType === Node.TEXT_NODE) {
                const available = Math.min(offset, remaining);
                if (available > 0) {
                    offset -= available;
                    result.setStart(container, offset);
                    remaining -= available;
                    if (remaining === 0) {
                        break;
                    }
                }
            }

            const previous = getPreviousTextNode(container);
            if (!previous) {
                break;
            }
            container = previous;
            offset = previous.textContent.length;
        }

        return result;
    }

    function normalizeRangeContainer(range) {
        const container = range.startContainer.nodeType === Node.ELEMENT_NODE
            ? range.startContainer
            : range.startContainer.parentNode;
        if (container && container.normalize) {
            container.normalize();
        }
    }

    function getNextTextNode(node) {
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
        let current = walker.nextNode();
        while (current) {
            if (current === node) {
                return walker.nextNode();
            }
            current = walker.nextNode();
        }
        return null;
    }

    function getTextOffsetForRangePoint(container, offset) {
        if (container && container.nodeType === Node.ELEMENT_NODE) {
            const preRange = document.createRange();
            preRange.selectNodeContents(editor);
            try {
                preRange.setEnd(container, offset);
                return preRange.cloneContents().textContent.length;
            } catch (error) {
                return -1;
            }
        }

        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
        let total = 0;
        let node = walker.nextNode();
        while (node) {
            if (node === container) {
                return total + Math.min(offset, node.textContent.length);
            }
            total += node.textContent.length;
            node = walker.nextNode();
        }
        return -1;
    }

    function getTextPositionForOffset(targetOffset) {
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
        let total = 0;
        let last = null;
        let node = walker.nextNode();
        while (node) {
            const length = node.textContent.length;
            if (targetOffset <= total + length) {
                return { node, offset: Math.max(0, Math.min(targetOffset - total, length)) };
            }
            total += length;
            last = node;
            node = walker.nextNode();
        }
        if (last) {
            return { node: last, offset: last.textContent.length };
        }
        const textNode = document.createTextNode('');
        editor.appendChild(textNode);
        return { node: textNode, offset: 0 };
    }

    function insertNodeAtSelection(node) {
        const range = getInsertionRange();
        if (!range) {
            editor.appendChild(node);
            savedEditorRange = null;
            scheduleSend();
            return;
        }

        range.deleteContents();
        range.insertNode(node);
        range.setStartAfter(node);
        range.setEndAfter(node);

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        savedEditorRange = range.cloneRange();
        scheduleSend();
    }

    function showTextPopup(callback, heading, initialText) {
        ensureTextPopup();
        textPopupCallback = callback;
        popupHeading.textContent = heading || '';
        popupTextarea.value = initialText || '';
        textPopup.style.display = 'block';
        ensurePopupTextSearchControls(textPopup, popupTextarea, popupTextarea);
        popupTextarea.focus();
    }

    function submitTextPopup() {
        ensureTextPopup();
        const text = popupTextarea.value;
        closeTextPopup();
        if (typeof textPopupCallback === 'function') {
            textPopupCallback(text);
        }
        textPopupCallback = null;
        activeNoteButton = null;
        scheduleSend();
    }

    function closeTextPopup() {
        ensureTextPopup();
        textPopup.style.display = 'none';
    }

    function showNoteInputPopup() {
        activeNoteButton = null;
        showTextPopup(text => {
            createMessageButton('', base64EncodeUtf8(text));
        }, 'Create Note:', '');
    }

    function showNoteEditPopup(button) {
        activeNoteButton = button;
        showTextPopup(text => {
            activeNoteButton.setAttribute('data-message', base64EncodeUtf8(text));
        }, 'Edit Note:', base64DecodeUtf8(button.getAttribute('data-message') || ''));
    }

    function noteButtonClickHandler(event) {
        event.preventDefault();
        event.stopPropagation();
        if (diffNotesPickState) {
            handleDiffNotesPickClick(event);
            return;
        }
        showNoteEditPopup(event.currentTarget || event.target);
    }

    function makeMessageButton(label, encodedMessage) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'note-button';
        button.setAttribute('data-message', encodedMessage);
        button.textContent = label || '';
        button.addEventListener('click', noteButtonClickHandler);
        return button;
    }

    function createMessageButton(label, encodedMessage) {
        insertNodeAtSelection(makeMessageButton(label, encodedMessage));
    }

    function getNoteButtonFromTarget(target) {
        return target && target.closest ? target.closest('.note-button') : null;
    }

    function getDiffNoteText(noteRef) {
        const button = noteRef && noteRef.nodeType ? getNoteButtonFromTarget(noteRef) : null;
        if (button) {
            return base64DecodeUtf8(button.getAttribute('data-message') || button.dataset.message || '');
        }
        return typeof noteRef === 'string' ? noteRef : '';
    }

    function normalizedDiffOptions(opts = {}) {
        if (typeof opts === 'string') {
            return { granularity: opts };
        }
        return opts && typeof opts === 'object' ? opts : {};
    }

    function normalizeDiffTextInput(text, opts = {}) {
        let value = String(text || '')
            .replace(/\r\n|\r/g, '\n')
            .replace(/^\uFEFF/, '')
            .replace(/\u00A0/g, ' ')
            .normalize('NFC');
        if (opts.ignoreTrailingWhitespace !== false) {
            value = value.split('\n').map(line => line.replace(/[ \t]+$/g, '')).join('\n');
        }
        return value;
    }

    function tokeniseDiffText(text, granularity, opts = {}) {
        const normalized = normalizeDiffTextInput(text, opts);
        if (granularity === 'char') {
            return Array.from(normalized).map(value => ({ text: value, key: value }));
        }
        if (granularity === 'word') {
            return (normalized.match(/\s+|[^\s]+/g) || []).map(value => ({ text: value, key: value }));
        }
        return normalized.split('\n').map((line, index, lines) => ({
            text: index < lines.length - 1 ? `${line}\n` : line,
            key: line
        }));
    }

    function lcsDiffTokens(aTokens, bTokens) {
        const n = aTokens.length;
        const m = bTokens.length;
        const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
        for (let i = n - 1; i >= 0; i -= 1) {
            for (let j = m - 1; j >= 0; j -= 1) {
                dp[i][j] = aTokens[i].key === bTokens[j].key
                    ? dp[i + 1][j + 1] + 1
                    : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        const segments = [];
        const push = (type, token) => {
            const last = segments[segments.length - 1];
            if (last && last.type === type) {
                last.text += token.text;
            } else {
                segments.push({ type, text: token.text });
            }
        };
        let i = 0;
        let j = 0;
        while (i < n && j < m) {
            if (aTokens[i].key === bTokens[j].key) {
                push('same', aTokens[i]);
                i += 1;
                j += 1;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                push('del', aTokens[i]);
                i += 1;
            } else {
                push('add', bTokens[j]);
                j += 1;
            }
        }
        while (i < n) push('del', aTokens[i++]);
        while (j < m) push('add', bTokens[j++]);
        return segments;
    }

    function normaliseDiffContextValue(value) {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    }

    function setDiffContext(contextBefore, contextAfter = contextBefore) {
        diffContext = {
            before: normaliseDiffContextValue(contextBefore),
            after: normaliseDiffContextValue(contextAfter)
        };
        setStatus(`Diff context set to ${diffContext.before} before / ${diffContext.after} after.`);
        return diffContext;
    }

    function clearDiffContext() {
        diffContext = null;
        setStatus('Diff context cleared.');
    }

    function splitDiffSegmentsToLines(segments) {
        const lines = [];
        segments.forEach(seg => {
            String(seg.text).split(/(\n)/).forEach(part => {
                if (part === '') return;
                if (!lines.length || lines[lines.length - 1].done) {
                    lines.push({ type: seg.type, text: '', changed: seg.type !== 'same', done: false });
                }
                lines[lines.length - 1].text += part;
                lines[lines.length - 1].changed = lines[lines.length - 1].changed || seg.type !== 'same';
                if (part === '\n') lines[lines.length - 1].done = true;
            });
        });
        return lines;
    }

    function applyLineDiffContext(segments, context) {
        if (!context) return segments;
        const lines = splitDiffSegmentsToLines(segments);
        const keep = new Set();
        lines.forEach((line, index) => {
            if (!line.changed) return;
            for (let i = Math.max(0, index - context.before); i <= Math.min(lines.length - 1, index + context.after); i += 1) {
                keep.add(i);
            }
        });
        const out = [];
        let lastKept = -2;
        Array.from(keep).sort((a, b) => a - b).forEach(index => {
            if (lastKept >= 0 && index > lastKept + 1) {
                out.push({ type: 'break', text: '---------- context break ----------\n' });
            }
            out.push({ type: lines[index].type, text: lines[index].text });
            lastKept = index;
        });
        return out.length ? out : segments;
    }

    function ensureDiffNotesPopup() {
        if (diffNotesPopup) return;
        diffNotesPopup = document.createElement('div');
        diffNotesPopup.className = 'diff-notes-popup';
        const header = document.createElement('div');
        header.className = 'diff-notes-header';
        const title = document.createElement('strong');
        title.textContent = 'Note Diff';
        const controls = document.createElement('div');
        ['line', 'word', 'char'].forEach(mode => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = mode;
            button.addEventListener('click', () => {
                if (diffNotesPopup.dataset.left != null) {
                    renderDiffNotesPopup(
                        base64DecodeUtf8(diffNotesPopup.dataset.left),
                        base64DecodeUtf8(diffNotesPopup.dataset.right),
                        { granularity: mode }
                    );
                }
            });
            controls.appendChild(button);
        });
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.textContent = 'Close';
        closeButton.addEventListener('click', closeDiffNotesPopup);
        controls.appendChild(closeButton);
        header.appendChild(title);
        header.appendChild(controls);
        diffNotesBody = document.createElement('pre');
        diffNotesBody.id = 'diffNotesBody';
        diffNotesBody.className = 'diff-notes-body';
        popupTextSearchBindTemporaryDoubleClickHighlights(diffNotesBody);
        diffNotesPopup.appendChild(header);
        diffNotesPopup.appendChild(diffNotesBody);
        document.body.appendChild(diffNotesPopup);
        ensurePopupTextSearchControls(diffNotesPopup, diffNotesBody, diffNotesBody);
    }

    function renderDiffNotesPopup(text1, text2, opts = {}) {
        const granularity = opts.granularity || 'line';
        diffNotesGranularity = granularity;
        ensureDiffNotesPopup();
        let segments = lcsDiffTokens(
            tokeniseDiffText(text1, granularity, opts),
            tokeniseDiffText(text2, granularity, opts)
        );
        if (granularity === 'line') {
            segments = applyLineDiffContext(segments, diffContext);
        }
        diffNotesBody.innerHTML = '';
        popupTextSearchClearDomHighlights(diffNotesBody.id);
        segments.forEach(seg => {
            const span = document.createElement('span');
            span.className = `diff-notes-${seg.type}`;
            span.textContent = seg.text;
            diffNotesBody.appendChild(span);
        });
        diffNotesPopup.style.display = 'block';
        setStatus(`diffnotes: ${granularity} diff shown.`);
    }

    function closeDiffNotesPopup() {
        if (diffNotesPopup) diffNotesPopup.style.display = 'none';
    }

    function cancelDiffNotesMode(message = 'diffnotes: note selection cancelled.') {
        diffNotesPickState = null;
        editor.classList.remove('diff-notes-picking');
        setStatus(message);
    }

    function startDiffNotesPickMode(opts = {}) {
        diffNotesPickState = { first: null, opts: normalizedDiffOptions(opts) };
        editor.classList.add('diff-notes-picking');
        setStatus('diffnotes: click the first note, then the second note. Esc cancels.');
    }

    function handleDiffNotesPickClick(event) {
        const button = getNoteButtonFromTarget(event.target);
        if (!button || !diffNotesPickState) return;
        if (!diffNotesPickState.first) {
            diffNotesPickState.first = button;
            setStatus('diffnotes: first note selected; click the second note.');
            return;
        }
        const first = diffNotesPickState.first;
        const opts = diffNotesPickState.opts;
        cancelDiffNotesMode('diffnotes: comparing selected notes.');
        diffnotes(first, button, opts);
    }

    function diffnotes(note1, note2, opts = {}) {
        if (arguments.length === 0 || (arguments.length === 1 && typeof note1 === 'object' && !note1.nodeType)) {
            startDiffNotesPickMode(normalizedDiffOptions(note1 || {}));
            return;
        }
        const options = normalizedDiffOptions(opts);
        const left = getDiffNoteText(note1);
        const right = getDiffNoteText(note2);
        ensureDiffNotesPopup();
        diffNotesPopup.dataset.left = base64EncodeUtf8(left);
        diffNotesPopup.dataset.right = base64EncodeUtf8(right);
        renderDiffNotesPopup(left, right, options);
    }

    function ensureTextPopup() {
        if (textPopup) {
            return;
        }

        textPopup = document.createElement('div');
        textPopup.id = 'textPopup';
        textPopup.className = 'text-popup';

        popupHeading = document.createElement('div');
        popupHeading.id = 'popupTextAreaHeading';
        popupHeading.className = 'text-popup-heading';
        textPopup.appendChild(popupHeading);

        popupTextarea = document.createElement('textarea');
        popupTextarea.id = 'popupTextarea';
        textPopup.appendChild(popupTextarea);

        const actions = document.createElement('div');
        actions.className = 'text-popup-actions';

        const okButton = document.createElement('button');
        okButton.type = 'button';
        okButton.textContent = 'OK';
        okButton.addEventListener('click', submitTextPopup);

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', closeTextPopup);

        actions.appendChild(okButton);
        actions.appendChild(cancelButton);
        textPopup.appendChild(actions);
        document.body.appendChild(textPopup);
    }

    function ensureFindReplaceDialog() {
        if (findReplaceDialog) {
            return;
        }

        findReplaceDialog = document.createElement('div');
        findReplaceDialog.id = 'findReplaceDialog';
        findReplaceDialog.className = 'find-replace-dialog';
        findReplaceDialog.innerHTML = [
            '<h3>Find & Replace</h3>',
            '<label for="findPattern">Find (pattern):</label>',
            '<input type="text" id="findPattern">',
            '<label for="replaceText">Replace with:</label>',
            '<input type="text" id="replaceText">',
            '<label><input type="checkbox" id="useRegex" checked> Use Regular Expression</label>',
            '<label><input type="checkbox" id="caseSensitive" checked> Case Sensitive</label>',
            '<label><input type="checkbox" id="cursorOnlyMode"> Place cursors only</label>',
            '<div class="find-replace-actions">',
            '<button type="button" id="runFindReplace">Replace All</button>',
            '<button type="button" id="hideFindReplace">Cancel</button>',
            '</div>'
        ].join('');
        document.body.appendChild(findReplaceDialog);

        document.getElementById('runFindReplace').addEventListener('click', runFindReplace);
        document.getElementById('hideFindReplace').addEventListener('click', hideFindReplaceDialog);
        document.getElementById('findPattern').addEventListener('keydown', runFindReplaceOnEnter);
        document.getElementById('replaceText').addEventListener('keydown', runFindReplaceOnEnter);
    }

    function showFindReplaceDialog() {
        ensureFindReplaceDialog();
        findReplaceDialog.style.display = 'block';
        document.getElementById('findPattern').focus();
    }

    function hideFindReplaceDialog() {
        ensureFindReplaceDialog();
        findReplaceDialog.style.display = 'none';
    }

    function runFindReplaceOnEnter(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            runFindReplace();
        }
    }

    function runFindReplace() {
        const findPattern = document.getElementById('findPattern').value;
        const replaceText = document.getElementById('replaceText').value;
        const useRegex = document.getElementById('useRegex').checked;
        const caseSensitive = document.getElementById('caseSensitive').checked;
        const cursorOnlyMode = document.getElementById('cursorOnlyMode').checked;
        if (cursorOnlyMode) {
            addCursorsAtRegex(findPattern, useRegex, caseSensitive);
            hideFindReplaceDialog();
            return;
        }
        replace(findPattern, replaceText, useRegex, caseSensitive);
    }

    function replace(findPattern, replaceText, useRegex = true, caseSensitive = true) {
        if (!findPattern) {
            setStatus('Please enter a pattern to find.');
            return;
        }

        const flags = caseSensitive ? 'g' : 'gi';
        let regex;
        try {
            regex = useRegex ? new RegExp(findPattern, flags) : new RegExp(escapeRegex(findPattern), flags);
        } catch (error) {
            setStatus(`Invalid regular expression: ${error.message}`);
            return;
        }

        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const parent = node.parentElement;
                if (!parent || parent.closest('button, a, textarea, #textPopup, #findReplaceDialog')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const replacements = [];

        let node = walker.nextNode();
        while (node) {
            regex.lastIndex = 0;
            if (regex.test(node.textContent || '')) {
                regex.lastIndex = 0;
                replacements.push({ node, newText: node.textContent.replace(regex, replaceText) });
            }
            node = walker.nextNode();
        }

        replacements.forEach(({ node: textNode, newText }) => {
            textNode.textContent = newText;
        });
        hideFindReplaceDialog();
        setStatus(`${replacements.length} node(s) replaced.`);
        scheduleSend();
    }

    function escapeRegex(str) {
        return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function addCursorsAtRegex(pattern, useRegex = false, caseSensitive = false) {
        if (!pattern) {
            setStatus('Please enter a pattern for cursor placement.');
            return;
        }

        let regex;
        try {
            regex = useRegex
                ? new RegExp(pattern, `g${caseSensitive ? '' : 'i'}`)
                : new RegExp(escapeRegex(pattern), `g${caseSensitive ? '' : 'i'}`);
        } catch (error) {
            setStatus(`Invalid regular expression: ${error.message}`);
            return;
        }

        clearAllCursors(false);
        const ranges = [];
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const parent = node.parentElement;
                if (!node.nodeValue || !parent || parent.closest('button, a, textarea, #textPopup, #findReplaceDialog')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        let node = walker.nextNode();
        while (node) {
            regex.lastIndex = 0;
            let match = regex.exec(node.nodeValue || '');
            while (match) {
                const range = document.createRange();
                range.setStart(node, match.index);
                range.collapse(true);
                ranges.push(range);
                if (match[0].length === 0) {
                    regex.lastIndex += 1;
                }
                match = regex.exec(node.nodeValue || '');
            }
            node = walker.nextNode();
        }

        ranges.reverse().forEach(range => addCursorAtRange(range));
        setStatus(`${cursors.length} cursor${cursors.length === 1 ? '' : 's'} added for pattern: ${regex}`);
        scheduleSend();
    }

    function sanitizeHtml() {
        editor.innerHTML = postProcessForEmail(editor.innerHTML);
        hydrateEditorControls(editor);
        setStatus('Editor content sanitized.');
        scheduleSend();
    }

    function removeSpansWithClass(className) {
        const spans = Array.from(editor.querySelectorAll(`span.${CSS.escape(String(className || ''))}`));
        spans.forEach(span => {
            const parent = span.parentNode;
            while (span.firstChild) {
                parent.insertBefore(span.firstChild, span);
            }
            parent.removeChild(span);
        });
        setStatus(`Removed ${spans.length} span${spans.length === 1 ? '' : 's'} with class "${className}".`);
        scheduleSend();
    }

    function removeSpanContentsForClass(className) {
        const spans = Array.from(editor.querySelectorAll(`span.${CSS.escape(String(className || ''))}`));
        spans.forEach(span => span.remove());
        setStatus(`Removed ${spans.length} span${spans.length === 1 ? '' : 's'} with class "${className}" and their contents.`);
        scheduleSend();
    }

    function removeEmptyLinesFromEditor() {
        let removed = 0;
        Array.from(editor.childNodes).forEach(node => {
            if (isVisiblyEmptyNode(node)) {
                node.remove();
                removed += 1;
            }
        });
        setStatus(`Removed ${removed} visibly empty top-level node${removed === 1 ? '' : 's'}.`);
        scheduleSend();
    }

    function delete_empty_lines() {
        const html = editor.innerHTML;
        const lines = String(html || '').split(/(<br\s*\/?>|\n)/i);
        const output = [];
        let removed = 0;
        for (let i = 0; i < lines.length; i += 1) {
            const part = lines[i];
            if (/^(<br\s*\/?>|\n)$/i.test(part)) {
                output.push(part);
                continue;
            }
            const probe = document.createElement('div');
            probe.innerHTML = part;
            if (lineHtmlIsEmpty(probe)) {
                removed += 1;
                if (output.length && /^(<br\s*\/?>|\n)$/i.test(output[output.length - 1])) {
                    output.pop();
                }
            } else {
                output.push(part);
            }
        }
        editor.innerHTML = output.join('');
        hydrateEditorControls(editor);
        setStatus(`delete_empty_lines: removed ${removed} empty line${removed === 1 ? '' : 's'}.`);
        scheduleSend();
        return removed;
    }

    function lineHtmlIsEmpty(container) {
        if (container.querySelector('img, svg, video, audio, canvas, iframe, button, input, select, textarea, table')) {
            return false;
        }
        return (container.textContent || '')
            .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
            .trim() === '';
    }

    function isVisiblyEmptyNode(node) {
        if (!node) {
            return true;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent.trim() === '';
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            return (node.innerText || node.textContent || '').trim() === '';
        }
        return false;
    }

    function flattenParagraphsInEditor() {
        const paragraphs = Array.from(editor.querySelectorAll('p'));
        paragraphs.forEach(paragraph => {
            const span = document.createElement('span');
            while (paragraph.firstChild) {
                span.appendChild(paragraph.firstChild);
            }
            span.appendChild(document.createElement('br'));
            paragraph.replaceWith(span);
        });
        hydrateEditorControls(editor);
        setStatus(`Flattened ${paragraphs.length} paragraph${paragraphs.length === 1 ? '' : 's'}.`);
        scheduleSend();
    }

    function removeListFormattingNewlines() {
        editor.innerHTML = editor.innerHTML
            .replace(/(<li[^>]*>)\s+/gi, '$1')
            .replace(/(<[ou]l[^>]*>)\s+/gi, '$1')
            .replace(/\s+<\/li>/gi, '</li>')
            .replace(/\s+<\/ol>/gi, '</ol>')
            .replace(/\s+<\/ul>/gi, '</ul>');
        hydrateEditorControls(editor);
        setStatus('Cleaned whitespace inside and around list elements.');
        scheduleSend();
    }

    function removeAllAnnotations() {
        const annotations = Array.from(editor.querySelectorAll('annotation, comment'));
        annotations.forEach(node => node.remove());
        setStatus(`Removed ${annotations.length} annotation element${annotations.length === 1 ? '' : 's'}.`);
        scheduleSend();
    }

    function removeAllButtonsFromEditor() {
        const buttons = Array.from(editor.querySelectorAll('button'));
        buttons.forEach(button => button.remove());
        setStatus(`Removed ${buttons.length} button${buttons.length === 1 ? '' : 's'} from the editor.`);
        scheduleSend();
    }

    function cleanInstrumentation() {
        const result = cleanInstrumentationHtml(editor.innerHTML);
        editor.innerHTML = result.html;
        hydrateEditorControls(editor);
        setStatus(`Removed ${result.removed} probe call${result.removed === 1 ? '' : 's'}.`);
        scheduleSend();
    }

    function tidyBlankLines() {
        editor.innerHTML = tidyBlankLinesHtml(editor.innerHTML);
        hydrateEditorControls(editor);
        setStatus('Collapsed excessive blank lines.');
        scheduleSend();
    }

    function tidyBlankLinesHtml(html) {
        return String(html || '').replace(/((?:<br\s*\/?>|\r?\n)[ \t]*){3,}/gi, '<br><br>');
    }

    function computeLineBlockRange(text, offset, count = 1) {
        const source = String(text || '').replace(/\r\n|\r/g, '\n');
        const safeOffset = Math.max(0, Math.min(Number.parseInt(offset, 10) || 0, source.length));
        const lineCount = Math.max(1, Number.parseInt(count, 10) || 1);
        let start = source.lastIndexOf('\n', Math.max(0, safeOffset - 1)) + 1;
        if (safeOffset === source.length && source.endsWith('\n') && source.length > 0) {
            start = source.lastIndexOf('\n', source.length - 2) + 1;
        }

        let end = start;
        for (let index = 0; index < lineCount; index += 1) {
            const nextBreak = source.indexOf('\n', end);
            if (nextBreak < 0) {
                end = source.length;
                break;
            }
            end = nextBreak + 1;
        }

        return {
            start,
            end,
            text: source.slice(start, end),
            lineCount
        };
    }

    function cleanInstrumentationHtml(html) {
        let removed = 0;
        const sep = '(?:\\s|<[^>]*>)*';
        const probePattern = new RegExp(
            '\\bmprewriter' + sep + '\\.' + sep + 'scope_START' + sep + '\\(' + sep + '\\d+' + sep + '\\)' + sep + ';' + sep,
            'gi'
        );
        let cleaned = String(html || '').replace(probePattern, match => {
            removed += 1;
            if (/<br\s*\/?>/i.test(match)) {
                return '<br>';
            }
            const newline = match.match(/\r?\n/);
            return newline ? newline[0] : '';
        });

        cleaned = cleaned.replace(/((?:<br\s*\/?>|\r?\n)[ \t]*){3,}/gi, '<br><br>');
        return { html: cleaned, removed };
    }

    function postProcessForEmail(html) {
        const lines = String(html || '').split(/(<[A-Za-z][^>]*>)|(\n)/i);
        let output = '';

        lines.forEach(part => {
            if (part === undefined) {
                return;
            }
            if (/(^<br\s*\/?>$)|(^\n$)/i.test(part)) {
                output += '<br>';
            } else {
                output += part.replace(/^\s+/, match =>
                    match.replace(/ /g, '&nbsp;').replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;')
                );
            }
        });

        return output;
    }

    function showMultiRegexHighlightPopup() {
        const example = [
            "# One regex per line; optional color index like '3:' or '@3'",
            'TODO',
            '3: \\bclass\\b\\s+\\w+',
            '/function\\s+\\w+/i @5',
            ''
        ].join('\n');
        const prefill = loadLastMultiRegexText() || example;

        showTextPopup(text => {
            if (!text) {
                setStatus('No patterns supplied.');
                return;
            }
            saveLastMultiRegexText(text);
            runMultiRegexHighlight(text);
        }, 'Multi-Regex Highlight (one per line)', prefill);
    }

    function loadLastMultiRegexText() {
        try {
            return window.localStorage.getItem('multiRegexHighlight.last') || '';
        } catch (error) {
            return '';
        }
    }

    function saveLastMultiRegexText(text) {
        try {
            window.localStorage.setItem('multiRegexHighlight.last', text || '');
        } catch (error) {
            // localStorage is optional in webview contexts.
        }
    }

    function runMultiRegexHighlight(raw) {
        const lines = String(raw || '').split(/\r?\n/);
        let assigned = 1;
        let patternCount = 0;
        let matchCount = 0;

        function nextColId() {
            if (assigned <= 7) {
                const id = assigned;
                assigned += 1;
                return id;
            }
            return 0;
        }

        lines.forEach(line => {
            const parsed = parseMultiRegexLine(line, nextColId);
            if (!parsed) {
                return;
            }
            patternCount += 1;
            if (parsed.colid >= 1 && parsed.colid <= 7) {
                const searchBox = document.getElementById(`searchBox${parsed.colid}`);
                if (searchBox) {
                    searchBox.value = parsed.pattern;
                }
            }
            matchCount += highlightPattern(parsed.pattern, parsed.colid, parsed.flags);
        });

        setStatus(`Multi-Regex: highlighted ${matchCount} match${matchCount === 1 ? '' : 'es'} from ${patternCount} pattern${patternCount === 1 ? '' : 's'}.`);
        scheduleSend();
    }

    function parseMultiRegexLine(line, nextColId) {
        let source = String(line || '').trim();
        if (!source || source.startsWith('#')) {
            return null;
        }

        let explicitCol = null;
        const prefixMatch = source.match(/^([1-7])\s*:\s*(.*)$/);
        if (prefixMatch) {
            explicitCol = Number(prefixMatch[1]);
            source = prefixMatch[2].trim();
        }

        let tailCol = null;
        const tailMatch = source.match(/\s@([1-7])\s*$/);
        if (tailMatch) {
            tailCol = Number(tailMatch[1]);
            source = source.replace(/\s@([1-7])\s*$/, '').trim();
        }

        let pattern = source;
        let flags = '';
        const jsStyle = source.match(/^\/(.+)\/([gimuyds]*)$/);
        if (jsStyle) {
            pattern = jsStyle[1];
            flags = jsStyle[2] || '';
        }

        return {
            pattern,
            flags,
            colid: explicitCol || tailCol || nextColId()
        };
    }

    function insertDownloadLinkAtSavedRange() {
        const selectedLabel = savedEditorRange ? savedEditorRange.toString().trim() : getSelectedTextInsideEditor().trim();
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.style.display = 'none';

        fileInput.addEventListener('change', function () {
            const file = fileInput.files && fileInput.files[0];
            if (!file) {
                return;
            }

            const reader = new FileReader();
            reader.onload = function (event) {
                const dataURL = event.target.result;
                const link = document.createElement('a');
                link.href = dataURL;
                link.download = file.name;
                link.className = 'spectral-attachment';
                link.textContent = selectedLabel || `📎${file.name}`;

                insertNodeAtSelection(link);
                setStatus(`Inserted download link for ${file.name}`);
            };
            reader.readAsDataURL(file);
        }, { once: true });

        document.body.appendChild(fileInput);
        fileInput.click();
        document.body.removeChild(fileInput);
    }

    function firstHalfBoldWords(root) {
        boldHalfOfWords(root, 'first');
    }

    function secondHalfBoldWords(root) {
        boldHalfOfWords(root, 'second');
    }

    function boldHalfOfWords(root, half) {
        Array.from(root.childNodes).forEach(processNode);

        function processNode(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                const words = node.textContent.split(/(\s+)/);
                const fragment = document.createDocumentFragment();

                words.forEach(word => {
                    if (word.trim().length > 3) {
                        const halfIndex = half === 'first' ? Math.ceil(word.length / 2) : Math.floor(word.length / 2);
                        const firstHalf = word.slice(0, halfIndex);
                        const secondHalf = word.slice(halfIndex);
                        if (half === 'first') {
                            fragment.appendChild(strongText(firstHalf));
                            fragment.appendChild(document.createTextNode(secondHalf));
                        } else {
                            fragment.appendChild(document.createTextNode(firstHalf));
                            fragment.appendChild(strongText(secondHalf));
                        }
                    } else {
                        fragment.appendChild(document.createTextNode(word));
                    }
                });

                node.replaceWith(fragment);
            } else if (node.nodeType === Node.ELEMENT_NODE && !node.closest('button, a, textarea, #textPopup')) {
                Array.from(node.childNodes).forEach(processNode);
            }
        }
    }

    function strongText(value) {
        const strong = document.createElement('strong');
        strong.textContent = value;
        return strong;
    }

    function getSelectedTextInsideEditor() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return '';
        }
        const range = selection.getRangeAt(0);
        if (!editor.contains(range.commonAncestorContainer)) {
            return '';
        }
        return selection.toString();
    }

    function hydrateEditorControls(root) {
        root.querySelectorAll('.note-button').forEach(button => {
            button.removeEventListener('click', noteButtonClickHandler);
            button.addEventListener('click', noteButtonClickHandler);
        });
        root.querySelectorAll('a[onclick]').forEach(anchor => {
            const onclick = anchor.getAttribute('onclick') || '';
            const match = onclick.match(/selectText\(['"]([^'"]+)['"]\)/);
            if (match) {
                anchor.setAttribute('data-select-id', match[1]);
                anchor.removeAttribute('onclick');
            }
        });
        root.querySelectorAll('a[data-select-id]').forEach(anchor => {
            anchor.removeEventListener('click', internalLinkClickHandler);
            anchor.addEventListener('click', internalLinkClickHandler);
        });
        root.querySelectorAll('.image-button-reveal').forEach(button => {
            button.addEventListener('click', () => showImageFromButton(button));
        });
    }

    function target(optionalId) {
        if (!savedEditorRange) {
            setStatus('No selection saved to mark as target.');
            return;
        }

        const range = savedEditorRange.cloneRange();
        if (range.collapsed) {
            setStatus('No selected text to mark as target.');
            return;
        }

        const id = optionalId || generateRandomId();
        const span = document.createElement('span');
        span.id = id;
        span.textContent = range.toString();

        range.deleteContents();
        range.insertNode(span);
        lastTargetId = id;
        setStatus(`Target set with id: ${id}`);
        scheduleSend();
    }

    function link(optionalId) {
        const range = getInsertionRange();
        if (!range || range.collapsed) {
            setStatus('No selection saved to link.');
            return;
        }

        const targetId = optionalId || lastTargetId;
        if (!targetId) {
            setStatus('No target ID available to link to.');
            return;
        }

        const anchor = document.createElement('a');
        anchor.href = `#${targetId}`;
        anchor.setAttribute('data-select-id', targetId);
        anchor.textContent = range.toString();
        anchor.addEventListener('click', internalLinkClickHandler);

        range.deleteContents();
        range.insertNode(anchor);
        setStatus(`Link created to target id: ${targetId}`);
        scheduleSend();
    }

    function xlink(optionalUrl) {
        if (!savedEditorRange || savedEditorRange.collapsed) {
            setStatus('No selection saved to create external link.');
            return;
        }

        const insertExternalLink = url => {
            if (!url) {
                setStatus('No URL provided.');
                return;
            }

            const range = savedEditorRange.cloneRange();
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            anchor.textContent = range.toString();

            range.deleteContents();
            range.insertNode(anchor);
            setStatus(`External link created to: ${url}`);
            scheduleSend();
        };

        if (optionalUrl) {
            insertExternalLink(optionalUrl);
        } else {
            showTextPopup(insertExternalLink, 'Enter URL:', 'https://');
        }
    }

    function internalLinkClickHandler(event) {
        event.preventDefault();
        const targetId = event.currentTarget.getAttribute('data-select-id');
        selectText(targetId);
    }

    function selectText(containerid) {
        const element = document.getElementById(containerid);
        if (!element) {
            setStatus(`Target not found: ${containerid}`);
            return;
        }

        const range = document.createRange();
        range.selectNode(element);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        savedEditorRange = range.cloneRange();
        setStatus(`Selected target: ${containerid}`);
    }

    function generateRandomId(length = 12) {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let id = '';
        for (let i = 0; i < length; i += 1) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return `edz${id}`;
    }

    function handleEditorDoubleClick() {
        const word = getSelectedTextInsideEditor().trim();
        if (!word) {
            return;
        }

        const count = highlightRegexRobust(word, 0, false);
        if (count > 0) {
            setStatus(`${count} occurrence${count === 1 ? '' : 's'} highlighted for "${word}"`);
            scheduleSend();
        }
    }

    function highlightRegexRobust(pattern, colid, showResultsListing) {
        void showResultsListing;
        const color = colid ? colorForHighlighter(colid) : randomHilightColor();
        const matches = [];
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || !node.nodeValue.includes(pattern)) {
                    return NodeFilter.FILTER_REJECT;
                }
                const parent = node.parentElement;
                if (!parent || parent.closest('button, a, textarea, #textPopup')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        let node = walker.nextNode();
        while (node) {
            collectWholeWordMatches(node, pattern).forEach(match => matches.push(match));
            node = walker.nextNode();
        }

        matches.reverse().forEach(match => wrapTextRange(match.node, match.start, match.end, color));
        return matches.length;
    }

    function highlightSearchPattern(pattern, colid) {
        return highlightPattern(pattern, colid, '');
    }

    function highlightPattern(pattern, colid, explicitFlags) {
        const source = String(pattern || '').trim();
        if (!source) {
            return 0;
        }

        const color = colorForHighlighter(colid);
        const flagSet = new Set(String(explicitFlags || '').replace(/g/g, '').split('').filter(Boolean));
        if (document.getElementById('caseInsensitive').checked || flagSet.has('i')) {
            flagSet.add('i');
        }
        flagSet.add('g');
        const flags = Array.from(flagSet).join('');
        let regex;
        try {
            regex = new RegExp(source, flags);
        } catch (error) {
            setStatus(`Invalid regex: ${error.message}`);
            return 0;
        }

        const matches = [];
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const parent = node.parentElement;
                if (!node.nodeValue || !parent || parent.closest('button, a, textarea, #textPopup')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        let node = walker.nextNode();
        while (node) {
            regex.lastIndex = 0;
            let match = regex.exec(node.nodeValue || '');
            while (match) {
                if (match[0].length === 0) {
                    regex.lastIndex += 1;
                } else {
                    matches.push({
                        node,
                        start: match.index,
                        end: match.index + match[0].length,
                        text: match[0]
                    });
                }
                match = regex.exec(node.nodeValue || '');
            }
            node = walker.nextNode();
        }

        const shouldShowResults = document.getElementById('showSearchResults')?.checked && Number(colid) >= 1 && Number(colid) <= 7;
        if (shouldShowResults) {
            prepareSearchResults(source, colid, matches);
        }

        matches.slice().reverse().forEach(match => {
            const span = wrapTextRange(match.node, match.start, match.end, color, {
                className: colid ? `highlight${colid}` : 'highlight',
                id: match.resultId
            });
            if (span && shouldShowResults) {
                span.setAttribute('data-spectral-search-result', '1');
            }
        });

        if (shouldShowResults) {
            showSearchResults(matches);
        }
        return matches.length;
    }

    function prepareSearchResults(pattern, colid, matches) {
        ensureSearchResultsPopup();
        searchResultsTitle.textContent = `Search ${colid}: ${matches.length} match${matches.length === 1 ? '' : 'es'} for ${pattern}`;
        searchResultsList.textContent = '';

        matches.forEach((match, index) => {
            match.resultId = `srch_${generateRandomId(14)}`;
            match.beforeContext = searchContextBefore(match.node, match.start);
            match.afterContext = searchContextAfter(match.node, match.end);

            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'search-result-row';
            row.addEventListener('click', () => selectSearchResult(match.resultId));

            const number = document.createElement('span');
            number.className = 'search-result-number';
            number.textContent = String(index + 1);

            const snippet = document.createElement('span');
            snippet.className = 'search-result-snippet';

            const before = document.createElement('span');
            before.className = 'search-result-context';
            before.textContent = match.beforeContext;

            const hit = document.createElement('span');
            hit.className = 'search-result-hit';
            hit.textContent = match.text;

            const after = document.createElement('span');
            after.className = 'search-result-context';
            after.textContent = match.afterContext;

            snippet.appendChild(before);
            snippet.appendChild(hit);
            snippet.appendChild(after);
            row.appendChild(number);
            row.appendChild(snippet);
            searchResultsList.appendChild(row);
        });
    }

    function showSearchResults(matches) {
        ensureSearchResultsPopup();
        if (!matches.length) {
            const empty = document.createElement('div');
            empty.className = 'search-result-empty';
            empty.textContent = 'No matches.';
            searchResultsList.appendChild(empty);
        }
        searchResultsPopup.style.display = 'block';
    }

    function ensureSearchResultsPopup() {
        if (searchResultsPopup) {
            return;
        }

        searchResultsPopup = document.createElement('div');
        searchResultsPopup.className = 'search-results-popup';

        const header = document.createElement('div');
        header.className = 'search-results-header';
        searchResultsTitle = document.createElement('strong');

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.textContent = 'Close';
        closeButton.addEventListener('click', closeSearchResultsPopup);

        header.appendChild(searchResultsTitle);
        header.appendChild(closeButton);

        searchResultsList = document.createElement('div');
        searchResultsList.className = 'search-results-list';

        searchResultsPopup.appendChild(header);
        searchResultsPopup.appendChild(searchResultsList);
        document.body.appendChild(searchResultsPopup);
    }

    function closeSearchResultsPopup() {
        if (searchResultsPopup) {
            searchResultsPopup.style.display = 'none';
        }
    }

    function selectSearchResult(resultId) {
        const element = document.getElementById(resultId);
        if (!element) {
            setStatus('Search result is no longer available.');
            return;
        }

        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        savedEditorRange = range.cloneRange();
        element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        editor.focus();
        setStatus(`Selected search result: ${element.textContent || resultId}`);
    }

    function searchContextBefore(node, start) {
        return compactSearchContext((node.nodeValue || '').slice(Math.max(0, start - 48), start), true);
    }

    function searchContextAfter(node, end) {
        return compactSearchContext((node.nodeValue || '').slice(end, end + 48), false);
    }

    function compactSearchContext(text, leading) {
        const compact = String(text || '').replace(/\s+/g, ' ');
        if (!compact) {
            return '';
        }
        return leading ? `...${compact}` : `${compact}...`;
    }

    function collectWholeWordMatches(node, word) {
        const matches = [];
        const text = node.nodeValue || '';
        let index = text.indexOf(word);

        while (index !== -1) {
            const end = index + word.length;
            if (isWordBoundary(text, index - 1) && isWordBoundary(text, end)) {
                matches.push({ node, start: index, end });
            }
            index = text.indexOf(word, index + Math.max(word.length, 1));
        }

        return matches;
    }

    function wrapTextRange(textNode, start, end, color, options = {}) {
        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, end);

        const span = document.createElement('span');
        if (options.className) {
            span.className = options.className;
        }
        if (options.id) {
            span.id = options.id;
        }
        span.style.backgroundColor = color;
        range.surroundContents(span);
        return span;
    }

    function isWordBoundary(text, index) {
        if (index < 0 || index >= text.length) {
            return true;
        }
        return !/[A-Za-z0-9_$]/.test(text.charAt(index));
    }

    function randomHilightColor() {
        const letters = 'BCDEF';
        let color = '#';
        for (let i = 0; i < 6; i += 1) {
            color += letters.charAt(Math.floor(Math.random() * letters.length));
        }
        return color;
    }

    function colorForHighlighter(colid) {
        const colors = {
            1: '#f0f583',
            2: '#fd9f9f',
            3: '#aafba2',
            4: '#a5f8f8',
            5: '#f997f9',
            6: '#ccddf7',
            7: '#ffffff'
        };
        return colors[colid] || randomHilightColor();
    }

    function getPlainText() {
        const clone = editor.cloneNode(true);
        removeLineNumbers(clone);
        clone.querySelectorAll('.cursor').forEach(span => span.remove());
        clone.querySelectorAll('.cursor-marker').forEach(span => span.remove());
        return cleanInvisibleChars(extractTextWithLineBreaks(clone));
    }

    function extractTextWithLineBreaks(node) {
        let text = '';

        node.childNodes.forEach(child => {
            if (child.nodeType === Node.TEXT_NODE) {
                text += child.textContent;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const tag = child.tagName.toUpperCase();

                if (tag === 'BR') {
                    text += '\n';
                } else if (['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag)) {
                    text += extractTextWithLineBreaks(child) + '\n';
                } else if (tag === 'TR') {
                    text += extractTextWithLineBreaks(child).replace(/\t+$/, '') + '\n';
                } else if (tag === 'TD' || tag === 'TH') {
                    text += extractTextWithLineBreaks(child) + '\t';
                } else {
                    text += extractTextWithLineBreaks(child);
                }
            }
        });

        return text;
    }

    function cleanInvisibleChars(text) {
        return text.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
            .replace(/\r\n|\r/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function textToSpectralHtml(text) {
        return escapeHtml(text)
            .replace(/\r\n/g, '<br/>')
            .replace(/\n/g, '<br/>');
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function materializeEmbeddedVideoSources(root) {
        root.querySelectorAll('video[data-spectral-video-src]').forEach(video => {
            video.setAttribute('src', normalizeVideoDataUrl(video.getAttribute('data-spectral-video-src')));
            video.removeAttribute('data-spectral-video-src');
        });
    }

    function hydrateEmbeddedVideoSources(root = document) {
        root.querySelectorAll('video[data-spectral-video-src], video[src^="data:video/"]').forEach(video => {
            const dataURL = normalizeVideoDataUrl(video.getAttribute('data-spectral-video-src') || video.getAttribute('src'));
            if (!dataURL || !dataURL.startsWith('data:video/')) {
                return;
            }
            const objectURL = URL.createObjectURL(dataUrlToBlob(dataURL));
            video.setAttribute('data-spectral-video-src', dataURL);
            video.src = objectURL;
            video.load();
        });
    }

    function normalizeVideoDataUrl(dataURL) {
        if (typeof dataURL !== 'string' || !dataURL.startsWith('data:video/')) {
            return dataURL || '';
        }
        return dataURL;
    }

    function dataUrlToBlob(dataURL) {
        const parts = String(dataURL || '').split(',');
        const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'application/octet-stream';
        const binary = atob(parts[1] || '');
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return new Blob([bytes], { type: mime });
    }

    function base64EncodeUtf8(text) {
        return btoa(unescape(encodeURIComponent(String(text || ''))));
    }

    function base64DecodeUtf8(base64) {
        try {
            return decodeURIComponent(escape(atob(base64 || '')));
        } catch (error) {
            return '';
        }
    }

    window.Spectral = {
        version: 1,
        editor,
        registerCommand: registerPluginCommand,
        runCommand: runPluginCommand,
        commandNames: () => Array.from(pluginCommands.keys()),
        addToolbarButton: addPluginToolbarButton,
        setStatus,
        scheduleSend,
        hydrateEditorControls,
        insertTextAtIndex,
        insertText,
        inserText,
        createNote,
        addCursorAtIndex,
        selectRangeByIndex,
        block_color,
        nested_block_color,
        diffnotes,
        setDiffContext,
        clearDiffContext,
        clearAllHighlight,
        renderMarkdown,
        copyMarkdownToClipboard,
        hideCmd,
        cmdhelp,
        showTextPopup,
        getPlainText: getPlainTextForIndexing,
        getEditorHtml: () => editor.innerHTML,
        setEditorHtml: html => {
            editor.innerHTML = String(html || '');
            hydrateEditorControls(editor);
            scheduleSend();
        },
        api: {
            get savedEditorRange() {
                return savedEditorRange;
            },
            set savedEditorRange(range) {
                savedEditorRange = range;
            },
            get cursors() {
                return cursors;
            }
        }
    };
})();
