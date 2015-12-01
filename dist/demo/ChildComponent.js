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
var ChildService_1 = require('./ChildService');
var ChildComponent = (function () {
    function ChildComponent(service, log) {
        this.service = service;
        this.log = log;
        this.title = service.title;
        log.debug('CONSTRUCTOR: ChildComponent, injected service method response: ' + service.title);
    }
    ChildComponent.prototype.config = function (logProvider) {
        logProvider.debugEnabled(true);
    };
    ChildComponent.prototype.run = function (log, service) {
        log.debug('RUN: ChildComponent, injected service method response: ' + service.title);
    };
    Object.defineProperty(ChildComponent.prototype, "config",
        __decorate([
            __param(0, decorators_1.Inject('$logProvider')), 
            __metadata('design:type', Function), 
            __metadata('design:paramtypes', [Object]), 
            __metadata('design:returntype', void 0)
        ], ChildComponent.prototype, "config", Object.getOwnPropertyDescriptor(ChildComponent.prototype, "config")));
    Object.defineProperty(ChildComponent.prototype, "run",
        __decorate([
            __param(0, decorators_1.Inject('$log')), 
            __metadata('design:type', Function), 
            __metadata('design:paramtypes', [Object, ChildService_1.ChildService]), 
            __metadata('design:returntype', void 0)
        ], ChildComponent.prototype, "run", Object.getOwnPropertyDescriptor(ChildComponent.prototype, "run")));
    ChildComponent = __decorate([
        decorators_1.Component({
            selector: 'child-component',
            template: '<h1>{{ctrl.title}}</h1>'
        }),
        __param(1, decorators_1.Inject('$log')), 
        __metadata('design:paramtypes', [ChildService_1.ChildService, Object])
    ], ChildComponent);
    return ChildComponent;
})();
//# sourceMappingURL=ChildComponent.js.map