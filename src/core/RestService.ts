/**
 * REST communication and error handling
 */

import {Provider, Inject} from '../decorators';

export interface IRequestConfig extends ng.IRequestConfig {
    command: string;
    mockup?: boolean;
}

@Inject('$http', '$window', '$rootScope', '$log', 'config')
class RestService {

    public url;

    private headers = { 'Content-Type': 'application/json;charset=utf-8' };
    private isOffline: boolean;
    private isMockupEnabled: boolean;

    constructor(
        private $http: ng.IHttpService,
        private $window: ng.IWindowService,
        private $rootScope: ng.IRootScopeService,
        private $log: ng.ILogService,
        private config: any) {

        /*
         Internet connection mockup/online notification
         */

        let updateOnlineStatus = () => {
            this.isOffline = !navigator.onLine;

            if (this.isOffline) {
                $rootScope.$broadcast('$rest:offline');
            } else {
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

    init() {
        return this.get('version')
            .then((result) => {
                this.$rootScope['$restVersion'] = result.version + '.' + result.revision;
                this.$log.info('REST', this.$rootScope['$restVersion'], moment(result.date).format('DD.MM.YYYY hh:mm'));
            });
    }

    /**
     * Mockup response - return JSON file from 'data' folder instead server request
     *
     * @param {object} config
     * @returns {promise} - Request promise
     */

    mockupResponse(config: IRequestConfig) {
        let request: ng.IPromise<any>;

        request = this.$http
            .get('data/' + config.command + '.json')
            .then((result) => {
                let data: any = result.data;
                let params: any = result.config.params;

                if (angular.isArray(data) && params && config.params.number) {
                    data = data.slice(params.number * params.size, (params.number + 1) * params.size);
                }

                return data;
            });

        return request;
    }

    /**
     * Adds request header
     *
     * @param name
     * @param value
     */

    putHeader(name, value) {
        this.headers[name] = value;
    }

    /**
     * Executes HTTP request
     *
     * @param method - HTTP method e.g. PUT, POST etc.
     * @param config - config {command: 'REST server endpoint command', params, data}
     * @returns {promise}
     */

    request(method: string, params: IRequestConfig | string) {
        let command: string = typeof params === 'string' ? params : params.command;
        let config: IRequestConfig;

        config = {
            method,
            url: this.url + command,
            command,
            headers: angular.extend(this.headers, (<IRequestConfig>params).headers || {}),
            params: typeof params === 'string' ? {} : params.params
        };

        if (!config.command) {
            throw new Error('REST Error: Command is required for REST call : ' + JSON.stringify(config));
        }

        if (this.isMockupEnabled || config.mockup) {
            return this.mockupResponse(config);
        }

        return this.$http(config)
            .then((response: ng.IHttpPromiseCallbackArg<any>) => {
                let data: any = response.data;

                this.$log.debug(
                    `RESPONSE ${config.command}, ` +
                    `status: ${response.status}` +
                    `${(data.length ? ', ' + (data.length) + ' items' : '')}`);

                return data;
            })
            .catch((response: ng.IHttpPromiseCallbackArg<any>) => {
                return {
                    status: response.status,
                    message: response.data
                };
            });
    }

    post(params) {
        return this.request('POST', params);
    }

    patch(params) {
        return this.request('PATCH', params);
    }

    get(params) {
        return this.request('GET', params);
    }

    put(params) {
        return this.request('PUT', params);
    }

    remove(params) {
        return this.request('DELETE', params);
    }
}

@Provider({
    name: '$rest'
})
class RestServiceProvider implements ng.IServiceProvider {

    private config = {
        restURL: `${window.location.origin}/api`
    };

    /**
     * Configure.
     *
     * @param {object} params - An `object` of params to extend.
     */

    configure(params) {
        if (!(params instanceof Object)) {
            throw new TypeError('Invalid argument: "config" must be an "Object".');
        }

        angular.extend(this.config, params);

        return this;
    }

    @Inject('$http', '$window', '$rootScope', '$log')
    $get($http, $window, $rootScope, $log) {
        return new RestService($http, $window, $rootScope, $log, this.config);
    }
}

export default RestService;
export { RestServiceProvider, RestService };
