/// <reference path="../../typings/tsd.d.ts" />
declare class OAuthHttpInterceptor {
    private $rootScope;
    private $q;
    private $oauthToken;
    static factory($rootScope: ng.IRootScopeService, $q: ng.IQService, $oauthToken: any): OAuthHttpInterceptor;
    constructor($rootScope: ng.IRootScopeService, $q: ng.IQService, $oauthToken: any);
    request: (config: any) => any;
    responseError: (rejection: any) => ng.IPromise<any>;
}
export default OAuthHttpInterceptor;
