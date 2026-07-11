const assert = require('node:assert/strict');
const test = require('node:test');

const {
    AUTH_REMEMBER_OPTIONS,
    createLoginPayload,
} = require('../src/auth.js');

test('offers the approved fixed remembered lifetimes', () => {
    assert.deepEqual(AUTH_REMEMBER_OPTIONS, [
        {text: '1 天', value: 1},
        {text: '3 天', value: 3},
        {text: '7 天', value: 7},
        {text: '30 天', value: 30},
    ]);
});

test('creates a browser-session login payload by default', () => {
    assert.deepEqual(createLoginPayload('secret', false, 7), {
        password: 'secret',
        rememberDays: null,
    });
});

test('includes the selected fixed lifetime when remembering', () => {
    assert.deepEqual(createLoginPayload('secret', true, 30), {
        password: 'secret',
        rememberDays: 30,
    });
});
