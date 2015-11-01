/**
 * HTTP Interceptor for global error handling
 */

import {Inject} from '../decorators';

function replacer(key, value) {
    if (typeof value === 'string' && value.length > 35) {
        return value.substring(0, 34) + '...';
    }
    return value;
}

class HttpInterceptor {

    request = (config) => {
        if (config.command) {
            this.$log.debug(config.method + ' ' + config.command +
                ': params ' + JSON.stringify(config.params, replacer) +
                ', headers ' + JSON.stringify(config.headers, replacer) +
                (config.data ? ', body: ' + JSON.stringify(config.data, replacer) : '')
            );
        }

        return config;
    };

    responseError = (rejection) => {
        let data = rejection.data;

        this.$log.error('HTTP Response Error, status: ' + rejection.status + ' message: ' + JSON.stringify(rejection.data, replacer));

        switch (rejection.status) {
            case 0:
            case 500:
            case 502:
            case 503:
                this.$rootScope.$broadcast('$rest:error:communication', data.error);
                break;
            case 400:
            case 404:
            case 405:
                this.$rootScope.$broadcast('$rest:error:request', data.error);
                break;
            case 401:
            case 403:
                this.$rootScope.$broadcast('$rest:error:authorization', data.error);
                break;
        }

        return this.$q.reject(rejection);
    };

    @Inject('$rootScope', '$q', '$log')
    public static factory($rootScope: ng.IRootScopeService, $q: ng.IQService, $log: ng.ILogService) {
        return new HttpInterceptor($rootScope, $q, $log);
    }

    constructor(
        private $rootScope: ng.IRootScopeService,
        private $q: ng.IQService,
        private $log: ng.ILogService) {
    }
}

export default HttpInterceptor;
export {HttpInterceptor};
