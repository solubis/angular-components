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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var decorators_1 = require('../decorators');
var ParentService_1 = require('./ParentService');
var Application = (function () {
    function Application(
        //private service: ParentService,
        log) {
        this.log = log;
    }
    Application.prototype.run = function (service) {
        service.getName();
    };
    Object.defineProperty(Application.prototype, "run",
        __decorate([
            __param(0, decorators_1.Inject()), 
            __metadata('design:type', Function), 
            __metadata('design:paramtypes', [ParentService_1.ParentService]), 
            __metadata('design:returntype', void 0)
        ], Application.prototype, "run", Object.getOwnPropertyDescriptor(Application.prototype, "run")));
    Application = __decorate([
        decorators_1.Service(), 
        __metadata('design:paramtypes', [Object])
    ], Application);
    return Application;
})();
//# sourceMappingURL=test.js.map