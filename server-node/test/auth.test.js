import assert from 'node:assert/strict';
import test from 'node:test';

import {
    AUTH_REMEMBER_DAYS,
    createAuthService,
} from '../app/auth.js';

const createContext = ({
    secure = false,
    header = {},
    query = {},
    cookie = null,
} = {}) => {
    const cookieValues = new Map;
    const cookieWrites = [];
    if (cookie !== null) {
        cookieValues.set('lanclip_auth', cookie);
    }

    return {
        secure,
        header,
        query,
        cookieWrites,
        cookies: {
            get(name) {
                return cookieValues.get(name);
            },
            set(name, value, options) {
                cookieWrites.push({name, value, options});
                if (value === null) {
                    cookieValues.delete(name);
                } else {
                    cookieValues.set(name, value);
                }
            },
        },
    };
};

test('accepts only supported remembered lifetimes', () => {
    const service = createAuthService({auth: 'secret', prefix: ''});

    assert.deepEqual(AUTH_REMEMBER_DAYS, [1, 3, 7, 30]);
    assert.equal(service.isAllowedRememberDays(null), true);
    AUTH_REMEMBER_DAYS.forEach(days => assert.equal(service.isAllowedRememberDays(days), true));
    assert.equal(service.isAllowedRememberDays(undefined), false);
    assert.equal(service.isAllowedRememberDays(2), false);
    assert.equal(service.isAllowedRememberDays('7'), false);
});

test('compares credentials without accepting different values', () => {
    const service = createAuthService({auth: 'secret', prefix: ''});

    assert.equal(service.matchesCredential('secret'), true);
    assert.equal(service.matchesCredential('wrong'), false);
    assert.equal(service.matchesCredential('secre'), false);
    assert.equal(service.matchesCredential(null), false);
});

test('accepts either a cookie or Bearer credential for HTTP requests', () => {
    const service = createAuthService({auth: 'secret', prefix: ''});

    assert.equal(service.isRequestAuthenticated(createContext({cookie: 'secret'})), true);
    assert.equal(service.isRequestAuthenticated(createContext({header: {authorization: 'Bearer secret'}})), true);
    assert.equal(service.isRequestAuthenticated(createContext({cookie: 'wrong'})), false);
    assert.equal(service.isRequestAuthenticated(createContext({header: {authorization: 'Bearer wrong'}})), false);
    assert.equal(createAuthService({auth: false, prefix: ''}).isRequestAuthenticated(createContext()), true);
});

test('accepts legacy query credentials only for explicit WebSocket checks', () => {
    const service = createAuthService({auth: 'secret', prefix: ''});
    const validQuery = createContext({query: {auth: 'secret'}});
    const invalidQuery = createContext({query: {auth: 'wrong'}});

    assert.equal(service.isRequestAuthenticated(validQuery), false);
    assert.equal(service.isRequestAuthenticated(validQuery, {allowQuery: true}), true);
    assert.equal(service.isRequestAuthenticated(invalidQuery, {allowQuery: true}), false);
    assert.equal(service.isRequestAuthenticated(createContext({cookie: 'secret'}), {allowQuery: true}), true);
});

test('sets a session cookie with scoped security attributes', () => {
    const service = createAuthService({auth: 'secret', prefix: '/lanclip'});
    const ctx = createContext();

    service.setCookie(ctx, null);

    assert.deepEqual(ctx.cookieWrites, [{
        name: 'lanclip_auth',
        value: 'secret',
        options: {
            signed: false,
            httpOnly: true,
            sameSite: 'strict',
            overwrite: true,
            path: '/lanclip/',
            secure: false,
        },
    }]);
});

test('sets an HTTPS remembered cookie with a fixed lifetime', () => {
    const service = createAuthService({auth: 'secret', prefix: ''});
    const ctx = createContext({secure: true});

    service.setCookie(ctx, 7);

    assert.deepEqual(ctx.cookieWrites[0], {
        name: 'lanclip_auth',
        value: 'secret',
        options: {
            signed: false,
            httpOnly: true,
            sameSite: 'strict',
            overwrite: true,
            path: '/',
            secure: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
        },
    });
});

test('clears the cookie with matching scope and security attributes', () => {
    const service = createAuthService({auth: 'secret', prefix: '/lanclip'});
    const ctx = createContext({secure: true, cookie: 'secret'});

    service.clearCookie(ctx);

    assert.deepEqual(ctx.cookieWrites[0], {
        name: 'lanclip_auth',
        value: null,
        options: {
            signed: false,
            httpOnly: true,
            sameSite: 'strict',
            overwrite: true,
            path: '/lanclip/',
            secure: true,
            maxAge: 0,
        },
    });
});

test('rate limits the eleventh failed attempt for fifteen minutes', () => {
    let now = 1_000_000;
    const service = createAuthService({auth: 'secret', prefix: ''}, {now: () => now});

    for (let i = 0; i < 10; i++) {
        assert.equal(service.getRetryAfter('client'), 0);
        service.recordFailure('client');
    }

    assert.equal(service.getRetryAfter('client'), 15 * 60);
    assert.equal(service.getRetryAfter('other-client'), 0);

    now += 15 * 60 * 1000 + 1;
    assert.equal(service.getRetryAfter('client'), 0);
});

test('clears recorded login failures after successful authentication', () => {
    const service = createAuthService({auth: 'secret', prefix: ''});

    for (let i = 0; i < 10; i++) {
        service.recordFailure('client');
    }
    service.clearFailures('client');

    assert.equal(service.getRetryAfter('client'), 0);
});
