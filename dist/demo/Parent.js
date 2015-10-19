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
require('./Child');
var Parent = (function () {
    function Parent() {
    }
    Parent.prototype.config = function ($logProvider) {
        $logProvider.debugEnabled(true);
    };
    Parent.prototype.run = function ($log, service) {
        $log.info(service.title);
    };
    Object.defineProperty(Parent.prototype, "config",
        __decorate([
            decorators_1.Inject('$logProvider'), 
            __metadata('design:type', Function), 
            __metadata('design:paramtypes', [Object]), 
            __metadata('design:returntype', void 0)
        ], Parent.prototype, "config", Object.getOwnPropertyDescriptor(Parent.prototype, "config")));
    Object.defineProperty(Parent.prototype, "run",
        __decorate([
            decorators_1.Inject('$log', 'parentService'), 
            __metadata('design:type', Function), 
            __metadata('design:paramtypes', [Object, ParentService]), 
            __metadata('design:returntype', void 0)
        ], Parent.prototype, "run", Object.getOwnPropertyDescriptor(Parent.prototype, "run")));
    Parent = __decorate([
        decorators_1.Component({
            selector: 'parent',
            dependencies: ['child']
        }), 
        __metadata('design:paramtypes', [])
    ], Parent);
    return Parent;
})();
var ParentService = (function () {
    function ParentService() {
        this.title = 'parentService';
    }
    ParentService = __decorate([
        decorators_1.Service({
            name: 'parentService'
        }), 
        __metadata('design:paramtypes', [])
    ], ParentService);
    return ParentService;
})();
