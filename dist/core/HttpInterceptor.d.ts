declare class HttpInterceptor {
    private $rootScope;
    private $q;
    private $log;
    static factory($rootScope: ng.IRootScopeService, $q: ng.IQService, $log: ng.ILogService): HttpInterceptor;
    constructor($rootScope: ng.IRootScopeService, $q: ng.IQService, $log: ng.ILogService);
    request: (config: any) => any;
    responseError: (rejection: any) => ng.IPromise<any>;
}
export default HttpInterceptor;
