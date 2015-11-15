export interface IRequestConfig extends ng.IRequestConfig {
    command: string;
    mockup?: boolean;
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
    private version;
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
    putHeader(name: string, value: string): void;
    /**
     * Executes HTTP request
     *
     * @param method - HTTP method e.g. PUT, POST etc.
     * @param params - config {command: 'REST server endpoint command', params, data} or command: string
     * @returns {promise}
     */
    request(method: string, params: IRequestConfig | string): ng.IPromise<any>;
    post(params: IRequestConfig | string): ng.IPromise<any>;
    patch(params: IRequestConfig | string): ng.IPromise<any>;
    get(params: IRequestConfig | string): ng.IPromise<any>;
    put(params: IRequestConfig | string): ng.IPromise<any>;
    remove(params: IRequestConfig | string): ng.IPromise<any>;
}
declare class RestServiceProvider implements ng.IServiceProvider {
    private config;
    /**
     * Configure.
     *
     * @param {object} params - An `object` of params to extend.
     */
    configure(params: Object): RestServiceProvider;
    $get($http: any, $window: any, $rootScope: any, $log: any): RestService;
}
export default RestService;
export { RestServiceProvider, RestService };
