/**
 * REST communication and error handling
 */
/*@ngInject*/
var RestService = (function () {
    function RestService($http, $q, $window, $rootScope, $log, config) {
        /*
         Internet connection mockup/online notification
         */
        var _this = this;
        this.$http = $http;
        this.$q = $q;
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
        else {
            $window.attachEvent('online', updateOnlineStatus);
            $window.attachEvent('offline', updateOnlineStatus);
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
        return this.get({ command: 'version' })
            .then(function (result) {
            _this.$rootScope.$restVersion = result.version + '.' + result.revision;
            _this.$log.info('REST', _this.$rootScope.$restVersion, moment(result.date).format('DD.MM.YYYY hh:mm'));
        });
    };
    /**
     * Mockup response - return JSON file from 'data' folder instead server request
     *
     * @param {object} config
     * @returns {promise} - Request promise
     */
    RestService.prototype.mockupResponse = function (config) {
        var _this = this;
        var request;
        request = this.$http
            .get('data/' + config.command + '.json')
            .then(function (response) {
            var content = response.data.content;
            if (_this.isMockupEnabled && content) {
                content = content.slice(config.params.number * config.params.size, (config.params.number + 1) * config.params.size);
                response.data.content = content;
                response.data.numberOfElements = content.length;
            }
            return response.data;
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
    RestService.prototype.request = function (method, config) {
        var _this = this;
        var deferred = this.$q.defer();
        if (!config.command) {
            throw new Error('REST Error: Command is required for REST call : ' + JSON.stringify(config));
        }
        config.url = this.url + config.command;
        config.method = method;
        config.headers = angular.extend(this.headers, config.headers);
        config.params = config.params || {};
        if (this.isMockupEnabled || config.mockup) {
            return this.mockupResponse(config);
        }
        this.$http(config)
            .success(function (data, status) {
            _this.$log.debug('RESPONSE ', config.command + ': ', 'status: ' + status + (data.content ? ', ' + (data.content && data.content.length) + ' items' : ''));
            if (data.result === 'error') {
                _this.$log.warn('Application error: "' + data.message + '" for: ' + JSON.stringify(config));
                deferred.reject({
                    status: status,
                    message: data
                });
                return;
            }
            deferred.resolve(data);
        })
            .error(function (data, status) {
            deferred.reject({
                status: status,
                message: data
            });
        });
        return deferred.promise;
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
    return RestService;
})();
exports.RestService = RestService;
var RestServiceProvider = (function () {
    function RestServiceProvider() {
        this.config = {
            restURL: window.location.origin
        };
    }
    /**
     * Configure.
     *
     * @param {object} params - An `object` of params to extend.
     */
    RestServiceProvider.prototype.configure = function (params) {
        if (!(params instanceof Object)) {
            throw new TypeError('Invalid argument: `config` must be an `Object`.');
        }
        angular.extend(this.config, params);
        return this;
    };
    /*@ngInject*/
    RestServiceProvider.prototype.$get = function ($http, $q, $window, $rootScope, $log) {
        return new RestService($http, $q, $window, $rootScope, $log, this.config);
    };
    return RestServiceProvider;
})();
exports.RestServiceProvider = RestServiceProvider;
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = RestService;
