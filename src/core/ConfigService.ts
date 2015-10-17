declare var window: any;

/*@ngInject*/
class ConfigServiceProvider implements ng.IServiceProvider {

    private config = {};

    constructor() {
        angular.extend(this.config, window.CONFIG);
    }


    /**
     * Configure.
     *
     * @param {object} params - An `object` of params to extend.
     */

    configure(params) {
        if (!(params instanceof Object)) {
            throw new TypeError('Invalid argument: `config` must be an `Object`.');
        }

        angular.extend(this.config, params);

        return this;
    }

    $get() {
        return this.config;
    }
}

export { ConfigServiceProvider };
export default ConfigServiceProvider;
