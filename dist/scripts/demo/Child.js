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
var Child = (function () {
    function Child() {
    }
    Child.prototype.config = function (logProvider) {
        logProvider.debugEnabled(true);
    };
    Child.prototype.run = function (log, service) {
        log.warn(service.title);
    };
    __decorate([
        decorators_1.Inject('$logProvider'), 
        __metadata('design:type', Function), 
        __metadata('design:paramtypes', [Object]), 
        __metadata('design:returntype', void 0)
    ], Child.prototype, "config", null);
    __decorate([
        decorators_1.Inject('$log', 'childService'), 
        __metadata('design:type', Function), 
        __metadata('design:paramtypes', [Object, ChildService]), 
        __metadata('design:returntype', void 0)
    ], Child.prototype, "run", null);
    Child = __decorate([
        decorators_1.Component({
            selector: 'child'
        }), 
        __metadata('design:paramtypes', [])
    ], Child);
    return Child;
})();
var ChildService = (function () {
    function ChildService() {
        this.title = 'childService';
    }
    ChildService.prototype.getName = function () {
        return this.title;
    };
    ChildService = __decorate([
        decorators_1.Service({
            name: 'childService'
        }), 
        __metadata('design:paramtypes', [])
    ], ChildService);
    return ChildService;
})();
//# sourceMappingURL=Child.js.map