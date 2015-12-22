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
var decorators_1 = require('../decorators');
var NgLogService = (function () {
    function NgLogService($log) {
        this.$log = $log;
        this.debug = this.$log.debug.bind(this.$log);
        this.error = this.$log.error.bind(this.$log);
        this.info = this.$log.info.bind(this.$log);
        this.warn = this.$log.warn.bind(this.$log);
        this.log = this.$log.log.bind(this.$log);
    }
    NgLogService = __decorate([
        decorators_1.Service(),
        __param(0, decorators_1.Inject('$log')), 
        __metadata('design:paramtypes', [Object])
    ], NgLogService);
    return NgLogService;
})();
exports.NgLogService = NgLogService;
var NgHttpService = (function () {
    function NgHttpService($http) {
        this.$http = $http;
        this.get = this.$http.get.bind(this.$http);
        this.delete = this.$http.delete.bind(this.$http);
        this.put = this.$http.put.bind(this.$http);
        this.post = this.$http.post.bind(this.$http);
        this.head = this.$http.head.bind(this.$http);
        this.jsonp = this.$http.jsonp.bind(this.$http);
        this.patch = this.$http.patch.bind(this.$http);
        this.defaults = this.$http.defaults;
        this.pendingRequests = this.$http.pendingRequests;
    }
    NgHttpService = __decorate([
        decorators_1.Service(),
        __param(0, decorators_1.Inject('$http')), 
        __metadata('design:paramtypes', [Function])
    ], NgHttpService);
    return NgHttpService;
})();
exports.NgHttpService = NgHttpService;
//# sourceMappingURL=AngularServices.js.map