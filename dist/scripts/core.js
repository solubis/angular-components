var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
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
var HttpInterceptor_1 = require('./core/HttpInterceptor');
var Core = (function () {
    function Core() {
    }
    Core.prototype.config = function ($httpProvider) {
        $httpProvider.interceptors.push(HttpInterceptor_1.HttpInterceptor.factory);
    };
    __decorate([
        decorators_1.Inject('$httpProvider'), 
        __metadata('design:type', Function), 
        __metadata('design:paramtypes', [Object]), 
        __metadata('design:returntype', void 0)
    ], Core.prototype, "config", null);
    Core = __decorate([
        decorators_1.Component({
            name: 'coreModule',
            dependencies: []
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