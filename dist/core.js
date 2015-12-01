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
function __export(m) {
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
/**
 * Module with services for error handler, local storage settings and small utils
 */
var decorators_1 = require('./decorators');
var Core = (function () {
    function Core() {
    }
    Core = __decorate([
        decorators_1.Component({
            name: 'coreModule'
        }), 
        __metadata('design:paramtypes', [])
    ], Core);
    return Core;
})();
exports.Core = Core;
__export(require('./core/ConfigService'));
__export(require('./core/HttpInterceptor'));
__export(require('./core/RestService'));
__export(require('./core/SettingsService'));
__export(require('./core/UtilsService'));
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = 'core';
//# sourceMappingURL=core.js.map