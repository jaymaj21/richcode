# Spectral Web Rich Editor for VS Code

This is the HTML-native alternative to `Spectral_vscode`.

The important design choice is that the rich layer is not a JSON-HLT model. It is the Spectral HTML representation itself:

```html
<div id="editor" class="editor" contenteditable="true">
  ...
</div>
```

For a source file named:

```text
Myclass.java
```

the extension saves:

```text
Myclass.java
Myclass.java.html
```

`Myclass.java.html` contains a Spectral-style `#editor` div, inline style/script support, the text popup, and metadata. Loading reuses `#editor.innerHTML` directly.

## Current Scope

- Opens a source file in a VS Code custom editor.
- Converts initial plain text to Spectral-style escaped HTML with `<br/>` line breaks.
- Treats `#editor.innerHTML` as the canonical rich layer.
- Converts `#editor` HTML back to plain text using the same recursive rules as `html2text.js`.
- Supports bold, italic, underline, clear formatting, seven Spectral highlighter colors, notes, attachments, and double-click word highlighting.
- Saves the source file and sibling `.html` layer together on `Ctrl+S`.

This is intentionally a separate project from `Spectral_vscode`. That project explores a structured JSON-HLT model. This project explores the faster path: keep compatibility with `spectralMultiCursor.html` so functions from that file can be moved over incrementally.

## Start Here

Future Codex sessions should read these files first:

1. `DEVELOPMENT_LOG.md`
2. `DESIGN.md`
3. `TESTING.md`

Then inspect:

1. `extension.js`
2. `media/editor.js`
3. `media/editor.css`

