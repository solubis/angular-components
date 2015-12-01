/**
 * REST communication and error handling
 */

import {Provider, Inject} from '../decorators';
import * as moment from 'moment';

export interface IRequestConfig extends ng.IRequestConfig {
    command: string;
    mockup?: boolean;
}

class RestService {

    public url;

    private headers = { 'Content-Type': 'application/json;charset=utf-8' };
    private isOffline: boolean;
    private isMockupEnabled: boolean;
    private version: string;

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
            .then((response: ng.IHttpPromiseCallbackArg<any[]>) => {
                let server = response[0];
                if (server) {
                    this.version = `${server.version} - ${moment(server.date).format('DD.MM.YYYY hh:mm')}`;
                    this.$log.info('REST', this.version);
                }
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
            .get(`data/${config.command}.json`)
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

    putHeader(name: string, value: string) {
        this.headers[name] = value;
    }

    /**
     * Executes HTTP request
     *
     * @param method - HTTP method e.g. PUT, POST etc.
     * @param params - config {command: 'REST server endpoint command', params, data} or command: string
     * @returns {promise}
     */

    request(method: string, params: IRequestConfig | string): ng.IPromise<any> {
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
            });
    }

    post(params: IRequestConfig | string) {
        return this.request('POST', params);
    }

    patch(params: IRequestConfig | string) {
        return this.request('PATCH', params);
    }

    get(params: IRequestConfig | string) {
        return this.request('GET', params);
    }

    put(params: IRequestConfig | string) {
        return this.request('PUT', params);
    }

    remove(params: IRequestConfig | string) {
        return this.request('DELETE', params);
    }
}

@Provider()
class RestServiceProvider implements ng.IServiceProvider {

    private config = {
        restURL: `${window.location.origin}/api`
    };

    /**
     * Configure.
     *
     * @param {object} params - An `object` of params to extend.
     */

    configure(params: Object) {
        if (!(params instanceof Object)) {
            throw new TypeError('Invalid argument: "config" must be an "Object".');
        }

        angular.extend(this.config, params);

        return this;
    }

    @Inject()
    $get(
        @Inject('$http') $http,
        @Inject('$window') $window,
        @Inject('$rootScope') $rootScope,
        @Inject('$log') $log): RestService {

        return new RestService($http, $window, $rootScope, $log, this.config);
    }
}

export default RestService;
export { RestServiceProvider, RestService };

