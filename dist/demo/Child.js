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
var Child = (function () {
    function Child() {
    }
    Child.prototype.config = function (logProvider) {
        logProvider.debugEnabled(true);
    };
    Child.prototype.run = function (log, service) {
        log.warn(service.title);
    };
    Object.defineProperty(Child.prototype, "config",
        __decorate([
            decorators_1.Inject('$logProvider'), 
            __metadata('design:type', Function), 
            __metadata('design:paramtypes', [Object]), 
            __metadata('design:returntype', void 0)
        ], Child.prototype, "config", Object.getOwnPropertyDescriptor(Child.prototype, "config")));
    Object.defineProperty(Child.prototype, "run",
        __decorate([
            decorators_1.Inject('$log', 'childService'), 
            __metadata('design:type', Function), 
            __metadata('design:paramtypes', [Object, ChildService]), 
            __metadata('design:returntype', void 0)
        ], Child.prototype, "run", Object.getOwnPropertyDescriptor(Child.prototype, "run")));
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
    ChildService = __decorate([
        decorators_1.Service({
            name: 'childService'
        }), 
        __metadata('design:paramtypes', [])
    ], ChildService);
    return ChildService;
})();
