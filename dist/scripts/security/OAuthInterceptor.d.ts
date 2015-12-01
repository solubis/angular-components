/**
 * HTTP Interceptor for global OAuth handling
 */
import OAuthTokenService from './OAuthTokenService';
declare class OAuthHttpInterceptor {
    private $rootScope;
    private $q;
    private $oauthToken;
    request: (config: any) => any;
    responseError: (rejection: any) => ng.IPromise<any>;
    static factory($rootScope: ng.IRootScopeService, $q: ng.IQService, $oauthToken: OAuthTokenService): OAuthHttpInterceptor;
    constructor($rootScope: ng.IRootScopeService, $q: ng.IQService, $oauthToken: any);
}
export default OAuthHttpInterceptor;
