import QueryStringService from './QueryStringService';
import OAuthTokenService from './OAuthTokenService';
export declare enum PermissionCheckType {
    One = 0,
    All = 1,
}
export declare enum AccessStatus {
    NotAuthorised = 0,
    Authorised = 1,
    LoginRequired = 2,
}
export declare class SecurityService {
    private $http;
    private $window;
    private $location;
    private $timeout;
    private $queryString;
    private $oauthToken;
    private Organisation;
    private config;
    private userPermissions;
    private headers;
    private url;
    constructor($http: ng.IHttpService, $window: ng.IWindowService, $location: ng.ILocationService, $timeout: ng.ITimeoutService, $queryString: QueryStringService, $oauthToken: OAuthTokenService, Organisation: any, config: any);
    /**
     * Returns Organisation structure
     * @returns {promise}
     */
    getOrganisation(): ng.IPromise<any>;
    /**
     * Verifies if the `user` is authenticated or not based on the `token`
     * cookie.
     *
     * @return {boolean}
     */
    isAuthenticated(): boolean;
    /**
     * Redirect to application page
     */
    redirectToApplication(token: any): void;
    /**
     * Redirect to login page
     */
    redirectToLogin(time?: number): void;
    /**
     * Retrieves the `access_token`, decodes it and stores all data in local storage
     *
     * @param {string} username
     * @param {string} password
     *
     * @return {promise} A response promise.
     */
    login(username: any, password: any): any;
    /**
     * Retrieves the profile object (authorities, user_name)
     *
     * @return {promise} A response promise.
     */
    decodeTokenContent(token: any): ng.IPromise<{}>;
    /**
     * Removes token and redirects to Login Page
     */
    logout(): void;
    /**
     * Retrieves the `refresh_token` and stores the `response.data` on local storage
     * using the `OAuthToken`.
     *
     * @return {promise} A response promise.
     */
    getRefreshToken(): ng.IPromise<ng.IHttpPromiseCallbackArg<{}>>;
    /**
     * Revokes the `token` and removes the stored `token` from cookies
     * using the `OAuthToken`.
     *
     * @return {promise} A response promise.
     */
    revokeToken(): ng.IPromise<ng.IHttpPromiseCallbackArg<{}>>;
    /**
     * Returns array of current user permissions
     *
     * @returns {string[]}
     */
    getPermissions(): string[];
    getUserPermissions(): any[];
    /**
     * Returns user name
     *
     * @returns {string}
     */
    getUserLogin(): string;
    /**
     * Returns user name
     *
     * @returns {string}
     */
    getUserFullName(): string;
    /**
     * Return Access Token
     */
    getAccessToken(): string;
    /**
     * State handling for UI router
     *
     * @param event
     * @param toState
     * @param loginRequiredCallback
     * @param notAuthorisedCallback
     */
    stateChangeStart(event: any, toState: any, loginRequiredCallback: any, notAuthorisedCallback: any): void;
    /**
     * Method for checking user permissions
     *
     * @param {string, string[]} requiredPermissions
     * @param {boolean} isLoginRequired
     * @param {PermissionCheckType} permissionCheckType - all permissions (All) or one of them (One)
     * @returns {AccessStatus}
     */
    authorize(requiredPermissions: any, isLoginRequired?: boolean, permissionCheckType?: PermissionCheckType): AccessStatus;
    /**
     * Check if passed user is current user
     */
    owner(userName: any): boolean;
}
export declare class SecurityServiceProvider implements ng.IServiceProvider {
    private config;
    /**
     * Configure.
     *
     * @param {object} params - An `object` of params to extend.
     */
    configure(params: any): this;
    $get($http: any, $window: any, $location: any, $timeout: any, $queryString: any, $oauthToken: any, Organisation: any): SecurityService;
}
export default SecurityService;
