declare class HttpInterceptor {
    private $rootScope;
    private $q;
    private $log;
    request: (config: any) => any;
    responseError: (rejection: any) => ng.IPromise<any>;
    static factory($rootScope: ng.IRootScopeService, $q: ng.IQService, $log: ng.ILogService): HttpInterceptor;
    constructor($rootScope: ng.IRootScopeService, $q: ng.IQService, $log: ng.ILogService);
}
export default HttpInterceptor;
export { HttpInterceptor };
