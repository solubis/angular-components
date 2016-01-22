
var path = require('path');
var webpack = require('webpack')

module.exports = {
    entry: {
        demo: ['./demo/index.ts', 'webpack-dev-server/client?http://localhost:3000'],
        components: ['./src/index.ts']
    },
    output: {
        path: path.join(__dirname, 'dist'),
        publicPath: '/',
        filename: '[name].js',
        libraryTarget: 'umd',
        library: '[name]'
    },
    cache: true,
    debug: false,
    devtool: 'source-map',
    resolve: {
        extensions: ['', '.ts', '.js']
    },
    module: {
        loaders: [
            { test: /\.tsx?$/, loader: 'ts' }
        ]
    },
    devServer: {
        contentBase: './demo'
    }
};