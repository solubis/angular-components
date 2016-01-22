declare module 'angular-components' {
	export interface IBasicDecoratorOptions {
	    name?: string;
	}
	export interface IComponentDecoratorOptions extends ng.IDirective {
	    selector?: string;
	    name?: string;
	    dependencies?: string[];
	}
	export interface IConstructorTarget extends Function {
	    name: string;
	    prototype: any;
	}
	export interface IPrototypeTarget extends Object {
	    name: string;
	} function Service(name?: string): ClassDecorator; function Provider(name?: string): ClassDecorator; function Filter(name: string): PropertyDecorator; function Value(name?: string): PropertyDecorator; function Directive(name: string): PropertyDecorator; function ActionHandler(name: string): PropertyDecorator; function StoreListener(): (target: Object, propertyKey: string | symbol) => void; function Component(options: IComponentDecoratorOptions): ClassDecorator; function Inject(name?: string): any; function bootstrap(component: Function): void;
	export { Component, Inject, Service, Provider, Filter, Directive, Value, ActionHandler, StoreListener, bootstrap };

}
declare module 'angular-components' {
	interface ConfigService {
	} class ConfigServiceProvider implements ng.IServiceProvider {
	    private config;
	    constructor();
	    /**
	     * Configure.
	     *
	     * @param {object} params - An `object` of params to extend.
	     */
	    configure(params: any): this;
	    $get(): {};
	}
	export { ConfigServiceProvider, ConfigService };

}
declare module 'angular-components' {
	 class HttpInterceptor {
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

}
declare module 'angular-components' {
	export interface IRequestConfig extends ng.IRequestConfig {
	    command: string;
	    mockup?: boolean;
	} class RestService {
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
	} class RestServiceProvider implements ng.IServiceProvider {
	    private config;
	    /**
	     * Configure.
	     *
	     * @param {object} params - An `object` of params to extend.
	     */
	    configure(params: Object): this;
	    $get($http: any, $window: any, $rootScope: any, $log: any): RestService;
	}
	export default RestService;
	export { RestServiceProvider, RestService };

}
declare module 'angular-components' {
	 class SettingsService {
	    private $window;
	    private config;
	    private settings;
	    constructor($window: any, config: any);
	    getSettings(): {
	        debug: boolean;
	        path: string;
	    };
	    saveSettings(): void;
	    get(name: any): any;
	    put(key: any, value?: any): void;
	    set(key: any, value?: any): void;
	    remove(key: any): void;
	} class SettingsServiceProvider implements ng.IServiceProvider {
	    private config;
	    /**
	     * Configure.
	     *
	     * @param {object} params - An `object` of params to extend.
	     */
	    configure(params: any): this;
	    $get($window: any): SettingsService;
	}
	export default SettingsService;
	export { SettingsServiceProvider, SettingsService };

}
declare module 'angular-components' {
	 class UtilsService {
	    private $filter;
	    private $dateFormat;
	    constructor($filter: any, $dateFormat: any);
	    formChanges(form: any, model: any): {};
	    isReadyToSave(form: any, exclusions: any): boolean;
	    isEmpty(obj: any): boolean;
	    arrayFilter(array: any, expression: any, flag?: boolean): any[];
	    arraySearch(array: any, expression: any, flag?: boolean): any;
	    formatDate(date: any): string;
	}
	export default UtilsService;

}
declare module 'angular-components' {
	export * from 'core/ConfigService';
	export * from 'core/HttpInterceptor';
	export * from 'core/RestService';
	export * from 'core/SettingsService';
	export * from 'core/UtilsService';

}
declare module 'angular-components' {
	export * from 'core';
	export * from 'decorators';

}
declare module 'angular-componentsice' {
	 class QueryStringService {
	    constructor();
	    extract(maybeUrl: any): any;
	    parse(str: any): any;
	    stringify(obj: any): string;
	}
	export default QueryStringService;

}
declare module 'angular-componentsce' {
	 class OAuthTokenService {
	    private $location;
	    private $window;
	    private $settings;
	    private config;
	    constructor($location: any, $window: any, $settings: any, config: any);
	    /**
	     * Set token.
	     *
	     *  @params {object} - Access token
	     */
	    setToken(data: any): void;
	    /**
	     * Get token.
	     *
	     *  @returns {object} - Access token
	     */
	    getToken(): any;
	    /**
	     * Get accessToken.
	     *
	     * @returns {string} - Access token
	     */
	    getAccessToken(): any;
	    /**
	     * Get authorization Header.
	     *
	     * @returns {string} - 'Authorization' Header e.g 'Bearer XXX'
	     */
	    getAuthorizationHeader(): string;
	    /**
	     * Get refresh Token.
	     *
	     * @returns {string} - 'Refresh token
	     */
	    getRefreshToken(): any;
	    /**
	     * Get tokenType.
	     *
	     * @returns {string} - Token type e.g. 'bearer', 'refresh'
	     */
	    getTokenType(): any;
	    restoreTokenFromURL(): void;
	    verifyTokenSignature(token: any): boolean;
	    urlBase64Decode(str: any): any;
	    decodeToken(token: any): any;
	    getTokenExpirationDate(token: any): Date;
	    isTokenExpired(token: any, offsetSeconds: any): boolean;
	    /**
	     * Remove token.
	     */
	    removeToken(): void;
	    setContent(tokenContent: any): void;
	    getContent(): any;
	    getUserLogin(): string;
	    getUserFullName(): any;
	    getPermissions(): any[];
	} class OAuthTokenServiceProvider implements ng.IServiceProvider {
	    private config;
	    /**
	     * Configure.
	     *
	     * @param {object} params - An `object` of params to extend.
	     */
	    configure(params: any): this;
	    $get($location: any, $window: any, $settings: any): OAuthTokenService;
	}
	export default OAuthTokenService;
	export { OAuthTokenServiceProvider, OAuthTokenService };

}
declare module 'angular-components' {
	import QueryStringService from 'QueryStringService';
	import OAuthTokenService from 'OAuthTokenService';
	export enum PermissionCheckType {
	    One = 0,
	    All = 1,
	}
	export enum AccessStatus {
	    NotAuthorised = 0,
	    Authorised = 1,
	    LoginRequired = 2,
	}
	export class SecurityService {
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
	export class SecurityServiceProvider implements ng.IServiceProvider {
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

}
declare module 'angular-componentsr' {
	/**
	 * HTTP Interceptor for global OAuth handling
	 */
	import OAuthTokenService from 'OAuthTokenService'; class OAuthHttpInterceptor {
	    private $rootScope;
	    private $q;
	    private $oauthToken;
	    request: (config: any) => any;
	    responseError: (rejection: any) => ng.IPromise<any>;
	    static factory($rootScope: ng.IRootScopeService, $q: ng.IQService, $oauthToken: OAuthTokenService): OAuthHttpInterceptor;
	    constructor($rootScope: ng.IRootScopeService, $q: ng.IQService, $oauthToken: any);
	}
	export default OAuthHttpInterceptor;

}
declare module 'angular-componentsive' {
	import { SecurityService } from 'SecurityService'; function AuthorizeDirective($security: SecurityService): ng.IDirective;
	export default AuthorizeDirective;

}
declare module 'angular-components' {
	import * as angular from 'angular'; let module: angular.IModule;
	export default module;

}
