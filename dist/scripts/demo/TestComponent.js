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
    __decorate([
        decorators_1.Inject('childService', '$log'), 
        __metadata('design:type', Function), 
        __metadata('design:paramtypes', [Object, Object]), 
        __metadata('design:returntype', void 0)
    ], TestComponent.prototype, "run", null);
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
//# sourceMappingURL=TestComponent.js.map