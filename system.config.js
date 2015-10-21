    System.config({
        defaultJSExtensions: true,
        transpiler: 'typescript',
        map: {
            'angular': 'node_modules/angular/index.js',
            'angular-ui-router': 'node_modules/angular-ui-router/release/angular-ui-router.js',
            'typescript': 'node_modules/typescript/lib/typescript.js',
            'jsrsasign': 'node_modules/jsrsasign/lib/jsrsasign.js',
            'moment': 'node_modules/moment/moment.js'
        },
        packages: {
            'src': {
                defaultExtension: 'ts'
            }
        }
    });
