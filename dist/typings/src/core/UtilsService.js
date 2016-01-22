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
var moment = require('moment');
/**
 * Small utils
 */
var UtilsService = (function () {
    function UtilsService($filter, $dateFormat) {
        this.$filter = $filter;
        this.$dateFormat = $dateFormat;
    }
    /*
     Get form fields that changed, are part of model and convert them to form acceptable by server
     */
    UtilsService.prototype.formChanges = function (form, model) {
        var changes = {};
        if (!model) {
            return changes;
        }
        angular.forEach(form, function (value, key) {
            if (key[0] !== '$' && !value.$pristine) {
                if (model[key] !== undefined) {
                    changes[key] = model[key];
                }
            }
        });
        return changes;
    };
    /*
     Manually check $dirty and $valid
     when fields in sub-forms shouldn't be validated
     */
    UtilsService.prototype.isReadyToSave = function (form, exclusions) {
        var valid = true;
        var dirty = false;
        exclusions = exclusions || [];
        angular.forEach(form, function (value, key) {
            if (key[0] !== '$' && exclusions.indexOf(key) < 0) {
                if (value.$dirty) {
                    dirty = true;
                }
                valid = valid && value.$valid;
            }
        });
        return dirty && valid;
    };
    /*
     Check if object has any own properties
     */
    UtilsService.prototype.isEmpty = function (obj) {
        if (obj == null) {
            return true;
        }
        if (obj.length > 0) {
            return false;
        }
        if (obj.length === 0) {
            return true;
        }
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
                return false;
            }
            ;
        }
        return true;
    };
    /*
     Search in Array for first element (quicker than Array.prototype.filter)
     */
    UtilsService.prototype.arrayFilter = function (array, expression, flag) {
        if (flag === void 0) { flag = true; }
        var resultArray = [];
        if (this.$filter) {
            resultArray = this.$filter('filter')(array, expression, flag);
        }
        return resultArray;
    };
    UtilsService.prototype.arraySearch = function (array, expression, flag) {
        if (flag === void 0) { flag = true; }
        var result;
        if (this.$filter) {
            result = this.$filter('filter')(array, expression, flag)[0];
        }
        return result;
    };
    UtilsService.prototype.formatDate = function (date) {
        return date ? moment(date).format(this.$dateFormat) : '';
    };
    UtilsService = __decorate([
        decorators_1.Service(),
        __param(0, decorators_1.Inject('$filter')),
        __param(1, decorators_1.Inject('$dateFormat')), 
        __metadata('design:paramtypes', [Object, Object])
    ], UtilsService);
    return UtilsService;
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = UtilsService;
//# sourceMappingURL=UtilsService.js.map