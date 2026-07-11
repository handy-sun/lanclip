const AUTH_REMEMBER_OPTIONS = Object.freeze([
    {text: '1 天', value: 1},
    {text: '3 天', value: 3},
    {text: '7 天', value: 7},
    {text: '30 天', value: 30},
]);

const createLoginPayload = (password, remember, rememberDays) => ({
    password,
    rememberDays: remember ? rememberDays : null,
});

module.exports = {
    AUTH_REMEMBER_OPTIONS,
    createLoginPayload,
};
