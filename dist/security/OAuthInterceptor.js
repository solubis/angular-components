/**
 * HTTP Interceptor for global OAuth handling
 */
/*@ngInject*/
var OAuthHttpInterceptor = (function () {
    function OAuthHttpInterceptor($rootScope, $q, $oauthToken) {
        var _this = this;
        this.$rootScope = $rootScope;
        this.$q = $q;
        this.$oauthToken = $oauthToken;
        this.request = function (config) {
            /*
             Inject `Authorization` header.
             */
            if (!config.url.match(/.html/) && _this.$oauthToken.getAuthorizationHeader()) {
                config.headers = config.headers || {};
                if (!config.headers.Authorization) {
                    config.headers.Authorization = _this.$oauthToken.getAuthorizationHeader();
                }
            }
            return config;
        };
        this.responseError = function (rejection) {
            var error = {
                status: rejection.status,
                message: rejection.data && rejection.data.error_description ? rejection.data.error_description : 'Unknown OAuth Error ' + JSON.stringify(rejection),
            };
            /*
             Catch `invalid_request` and `invalid_grant` errors and ensure that the `token` is removed.
             */
            if (400 === rejection.status && rejection.data &&
                ('invalid_request' === rejection.data.error || 'invalid_grant' === rejection.data.error)) {
                _this.$oauthToken.removeToken();
                _this.$rootScope.$broadcast('$oauth:error', error);
            }
            /*
             Catch `invalid_token` and `unauthorized` errors.
             The token isn't removed here so it can be refreshed when the `invalid_token` error occurs.
             */
            if (401 === rejection.status) {
                if ((rejection.data && 'invalid_token' === rejection.data.error) ||
                    (rejection.headers('www-authenticate') && 0 === rejection.headers('www-authenticate').indexOf('Bearer'))) {
                    error.message = 'Invalid token. Should login.';
                    _this.$rootScope.$broadcast('$oauth:error', error);
                }
                else {
                    error.url = rejection.config.url;
                    _this.$rootScope.$broadcast('$http:error:authorization', error);
                }
            }
            if (403 === rejection.status) {
                _this.$rootScope.$broadcast('$oauth:error', error);
            }
            return _this.$q.reject(rejection);
        };
    }
    OAuthHttpInterceptor.$inject = ["$rootScope", "$q", "$oauthToken"];
    /*@ngInject*/
    OAuthHttpInterceptor.factory = function ($rootScope, $q, $oauthToken) {
        return new OAuthHttpInterceptor($rootScope, $q, $oauthToken);
    };
    OAuthHttpInterceptor.factory.$inject = ["$rootScope", "$q", "$oauthToken"];
    return OAuthHttpInterceptor;
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = OAuthHttpInterceptor;
