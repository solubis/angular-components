/// <reference path="../../typings/tsd.d.ts" />
var moment = require('moment');
var DATE_FORMAT = 'DD.MM.YYYY HH:mm:ss';
/**
 * Small utils
 */
/*@ngInject*/
var UtilsService = (function () {
    function UtilsService($filter, $dateFormat) {
        if ($filter === void 0) { $filter = undefined; }
        if ($dateFormat === void 0) { $dateFormat = DATE_FORMAT; }
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
    return UtilsService;
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = UtilsService;
