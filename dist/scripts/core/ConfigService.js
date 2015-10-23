/*@ngInject*/
var ConfigServiceProvider = (function () {
    function ConfigServiceProvider() {
        this.config = {};
        angular.extend(this.config, window.CONFIG);
    }
    /**
     * Configure.
     *
     * @param {object} params - An `object` of params to extend.
     */
    ConfigServiceProvider.prototype.configure = function (params) {
        if (!(params instanceof Object)) {
            throw new TypeError('Invalid argument: `config` must be an `Object`.');
        }
        angular.extend(this.config, params);
        return this;
    };
    ConfigServiceProvider.prototype.$get = function () {
        return this.config;
    };
    return ConfigServiceProvider;
})();
exports.ConfigServiceProvider = ConfigServiceProvider;
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ConfigServiceProvider;
