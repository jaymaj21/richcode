const assert = require('node:assert/strict');
const {
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
    markdownToHtml
} = require('../lib/spectralwebCore');

const tests = [];

function test(name, fn) {
    tests.push({ name, fn });
}

function text(value) {
    return { nodeType: TEXT_NODE, textContent: value };
}

function el(tagName, children = []) {
    return { nodeType: ELEMENT_NODE, tagName, childNodes: children };
}

test('textToSpectralHtml escapes source text and preserves newlines as br tags', () => {
    assert.equal(
        textToSpectralHtml('if (a < b && c > d) {\n    return "x";\n}'),
        'if (a &lt; b &amp;&amp; c &gt; d) {<br/>    return &quot;x&quot;;<br/>}'
    );
});

test('extractEditorInnerHtml reads the saved Spectral editor div', () => {
    const html = '<html><body><style></style><div id="editor" class="editor">\nabc<br/>def\n</div><script id="spectralweb-metadata"></script></body></html>';
    assert.equal(extractEditorInnerHtml(html), 'abc<br/>def');
});

test('extractTextWithLineBreaks follows html2text block and br rules', () => {
    const root = el('DIV', [
        text('alpha'),
        el('BR'),
        text('beta'),
        el('DIV', [text('gamma')]),
        el('TABLE', [
            el('TR', [
                el('TD', [text('c1')]),
                el('TD', [text('c2')])
            ])
        ])
    ]);

    assert.equal(extractTextWithLineBreaks(root), 'alpha\nbetagamma\nc1\tc2\n');
});

test('cleanInvisibleChars mirrors html2text cleanup policy', () => {
    assert.equal(cleanInvisibleChars('\uFEFF a\u00A0 \n\n\n b \r\n'), 'a\n\n b');
});

test('filterHtmlLinesByCursorMarkers keeps marked rich html lines and removes markers', () => {
    const html = [
        '<strong>alpha</strong>',
        '<em>beta<span class="cursor-marker"></span></em>',
        '<span style="background: yellow">gamma</span><span class="cursor-marker" contenteditable="false"></span>'
    ].join('<br>');

    assert.deepEqual(filterHtmlLinesByCursorMarkers(html, true), {
        html: '<em>beta</em><br><span style="background: yellow">gamma</span>',
        cursorLineCount: 2,
        lineCount: 2
    });
});

test('filterHtmlLinesByCursorMarkers deletes marked rich html lines and preserves unmarked markup', () => {
    const html = '<strong>alpha</strong><br><em>beta<span class="cursor-marker"></span></em><br><code>gamma</code>';

    assert.deepEqual(filterHtmlLinesByCursorMarkers(html, false), {
        html: '<strong>alpha</strong><br><code>gamma</code>',
        cursorLineCount: 1,
        lineCount: 2
    });
});

test('filterHtmlLinesByHighlights keeps lines with highlight classes or background styles', () => {
    const html = [
        '<strong>alpha</strong>',
        '<span class="highlight3">beta</span>',
        '<span style="background-color: rgb(255, 255, 0);">gamma</span>'
    ].join('<br>');

    assert.deepEqual(filterHtmlLinesByHighlights(html, true), {
        html: '<span class="highlight3">beta</span><br><span style="background-color: rgb(255, 255, 0);">gamma</span>',
        highlightedLineCount: 2,
        lineCount: 2
    });
});

test('filterHtmlLinesByHighlights deletes highlighted lines', () => {
    const html = '<strong>alpha</strong><br><span class="highlight">beta</span><br><code>gamma</code>';

    assert.deepEqual(filterHtmlLinesByHighlights(html, false), {
        html: '<strong>alpha</strong><br><code>gamma</code>',
        highlightedLineCount: 1,
        lineCount: 2
    });
});

test('indentTextLines indents and unindents selected text like Spectral Tab handling', () => {
    assert.equal(indentTextLines('alpha\n  beta\n\tgamma', true), '    alpha\n      beta\n    \tgamma');
    assert.equal(indentTextLines('    alpha\n  beta\n\tgamma\nplain', false), 'alpha\nbeta\ngamma\nplain');
});

test('transformTextCase mirrors Spectral selection case helpers', () => {
    assert.equal(transformTextCase('Alpha beta', 'upper'), 'ALPHA BETA');
    assert.equal(transformTextCase('Alpha BETA', 'lower'), 'alpha beta');
    assert.equal(transformTextCase('alpha BETA', 'title'), 'Alpha Beta');
    assert.equal(transformTextCase('alpha beta_gamma-delta', 'camel'), 'alphaBetaGammaDelta');
    assert.equal(transformTextCase('alphaBeta gamma-delta', 'snake'), 'alpha_beta_gamma_delta');
    assert.equal(transformTextCase('alphaBeta gamma_delta', 'kebab'), 'alpha-beta-gamma-delta');
});

test('incrementIntegersInMatches bumps integers in regex matches and preserves padding', () => {
    assert.equal(incrementIntegersInMatches('item09 item-2 x', /item-?\d+/g, 1), 'item10 item-1 x');
    assert.equal(incrementIntegersInMatches('v007 v099 plain5', 'v\\d+', 2), 'v009 v101 plain5');
    assert.equal(incrementIntegersInMatches('n0 n-1', /n-?\d+/, -1), 'n-1 n-2');
});

test('computeSmartReturnInsertion mirrors Spectral smart Enter indentation', () => {
    assert.deepEqual(computeSmartReturnInsertion('if (ready) {', ''), {
        text: '\n    ',
        caretOffset: 5
    });
    assert.deepEqual(computeSmartReturnInsertion('    if (ready) {', '}'), {
        text: '\n        \n    ',
        caretOffset: 9
    });
    assert.deepEqual(computeSmartReturnInsertion('    value = call(', ''), {
        text: '\n        ',
        caretOffset: 9
    });
    assert.deepEqual(computeSmartReturnInsertion('    value = 1', ''), {
        text: '\n    ',
        caretOffset: 5
    });
});

test('dedentClosingBraceLine removes up to one Spectral indentation level', () => {
    assert.equal(dedentClosingBraceLine('        '), '    ');
    assert.equal(dedentClosingBraceLine('  '), '');
    assert.equal(dedentClosingBraceLine('\t'), '\t');
    assert.equal(dedentClosingBraceLine(''), '');
});

test('reflowText collapses selected newlines and wraps like Spectral reflow', () => {
    assert.equal(
        reflowText('alpha beta\ngamma delta epsilon', 10),
        'alpha beta gamma\ndelta epsilon'
    );
    assert.equal(reflowText('alpha\n    beta', 80), 'alpha beta');
    assert.equal(reflowText('alpha beta', 0), 'alpha beta');
});

test('reverseHtmlLines reverses all explicit rich html lines when no selection markers exist', () => {
    assert.deepEqual(reverseHtmlLines('<b>one</b><br><i>two</i><br>three'), {
        html: 'three<br><i>two</i><br><b>one</b>',
        reversedLineCount: 3,
        selectedOnly: false
    });
});

test('reverseHtmlLines reverses only selected marker-bounded lines', () => {
    const html = [
        'one',
        '<span id="selection-start"></span><b>two</b>',
        '<i>three</i>',
        'four<span id="selection-end"></span>',
        'five'
    ].join('<br>');

    assert.deepEqual(reverseHtmlLines(html), {
        html: 'one<br>four<br><i>three</i><br><b>two</b><br>five',
        reversedLineCount: 3,
        selectedOnly: true
    });
});

test('enumerateCursorLabels returns right-to-left insertion labels for left-to-right numbering', () => {
    assert.deepEqual(enumerateCursorLabels(4), ['#4 ', '#3 ', '#2 ', '#1 ']);
    assert.deepEqual(enumerateCursorLabels(3, 10), ['#12 ', '#11 ', '#10 ']);
    assert.deepEqual(enumerateCursorLabels(0), []);
});

test('cleanInstrumentationHtml removes mprewriter probes and preserves line breaks', () => {
    assert.deepEqual(cleanInstrumentationHtml('alpha<br>mprewriter.scope_START(42);<br>beta'), {
        html: 'alpha<br><br>beta',
        removed: 1
    });
    assert.deepEqual(cleanInstrumentationHtml('mprewriter <b>.</b> scope_START(7); gamma'), {
        html: 'gamma',
        removed: 1
    });
});

test('indexToTextOffset maps line.character and end indexes onto plain text offsets', () => {
    const text = 'alpha\nbeta\ngamma';
    assert.equal(indexToTextOffset(text, '1.0'), 0);
    assert.equal(indexToTextOffset(text, '1.2'), 2);
    assert.equal(indexToTextOffset(text, '2.0'), 6);
    assert.equal(indexToTextOffset(text, '2.end'), 10);
    assert.equal(indexToTextOffset(text, 'end'), 16);
    assert.equal(indexToTextOffset(text, '9.0'), -1);
});

test('tidyBlankLinesHtml collapses excessive explicit blank lines', () => {
    assert.equal(tidyBlankLinesHtml('a<br><br><br>b'), 'a<br><br>b');
    assert.equal(tidyBlankLinesHtml('a\n\n\n\nb'), 'a<br><br>b');
});

test('computeLineBlockRange selects current and following plain-text lines', () => {
    assert.deepEqual(computeLineBlockRange('aa\nbb\ncc', 4, 1), {
        start: 3,
        end: 6,
        text: 'bb\n',
        lineCount: 1
    });
    assert.deepEqual(computeLineBlockRange('aa\nbb\ncc', 4, 2), {
        start: 3,
        end: 8,
        text: 'bb\ncc',
        lineCount: 2
    });
});

test('selectedLineEdgeOffsets maps selection to line starts and ends', () => {
    const text = 'alpha\n  beta\ncharlie';
    assert.deepEqual(selectedLineEdgeOffsets(text, 2, 13, 'start'), [0, 6, 13]);
    assert.deepEqual(selectedLineEdgeOffsets(text, 2, 13, 'end'), [5, 12, 20]);
});

test('computeAlignWhitespaceEdit mirrors cursor alignment whitespace rules', () => {
    assert.deepEqual(computeAlignWhitespaceEdit('ab cd', 2, 'right'), {
        changed: true,
        cursorOffset: 2,
        deleteStart: 2,
        deleteEnd: 3
    });
    assert.deepEqual(computeAlignWhitespaceEdit('ab\tcd', 3, 'left'), {
        changed: true,
        cursorOffset: 2,
        deleteStart: 2,
        deleteEnd: 3
    });
    assert.deepEqual(computeAlignWhitespaceEdit('ab\ncd', 2, 'right'), {
        changed: false,
        cursorOffset: 2,
        deleteStart: -1,
        deleteEnd: -1
    });
    assert.deepEqual(computeAlignWhitespaceEdit('ab cd', 1, 'left'), {
        changed: false,
        cursorOffset: 1,
        deleteStart: -1,
        deleteEnd: -1
    });
});

test('markdown export helpers escape text and choose inline code fences', () => {
    assert.equal(escapeMarkdownText('a_b [x](y) #1 | > done!'), 'a\\_b \\[x\\]\\(y\\) \\#1 \\| \\> done\\!');
    assert.equal(wrapInlineCode('plain'), '`plain`');
    assert.equal(wrapInlineCode('uses ` ticks'), '``uses ` ticks``');
});

test('video data-url helpers keep saved media portable', () => {
    assert.equal(getDataUrlSafeVideoMimeType('video/webm;codecs=vp8,opus'), 'video/webm');
    assert.equal(getDataUrlSafeVideoMimeType(''), 'video/webm');
    assert.equal(normalizeVideoDataUrl('data:video/webm;base64,AAAA'), 'data:video/webm;base64,AAAA');
    assert.equal(normalizeVideoDataUrl('blob:vscode-webview://x'), 'blob:vscode-webview://x');
});

test('markdownToHtml renders common Spectral markdown structures', () => {
    const markdown = [
        '# Title',
        '',
        'Some **bold** and `code`.',
        '',
        '- one',
        '- two',
        '',
        '```js',
        'const x = 1 < 2;',
        '```'
    ].join('\n');

    assert.equal(markdownToHtml(markdown), [
        '<h1>Title</h1>',
        '<p>Some <strong>bold</strong> and <code>code</code>.</p>',
        '<ul>',
        '<li>one</li>',
        '<li>two</li>',
        '</ul>',
        '<pre><code class="language-js">const x = 1 &lt; 2;</code></pre>'
    ].join('\n'));
});

let failures = 0;
tests.forEach(({ name, fn }) => {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        failures += 1;
        console.error(`not ok - ${name}`);
        console.error(error);
    }
});

if (failures > 0) {
    process.exitCode = 1;
} else {
    console.log(`${tests.length} tests passed`);
}
