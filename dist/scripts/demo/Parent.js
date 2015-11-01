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
    __decorate([
        decorators_1.Inject('$logProvider'), 
        __metadata('design:type', Function), 
        __metadata('design:paramtypes', [Object]), 
        __metadata('design:returntype', void 0)
    ], Parent.prototype, "config", null);
    __decorate([
        decorators_1.Inject('$log', 'parentService'), 
        __metadata('design:type', Function), 
        __metadata('design:paramtypes', [Object, ParentService]), 
        __metadata('design:returntype', void 0)
    ], Parent.prototype, "run", null);
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
    ParentService.prototype.getName = function () {
        return this.title;
    };
    ParentService = __decorate([
        decorators_1.Service({
            name: 'parentService'
        }), 
        __metadata('design:paramtypes', [])
    ], ParentService);
    return ParentService;
})();
//# sourceMappingURL=Parent.js.map