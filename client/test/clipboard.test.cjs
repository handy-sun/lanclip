const assert = require('node:assert/strict');
const test = require('node:test');

const {copyText} = require('../src/clipboard.js');

const createDocument = ({copyResult = true} = {}) => {
    const activeElement = {
        focused: false,
        focus() {
            this.focused = true;
        },
    };
    const body = {
        child: null,
        appendChild(element) {
            this.child = element;
        },
        removeChild(element) {
            assert.equal(element, this.child);
            this.child = null;
        },
    };
    const textarea = {
        attributes: {},
        style: {},
        selected: false,
        setAttribute(name, value) {
            this.attributes[name] = value;
        },
        select() {
            this.selected = true;
        },
        setSelectionRange(start, end) {
            this.selectionRange = [start, end];
        },
    };
    const documentRef = {
        activeElement,
        body,
        createElement(tagName) {
            assert.equal(tagName, 'textarea');
            return textarea;
        },
        execCommand(command) {
            assert.equal(command, 'copy');
            return copyResult;
        },
    };

    return {activeElement, body, documentRef, textarea};
};

test('uses the asynchronous Clipboard API when it is available', async () => {
    const writes = [];
    const navigatorRef = {
        clipboard: {
            async writeText(text) {
                writes.push(text);
            },
        },
    };

    await copyText('hello', {navigatorRef});

    assert.deepEqual(writes, ['hello']);
});

test('falls back to execCommand on an insecure HTTP origin', async () => {
    const {activeElement, body, documentRef, textarea} = createDocument();
    const content = '来自 handy 的内容';

    await copyText(content, {navigatorRef: {}, documentRef});

    assert.equal(textarea.value, content);
    assert.equal(textarea.attributes.readonly, '');
    assert.equal(textarea.selected, true);
    assert.deepEqual(textarea.selectionRange, [0, content.length]);
    assert.equal(body.child, null);
    assert.equal(activeElement.focused, true);
});

test('falls back when the asynchronous Clipboard API rejects', async () => {
    const {documentRef, textarea} = createDocument();
    const navigatorRef = {
        clipboard: {
            async writeText() {
                throw new Error('NotAllowedError');
            },
        },
    };

    await copyText('fallback', {navigatorRef, documentRef});

    assert.equal(textarea.selected, true);
});

test('reports an error and cleans up when both copy methods fail', async () => {
    const {activeElement, body, documentRef} = createDocument({copyResult: false});

    await assert.rejects(
        copyText('cannot copy', {navigatorRef: {}, documentRef}),
        /浏览器拒绝访问剪贴板/,
    );
    assert.equal(body.child, null);
    assert.equal(activeElement.focused, true);
});
