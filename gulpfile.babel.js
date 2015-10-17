import gulp from 'gulp';
import runSequence from 'run-sequence';
import browserSync from 'browser-sync';
import del from 'del';
import Builder from 'systemjs-builder';

import config from './gulpfile.config.js';

var $ = require('gulp-load-plugins')({
    lazy: true
});

const SERVER_NAME = 'SERVER';

/**
 * The 'server' task start BrowserSync and open the browser.
 */
gulp.task('server', () => {
    let server = browserSync.create(SERVER_NAME);
    let browser = 'google chrome';
    let files = [
        config.src.files,
        config.typescript,
        config.systemjs
    ];

    server.init({
        open: true,
        port: 3000,
        directory: true,
        notify: true,
        startPath: `src/index.html`,
        files: files,
        server: {
            baseDir: './'
        },
        browser: browser
    });
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
    return gulp.src(
            [config.src.basePath + '*.{ico,png,txt}',
                config.src.basePath + '404.html'
            ])
        .pipe(gulp.dest(config.dist.basePath));
});

/**
 * The 'images' task optimize and copies images to `dist` directory.
 */
gulp.task('images', () => {
    return gulp.src(config.src.images)
        .pipe(gulp.dest(config.dist.images));
});

/**
 * The 'data' task optimize and copies images to `dist` directory.
 */
gulp.task('data', () => {
    return gulp.src(config.src.data)
        .pipe(gulp.dest(config.dist.data));
});

/**
 * The 'fonts' task copies fonts to `dist` directory.
 */
gulp.task('fonts', () => {
    return gulp.src(config.src.fonts)
        .pipe(gulp.dest(config.dist.fonts));
});

/**
 * The HTML convert templates to JS task.
 */

gulp.task('html', () => {
    return gulp.src(config.src.html)
        .pipe($.minifyHtml({
            empty: true,
            spare: true,
            quotes: true
        }))
        .pipe($.ngHtml2js({
            moduleName: config.templatesModuleName
        }))
        .pipe($.concat('templates.js'))
        .pipe(gulp.dest(config.dist.scripts));
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
    return gulp.src(config.src.html)
        .pipe($.htmlhint({
            'doctype-first': false,
            'spec-char-escape': false
        }))
        .pipe($.htmlhint.reporter())
        .pipe($.htmlhint.failReporter());
});

/**
 * The 'Typescript' task.
 */
gulp.task('typescript', () => {
    let project = $.typescript.createProject(
        config.typescript
    );

    return project.src()
        .pipe($.plumber())
        .pipe($.tslint())
        .pipe($.tslint.report('prose', {emitError: false}))
        .pipe($.typescript(project))
        .js.pipe($.ngAnnotate())
        .pipe(gulp.dest(config.dist.scripts));
});

/**
 * The 'Bundle' task.
 */

gulp.task('bundle', ['typescript'], () => {
    let builder = new Builder(config.root);

    builder.loadConfig(config.systemjs)
        .then(() => {
            return builder.buildStatic(
                `${config.dist.scripts}src/modules/app.js`,
                `${config.dist.scripts}bundle.js`, {
                    minify: false,
                    mangle: false,
                    sourceMaps: false
                });
        }).then(() => del(`${config.dist.scripts}src`));
});

/**
 * The 'build' task gets app ready for deployment by processing files
 * and put them into directory ready for production.
 */
gulp.task('build', (done) => {
    runSequence(
        ['clean'], ['compile', 'copy', 'images', 'fonts', 'data'],
        done
    );
});

gulp.task('default', ['server']);
