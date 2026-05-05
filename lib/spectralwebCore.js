const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function textToSpectralHtml(text) {
    return escapeHtml(text)
        .replace(/\r\n/g, '<br/>')
        .replace(/\n/g, '<br/>');
}

function extractEditorInnerHtml(html) {
    const match = String(html || '').match(/<div\b[^>]*id=["']editor["'][^>]*>([\s\S]*)<\/div>\s*(?:<script\b|<\/body>|<\/html>|$)/i);
    if (!match) {
        return null;
    }
    return match[1].trim();
}

function extractTextWithLineBreaks(node) {
    let text = '';
    const childNodes = Array.from(node && node.childNodes ? node.childNodes : []);

    childNodes.forEach(child => {
        if (child.nodeType === TEXT_NODE) {
            text += child.textContent || '';
        } else if (child.nodeType === ELEMENT_NODE) {
            const tag = String(child.tagName || '').toUpperCase();

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
    return String(text || '').replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
        .replace(/\r\n|\r/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function filterHtmlLinesByCursorMarkers(html, keep) {
    return filterHtmlLinesByPredicate(html, keep, line => containsCursorMarker(line), line => removeCursorMarkers(line), 'cursorLineCount');
}

function filterHtmlLinesByHighlights(html, keep) {
    return filterHtmlLinesByPredicate(html, keep, line => containsHighlight(line), line => line, 'highlightedLineCount');
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

function dedentClosingBraceLine(lineBeforeCaret) {
    return String(lineBeforeCaret || '').replace(/^ {1,4}/, '');
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

function reverseHtmlLines(html, startMarkerId = 'selection-start', endMarkerId = 'selection-end') {
    const lines = splitHtmlLines(html);
    const startPattern = markerByIdPattern(startMarkerId);
    const endPattern = markerByIdPattern(endMarkerId);
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
            .replace(markerByIdPattern(startMarkerId), '')
            .replace(markerByIdPattern(endMarkerId), '');
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

function enumerateCursorLabels(cursorCount, countStart = 1) {
    const count = Math.max(0, Number.parseInt(cursorCount, 10) || 0);
    const start = Number.parseInt(countStart, 10) || 1;
    let counter = count + start - 1;
    return Array.from({ length: count }, () => `#${counter--} `);
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

function escapeMarkdownText(text) {
    return String(text || '').replace(/([\\`*_{}\[\]()#+\-.!|>])/g, '\\$1');
}

function wrapInlineCode(text) {
    const value = String(text || '');
    const longestRun = (value.match(/`+/g) || ['']).reduce((longest, run) => Math.max(longest, run.length), 0);
    const fence = '`'.repeat(longestRun + 1);
    return `${fence}${value}${fence}`;
}

function getDataUrlSafeVideoMimeType(mimeType) {
    const containerType = String(mimeType || 'video/webm').split(';')[0].trim();
    return containerType || 'video/webm';
}

function normalizeVideoDataUrl(dataURL) {
    if (typeof dataURL !== 'string' || !dataURL.startsWith('data:video/')) {
        return dataURL || '';
    }
    return dataURL;
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

function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function filterHtmlLinesByPredicate(html, keep, predicate, cleanLine, countKey) {
    const lines = splitHtmlLines(html);
    const matchedLines = new Set();
    const cleanedLines = lines.map((line, index) => {
        if (predicate(line)) {
            matchedLines.add(index);
        }
        return cleanLine(line);
    });
    const filtered = cleanedLines.filter((_, index) => keep ? matchedLines.has(index) : !matchedLines.has(index));

    return {
        html: filtered.join('<br>'),
        [countKey]: matchedLines.size,
        lineCount: filtered.length
    };
}

function splitHtmlLines(html) {
    return String(html || '').split(/<br\s*\/?>|\n/i);
}

function containsCursorMarker(html) {
    return cursorMarkerPattern().test(String(html || ''));
}

function containsHighlight(html) {
    const value = String(html || '');
    return /<span\b[^>]*class=["'][^"']*\bhighlight\d*\b[^"']*["'][^>]*>/i.test(value) ||
        /<span\b[^>]*style=["'][^"']*background(?:-color)?\s*:/i.test(value) ||
        /<tspan\b[^>]*data-spectral-svg-hl\b/i.test(value);
}

function removeCursorMarkers(html) {
    return String(html || '').replace(cursorMarkerPattern(), '');
}

function cursorMarkerPattern() {
    return /<span\b[^>]*class=["'][^"']*\bcursor-marker\b[^"']*["'][^>]*><\/span>/gi;
}

function markerByIdPattern(id) {
    const escaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`<span\\b[^>]*id=["']${escaped}["'][^>]*><\\/span>`, 'gi');
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

module.exports = {
    TEXT_NODE,
    ELEMENT_NODE,
    textToSpectralHtml,
    extractEditorInnerHtml,
    extractTextWithLineBreaks,
    cleanInvisibleChars,
    filterHtmlLinesByCursorMarkers,
    filterHtmlLinesByHighlights,
    indentTextLines,
    transformTextCase,
    incrementIntegersInMatches,
    computeSmartReturnInsertion,
    dedentClosingBraceLine,
    reflowText,
    reverseHtmlLines,
    enumerateCursorLabels,
    cleanInstrumentationHtml,
    indexToTextOffset,
    tidyBlankLinesHtml,
    computeLineBlockRange,
    selectedLineEdgeOffsets,
    computeAlignWhitespaceEdit,
    escapeMarkdownText,
    wrapInlineCode,
    getDataUrlSafeVideoMimeType,
    normalizeVideoDataUrl,
    markdownToHtml,
    escapeHtml
};
