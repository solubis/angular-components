export interface IRequestConfig extends ng.IRequestConfig {
    command: string;
    mockup?: boolean;
    headers?: any;
}
declare class RestService {
    private $http;
    private $window;
    private $rootScope;
    private $log;
    private config;
    url: any;
    private headers;
    private isOffline;
    private isMockupEnabled;
    constructor($http: ng.IHttpService, $window: ng.IWindowService, $rootScope: ng.IRootScopeService, $log: ng.ILogService, config: any);
    init(): ng.IPromise<void>;
    /**
     * Mockup response - return JSON file from 'data' folder instead server request
     *
     * @param {object} config
     * @returns {promise} - Request promise
     */
    mockupResponse(config: IRequestConfig): ng.IPromise<any>;
    /**
     * Adds request header
     *
     * @param name
     * @param value
     */
    putHeader(name: any, value: any): void;
    /**
     * Executes HTTP request
     *
     * @param method - HTTP method e.g. PUT, POST etc.
     * @param config - config {command: 'REST server endpoint command', params, data}
     * @returns {promise}
     */
    request(method: string, params: string | IRequestConfig): ng.IPromise<any>;
    post(params: any): ng.IPromise<any>;
    patch(params: any): ng.IPromise<any>;
    get(params: any): ng.IPromise<any>;
    put(params: any): ng.IPromise<any>;
    remove(params: any): ng.IPromise<any>;
}
declare class RestServiceProvider implements ng.IServiceProvider {
    private config;
    /**
     * Configure.
     *
     * @param {object} params - An `object` of params to extend.
     */
    configure(params: any): this;
    $get($http: any, $window: any, $rootScope: any, $log: any): RestService;
}
export default RestService;
export { RestServiceProvider, RestService };
