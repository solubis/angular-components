declare class OAuthTokenService {
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
}
declare class OAuthTokenServiceProvider implements ng.IServiceProvider {
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
