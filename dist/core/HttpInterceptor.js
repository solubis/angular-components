/**
 * HTTP Interceptor for global error handling
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") return Reflect.decorate(decorators, target, key, desc);
    switch (arguments.length) {
        case 2: return decorators.reduceRight(function(o, d) { return (d && d(o)) || o; }, target);
        case 3: return decorators.reduceRight(function(o, d) { return (d && d(target, key)), void 0; }, void 0);
        case 4: return decorators.reduceRight(function(o, d) { return (d && d(target, key, o)) || o; }, desc);
    }
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var decorators_1 = require('../decorators');
function replacer(key, value) {
    if (typeof value === 'string' && value.length > 35) {
        return value.substring(0, 34) + '...';
    }
    return value;
}
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
            var data = rejection.data;
            _this.$log.error('HTTP Response Error, status: ' + rejection.status + ' message: ' + JSON.stringify(rejection.data, replacer));
            switch (rejection.status) {
                case 0:
                case 500:
                case 502:
                case 503:
                    _this.$rootScope.$broadcast('$rest:error:communication', data.error);
                    break;
                case 400:
                case 404:
                case 405:
                    _this.$rootScope.$broadcast('$rest:error:request', data.error);
                    break;
                case 401:
                case 403:
                    _this.$rootScope.$broadcast('$rest:error:authorization', data.error);
                    break;
            }
            return _this.$q.reject(rejection);
        };
    }
    HttpInterceptor.factory = function ($rootScope, $q, $log) {
        return new HttpInterceptor($rootScope, $q, $log);
    };
    Object.defineProperty(HttpInterceptor, "factory",
        __decorate([
            decorators_1.Inject(),
            __param(0, decorators_1.Inject('$rootScope')),
            __param(1, decorators_1.Inject('$q')),
            __param(2, decorators_1.Inject('$log')), 
            __metadata('design:type', Function), 
            __metadata('design:paramtypes', [Object, Function, Object]), 
            __metadata('design:returntype', void 0)
        ], HttpInterceptor, "factory", Object.getOwnPropertyDescriptor(HttpInterceptor, "factory")));
    return HttpInterceptor;
})();
exports.HttpInterceptor = HttpInterceptor;
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = HttpInterceptor;
//# sourceMappingURL=HttpInterceptor.js.map