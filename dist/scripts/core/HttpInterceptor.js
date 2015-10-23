/**
 * HTTP Interceptor for global error handling
 */
function replacer(key, value) {
    if (typeof value === 'string' && value.length > 35) {
        return value.substring(0, 34) + '...';
    }
    return value;
}
/*@ngInject*/
var HttpInterceptor = (function () {
    function HttpInterceptor($rootScope, $q, $log) {
        var _this = this;
        this.$rootScope = $rootScope;
        this.$q = $q;
        this.$log = $log;
        this.request = function (config) {
            if (config.command) {
                _this.$log.debug(config.method + ' ' + config.command +
                    ': params ' + JSON.stringify(config.params, replacer) +
                    ', headers ' + JSON.stringify(config.headers, replacer) +
                    (config.data ? ', body: ' + JSON.stringify(config.data, replacer) : ''));
            }
            return config;
        };
        this.responseError = function (rejection) {
            _this.$log.error('HTTP Response Error, status: ' + rejection.status + ' message: ' + JSON.stringify(rejection.data, replacer));
            rejection.message = rejection.data && rejection.data.error_description ? rejection.data.error_description : 'Unknown server error';
            rejection.url = rejection.config.url;
            switch (rejection.status) {
                case 0:
                case 500:
                case 502:
                case 503:
                    _this.$rootScope.$broadcast('$rest:error:communication', rejection);
                    break;
                case 400:
                case 405:
                    _this.$rootScope.$broadcast('$rest:error:request', rejection);
                    break;
                case 401:
                case 403:
                    _this.$rootScope.$broadcast('$rest:error:authorization', rejection);
                    break;
            }
            return _this.$q.reject(rejection);
        };
    }
    /*@ngInject*/
    HttpInterceptor.factory = function ($rootScope, $q, $log) {
        return new HttpInterceptor($rootScope, $q, $log);
    };
    return HttpInterceptor;
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = HttpInterceptor;
