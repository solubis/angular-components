var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") return Reflect.decorate(decorators, target, key, desc);
    switch (arguments.length) {
        case 2: return decorators.reduceRight(function(o, d) { return (d && d(o)) || o; }, target);
        case 3: return decorators.reduceRight(function(o, d) { return (d && d(target, key)), void 0; }, void 0);
        case 4: return decorators.reduceRight(function(o, d) { return (d && d(target, key, o)) || o; }, desc);
    }
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
    Object.defineProperty(ConfigServiceProvider.prototype, "$get",
        __decorate([
            decorators_1.Inject(), 
            __metadata('design:type', Function), 
            __metadata('design:paramtypes', []), 
            __metadata('design:returntype', void 0)
        ], ConfigServiceProvider.prototype, "$get", Object.getOwnPropertyDescriptor(ConfigServiceProvider.prototype, "$get")));
    ConfigServiceProvider = __decorate([
        decorators_1.Provider(), 
        __metadata('design:paramtypes', [])
    ], ConfigServiceProvider);
    return ConfigServiceProvider;
})();
exports.ConfigServiceProvider = ConfigServiceProvider;
//# sourceMappingURL=ConfigService.js.map