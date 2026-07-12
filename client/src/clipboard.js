const fallbackCopyText = (text, documentRef) => {
    if (!documentRef || !documentRef.body || typeof documentRef.execCommand !== 'function') {
        throw new Error('Clipboard fallback is unavailable');
    }

    const activeElement = documentRef.activeElement;
    const selection = typeof documentRef.getSelection === 'function'
        ? documentRef.getSelection()
        : null;
    const ranges = [];
    if (selection) {
        for (let index = 0; index < selection.rangeCount; index += 1) {
            ranges.push(selection.getRangeAt(index).cloneRange());
        }
    }

    const textarea = documentRef.createElement('textarea');
    textarea.value = String(text);
    textarea.setAttribute('readonly', '');
    textarea.setAttribute('aria-hidden', 'true');
    Object.assign(textarea.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        opacity: '0',
        pointerEvents: 'none',
    });

    documentRef.body.appendChild(textarea);
    try {
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        if (!documentRef.execCommand('copy')) {
            throw new Error('Copy command was rejected');
        }
    } finally {
        documentRef.body.removeChild(textarea);
        if (activeElement && typeof activeElement.focus === 'function') {
            activeElement.focus();
        }
        if (selection) {
            selection.removeAllRanges();
            ranges.forEach(range => selection.addRange(range));
        }
    }
};

const copyText = async (text, dependencies = {}) => {
    const navigatorRef = dependencies.navigatorRef
        || (typeof navigator === 'undefined' ? undefined : navigator);
    const documentRef = dependencies.documentRef
        || (typeof document === 'undefined' ? undefined : document);

    if (navigatorRef
        && navigatorRef.clipboard
        && typeof navigatorRef.clipboard.writeText === 'function') {
        try {
            await navigatorRef.clipboard.writeText(String(text));
            return;
        } catch (_) {
            // Some Chromium variants reject Clipboard API access even after a user click.
        }
    }

    try {
        fallbackCopyText(text, documentRef);
    } catch (_) {
        throw new Error('浏览器拒绝访问剪贴板，请改用 HTTPS 或手动复制');
    }
};

module.exports = {copyText};
