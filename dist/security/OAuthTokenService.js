/*@ngInject*/
var OAuthTokenService = (function () {
    function OAuthTokenService($location, $window, $settings, config) {
        this.$location = $location;
        this.$window = $window;
        this.$settings = $settings;
        this.config = config;
    }
    /**
     * Set token.
     *
     *  @params {object} - Access token
     */
    OAuthTokenService.prototype.setToken = function (data) {
        this.$settings.set(this.config.name, data);
    };
    /**
     * Get token.
     *
     *  @returns {object} - Access token
     */
    OAuthTokenService.prototype.getToken = function () {
        this.restoreTokenFromURL();
        return this.$settings.get(this.config.name);
    };
    /**
     * Get accessToken.
     *
     * @returns {string} - Access token
     */
    OAuthTokenService.prototype.getAccessToken = function () {
        return this.getToken() ? this.getToken().access_token : undefined;
    };
    /**
     * Get authorization Header.
     *
     * @returns {string} - 'Authorization' Header e.g 'Bearer XXX'
     */
    OAuthTokenService.prototype.getAuthorizationHeader = function () {
        if (!(this.getTokenType() && this.getAccessToken())) {
            return;
        }
        return this.getTokenType().charAt(0).toUpperCase() + this.getTokenType().substr(1) + ' ' + this.getAccessToken();
    };
    /**
     * Get refresh Token.
     *
     * @returns {string} - 'Refresh token
     */
    OAuthTokenService.prototype.getRefreshToken = function () {
        return this.getToken() ? this.getToken().refresh_token : undefined;
    };
    /**
     * Get tokenType.
     *
     * @returns {string} - Token type e.g. 'bearer', 'refresh'
     */
    OAuthTokenService.prototype.getTokenType = function () {
        return this.getToken() ? this.getToken().token_type : undefined;
    };
    OAuthTokenService.prototype.restoreTokenFromURL = function () {
        var accessToken;
        var content;
        accessToken = this.$location.search()['token'];
        if (accessToken && this.verifyTokenSignature(accessToken)) {
            this.$location.search('token', null);
            content = this.decodeToken(accessToken);
            this.setToken({
                access_token: accessToken,
                token_type: 'bearer',
                content: content
            });
        }
    };
    OAuthTokenService.prototype.verifyTokenSignature = function (token) {
        var result = false;
        var publicKey = this.config.publicKey;
        try {
            result = KJUR.jws.JWS.verify(token, publicKey, ["RS256"]);
        }
        catch (ex) {
            console.error("OAuth Token Service Error: " + ex);
            result = false;
        }
        if (result == true) {
            console.log('Token Signature Valid');
        }
        else {
            console.log('Token Signature Not Valid');
        }
        return result;
    };
    OAuthTokenService.prototype.urlBase64Decode = function (str) {
        var output = str.replace(/-/g, '+').replace(/_/g, '/');
        switch (output.length % 4) {
            case 0:
                {
                    break;
                }
            case 2:
                {
                    output += '==';
                    break;
                }
            case 3:
                {
                    output += '=';
                    break;
                }
            default:
                {
                    throw 'Illegal base64url string!';
                }
        }
        return this.$window.decodeURIComponent(this.$window.encodeURIComponent(this.$window.atob(output)));
    };
    OAuthTokenService.prototype.decodeToken = function (token) {
        var parts = token.split('.');
        if (parts.length !== 3) {
            throw new Error('JWT must have 3 parts');
        }
        var decoded = this.urlBase64Decode(parts[1]);
        if (!decoded) {
            throw new Error('Cannot decode the token');
        }
        return JSON.parse(decoded);
    };
    OAuthTokenService.prototype.getTokenExpirationDate = function (token) {
        var decoded;
        decoded = this.decodeToken(token);
        if (typeof decoded.exp === "undefined") {
            return null;
        }
        var d = new Date(0); // The 0 here is the key, which sets the date to the epoch
        d.setUTCSeconds(decoded.exp);
        return d;
    };
    OAuthTokenService.prototype.isTokenExpired = function (token, offsetSeconds) {
        var d = this.getTokenExpirationDate(token);
        offsetSeconds = offsetSeconds || 0;
        if (d === null) {
            return false;
        }
        return !(d.valueOf() > (new Date().valueOf() + (offsetSeconds * 1000)));
    };
    /**
     * Remove token.
     */
    OAuthTokenService.prototype.removeToken = function () {
        this.$settings.set(this.config.name);
    };
    OAuthTokenService.prototype.setContent = function (tokenContent) {
        this.$settings.set(this.config.name);
    };
    OAuthTokenService.prototype.getContent = function () {
        var token = this.getToken();
        return token && token.content ? token.content : undefined;
    };
    OAuthTokenService.prototype.getUserLogin = function () {
        var content = this.getContent();
        return content && content.user_name ? content.user_name : undefined;
    };
    OAuthTokenService.prototype.getUserFullName = function () {
        var content = this.getContent();
        return content && content.full_name ? content.full_name : undefined;
    };
    OAuthTokenService.prototype.getPermissions = function () {
        var content = this.getContent();
        return content && content.authorities ? content.authorities : undefined;
    };
    return OAuthTokenService;
})();
exports.OAuthTokenService = OAuthTokenService;
var OAuthTokenServiceProvider = (function () {
    function OAuthTokenServiceProvider() {
        this.config = {
            name: 'token'
        };
    }
    /**
     * Configure.
     *
     * @param {object} params - An `object` of params to extend.
     */
    OAuthTokenServiceProvider.prototype.configure = function (params) {
        if (!(params instanceof Object)) {
            throw new TypeError('Invalid argument: `config` must be an `Object`.');
        }
        angular.extend(this.config, params);
        return this;
    };
    /*@ngInject*/
    OAuthTokenServiceProvider.prototype.$get = function ($location, $window, $settings) {
        return new OAuthTokenService($location, $window, $settings, this.config);
    };
    return OAuthTokenServiceProvider;
})();
exports.OAuthTokenServiceProvider = OAuthTokenServiceProvider;
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = OAuthTokenService;
