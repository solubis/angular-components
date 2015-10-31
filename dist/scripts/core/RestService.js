/**
 * REST communication and error handling
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var decorators_1 = require('../decorators');
var RestService = (function () {
    function RestService($http, $window, $rootScope, $log, config) {
        /*
         Internet connection mockup/online notification
         */
        var _this = this;
        this.$http = $http;
        this.$window = $window;
        this.$rootScope = $rootScope;
        this.$log = $log;
        this.config = config;
        this.headers = { 'Content-Type': 'application/json;charset=utf-8' };
        var updateOnlineStatus = function () {
            _this.isOffline = !navigator.onLine;
            if (_this.isOffline) {
                $rootScope.$broadcast('$rest:offline');
            }
            else {
                $rootScope.$broadcast('$rest:online');
            }
        };
        if ($window.addEventListener) {
            $window.addEventListener('online', updateOnlineStatus);
            $window.addEventListener('offline', updateOnlineStatus);
        }
        /*
         Configuration
         */
        this.isMockupEnabled = config.mockupEnabled;
        if (this.isMockupEnabled) {
            $log.warn('Using Mockup Data');
            return;
        }
        if (config.restURL) {
            this.url = config.restURL.trim();
            if (this.url.charAt(this.url.length - 1) !== '/') {
                this.url += '/';
            }
        }
        $log.info('REST ' + this.url);
    }
    RestService.prototype.init = function () {
        var _this = this;
        return this.get('version')
            .then(function (result) {
            _this.$rootScope['$restVersion'] = result.version + '.' + result.revision;
            _this.$log.info('REST', _this.$rootScope['$restVersion'], moment(result.date).format('DD.MM.YYYY hh:mm'));
        });
    };
    /**
     * Mockup response - return JSON file from 'data' folder instead server request
     *
     * @param {object} config
     * @returns {promise} - Request promise
     */
    RestService.prototype.mockupResponse = function (config) {
        var request;
        request = this.$http
            .get('data/' + config.command + '.json')
            .then(function (result) {
            var data = result.data;
            var params = result.config.params;
            if (angular.isArray(data) && params && config.params.number) {
                data = data.slice(params.number * params.size, (params.number + 1) * params.size);
            }
            return data;
        });
        return request;
    };
    /**
     * Adds request header
     *
     * @param name
     * @param value
     */
    RestService.prototype.putHeader = function (name, value) {
        this.headers[name] = value;
    };
    /**
     * Executes HTTP request
     *
     * @param method - HTTP method e.g. PUT, POST etc.
     * @param config - config {command: 'REST server endpoint command', params, data}
     * @returns {promise}
     */
    RestService.prototype.request = function (method, params) {
        var _this = this;
        var command = typeof params === 'string' ? params.trim() : params.command;
        var config;
        config = {
            method: method,
            url: this.url + command,
            command: command,
            headers: angular.extend(this.headers, params.headers || {}),
            params: typeof params === 'string' ? {} : params.params
        };
        if (!config.command) {
            throw new Error('REST Error: Command is required for REST call : ' + JSON.stringify(config));
        }
        if (this.isMockupEnabled || config.mockup) {
            return this.mockupResponse(config);
        }
        return this.$http(config)
            .then(function (response) {
            var data = response.data;
            _this.$log.debug(("RESPONSE " + config.command + ", ") +
                ("status: " + response.status) +
                ("" + (data.length ? ', ' + (data.length) + ' items' : '')));
            return data;
        })
            .catch(function (response) {
            return {
                status: response.status,
                message: response.data
            };
        });
    };
    RestService.prototype.post = function (params) {
        return this.request('POST', params);
    };
    RestService.prototype.patch = function (params) {
        return this.request('PATCH', params);
    };
    RestService.prototype.get = function (params) {
        return this.request('GET', params);
    };
    RestService.prototype.put = function (params) {
        return this.request('PUT', params);
    };
    RestService.prototype.remove = function (params) {
        return this.request('DELETE', params);
    };
    RestService = __decorate([
        decorators_1.Inject('$http', '$window', '$rootScope', '$log', 'config'), 
        __metadata('design:paramtypes', [Function, Object, Object, Object, Object])
    ], RestService);
    return RestService;
})();
exports.RestService = RestService;
var RestServiceProvider = (function () {
    function RestServiceProvider() {
        this.config = {
            restURL: window.location.origin + "/api"
        };
    }
    /**
     * Configure.
     *
     * @param {object} params - An `object` of params to extend.
     */
    RestServiceProvider.prototype.configure = function (params) {
        if (!(params instanceof Object)) {
            throw new TypeError('Invalid argument: "config" must be an "Object".');
        }
        angular.extend(this.config, params);
        return this;
    };
    RestServiceProvider.prototype.$get = function ($http, $window, $rootScope, $log) {
        return new RestService($http, $window, $rootScope, $log, this.config);
    };
    __decorate([
        decorators_1.Inject('$http', '$window', '$rootScope', '$log'), 
        __metadata('design:type', Function), 
        __metadata('design:paramtypes', [Object, Object, Object, Object]), 
        __metadata('design:returntype', void 0)
    ], RestServiceProvider.prototype, "$get", null);
    RestServiceProvider = __decorate([
        decorators_1.Provider({
            name: '$rest'
        }), 
        __metadata('design:paramtypes', [])
    ], RestServiceProvider);
    return RestServiceProvider;
})();
exports.RestServiceProvider = RestServiceProvider;
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = RestService;
//# sourceMappingURL=RestService.js.map