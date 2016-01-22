/*@ngInject*/
var QueryStringService = (function () {
    function QueryStringService() {
    }
    QueryStringService.prototype.extract = function (maybeUrl) {
        return maybeUrl.split('?')[1] || '';
    };
    QueryStringService.prototype.parse = function (str) {
        if (typeof str !== 'string') {
            return {};
        }
        str = str.trim().replace(/^(\?|#|&)/, '');
        if (!str) {
            return {};
        }
        return str.split('&').reduce(function (ret, param) {
            var parts = param.replace(/\+/g, ' ').split('=');
            var key = parts[0];
            var val = parts[1];
            key = decodeURIComponent(key);
            val = val === undefined ? null : decodeURIComponent(val);
            if (!ret.hasOwnProperty(key)) {
                ret[key] = val;
            }
            else if (Array.isArray(ret[key])) {
                ret[key].push(val);
            }
            else {
                ret[key] = [ret[key], val];
            }
            return ret;
        }, {});
    };
    QueryStringService.prototype.stringify = function (obj) {
        return obj ? Object.keys(obj).sort().map(function (key) {
            var val = obj[key];
            if (Array.isArray(val)) {
                return val.sort().map(function (val2) {
                    return encodeURIComponent(key) + '=' + encodeURIComponent(val2);
                }).join('&');
            }
            return encodeURIComponent(key) + '=' + encodeURIComponent(val);
        }).join('&') : '';
    };
    return QueryStringService;
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = QueryStringService;
//# sourceMappingURL=QueryStringService.js.map