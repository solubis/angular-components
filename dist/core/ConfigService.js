var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var decorators_1 = require('../decorators');
var ConfigServiceProvider = (function () {
    function ConfigServiceProvider() {
        this.config = {};
        angular.extend(this.config, window.CONFIG);
    }
    /**
     * Configure.
     *
     * @param {object} params - An `object` of params to extend.
     */
    ConfigServiceProvider.prototype.configure = function (params) {
        if (!(params instanceof Object)) {
            throw new TypeError('Invalid argument: `config` must be an `Object`.');
        }
        angular.extend(this.config, params);
        return this;
    };
    ConfigServiceProvider.prototype.$get = function () {
        return this.config;
    };
    __decorate([
        decorators_1.Inject(), 
        __metadata('design:type', Function), 
        __metadata('design:paramtypes', []), 
        __metadata('design:returntype', void 0)
    ], ConfigServiceProvider.prototype, "$get", null);
    ConfigServiceProvider = __decorate([
        decorators_1.Provider(), 
        __metadata('design:paramtypes', [])
    ], ConfigServiceProvider);
    return ConfigServiceProvider;
})();
exports.ConfigServiceProvider = ConfigServiceProvider;
//# sourceMappingURL=ConfigService.js.map