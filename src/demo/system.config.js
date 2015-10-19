    System.config({
        baseURL: '/',
        defaultJSExtensions: true,
        transpiler: 'typescript',
        map: {
            'angular': 'node_modules/angular/index.js',
            'angular-ui-router': 'node_modules/angular-ui-router/release/angular-ui-router.js',
            'typescript': 'node_modules/typescript/lib/typescript.js'
        },
        packages: {
            'src': {
                defaultExtension: 'ts'
            }
        }
    });
