declare class NgLogService implements ng.ILogService {
    private $log;
    constructor($log: ng.ILogService);
    debug: any;
    error: any;
    info: any;
    warn: any;
    log: any;
}
declare class NgHttpService implements ng.IHttpService {
    private $http;
    constructor($http: ng.IHttpService);
    get: any;
    delete: any;
    put: any;
    post: any;
    head: any;
    jsonp: any;
    patch: any;
    defaults: ng.IHttpProviderDefaults;
    pendingRequests: ng.IRequestConfig[];
}
export { NgLogService, NgHttpService };
