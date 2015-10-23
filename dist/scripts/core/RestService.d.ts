/**
 * REST communication and error handling
 */
declare class RestService {
    private $http;
    private $q;
    private $window;
    private $rootScope;
    private $log;
    private config;
    url: any;
    private headers;
    private isOffline;
    private isMockupEnabled;
    constructor($http: any, $q: any, $window: any, $rootScope: any, $log: any, config: any);
    init(): any;
    /**
     * Mockup response - return JSON file from 'data' folder instead server request
     *
     * @param {object} config
     * @returns {promise} - Request promise
     */
    mockupResponse(config: any): any;
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
    request(method: any, config: any): any;
    post(params: any): any;
    patch(params: any): any;
    get(params: any): any;
    put(params: any): any;
    remove(params: any): any;
}
declare class RestServiceProvider implements ng.IServiceProvider {
    private config;
    /**
     * Configure.
     *
     * @param {object} params - An `object` of params to extend.
     */
    configure(params: any): RestServiceProvider;
    $get($http: any, $q: any, $window: any, $rootScope: any, $log: any): RestService;
}
export default RestService;
export { RestServiceProvider, RestService };
