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
var ParentComponent = (function () {
    function ParentComponent() {
    }
    ParentComponent.prototype.config = function ($logProvider) {
        $logProvider.debugEnabled(true);
    };
    ParentComponent.prototype.run = function ($log, service) {
        $log.info(service.getT);
    };
    Object.defineProperty(ParentComponent.prototype, "config",
        __decorate([
            __param(0, decorators_1.Inject('$logProvider')), 
            __metadata('design:type', Function), 
            __metadata('design:paramtypes', [Object]), 
            __metadata('design:returntype', void 0)
        ], ParentComponent.prototype, "config", Object.getOwnPropertyDescriptor(ParentComponent.prototype, "config")));
    Object.defineProperty(ParentComponent.prototype, "run",
        __decorate([
            __param(0, decorators_1.Inject('$log')), 
            __metadata('design:type', Function), 
            __metadata('design:paramtypes', [Object, Object]), 
            __metadata('design:returntype', void 0)
        ], ParentComponent.prototype, "run", Object.getOwnPropertyDescriptor(ParentComponent.prototype, "run")));
    ParentComponent = __decorate([
        decorators_1.Component({
            selector: 'parent',
        }), 
        __metadata('design:paramtypes', [])
    ], ParentComponent);
    return ParentComponent;
})();
//# sourceMappingURL=ParentComponent.js.map