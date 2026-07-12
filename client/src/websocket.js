const {
    AUTH_REMEMBER_OPTIONS,
    createLoginPayload,
} = require('./auth');

export default {
    data() {
        return {
            websocket: null,
            websocketConnecting: false,
            authCode: '',
            authCodeDialog: false,
            authRemember: false,
            authRememberDays: 7,
            authRememberOptions: AUTH_REMEMBER_OPTIONS,
            authSubmitting: false,
            serverRequiresAuth: false,
            room: this.$router.currentRoute.query.room || '',
            roomInput: '',
            roomDialog: false,
            retry: 0,
            event: {
                receive: data => {
                    this.$root.received.unshift(data);
                },
                receiveMulti: data => {
                    this.$root.received.unshift(...Array.from(data).reverse());
                },
                revoke: data => {
                    let index = this.$root.received.findIndex(e => e.id === data.id);
                    if (index === -1) return;
                    this.$root.received.splice(index, 1);
                },
                config: data => {
                    this.$root.config = data;
                    console.log(
                        `%c LanClip ${data.version} %c https://github.com/handy-sun/lanclip `,
                        'color:#fff;background-color:#1e88e5',
                        'color:#fff;background-color:#64b5f6'
                    );
                },
                connect: data => {
                    this.$root.device.push(data);
                },
                disconnect: data => {
                    let index = this.$root.device.findIndex(e => e.id === data.id);
                    if (index === -1) return;
                    this.$root.device.splice(index, 1);
                },
                forbidden: () => {
                    this.handleForbidden();
                },
            },
        };
    },
    watch: {
        room() {
            this.disconnect();
            this.connect();
        },
    },
    methods: {
        async connect() {
            if (this.websocketConnecting) return;
            this.websocketConnecting = true;
            try {
                const response = await this.$http.get('server');
                this.serverRequiresAuth = response.data.auth;
                if (response.data.auth && !response.data.authenticated) {
                    this.authCodeDialog = true;
                    this.websocketConnecting = false;
                    return;
                }

                this.$toast(this.retry ? `未能连接到服务器，正在尝试第 ${this.retry} 次重连……` : '正在连接服务器……', {
                    showClose: false,
                    dismissable: false,
                    timeout: -1,
                });
                const wsUrl = new URL(response.data.server);
                wsUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
                wsUrl.port = location.port;
                wsUrl.searchParams.set('room', this.room);
                const ws = await new Promise((resolve, reject) => {
                    const websocket = new WebSocket(wsUrl);
                    websocket.onopen = () => resolve(websocket);
                    websocket.onerror = reject;
                });
                this.websocketConnecting = false;
                this.retry = 0;
                this.received = [];
                this.$toast('连接服务器成功');
                ws.interval = setInterval(() => {ws.send('')}, 30000);
                ws.onclose = () => {
                    clearInterval(ws.interval)
                    this.failure()
                };
                ws.onmessage = e => {
                    try {
                        let parsed = JSON.parse(e.data);
                        (this.event[parsed.event] || (() => {}))(parsed.data);
                    } catch {}
                };
                this.websocket = ws;
            } catch {
                this.websocketConnecting = false;
                this.failure();
            }
        },
        async login() {
            if (!this.authCode || this.authSubmitting) return;
            this.authSubmitting = true;
            try {
                await this.$http.post('auth', createLoginPayload(
                    this.authCode,
                    this.authRemember,
                    this.authRememberDays,
                ));
                this.authCode = '';
                this.authCodeDialog = false;
                this.retry = 0;
                await this.connect();
            } catch (error) {
                const status = error.response && error.response.status;
                if (status === 403) {
                    this.$toast.error('密码错误');
                } else if (status === 429) {
                    this.$toast.error('认证尝试次数过多，请稍后重试');
                } else if (error.response && error.response.data.msg) {
                    this.$toast.error(`认证失败：${error.response.data.msg}`);
                } else {
                    this.$toast.error('认证失败');
                }
            } finally {
                this.authSubmitting = false;
            }
        },
        async logout() {
            try {
                await this.$http.delete('auth');
                this.disconnect();
                this.authCode = '';
                this.authRemember = false;
                this.authRememberDays = 7;
                this.authCodeDialog = true;
                this.$toast('已退出认证');
            } catch {
                this.$toast.error('退出认证失败');
            }
        },
        async handleForbidden() {
            try {
                await this.$http.delete('auth');
            } catch {}
            this.disconnect();
            this.authCode = '';
            this.authCodeDialog = true;
        },
        disconnect() {
            this.websocketConnecting = false;
            if (this.websocket) {
                this.websocket.onclose = () => {};
                this.websocket.close();
                this.websocket = null;
            }
            this.$root.device = [];
        },
        failure() {
            this.websocket = null;
            this.$root.device = [];
            if (this.retry++ < 3) {
                this.connect();
            } else {
                this.$toast.error('连接服务器失败，请点击工具栏上的“连接”图标重试', {
                    showClose: false,
                    dismissable: false,
                    timeout: -1,
                });
            }
        },
    },
    mounted() {
        this.connect();
    },
}
