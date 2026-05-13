module.exports = {
    outputDir: 'dist',
    publicPath: '',
    integrity: true,
    transpileDependencies: [
        'vuetify',
    ],
    devServer: {
        port: 1210,
        proxy: {
            '/*': {
                target: 'http://localhost:9501/',
                changeOrigin: true,
            },
        },
    },
    productionSourceMap: false,
}
