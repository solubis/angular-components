System.config({
    defaultJSExtensions: true,
    transpiler: 'typescript',
    typescriptOptions: {
        "module": "commonjs",
        "noImplicitAny": false,
        "removeComments": false,
        "preserveConstEnums": false,
        "sourceMap": true,
        "emitDecoratorMetadata": true,
        "experimentalDecorators": true
    },
    map: {
        'angular': 'node_modules/angular/index.js',
        'angular-ui-router': 'node_modules/angular-ui-router/release/angular-ui-router.js',
        'typescript': 'node_modules/typescript/lib/typescript.js',
        'jsrsasign': 'node_modules/jsrsasign/lib/jsrsasign.js',
        'moment': 'node_modules/moment/moment.js',
        'reflect-metadata': 'node_modules/reflect-metadata/Reflect.js'
    },
    packages: {
        'src': {
            defaultExtension: 'ts'
        }
    }
});
