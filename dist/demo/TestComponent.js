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
require('./ChildComponent');
var TestComponent = (function () {
    function TestComponent(service, log) {
        this.service = service;
        this.log = log;
        this.title = service.title;
        log.debug('CONSTRUCTOR: TestComponent, injected service method response: ' + service.title);
    }
    TestComponent.prototype.run = function (service, log) {
        log.debug('RUN: TestComponent, injected service method response: ' + service.title);
    };
    TestComponent.prototype.config = function (logProvider) {
        logProvider.debugEnabled(true);
    };
    TestComponent.test = 'TEST VALUE';
    Object.defineProperty(TestComponent.prototype, "run",
        __decorate([
            __param(1, decorators_1.Inject('$log')), 
            __metadata('design:type', Function), 
            __metadata('design:paramtypes', [ParentService_1.ParentService, Object]), 
            __metadata('design:returntype', void 0)
        ], TestComponent.prototype, "run", Object.getOwnPropertyDescriptor(TestComponent.prototype, "run")));
    Object.defineProperty(TestComponent.prototype, "config",
        __decorate([
            __param(0, decorators_1.Inject('$logProvider')), 
            __metadata('design:type', Function), 
            __metadata('design:paramtypes', [Object]), 
            __metadata('design:returntype', void 0)
        ], TestComponent.prototype, "config", Object.getOwnPropertyDescriptor(TestComponent.prototype, "config")));
    __decorate([
        decorators_1.Value('testValue'), 
        __metadata('design:type', String)
    ], TestComponent, "test");
    TestComponent = __decorate([
        decorators_1.Component({
            selector: 'test-component',
            templateUrl: 'test.html'
        }),
        __param(1, decorators_1.Inject('$log')), 
        __metadata('design:paramtypes', [ParentService_1.ParentService, Object])
    ], TestComponent);
    return TestComponent;
})();
decorators_1.bootstrap(TestComponent);
//# sourceMappingURL=TestComponent.js.map