/// <reference path="../../typings/tsd.d.ts" />
(function (PermissionCheckType) {
    PermissionCheckType[PermissionCheckType["One"] = 0] = "One";
    PermissionCheckType[PermissionCheckType["All"] = 1] = "All";
})(exports.PermissionCheckType || (exports.PermissionCheckType = {}));
var PermissionCheckType = exports.PermissionCheckType;
(function (AccessStatus) {
    AccessStatus[AccessStatus["NotAuthorised"] = 0] = "NotAuthorised";
    AccessStatus[AccessStatus["Authorised"] = 1] = "Authorised";
    AccessStatus[AccessStatus["LoginRequired"] = 2] = "LoginRequired";
})(exports.AccessStatus || (exports.AccessStatus = {}));
var AccessStatus = exports.AccessStatus;
var LOGIN_REDIRECT_TIMEOUT = 3000;
/*@ngInject*/
var SecurityService = (function () {
    function SecurityService($http, $window, $location, $timeout, $queryString, $oauthToken, Organisation, config) {
        this.$http = $http;
        this.$window = $window;
        this.$location = $location;
        this.$timeout = $timeout;
        this.$queryString = $queryString;
        this.$oauthToken = $oauthToken;
        this.Organisation = Organisation;
        this.config = config;
        this.headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic YWNtZTphY21lc2VjcmV0'
        };
        this.url = config.oauthURL && config.oauthURL.trim();
        if (this.url && this.url.charAt(this.url.length - 1) !== '/') {
            this.url += '/';
        }
    }
    /**
     * Returns Organisation structure
     * @returns {promise}
     */
    SecurityService.prototype.getOrganisation = function () {
        var _this = this;
        return this.$http
            .get(this.url + 'hierarchies')
            .then(function (result) {
            return new _this.Organisation(result.data, 'Hierarchies');
        });
    };
    /**
     * Verifies if the `user` is authenticated or not based on the `token`
     * cookie.
     *
     * @return {boolean}
     */
    SecurityService.prototype.isAuthenticated = function () {
        return !!this.$oauthToken.getToken();
    };
    /**
     * Redirect to application page
     */
    SecurityService.prototype.redirectToApplication = function (token) {
        var _this = this;
        var applicationURL;
        var createTokenURL = function (applicationURL, applicationRoute, token) {
            var url = applicationURL + "#" + applicationRoute;
            url += applicationRoute.indexOf('?') >= 0 ? '&' : '?';
            url += "token=" + token;
            return url;
        };
        applicationURL = this.$location.search()['redirect_url'] || this.config.applicationURL;
        if (!applicationURL) {
            throw new Error('No application URL in config or redirect_url param');
        }
        applicationURL = createTokenURL(applicationURL, this.$location.hash(), token);
        this.$timeout(function () { return _this.$window.location.assign(applicationURL); });
    };
    /**
     * Redirect to login page
     */
    SecurityService.prototype.redirectToLogin = function (time) {
        var _this = this;
        if (time === void 0) { time = LOGIN_REDIRECT_TIMEOUT; }
        this.$timeout(function () {
            _this.$window.location.assign(_this.config.loginURL + '#?redirect_url=' + encodeURI('' + _this.$window.location));
        }, time);
    };
    /**
     * Retrieves the `access_token`, decodes it and stores all data in local storage
     *
     * @param {string} username
     * @param {string} password
     *
     * @return {promise} A response promise.
     */
    SecurityService.prototype.login = function (username, password) {
        var _this = this;
        var data;
        var promise;
        data = angular.extend(this.config, { username: username, password: password });
        data = this.$queryString.stringify(data);
        var config = {
            method: 'POST',
            url: this.url + 'oauth/token',
            headers: this.headers,
            data: data
        };
        promise = this.$http(config)
            .then(function (result) {
            var token = result.data;
            _this.redirectToApplication(token.access_token);
        });
        return promise;
    };
    /**
     * Retrieves the profile object (authorities, user_name)
     *
     * @return {promise} A response promise.
     */
    SecurityService.prototype.decodeTokenContent = function (token) {
        var data;
        var config = {
            headers: this.headers
        };
        data = 'token=' + token;
        return this.$http
            .post(this.url + 'oauth/check_token', data, config)
            .then(function (result) { return result.data; });
    };
    /**
     * Removes token and redirects to Login Page
     */
    SecurityService.prototype.logout = function () {
        this.$oauthToken.removeToken();
        this.redirectToLogin(0);
    };
    /**
     * Retrieves the `refresh_token` and stores the `response.data` on local storage
     * using the `OAuthToken`.
     *
     * @return {promise} A response promise.
     */
    SecurityService.prototype.getRefreshToken = function () {
        var _this = this;
        var data = {
            grant_type: 'refresh_token',
            refresh_token: this.$oauthToken.getRefreshToken()
        };
        var config = {
            headers: this.headers
        };
        data = angular.extend(this.config, data);
        return this.$http
            .post(this.url + 'oauth/token', this.$queryString.stringify(data), config)
            .then(function (response) {
            _this.$oauthToken.setToken(response.data);
            return response;
        });
    };
    /**
     * Revokes the `token` and removes the stored `token` from cookies
     * using the `OAuthToken`.
     *
     * @return {promise} A response promise.
     */
    SecurityService.prototype.revokeToken = function () {
        var _this = this;
        var data = {
            token: this.$oauthToken.getRefreshToken() ? this.$oauthToken.getRefreshToken() : this.$oauthToken.getAccessToken()
        };
        data = angular.extend(this.config, data);
        return this.$http
            .post(this.url + 'oauth/revoke', this.$queryString.stringify(data), this.config)
            .then(function (response) {
            _this.$oauthToken.removeToken();
            return response;
        });
    };
    /**
     * Returns array of current user permissions
     *
     * @returns {string[]}
     */
    SecurityService.prototype.getPermissions = function () {
        return this.$oauthToken.getPermissions();
    };
    SecurityService.prototype.getUserPermissions = function () {
        if (!this.userPermissions) {
            var permissions = this.getPermissions();
            this.userPermissions = permissions ? this.getPermissions().map(function (item) { return item.toLowerCase().trim(); }) : [];
        }
        return this.userPermissions;
    };
    /**
     * Returns user name
     *
     * @returns {string}
     */
    SecurityService.prototype.getUserLogin = function () {
        return this.$oauthToken.getUserLogin();
    };
    /**
     * Returns user name
     *
     * @returns {string}
     */
    SecurityService.prototype.getUserFullName = function () {
        return this.$oauthToken.getUserFullName();
    };
    /**
     * Return Access Token
     */
    SecurityService.prototype.getAccessToken = function () {
        return this.$oauthToken.getAccessToken();
    };
    /**
     * State handling for UI router
     *
     * @param event
     * @param toState
     * @param loginRequiredCallback
     * @param notAuthorisedCallback
     */
    SecurityService.prototype.stateChangeStart = function (event, toState, loginRequiredCallback, notAuthorisedCallback) {
        var authorised;
        var requiredPermissions = toState.access && toState.access.requiredPermissions;
        var isLoginRequired = toState.access && toState.access.isLoginRequired || true;
        var permissionCheckTypeString = toState.access && toState.access.permissionCheckType;
        var permissionCheckType = PermissionCheckType[permissionCheckTypeString] || PermissionCheckType.All;
        if (toState.access !== undefined) {
            authorised = this.authorize(requiredPermissions, isLoginRequired, permissionCheckType);
            if (authorised === AccessStatus.LoginRequired) {
                if (angular.isFunction(loginRequiredCallback)) {
                    loginRequiredCallback();
                }
                this.redirectToLogin(this.config.redirectToLoginTimeout);
                event.preventDefault();
            }
            else if (authorised === AccessStatus.NotAuthorised) {
                if (angular.isFunction(notAuthorisedCallback)) {
                    notAuthorisedCallback();
                }
                event.preventDefault();
            }
        }
    };
    /**
     * Method for checking user permissions
     *
     * @param {string, string[]} requiredPermissions
     * @param {boolean} isLoginRequired
     * @param {PermissionCheckType} permissionCheckType - all permissions (All) or one of them (One)
     * @returns {AccessStatus}
     */
    SecurityService.prototype.authorize = function (requiredPermissions, isLoginRequired, permissionCheckType) {
        if (isLoginRequired === void 0) { isLoginRequired = true; }
        if (permissionCheckType === void 0) { permissionCheckType = PermissionCheckType.One; }
        var user = this.getUserLogin();
        var userPermissions = this.getUserPermissions();
        var length;
        var hasPermission = true;
        var permission;
        var i;
        /*
         Login required but no user logged in
         */
        if (isLoginRequired === true && !user) {
            return AccessStatus.LoginRequired;
        }
        /*
         Login required, user logged in but no permissions required
         */
        requiredPermissions = angular.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
        if ((isLoginRequired === true && user) && (requiredPermissions === undefined || requiredPermissions.length === 0)) {
            return AccessStatus.Authorised;
        }
        length = requiredPermissions.length;
        /*
         Permission required
         */
        if (requiredPermissions && userPermissions) {
            for (i = 0; i < length; i++) {
                permission = requiredPermissions[i].toLowerCase().trim();
                if (permissionCheckType === PermissionCheckType.All) {
                    hasPermission = hasPermission && userPermissions.indexOf(permission) > -1;
                    /*
                     if all the permissions are required and hasPermission is false there is no point carrying on
                     */
                    if (hasPermission === false) {
                        break;
                    }
                }
                else if (permissionCheckType === PermissionCheckType.One) {
                    hasPermission = userPermissions.indexOf(permission) > -1;
                    /*
                     if we only need one of the permissions and we have it there is no point carrying on
                     */
                    if (hasPermission) {
                        break;
                    }
                }
            }
            return hasPermission ? AccessStatus.Authorised : AccessStatus.NotAuthorised;
        }
    };
    /**
     * Check if passed user is current user
     */
    SecurityService.prototype.owner = function (userName) {
        return userName === this.getUserLogin();
    };
    return SecurityService;
})();
exports.SecurityService = SecurityService;
var SecurityServiceProvider = (function () {
    function SecurityServiceProvider() {
        this.config = {
            'grant_type': 'password',
            'client_id': 'acme',
            'scope': 'openid'
        };
    }
    /**
     * Configure.
     *
     * @param {object} params - An `object` of params to extend.
     */
    SecurityServiceProvider.prototype.configure = function (params) {
        if (!(params instanceof Object)) {
            throw new TypeError('Invalid argument: `config` must be an `Object`.');
        }
        angular.extend(this.config, params);
        return this;
    };
    /*@ngInject*/
    SecurityServiceProvider.prototype.$get = function ($http, $window, $location, $timeout, $queryString, $oauthToken, Organisation) {
        return new SecurityService($http, $window, $location, $timeout, $queryString, $oauthToken, Organisation, this.config);
    };
    return SecurityServiceProvider;
})();
exports.SecurityServiceProvider = SecurityServiceProvider;
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SecurityService;
