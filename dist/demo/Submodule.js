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
require('./Submodule0');
var SubModule = (function () {
    function SubModule() {
    }
    SubModule.prototype.config = function ($logProvider) {
        $logProvider.debugEnabled(true);
    };
    SubModule.prototype.run = function ($log, service) {
        $log.debug('DEBUG: RUN SUBMODULE');
        $log.info(service.title);
    };
    Object.defineProperty(SubModule.prototype, "run",
        __decorate([
            decorators_1.Inject('$log', 'myServiceFromSubmodule'), 
            __metadata('design:type', Function), 
            __metadata('design:paramtypes', [Object, TestServiceFromSubmodule]), 
            __metadata('design:returntype', void 0)
        ], SubModule.prototype, "run", Object.getOwnPropertyDescriptor(SubModule.prototype, "run")));
    SubModule = __decorate([
        decorators_1.Component({
            selector: 'submodule',
            dependencies: ['submodule0']
        }), 
        __metadata('design:paramtypes', [])
    ], SubModule);
    return SubModule;
})();
var TestServiceFromSubmodule = (function () {
    function TestServiceFromSubmodule() {
        this.title = 'SERVICE FROM SUBMODULE';
    }
    TestServiceFromSubmodule = __decorate([
        decorators_1.Service({
            name: 'myServiceFromSubmodule'
        }), 
        __metadata('design:paramtypes', [])
    ], TestServiceFromSubmodule);
    return TestServiceFromSubmodule;
})();
