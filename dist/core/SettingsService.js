/// <reference path="../../typings/tsd.d.ts" />
/**
 * Saving and loading settings from local storage
 */
/*@ngInject*/
var SettingsService = (function () {
    function SettingsService($window, config) {
        this.$window = $window;
        this.config = config;
        this.settings = {
            debug: false,
            path: ''
        };
        this.settings = JSON.parse($window.localStorage.getItem(this.config.storeName)) || this.settings;
    }
    SettingsService.prototype.getSettings = function () {
        return this.settings;
    };
    SettingsService.prototype.saveSettings = function () {
        var text = JSON.stringify(this.settings);
        if (text && text !== '{}') {
            this.$window.localStorage.setItem(this.config.storeName, text);
        }
    };
    SettingsService.prototype.get = function (name) {
        return this.settings[name];
    };
    SettingsService.prototype.put = function (key, value) {
        if (value === void 0) { value = undefined; }
        if (value) {
            this.settings[key] = value;
        }
        else {
            delete this.settings[key];
        }
        this.saveSettings();
    };
    SettingsService.prototype.set = function (key, value) {
        if (value === void 0) { value = undefined; }
        this.put(key, value);
    };
    SettingsService.prototype.remove = function (key) {
        this.put(key);
    };
    return SettingsService;
})();
exports.SettingsService = SettingsService;
var SettingsServiceProvider = (function () {
    function SettingsServiceProvider() {
        this.config = {
            storeName: 'iq.settings'
        };
    }
    /**
     * Configure.
     *
     * @param {object} params - An `object` of params to extend.
     */
    SettingsServiceProvider.prototype.configure = function (params) {
        if (!(params instanceof Object)) {
            throw new TypeError('Invalid argument: `config` must be an `Object`.');
        }
        angular.extend(this.config, params);
        return this;
    };
    /*@ngInject*/
    SettingsServiceProvider.prototype.$get = function ($window) {
        return new SettingsService($window, this.config);
    };
    return SettingsServiceProvider;
})();
exports.SettingsServiceProvider = SettingsServiceProvider;
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SettingsService;
