/**
 * Module with services for error handler, local storage settings and small utils
 */
var angular = require('angular');
var SettingsService_1 = require('./core/SettingsService');
exports.SettingsServiceProvider = SettingsService_1.SettingsServiceProvider;
exports.SettingsService = SettingsService_1.SettingsService;
var RestService_1 = require('./core/RestService');
exports.RestServiceProvider = RestService_1.RestServiceProvider;
exports.RestService = RestService_1.RestService;
var ConfigService_1 = require('./core/ConfigService');
exports.ConfigServiceProvider = ConfigService_1.default;
var HttpInterceptor_1 = require('./core/HttpInterceptor');
exports.HttpInterceptor = HttpInterceptor_1.default;
var UtilsService_1 = require('./core/UtilsService');
exports.UtilsService = UtilsService_1.default;
exports.module = angular.module('core', [])
    .value('$dateFormat', 'DD.MM.YYYY HH:mm:ss')
    .filter('dateFormat', function ($utils) { return function (value) { return $utils.formatDate(value); }; })
    .config(function ($httpProvider) {
    $httpProvider.interceptors.push(HttpInterceptor_1.default.factory);
})
    .provider('$rest', RestService_1.RestServiceProvider)
    .provider('$config', ConfigService_1.default)
    .service('$utils', UtilsService_1.default)
    .provider('$settings', SettingsService_1.SettingsServiceProvider);
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = exports.module;
