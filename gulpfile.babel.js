import gulp from 'gulp';
import runSequence from 'run-sequence';
import browserSync from 'browser-sync';
import del from 'del';
import merge from 'merge2';
import Builder from 'systemjs-builder';

import config from './gulpfile.config.js';

var $ = require('gulp-load-plugins')({
    lazy: true
});

/**
 * The 'browserSync' task start BrowserSync and open the browser.
 *
 */
gulp.task('server', () => {
    let bs = browserSync.create();
    let browser = 'google chrome';
    let files = [
        config.src.watchFiles,
        config.typescript,
        config.systemjs
    ];
    let serverConfig = null;
    let options = {
        open: false, // Disabled because of bug: https://github.com/BrowserSync/browser-sync/issues/877
        port: 3000,
        directory: true,
        notify: true,
        startPath: config.indexHTML,
        files: files,
        browser: browser
    };

    try {
        $.nodemon({
            script: 'server/server.js',
            ext: 'js html',
            env: {
                'NODE_ENV': 'development'
            }
        });

        serverConfig = require('./server/config.json');
        options.proxy = `${serverConfig.host}:${serverConfig.port}`;
        $.util.log(`REST Server found at ${serverConfig.host}:${serverConfig.port}. Using browser-sync as proxy`);
    } catch (e) {
        $.util.log('No REST Server present. Using browser-sync as server');
        options.server = {
            baseDir: './'
        };
    }

    bs.init(options);
});

/**
 * The 'SASS' task.
 */
gulp.task('sass', () => {
    return gulp.src(config.src.styles)
        .pipe($.sass().on('error', $.sass.logError))
        .pipe(gulp.dest(config.dist.styles));
});

/**
 * The 'clean' task delete 'dist' directory.
 */
gulp.task('clean', (done) => {
    const files = [].concat(config.dist.basePath);
    return del(files, done);
});

/**
 * The 'copy' task just copies files from A to B. We use it here
 * to copy our files that haven't been copied by other tasks
 * e.g. (favicon, etc.) into the `dist` directory.
 */
gulp.task('copy', () => {
    return merge[
        gulp.src(config.src.baseFiles).pipe(gulp.dest(config.dist.basePath)),
        gulp.src(config.src.images).pipe(gulp.dest(config.dist.images)),
        gulp.src(config.src.data).pipe(gulp.dest(config.dist.data)),
        gulp.src(config.src.fonts).pipe(gulp.dest(config.dist.fonts))
    ];
});

/**
 * The 'compile' task compile all js, css and html files.
 */
gulp.task('compile', ['bundle', 'html', 'sass'], () => {
    return gulp.src(`${config.src.basePath}index.html`)
        .pipe($.inject(gulp.src(`${config.dist.scripts}*.js`, {
            read: false
        })))
        .pipe($.usemin())
        .pipe(gulp.dest(config.dist.basePath));
});

/**
 * The 'htmlhint' task defines the rules of our hinter as well as which files we
 * should check. It helps to detect errors and potential problems in our
 * HTML code.
 */
gulp.task('htmlhint', () => {
    return gulp.src(config.src.templates)
        .pipe($.htmlhint({
            'doctype-first': false,
            'spec-char-escape': false
        }))
        .pipe($.htmlhint.reporter())
        .pipe($.htmlhint.failReporter());
});

/**
 * The HTML convert templates to JS task.
 */

gulp.task('html', ['htmlhint'], () => {
    return gulp.src(config.src.templates)
        .pipe($.minifyHtml({
            empty: true,
            spare: true,
            quotes: true
        }))
        .pipe($.ngHtml2js({
            moduleName: config.templatesModuleName,
            prefix: 'modules/'
        }))
        .pipe($.concat(`${config.templatesModuleName}.js`))
        .pipe(gulp.dest(config.dist.scripts));
});

/**
 * The 'TSLint' task.
 */
gulp.task('tslint', () => {
    return gulp.src(config.src.typescripts)
        .pipe($.plumber())
        .pipe($.tslint())
        .pipe($.tslint.report('prose', {
            emitError: false
        }));
});

/**
 * The 'Typescript' task.
 */
gulp.task('typescript', ['tslint'], () => {
    let project = $.typescript.createProject(
        config.typescript
    );

    let result = gulp.src(config.src.typescripts)
        .pipe($.typescript(project));

    return merge([
        result.dts.pipe(gulp.dest(config.dist.scripts)),
        result.js.pipe(gulp.dest(config.dist.scripts))
    ]);
});

/**
 * The 'Bundle' task.
 */

gulp.task('bundle', ['tslint'], (done) => {
    let builder = new Builder(config.root);

    builder
        .loadConfig(config.systemconfig)
        .then(() => {
            return builder.buildStatic(
                `${config.src.basePath}index.ts`,
                `${config.dist.scripts}bundle.js`, {
                    minify: false,
                    mangle: false,
                    sourceMaps: false
                });
        }).then(() => {
            done();
        });
});

/**
 * The 'build' task gets app ready for deployment by processing files
 * and put them into directory ready for production.
 */
gulp.task('build', (done) => {
    runSequence(
        ['clean'], config.build,
        done
    );
});

gulp.task('default', ['server']);
