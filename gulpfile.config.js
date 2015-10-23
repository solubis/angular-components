const root = __dirname;
const config = {
    root: root,
    /**
     * The config files
     */
    gulp: `${root}/gulpfile.babel.js`,
    systemjs: `${root}/system.config.js`,
    typescript: `${root}/tsconfig.json`,

    indexHTML: 'src/demo/index.html',
    templatesModuleName: 'templates',

    /**
     * This is a collection of file patterns that refer to our app code (the
     * stuff in `src/`). These file paths are used in the configuration of
     * build tasks.
     */
    src: {
        basePath: `${root}/src/`,
        files: `${root}/src/**/*.{css,ts,html,jpg,png}`,
        typescripts: [`${root}/src/**/!(*.spec).ts`,`${root}/typings/tsd.d.ts`],
        images: `${root}/src/images/**/*`,
        fonts: `${root}/src/fonts/**/*`,
        data: `${root}/src/data/**/*`,
        styles: [`${root}/src/styles/app.scss`],
        html: [`${root}/src/**/*.html`]
    },

    /**
     * The 'dist' folder is where our app resides once it's
     * completely built.
     */
    dist: {
        basePath: `${root}/dist/`,
        scripts: `${root}/dist/scripts/`,
        styles: `${root}/dist/styles/`,
        images: `${root}/dist/images/`,
        data: `${root}/dist/data/`,
        fonts: `${root}/dist/fonts/`
    }
};

export default config;
