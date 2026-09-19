# Development Log

This file is the progressive handoff note for `Spectralweb_vscode`.

## 2026-09-19: Local JS Command Server Plugin

Added a webview-to-extension-host bridge for the command server plugin.

- `startCmdServer(port)` and `stopCmdServer(port)` are available from JS Cmd.
- The extension host owns the Node TCP server because webview plugins cannot use
  `require('net')`.
- Servers bind only to `127.0.0.1` and are scoped to the editor that started them.
- Commands and responses use null-byte framing, allowing multiline JavaScript.
- Commands execute through the existing JS Cmd interpreter in the webview.
- Closing the editor stops its listeners and connected sockets.
- Input is limited to 1 MiB per buffered command.

## 2026-06-22: Webview Plugin Loader

Added a Tcl-style webview plugin loader for extension-local scripts:

- `plugins/plugins.js` and sorted `plugins/plugin_*.js` are injected after `media/editor.js`.
- `window.Spectral` exposes command registration, toolbar buttons, status updates, indexed insertion, note creation, block coloring, diffnotes, and editor HTML/text helpers.
- JS Cmd runs registered plugin commands by bare name before falling back to eval.
- `plugins/README.md` documents the plugin file naming and API pattern.

## 2026-06-21: Docked JS Command Bar

Changed JS Cmd from a transient floating popup to a one-line bottom-docked command bar. Enter runs a command and keeps the bar focused; Escape clears/refocuses it; `hideCmd()` dismisses it.

## 2026-06-21: Indexed Note Creation Helpers

Added JavaScript command helpers matching the Tcl/Tk indexed editing surface:

- `createNote(index, text, label = "")` creates a note button at `line.character`, `line.end`, or `end`.
- `insertText(index, text)` and `inserText(index, text)` alias `insertTextAtIndex(index, text)`.

## 2026-06-20: SpectralMultiCursor Command Parity Refresh

Ported the non-SVG June command features from `../spectralMultiCursor.html` into the VS Code webview.

Added:

- `diffnotes()`, `diffnotes({ granularity: "word" })`, `setDiffContext(...)`, and `clearDiffContext()`.
- `F7` two-note diff picking mode, with `Esc` cancellation.
- `cmdhelp()` command reference popup.
- `block_color(...)` and `nested_block_color(...)` for brace blocks.
- `block_color("sel", ...)` / `nested_block_color(..., "sel", ...)` selection mode.
- Hyphen-negated string regex predicates for block coloring, with `--` preserving a literal leading hyphen.
- `delete_empty_lines()` command alias.
- Bracket matching now also selects the interior range between matched brackets.

Explicitly not ported in this refresh:

- SVG-specific editor features from `spectralMultiCursor.html`; those are not needed in this VS Code plugin.

Validation:

```powershell
npm run lint
npm test
```

Both passed after the change.

## 2026-06-21: Popup Text Search Parity

Ported the popup-local search controls from `spectralMultiCursor.html` into the VS Code webview popups.

Added:

- popup search bars on note text popups, note diff popups, and command help;
- Enter / Shift+Enter navigation through matches;
- configurable match background and foreground colors;
- Clear button that removes only popup-local search highlights;
- match counts such as `2/7`.

For textarea-backed note popups, matches are navigated using the native text selection. For DOM-backed diff/help popups, matches are wrapped with transient `.popup-search-hit` spans.

## 2026-05-03: HTML-Native Alternative Started

Created `Spectralweb_vscode` as a separate VS Code extension project.

Purpose:

- explore the alternative requested by Jayanta where the VS Code extension follows the `spectralMultiCursor.html` HTML representation directly;
- avoid the JSON-HLT model used by `Spectral_vscode`;
- make it easier to transfer functions from `spectralMultiCursor.html` because the rich state remains ordinary editor HTML.

## Architecture

Files:

- `package.json`: extension manifest and commands.
- `.vscode/launch.json`: launches an Extension Development Host with `F5`.
- `extension.js`: VS Code custom editor provider, source/rich save bridge, companion HTML load/save.
- `media/editor.js`: webview editing behavior.
- `media/editor.css`: Spectral-like light editor and toolbar styling.
- `lib/spectralwebCore.js`: pure Spectral HTML/projection helpers used by tests.
- `test/run-tests.js`: in-process Node test runner.
- `README.md`, `DESIGN.md`, `TESTING.md`: handoff and testing docs.

Commands:

- `Spectral Web: Open Rich Editor`
- `Spectral Web: Save Rich HTML Layer`

View type:

```text
spectralweb.richEditor
```

## Persistence Decision

The canonical rich state is:

```javascript
document.getElementById('editor').innerHTML
```

The companion file is a minimal Spectral-style HTML file containing:

- `#inline-style`
- `#inline-script`
- `#textPopup`
- `#editor`
- `#spectralweb-metadata`

Loading extracts `#editor.innerHTML` from `filename.ext.html`. If the companion does not exist, the source text is escaped and newlines become `<br/>`, matching `escapeTextWithLineBreaks()` in `spectralMultiCursor.html`.

## Plain Text Projection

The webview implements `extractTextWithLineBreaks()` and `cleanInvisibleChars()` based on `html2text.js`.

Important compatibility note:

- `html2text.js` trims the final result.
- This extension currently trims too, to keep the same projection semantics.
- That may remove meaningful leading/trailing whitespace in rare source files.

## Implemented Features

- Basic formatting through `document.execCommand`.
- Seven Spectral highlighter colors:
  - `#f0f583`
  - `#fd9f9f`
  - `#aafba2`
  - `#a5f8f8`
  - `#f997f9`
  - `#ccddf7`
  - `#ffffff`
- Spectral-style notes:
  - `.note-button`
  - base64 note text in `data-message`
  - popup creation/editing behavior
- Attachments:
  - data-URL `<a download>` links
  - selected text preserved as the visible label
- Hyperlinks:
  - internal targets and links;
  - external links through the text popup;
  - portable saved `data-select-id` rehydration.
- Double-click word highlighting:
  - whole-word occurrence matching
  - random light color generation using hex digits from `BCDEF`
- Save behavior:
  - `Ctrl+S` sends plain text and editor HTML to the extension host;
  - the extension saves the plain file if dirty and writes the sibling `.html`.

## 2026-05-04: Broader Toolbar Shell And Tests

Expanded the webview top/status bars to more closely mirror `spectralMultiCursor.html`.

Newly visible toolbar/status elements:

- file loader input;
- remove bold/italic/underline controls;
- left/right bold controls;
- target/link/external-link controls;
- background color picker;
- default font button;
- copy editor HTML button;
- font, size, and foreground color selectors;
- editable and wrap toggles;
- ignore-case checkbox;
- find/replace placeholder;
- speak-selection button;
- n-cursor controls;
- sanitize and help controls;
- seven regex search boxes paired with seven highlighter buttons;
- status textarea matching the original status bar shape.

Ported low-risk behavior:

- local file input reads a file into the editor as escaped Spectral HTML with `<br/>` newlines;
- editable and wrap toggles work;
- background color picker works;
- font, size, and foreground color selectors apply browser editing commands;
- copy button copies `editor.innerHTML`;
- speak-selection uses browser speech synthesis when available;
- regex search boxes highlight matches on Enter;
- multi-regex highlighting popup is ported and remembers its last content in webview local storage when available;
- find/replace popup is ported for text-node replacements with regex/plain-text and case-sensitive modes;
- sanitize is ported using the original `postProcessForEmail` behavior;
- first-half and second-half word bolding are ported as DOM transformations based on the original `firstHalfBoldWords` and `secondHalfBoldWords` functions;
- unported controls show their command name in the status bar.

## 2026-05-04: Removed S3/MathML And Ported Links

Jayanta clarified that S3 features and MathML cleanup are not required for the VS Code extension. Removed these toolbar entries:

- `S3 Config`
- `Save S3`
- `Load S3`
- `MathML Clean`

Ported the hyperlinking group:

- `Target` marks the saved selection as a span with a generated `edz...` id.
- `Link` wraps the current/saved selection as an internal link to the most recent target.
- `Ext Link` opens the text popup for a URL and wraps the saved selection as an external link.
- Internal links use `data-select-id` plus a click listener in the VS Code webview, avoiding inline `onclick` under the webview CSP.
- The saved portable HTML rehydrates `a[data-select-id]` links in `#inline-script`.

This is a good example of the gradual transfer pattern: the semantics are copied from `spectralMultiCursor.html`, but event binding is adapted to VS Code webview rules.

## 2026-05-04: Find & Replace Port

Ported the useful part of `showFindReplaceDialog`, `runFindReplace`, and `replace`.

Implemented:

- popup dialog built by `media/editor.js`;
- find pattern;
- replacement text;
- regex/plain-text mode;
- case-sensitive/case-insensitive mode;
- Replace All over editor text nodes.

Also ported:

- cursor-only mode, which places cursors at regex/plain-text matches instead of replacing text.

The replacement walker skips buttons, links, textareas, and popup content so notes, attachments, and link labels are not accidentally rewritten by the first implementation.

## 2026-05-04: Sanitize And Multi-Regex Port

Ported two more self-contained controls:

- `Sanitize`
- `H*`

`Sanitize` now applies the original email-oriented `postProcessForEmail` behavior:

- keeps `<br>` line breaks;
- converts leading spaces to `&nbsp;`;
- converts leading tabs to four `&nbsp;` entities.

`H*` opens the shared text popup with the same input style as `spectralMultiCursor.html`:

- one regex per line;
- blank lines and `#` comments ignored;
- optional color prefix such as `3: pattern`;
- optional color suffix such as `/pattern/i @5`;
- automatic colors 1 through 7 before falling back to random colors.

Implementation notes:

- multi-regex input is remembered in webview `localStorage` when available;
- individual regex search boxes are populated for color ids 1 through 7;
- highlighting reuses the existing text-node regex highlighter and skips buttons, links, textareas, and popup content.

## 2026-05-04: First N-Cursor Workflow

Replaced the remaining n-cursor placeholder buttons with a first functional port.

Implemented:

- `Add n-Cursors`
  - if text is selected, adds cursors at the start of selected lines;
  - if selection is collapsed, toggles click-to-add cursor mode.
- `Clear n-Cursors`
  - removes all visual cursor spans.
- `Align /w Cursors`
  - deletes one following space or tab at each cursor.
- Basic multi-cursor editing:
  - printable character insertion;
  - `Enter`;
  - `Tab` as four spaces;
  - `Backspace`;
  - `Delete`;
  - `ArrowLeft`;
  - `ArrowRight`;
  - paste at all cursors, preferring HTML, then images, then plain text.
- regex/plain-text cursor placement through Find & Replace cursor-only mode.
- selected-line-end cursor placement with right-click on `Add n-Cursors`;
- preceding-whitespace alignment with right-click on `Align /w Cursors`.

Important implementation choices:

- Cursor visuals are `<span class="cursor" contenteditable="false">`.
- Cursor spans are removed from the cloned editor HTML before save, so they do not persist into the rich layer.
- Multi-cursor edits mutate existing text nodes in place, so rich HTML annotations are preserved.
- This is intentionally smaller than the original subsystem. The main remaining cursor gaps are richer segment distribution that preserves markup and any less-used line/highlight variants.
- The offset mapping handles both text-node cursor ranges and element-node ranges just after cursor spans.

## 2026-05-04: Cursor Movement And Paste

Extended the first n-cursor workflow:

- `ArrowLeft` and `ArrowRight` move all active cursors by one plain-text offset.
- Pasting with cursors active inserts at every cursor.

Implementation notes:

- Paste uses the browser paste event's `clipboardData`, avoiding extra async clipboard permissions for normal paste.
- Paste preference order is:
  - `text/html`;
  - image files converted to data-URL `<img>` tags;
  - `text/plain`.
- Cursor movement remains offset-based, so it works across text nodes while preserving surrounding rich HTML markup.

## 2026-05-04: Regex-Driven Cursor Placement

Restored the useful `cursorOnlyMode` branch of the original Find & Replace dialog.

Behavior:

- Open `Find & Replace`.
- Enter a pattern.
- Choose regex/plain-text mode and case sensitivity.
- Check `Place cursors only`.
- Click `Replace All` or press Enter.

Instead of changing text, the webview adds cursors at each match start. The walker skips buttons, links, textareas, and popup content.

## 2026-05-04: Cursor Context Menu Variants

Ported two small context-menu behaviors:

- right-click `Add n-Cursors`: add cursors at selected line ends;
- right-click `Align /w Cursors`: delete one preceding space/tab at each cursor.

This mirrors the original toolbar's alternate cursor placement/alignment path without pulling in the full remaining line-operation subsystem.

## 2026-05-04: Cursor Line Filtering

Added toolbar controls:

- `Keep Lines`
- `Delete Lines`

Behavior:

- `Keep Lines` keeps only lines containing one or more cursors.
- `Delete Lines` removes lines containing one or more cursors.
- Keyboard shortcuts are also active in the webview:
  - `Ctrl+Alt+K`: keep cursor lines;
  - `Ctrl+Alt+D`: delete cursor lines.

Initial limitation, now fixed:

- The first implementation computed cursor line numbers from the plain-text projection and rebuilt `editor.innerHTML` from plain text using `textToSpectralHtml`.
- That was useful for source filtering but did not preserve rich markup on surviving lines.

## 2026-05-04: Markup-Preserving Cursor Line Filtering

Reworked `Keep Lines` and `Delete Lines` to use the original marker idea more directly.

Current behavior:

- Insert temporary `<span class="cursor-marker">` elements at cursor ranges.
- Split `editor.innerHTML` into explicit lines.
- Keep or delete lines containing markers.
- Remove marker spans from surviving lines.
- Restore the filtered HTML with `<br>` separators.

Added tested helper:

```text
filterHtmlLinesByCursorMarkers(html, keep)
```

The helper lives in `lib/spectralwebCore.js` and is covered by `test/run-tests.js`.

Remaining caveat:

- This preserves markup when line boundaries are represented by explicit `<br>` or literal newlines in `innerHTML`.
- It does not yet detect soft visual wraps the way the original `explicitlySegmentLines()` can, because that requires browser layout rectangles and cannot be covered by the current Node tests.

## 2026-05-04: Paste Segment Distribution

Ported the original paste-distribution shortcuts:

- `Ctrl+Alt+V`
  - with active cursors: paste clipboard content at all cursors;
  - without active cursors: split clipboard content into segments and append them to successive line ends starting at the current cursor line.
- `Ctrl+Alt+v`
  - with active cursors: paste clipboard content at all cursors;
  - without active cursors: split clipboard content into segments and prepend them to successive line starts starting at the current cursor line.

Clipboard segment splitting accepts:

- plain-text newlines;
- `<br>`;
- closing `</p>`;
- closing `</div>`.

Implementation notes:

- Active-cursor paste reuses the HTML/image/plain-text paste path.
- No-cursor segment distribution is source-oriented in this first version: it operates on the plain-text projection and rebuilds the editor with `textToSpectralHtml`.
- That means segment distribution is useful for code text, but it does not preserve rich markup on affected lines yet.

## 2026-05-04: Bracket Matching

Ported `matchAndHighlightBrackets()` behavior behind:

```text
Ctrl+Alt+M
```

Behavior:

- Uses the saved editor cursor.
- Checks the character at the cursor, then the character just before it.
- Supports:
  - parentheses `()`;
  - square brackets `[]`;
  - braces `{}`.
- Uses stack matching for nested brackets of the same kind.
- Highlights the matched pair with one random light color.

Implementation note:

- The matcher works on flattened text offsets but wraps only the two matching bracket characters in the rich DOM, so surrounding annotations are preserved.

## 2026-05-04: Clear Highlights

Ported the original `clearAllHighlight()` behavior.

Controls:

- `Clear Highlights` toolbar button;
- `Ctrl+Alt+C`.

Behavior:

- unwraps `.highlight` and `.highlight1` through `.highlight7`;
- removes inline `background-color` from span elements, unwrapping empty spans;
- unwraps SVG text highlights marked with `data-spectral-svg-hl`;
- removes SVG highlight background rects marked with `data-spectral-svg-hl-rect`.

This gives a cleanup path for manual highlighters, regex highlighters, double-click word highlights, and bracket-match highlights.

## 2026-05-04: Highlighted-Line Filtering

Ported the original highlighted-line operations.

Controls:

- `Keep HL Lines`
- `Delete HL Lines`

Shortcuts:

- `Ctrl+Alt+Shift+K`: keep highlighted lines;
- `Ctrl+Alt+Shift+D`: delete highlighted lines.

Highlight detection covers:

- `.highlight`;
- `.highlight1` through `.highlight7`;
- inline `background-color` styles from browser highlighter commands;
- SVG text highlights marked with `data-spectral-svg-hl`.

Added tested helper:

```text
filterHtmlLinesByHighlights(html, keep)
```

The helper lives in `lib/spectralwebCore.js` and is covered by `test/run-tests.js`.

## 2026-05-04: Tab Indentation

Ported the original `indentSelectedLines()` and collapsed-caret Tab behavior.

Behavior:

- `Tab` indents selected lines by four spaces;
- `Shift+Tab` removes one indentation level from selected lines;
- with no selection, `Tab` inserts four spaces at the caret;
- with no selection, `Shift+Tab` removes four spaces immediately before the caret when present.

The selected-line path is intentionally text-oriented, just like the original `spectralMultiCursor.html` function. If a rich formatted selection is indented, that selected fragment is replaced by plain text with preserved newlines.

Added tested helper:

```text
indentTextLines(text, indent)
```

The helper lives in `lib/spectralwebCore.js` and is covered by `test/run-tests.js`.

## 2026-05-04: Selection Text Utilities

Ported the original selection utilities:

- `uc()`: uppercase selected text;
- `lc()`: lowercase selected text;
- `tc()`: title-case selected text;
- `camel()`: camel-case selected text;
- `snake()`: snake-case selected text;
- `kebab()`: kebab-case selected text;
- `wc()`: count words in selected text.

These are exposed as toolbar controls:

- `UC`
- `LC`
- `TC`
- `camel`
- `snake`
- `kebab`
- `WC`

As in the original implementation, transformations are text-oriented. Applying them to rich formatted content replaces the selected fragment with plain transformed text.

Added tested helper:

```text
transformTextCase(text, mode)
```

The helper lives in `lib/spectralwebCore.js` and is covered by `test/run-tests.js`.

## 2026-05-04: Smart Enter

Ported the original `smartReturnPress()` behavior for normal single-caret editing.

Behavior:

- `Enter` preserves current line indentation;
- after `{`, `:`, or an unbalanced `(`, the inserted line receives one extra four-space indentation level;
- when the text to the right starts with `}`, the function inserts an extra line so the caret lands on the indented middle line.

This only runs when no n-cursors are active. Multi-cursor `Enter` still uses the existing cursor insertion path.

Added tested helper:

```text
computeSmartReturnInsertion(beforeCursor, afterCursor)
```

The helper lives in `lib/spectralwebCore.js` and is covered by `test/run-tests.js`.

## 2026-05-04: Brace Handling

Ported the original `handleBraceKey()` source-editing convenience.

Behavior:

- typing `{` inserts `{}` and places the caret between the braces;
- typing `}` on an indentation-only line removes up to one four-space indentation level, inserts `}`, and places the caret after it;
- typing `}` in normal text is left to the browser's normal insertion behavior.

This is intentionally a slightly corrected version of the original event flow. In `spectralMultiCursor.html`, the outer key handler prevents the default `}` insertion before calling `handleBraceKey()`, so the original can dedent without inserting the brace. The VS Code port keeps the useful dedent behavior but also inserts the requested `}`.

Added tested helper:

```text
dedentClosingBraceLine(lineBeforeCaret)
```

The helper lives in `lib/spectralwebCore.js` and is covered by `test/run-tests.js`.

## 2026-05-04: Reflow Selection

Ported the original `reflow(maxColumn)` utility.

Behavior:

- `Reflow` prompts for a target column width;
- selected newlines and surrounding whitespace are collapsed to single spaces;
- wrapping happens at whitespace once the current column is greater than the requested width;
- the selected fragment is replaced with plain text, matching the original text-oriented implementation.

Added tested helper:

```text
reflowText(text, maxColumn)
```

The helper lives in `lib/spectralwebCore.js` and is covered by `test/run-tests.js`.

## 2026-05-04: Explanation Wrapper

Ported the original `insertAbbrevAroundSelection()` behavior.

Controls:

- `Explain` toolbar button;
- `Ctrl+Alt+1`.

Behavior:

- saves the active selection before opening the popup;
- prompts for explanation text;
- wraps the selected contents in `<abbrev title="explanation">...</abbrev>`;
- moves the caret after the inserted abbreviation element.

The webview stylesheet and saved companion inline stylesheet now include the original dotted underline/cursor styling for `abbrev`.

## 2026-05-04: Transient Line Numbers

Ported the original line-number visibility command with persistence safeguards.

Controls:

- `Line #` toolbar button;
- `Ctrl+Alt+n`.

Behavior:

- visible line-number spans are inserted at explicit `<br>`-separated line starts;
- toggling again removes the spans;
- `getPlainText()` removes `.line-number` spans from a clone before projecting source text;
- `getEditorHtmlForSave()` removes `.line-number` spans from a clone before saving companion HTML.

This differs from the original visual-line implementation, which detects wrapped visual lines by measuring character rectangles. The VS Code port currently numbers explicit HTML/source lines to avoid making wrapped display state part of persistence.

## 2026-05-04: Reverse Lines

Ported the original `reverseLines()` line ordering utility.

Controls:

- `Reverse Lines` toolbar button.

Behavior:

- with no selection, all explicit `<br>`/source lines are reversed;
- with a selection, temporary marker spans identify the selected line block;
- only the marker-bounded line block is reversed;
- marker spans are removed during the reversal;
- per-line HTML is preserved while the line order changes.

This follows the original explicit-line behavior rather than trying to reverse soft-wrapped visual lines.

Added tested helper:

```text
reverseHtmlLines(html, startMarkerId, endMarkerId)
```

The helper lives in `lib/spectralwebCore.js` and is covered by `test/run-tests.js`.

## 2026-05-04: Enumerate Cursors

Ported the original `enumerateCursors(countStart = 1)` utility.

Controls:

- `Enum Cursors` toolbar button.

Behavior:

- requires active n-cursors;
- inserts labels like `#1 `, `#2 `, and so on in visible left-to-right order;
- applies insertions right-to-left internally so earlier edits do not shift later cursor offsets;
- keeps cursors after the inserted labels.

Added tested helper:

```text
enumerateCursorLabels(cursorCount, countStart)
```

The helper returns labels in right-to-left insertion order, so a four-cursor edit receives `#4`, `#3`, `#2`, `#1` as the DOM is processed from right to left.

## 2026-05-04: Instrumentation Cleanup

Ported `instrclean()` from the original Java instrumentation workflow.

Controls:

- `Instr Clean` toolbar button.

Behavior:

- removes `mprewriter.scope_START(number);` probe calls;
- tolerates whitespace or HTML tags between probe tokens;
- preserves an explicit line break when the removed probe occupied its own line;
- collapses excessive blank lines to at most two.

Added tested helper:

```text
cleanInstrumentationHtml(html)
```

The helper lives in `lib/spectralwebCore.js` and is covered by `test/run-tests.js`.

## 2026-05-04: Shortcut Parity Pass

Added keyboard routes for features already present in the VS Code webview.

Shortcuts:

- `Ctrl+1` through `Ctrl+7`: send selected text to the corresponding regex search box and focus it;
- `Ctrl+Alt+/`: open the multi-regex highlighter popup;
- `Ctrl+Alt+q`: insert an embedded attachment/download link;
- `Ctrl+Alt+r`: speak the current selection.

These call the same implementation paths as the toolbar buttons. `Ctrl+1` through `Ctrl+7` may be intercepted by VS Code or the host browser before reaching the webview, depending on focus and platform.

## 2026-05-04: Index-Based Editing

Ported the practical parts of the original index API.

Controls:

- `Insert @`
- `Cursor @`
- `Select @`

Index format:

- `line.character`, for example `2.0`;
- `line.end`, for example `2.end`;
- `end` for the end of the plain-text projection.

Behavior:

- indexes are evaluated against the same plain-text projection used for source saving;
- character offsets are zero-based;
- transient `.line-number`, `.cursor`, and `.cursor-marker` spans are ignored for index calculations;
- `Insert @` uses the first popup line as the index and the remaining popup lines as inserted text;
- `Cursor @` adds one n-cursor at the supplied index;
- `Select @` uses two popup lines, start index then end index.

Added tested helper:

```text
indexToTextOffset(text, indexStr)
```

The helper lives in `lib/spectralwebCore.js` and is covered by `test/run-tests.js`.

## 2026-05-04: HTML Insertion

Ported the original `Ctrl+i` HTML insertion workflow.

Controls:

- `HTML` toolbar button;
- `Ctrl+i`.

Behavior:

- if there is a non-empty editor selection, the selected literal text is parsed as HTML and replaces the selection;
- if there is no selection, a text popup prompts for HTML and inserts it at the saved caret;
- inserted content is hydrated afterward so note buttons and internal links regain webview handlers.

This is intentionally powerful and trusts the local editor user, matching the original standalone HTML tool.

## 2026-05-04: Markdown Render

Ported the self-contained `mdrender()` / `mdToHtml()` path as `Render MD`.

Controls:

- `Render MD`

Behavior:

- reads the editor's plain-text projection as Markdown;
- replaces the editor with rendered HTML;
- supports common Markdown structures: headings, paragraphs, lists, blockquotes, horizontal rules, fenced code blocks, images, links, inline code, emphasis, strong, and strike-through;
- rehydrates editor controls after rendering.

Added tested helper:

```text
markdownToHtml(markdown)
```

The helper lives in `lib/spectralwebCore.js` and is covered by `test/run-tests.js`.

## 2026-05-04: Toolbar Visibility Toggle

Ported the original `Ctrl+b` toolbar visibility shortcut.

Controls:

- `Tools` toolbar button;
- `Ctrl+b`.

Behavior:

- hides and shows secondary toolbars;
- keeps the first toolbar visible so `Tools` remains reachable.

## 2026-05-04: Local Snapshot Undo/Redo

Ported the original local `save()`, `undo()`, and `redo()` stack.

Controls:

- `Snap`
- `Undo Snap`
- `Redo Snap`

Shortcuts:

- `Ctrl+Alt+S`: save a local snapshot;
- `Ctrl+Alt+z`: restore the previous snapshot;
- `Ctrl+Alt+y`: redo a restored snapshot.

Behavior:

- snapshots store editor HTML after removing transient cursor and line-number markers;
- redo history is cleared when a new snapshot is saved;
- restoring a snapshot rehydrates note buttons and internal links;
- this is independent from `Ctrl+S`, which still saves the source file and companion HTML layer.

## 2026-05-04: Rich Copy

Ported the original custom editor copy behavior.

Behavior:

- intercepts copy events that originate from a non-empty editor selection;
- writes cleaned `text/html` using the existing email-style post-processing;
- writes a plain-text clipboard variant using the same projection rules as save;
- preserves note button `data-message` attributes and internal-link metadata;
- omits transient `.cursor`, `.cursor-marker`, and `.line-number` spans.

## 2026-05-04: Image Iconizing

Ported the original `replaceImagesInSelectionWithButtons()` / `makeImageButtonFromImg()` feature.

Controls:

- `Iconize Images`
- `Ctrl+Alt+P`

Behavior:

- finds images intersecting the current editor selection;
- replaces each selected image with a persistent `.image-button-reveal` button;
- stores the original `<img>` outer HTML as Base64 in `data-imghtml`;
- saved companion HTML includes the reveal-button style and `showImageFromButton()` rehydration support;
- the VS Code webview opens the image in an in-webview viewer popup instead of using `window.open`, which is less reliable under webview restrictions.

## 2026-05-04: Image Scaling

Ported the original `showImageScalingPopup()` / `applyImageScaling(scale)` behavior.

Controls:

- `Scale Images`
- `Ctrl+Alt+p`

Behavior:

- prompts for a positive percentage;
- scales images intersecting the current selection;
- if no selected image is found, scales the image nearest the saved caret;
- updates the image `width`, removes `height`, and leaves CSS height as `auto`.

## 2026-05-04: Help Popup

Changed `Help` from a status-only placeholder into an in-webview popup listing active commands and shortcuts.

This mirrors the role of the original `help()` popup while keeping the content focused on commands that are currently ported in `Spectralweb_vscode`.

## 2026-05-04: Blank-Line Tidy

Exposed the original excessive-blank-line cleanup as a standalone command.

Controls:

- `Tidy Blanks` toolbar button.

Behavior:

- collapses runs of three or more explicit blank lines to two;
- handles both `<br>`-based HTML lines and literal newline text.

Added tested helper:

```text
tidyBlankLinesHtml(html)
```

The helper lives in `lib/spectralwebCore.js` and is covered by `test/run-tests.js`.

Added automated tests:

- `lib/spectralwebCore.js` contains pure helper functions for text-to-HTML, editor extraction, DOM-to-text projection, and cleanup.
- `test/run-tests.js` verifies those helpers without needing VS Code or a browser.
- `npm test` uses an in-process runner because `node --test` tried to spawn a child process and failed under the current sandbox with `spawn EPERM`.

Validation commands:

```powershell
npm run lint
npm test
```

Both pass after this change.

## 2026-05-04: Markdown Export

Added the reverse side of the Markdown bridge.

Control:

- `Copy MD`

Behavior:

- copies the current selection as Markdown when the selection is inside the editor;
- falls back to copying the whole rich editor as Markdown when there is no selection;
- strips transient cursors, cursor markers, and line numbers before conversion;
- converts headings, paragraphs/divs, lists, blockquotes, horizontal rules, code blocks, inline code, bold, italic, strike-through, links, images, and simple tables;
- represents Spectral note buttons as `[note: note text]`;
- decodes iconized image buttons and emits image Markdown when the stored original `<img>` can be recovered.

Added tested helpers:

```text
escapeMarkdownText(text)
wrapInlineCode(text)
```

The browser-side recursive DOM conversion remains in `media/editor.js` because it depends on real DOM selection, cloning, and element traversal.

Validation commands:

```powershell
npm run lint
npm test
```

Both pass after this change. The helper suite now has 21 tests.

## 2026-05-04: Audio And Video Recording

Ported the original audio and webcam recording insertion paths into the VS Code webview.

Controls:

- `Audio Rec`
- `Video Rec`
- `Ctrl+l`
- `Ctrl+Alt+l`

Behavior:

- `Audio Rec` requests microphone access, records with `MediaRecorder`, and inserts a data-url `<audio controls>` element at the saved editor range;
- `Video Rec` requests camera and microphone access, records with the best supported browser MIME type, and inserts a `<video controls>` element at the saved editor range;
- while recording, a small webview popup exposes a `Stop` button;
- video elements keep a portable Base64 data URL in `data-spectral-video-src` while the live `src` uses a blob URL for playback;
- `getEditorHtmlForSave()` materializes `data-spectral-video-src` back to `src` before writing the companion HTML;
- the VS Code webview rehydrates saved `data:video/...` sources to blob URLs on load;
- the saved standalone companion HTML now includes the same video rehydration script, which is the JavaScript needed for reliable playback after export.

Added tested helpers:

```text
getDataUrlSafeVideoMimeType(mimeType)
normalizeVideoDataUrl(dataURL)
```

Validation commands:

```powershell
npm run lint
npm test
```

Both pass after this change. The helper suite now has 22 tests.

## 2026-05-04: Current-Line Yank And Delete

Ported a VS Code-webview version of the original `yy()` / `dd()` line helpers.

Controls:

- `Yank Lines`
- `DD Lines`

Behavior:

- requires a single caret inside the editor;
- computes the current line from the same plain-text projection used by save/index addressing;
- maps that line range back into the rich DOM;
- copies both `text/html` and indentation-preserving `text/plain` to the clipboard;
- preserves note metadata and internal link metadata in the copied HTML;
- `DD Lines` deletes the copied range after a successful clipboard write.

Added tested helper:

```text
computeLineBlockRange(text, offset, count)
```

This first UI pass exposes the current-line case. The helper already accepts a count so a later popup or command argument can support multi-line `dd(n)` / `yy(n)` parity without changing the core range calculation.

Validation commands:

```powershell
npm run lint
npm test
```

Both pass after this change. The helper suite now has 23 tests.

## 2026-05-04: SVG Export Removed From VS Code Scope

The dedicated `Copy SVG` / `Save SVG` export path was removed from the VS Code extension after project direction clarified that SVG-specific tooling can remain only in `spectralMultiCursor.html`.

Pasted or inserted inline SVG is still allowed as ordinary rich HTML content. Generic highlight cleanup still tolerates SVG highlight markers, but there are no visible SVG export controls and no extension-host `.svg` writer.

## 2026-05-04: Increment Integers

Ported the original `incrint(userPattern, delta)` utility.

Control:

- `Incr Int`

Behavior:

- opens the standard text popup with input format `regex, delta`;
- if the comma and delta are omitted, delta defaults to `1`;
- applies to the active editor selection when present;
- falls back to the whole editor when there is no selection;
- increments every integer inside each regex match;
- preserves positive zero padding, so `v007` incremented by `2` becomes `v009`;
- skips text inside buttons, links, popups, and recording controls to avoid damaging note/link UI.

Added tested helper:

```text
incrementIntegersInMatches(text, userPattern, delta)
```

Validation commands:

```powershell
npm run lint
npm test
```

Both pass after this change. The helper suite now has 24 tests.

## 2026-05-04: JavaScript Command Popup

Ported the original JavaScript command evaluator as an explicit command surface rather than a hidden `Esc` behavior.

Controls:

- `JS Cmd`
- `Ctrl+q`

Behavior:

- opens a small JavaScript command input popup;
- `Enter` evaluates the command;
- `ArrowUp` and `ArrowDown` navigate command history;
- `Esc` closes the popup only while the popup input has focus;
- plain command names without `()`, such as `clearAllHighlight`, are evaluated as function calls;
- convenience aliases include `uc`, `lc`, `tc`, `camel`, `snake`, `kebab`, `wc`, `mdrender`, and `tomd`;
- original-style `3y` / `3d` shortcuts call the ported line yank/delete helpers with a count;
- the VS Code webview CSP now includes `unsafe-eval`, intentionally scoped to this webview, because an eval-based command box cannot work under the previous CSP.

No pure helper test was added because the useful behavior is webview eval scope, popup state, and command dispatch. Syntax and existing helper tests pass after the change.

Validation commands:

```powershell
npm run lint
npm test
```

Both pass after this change. The helper suite remains at 24 tests.

## 2026-05-04: Command-Only Cleanup Utilities

Added several original cleanup helpers without adding toolbar buttons. They are intended to be invoked through `JS Cmd`.

Commands:

- `removeSpansWithClass(className)`
- `removeSpanContentsForClass(className)`
- `removeEmptyLinesFromEditor()`
- `flattenParagraphsInEditor()`
- `removeListFormattingNewlines()`
- `removeAllAnnotations()`
- `removeAllButtonsFromEditor()`

Behavior:

- these functions mutate the rich editor DOM directly;
- they update the status bar and schedule a save bridge update;
- `flattenParagraphsInEditor()` converts `<p>` elements to inline spans with trailing `<br>`, matching the original intent;
- the MathML-specific cleanup bundle remains intentionally unported because MathML cleanup was removed from scope.

Validation commands:

```powershell
npm run lint
npm test
```

Both pass after this change. The helper suite remains at 24 tests.

## 2026-05-04: Media Permission Fallback

Live microphone/camera recording can be blocked by VS Code's webview host before a browser-style permission prompt is shown. This appears as a permissions-policy or access-denied error from `getUserMedia()`.

Added file-embedding fallback:

- `+ Media`
- `insertMediaFileAtSavedRange()`
- alias: `media`
- alias: `insertmedia`

Behavior:

- opens a file picker accepting `audio/*,video/*`;
- embeds the selected audio/video file as a data URL at the saved editor range;
- prefers the current collapsed editor cursor when one is active, then falls back to the saved editor range;
- videos use the same `data-spectral-video-src` plus blob-url live playback path as recorded videos;
- audio files are inserted as portable `<audio controls src="data:...">` elements;
- recording error messages now point users to this fallback when access is denied or blocked.

On 2026-05-04 the visible `Audio Rec` and `Video Rec` toolbar buttons were removed and replaced with `+ Media`. Direct recording functions remain available through `JS Cmd` for experimentation, but file embedding is the intended visible workflow in VS Code.

Validation commands:

```powershell
npm run lint
npm test
```

Both pass after this change. The helper suite remains at 24 tests.

## 2026-05-04: Toolbar Decluttering

Removed lower-frequency controls from the visible toolbar while keeping their functions available through shortcuts or `JS Cmd`.

Removed visible controls:

- file chooser input;
- `Snap`, `Undo Snap`, `Redo Snap`;
- `Line #`;
- `Yank Lines`, `DD Lines`;
- `Insert @`, `Cursor @`, `Select @`;
- `Keep Lines`, `Delete Lines`;
- `Keep HL Lines`, `Delete HL Lines`;
- `Tidy Blanks`;
- `Tools`.

Changed `Ctrl+b` to toggle the entire toolbar container instead of leaving the first toolbar permanently visible.

Validation commands:

```powershell
npm run lint
npm test
```

Both pass after this change.

## 2026-05-04: N-Cursor Projection Hardening

Improved the VS Code port of the original n-cursor behavior.

Changes:

- selection-to-cursor placement now uses the same plain-text projection as save and index addressing, so explicit `<br>` line breaks count as newlines;
- selected line starts/ends are calculated from plain-text line boundaries rather than `editor.textContent`;
- Backspace/Delete/ArrowLeft/ArrowRight now operate through the same `<br>`-aware offset mapping;
- Backspace/Delete across an explicit `<br>` removes the line break instead of silently failing;
- multi-cursor insertion and HTML paste now remap through the same projection;
- cursor ranges after multi-edit are kept as live DOM ranges rather than stale offsets after earlier edits.

Added tested helper:

```text
selectedLineEdgeOffsets(plainText, startOffset, endOffset, edge)
```

This is still not a perfect visual-line clone of `spectralMultiCursor.html`, which uses rendered client rectangles for some cursor placement. The port is now stronger for source-like explicit lines and saved rich HTML line boundaries, and the remaining gap is visual wrapped-line behavior.

Validation commands:

```powershell
npm run lint
npm test
```

Both pass after this change. The helper suite now has 25 tests.

## 2026-05-04: Align With Cursors Fidelity

Tightened `Align /w Cursors` against the original `spectralMultiCursor.html` behavior.

Original behavior:

- toolbar `Align /w Cursors` deletes one following space/tab at each active cursor;
- context-menu `Align /w Cursors` deletes one preceding space/tab;
- if the adjacent character is not a space/tab, the cursor is kept unchanged.

Port fix:

- alignment now decides each edit from the current `<br>`-aware plain-text projection;
- cursor ranges are captured as live DOM ranges after each deletion, avoiding stale offsets after earlier edits shift text;
- only literal space and tab are alignment targets, so newlines and other characters are preserved;
- the tested core helper is:

```text
computeAlignWhitespaceEdit(plainText, offset, side)
```

Validation commands:

```powershell
npm run lint
npm test
```

Both pass after this change. The helper suite now has 26 tests.

## 2026-05-05: Search Results Panel

Made the existing `Results` checkbox active for regex search boxes.

Behavior:

- pressing Enter in a numbered regex search box still highlights matches as before;
- when `Results` is checked, a compact in-webview panel opens with one clickable row per match;
- each row shows a match number plus nearby text context;
- clicking a row selects and scrolls to the corresponding highlighted match in the editor;
- the panel is intentionally lightweight and does not affect normal paste or save semantics.

This ports the useful search-result listing behavior from `spectralMultiCursor.html` without bringing over the older per-color draggable popup stack.

## 2026-05-05: Stop Speech Control

Ported the practical half of the original `stopSpeaking()` behavior as a visible `Stop Speech` toolbar button next to `Speak Selection`.

Behavior:

- `Speak Selection` cancels any existing utterance before starting the selected text;
- `Stop Speech` calls `speechSynthesis.cancel()` and reports status;
- the control is visible rather than transient so speech output always has an obvious off switch.

## 2026-05-05: Toolbar Starts Hidden

Changed VS Code webviews so the full toolbar area starts hidden. `Ctrl+b` remains the way to show and hide it, with the first `Ctrl+b` after opening a Spectral Web editor revealing the toolbar.

## 2026-05-05: Reflow JS Command Compatibility

Added an original-compatible `reflow(maxColumn)` wrapper for `JS Cmd`, so commands such as `reflow(60)` now call the existing VS Code reflow implementation. Entering plain `reflow` opens the existing reflow popup.

## Future Work

1. Transfer more functions from `spectralMultiCursor.html` into `media/editor.js` in groups.
2. Replace marker-based HTML extraction with a more robust parser if dependencies become acceptable.
3. Add import tests using existing `editor-content-*.html` examples.
4. Decide whether exact `html2text.js` trimming should remain for source files or become configurable.
5. Add a compatibility matrix documenting which `spectralMultiCursor.html` functions are ported.
