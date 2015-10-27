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
require('./Parent');
var TestComponent = (function () {
    function TestComponent(service, http, log) {
        this.service = service;
        this.http = http;
        this.log = log;
        this.title = service.title;
    }
    TestComponent.prototype.run = function (service, log) {
        log.debug('TestComponent with ' + service.title);
    };
    Object.defineProperty(TestComponent.prototype, "run",
        __decorate([
            decorators_1.Inject('childService', '$log'), 
            __metadata('design:type', Function), 
            __metadata('design:paramtypes', [Object, Object]), 
            __metadata('design:returntype', void 0)
        ], TestComponent.prototype, "run", Object.getOwnPropertyDescriptor(TestComponent.prototype, "run")));
    TestComponent = __decorate([
        decorators_1.Component({
            selector: 'test-component',
            templateUrl: 'test.html',
            dependencies: ['parent']
        }),
        decorators_1.Inject('childService', '$http', '$log'), 
        __metadata('design:paramtypes', [TestService, Function, Object])
    ], TestComponent);
    return TestComponent;
})();
var TestService = (function () {
    function TestService() {
        this.title = 'myService';
    }
    TestService.prototype.getName = function () {
        return this.title;
    };
    TestService = __decorate([
        decorators_1.Service({
            name: 'myService'
        }), 
        __metadata('design:paramtypes', [])
    ], TestService);
    return TestService;
})();
decorators_1.bootstrap(TestComponent);
