/// <reference path="../typings/tsd.d.ts" />
var SecurityService_1 = require('./security/SecurityService');
var OAuthTokenService_1 = require('./security/OAuthTokenService');
var OAuthInterceptor_1 = require('./security/OAuthInterceptor');
var QueryStringService_1 = require('./security/QueryStringService');
var AuthorizeDirective_1 = require('./security/AuthorizeDirective');
var core = require('./core');
require('jsrsasign');
var module = angular.module('fds.security', [core.module.name])
    .config(function ($httpProvider, $configProvider, $securityProvider) {
    var config = $configProvider.$get();
    $securityProvider.configure(config);
    $httpProvider.interceptors.push(OAuthInterceptor_1.default.factory);
})
    .run(function ($rootScope, $security) {
    $rootScope.authorize = $security.authorize.bind($security);
    $rootScope.owner = $security.owner.bind($security);
    if ($security.isAuthenticated()) {
        $rootScope.userLogin = $security.getUserLogin();
        $rootScope.userFullName = $security.getUserFullName();
    }
})
    .provider('$security', SecurityService_1.SecurityServiceProvider)
    .provider('$oauthToken', OAuthTokenService_1.OAuthTokenServiceProvider)
    .service('$queryString', QueryStringService_1.default)
    .directive('authorize', AuthorizeDirective_1.default);
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = module;
