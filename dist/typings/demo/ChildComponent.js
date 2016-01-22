var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var decorators_1 = require('../src/decorators');
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
    __decorate([
        __param(0, decorators_1.Inject('$logProvider')), 
        __metadata('design:type', Function), 
        __metadata('design:paramtypes', [Object]), 
        __metadata('design:returntype', void 0)
    ], ChildComponent.prototype, "config", null);
    __decorate([
        __param(0, decorators_1.Inject('$log')), 
        __metadata('design:type', Function), 
        __metadata('design:paramtypes', [Object, ChildService_1.ChildService]), 
        __metadata('design:returntype', void 0)
    ], ChildComponent.prototype, "run", null);
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