import crypto from 'node:crypto';

export const AUTH_REMEMBER_DAYS = Object.freeze([1, 3, 7, 30]);

const AUTH_COOKIE_NAME = 'lanclip_auth';
const FAILURE_LIMIT = 10;
const FAILURE_WINDOW = 15 * 60 * 1000;

export const createAuthService = (serverConfig, {now = Date.now} = {}) => {
    const failures = new Map;
    const cookiePath = `${serverConfig.prefix || ''}/`;

    const isAllowedRememberDays = days => days === null || AUTH_REMEMBER_DAYS.includes(days);

    const matchesCredential = credential => {
        if (!serverConfig.auth || typeof credential !== 'string') {
            return false;
        }
        const expected = Buffer.from(serverConfig.auth);
        const supplied = Buffer.from(credential);
        return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
    };

    const isRequestAuthenticated = (ctx, {allowQuery = false} = {}) => {
        if (!serverConfig.auth) {
            return true;
        }
        const authorization = ctx.header.authorization || '';
        const bearer = authorization.startsWith('Bearer ') ? authorization.substring(7) : null;
        const cookie = ctx.cookies.get(AUTH_COOKIE_NAME, {signed: false});
        const query = allowQuery ? ctx.query.auth : null;
        return matchesCredential(bearer) || matchesCredential(cookie) || matchesCredential(query);
    };

    const cookieOptions = ctx => ({
        signed: false,
        httpOnly: true,
        sameSite: 'strict',
        overwrite: true,
        path: cookiePath,
        secure: ctx.secure,
    });

    const setCookie = (ctx, rememberDays) => {
        const options = cookieOptions(ctx);
        if (rememberDays !== null) {
            options.maxAge = rememberDays * 24 * 60 * 60 * 1000;
        }
        ctx.cookies.set(AUTH_COOKIE_NAME, serverConfig.auth, options);
    };

    const clearCookie = ctx => ctx.cookies.set(AUTH_COOKIE_NAME, null, {
        ...cookieOptions(ctx),
        maxAge: 0,
    });

    const activeFailures = client => {
        const cutoff = now() - FAILURE_WINDOW;
        const active = (failures.get(client) || []).filter(timestamp => timestamp > cutoff);
        if (active.length) {
            failures.set(client, active);
        } else {
            failures.delete(client);
        }
        return active;
    };

    const getRetryAfter = client => {
        const active = activeFailures(client);
        if (active.length < FAILURE_LIMIT) {
            return 0;
        }
        return Math.max(1, Math.ceil((active[0] + FAILURE_WINDOW - now()) / 1000));
    };

    const recordFailure = client => {
        const active = activeFailures(client);
        active.push(now());
        failures.set(client, active);
    };

    const clearFailures = client => failures.delete(client);

    return {
        isAllowedRememberDays,
        matchesCredential,
        isRequestAuthenticated,
        setCookie,
        clearCookie,
        getRetryAfter,
        recordFailure,
        clearFailures,
    };
};
