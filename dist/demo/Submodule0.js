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
var SubModule0 = (function () {
    function SubModule0() {
    }
    SubModule0.prototype.config = function (logProvider) {
        logProvider.debugEnabled(true);
    };
    SubModule0.prototype.run = function (log, service) {
        log.info('INFO: RUN SUBMODULE0');
        log.warn(service.title);
    };
    Object.defineProperty(SubModule0.prototype, "config",
        __decorate([
            decorators_1.Inject('$logProvider'), 
            __metadata('design:type', Function), 
            __metadata('design:paramtypes', [Object]), 
            __metadata('design:returntype', void 0)
        ], SubModule0.prototype, "config", Object.getOwnPropertyDescriptor(SubModule0.prototype, "config")));
    Object.defineProperty(SubModule0.prototype, "run",
        __decorate([
            decorators_1.Inject('$log', 'myServiceFromSubmodule0'), 
            __metadata('design:type', Function), 
            __metadata('design:paramtypes', [Object, TestServiceFromSubmodule]), 
            __metadata('design:returntype', void 0)
        ], SubModule0.prototype, "run", Object.getOwnPropertyDescriptor(SubModule0.prototype, "run")));
    SubModule0 = __decorate([
        decorators_1.Component({
            selector: 'submodule0'
        }), 
        __metadata('design:paramtypes', [])
    ], SubModule0);
    return SubModule0;
})();
var TestServiceFromSubmodule = (function () {
    function TestServiceFromSubmodule() {
        this.title = 'TITLE FROM SUBMODULE-0';
    }
    TestServiceFromSubmodule = __decorate([
        decorators_1.Service({
            name: 'myServiceFromSubmodule0'
        }), 
        __metadata('design:paramtypes', [])
    ], TestServiceFromSubmodule);
    return TestServiceFromSubmodule;
})();
