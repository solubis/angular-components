import * as angular from 'angular';

import 'jsrsasign';

import { SecurityServiceProvider } from './security/SecurityService';
import { OAuthTokenServiceProvider } from './security/OAuthTokenService';
import OAuthInterceptor from './security/OAuthInterceptor';
import QueryStringService from './security/QueryStringService';
import AuthorizeDirective from './security/AuthorizeDirective';

let module = angular.module('fds.security', [])

    .config(($httpProvider, $configProvider, $securityProvider: SecurityServiceProvider) => {
        let config = $configProvider.$get();

        $securityProvider.configure(config);
        $httpProvider.interceptors.push(OAuthInterceptor.factory);
    })

    .run(($rootScope, $security) => {
        $rootScope.authorize = $security.authorize.bind($security);
        $rootScope.owner = $security.owner.bind($security);

        if ($security.isAuthenticated()) {
            $rootScope.userLogin = $security.getUserLogin();
            $rootScope.userFullName = $security.getUserFullName();
        }
    })

    .provider('$security', SecurityServiceProvider)

    .provider('$oauthToken', OAuthTokenServiceProvider)

    .service('$queryString', QueryStringService)

    .directive('authorize', AuthorizeDirective);

export default module;
