/// <reference path="../../typings/tsd.d.ts" />

/*@ngInject*/
class QueryStringService {

    constructor() {}

    extract(maybeUrl) {
        return maybeUrl.split('?')[1] || '';
    }

    parse(str) {
        if (typeof str !== 'string') {
            return {};
        }

        str = str.trim().replace(/^(\?|#|&)/, '');

        if (!str) {
            return {};
        }

        return str.split('&').reduce((ret, param) => {
            let parts = param.replace(/\+/g, ' ').split('=');
            let key = parts[0];
            let val = parts[1];

            key = decodeURIComponent(key);
            val = val === undefined ? null : decodeURIComponent(val);

            if (!ret.hasOwnProperty(key)) {
                ret[key] = val;
            } else if (Array.isArray(ret[key])) {
                ret[key].push(val);
            } else {
                ret[key] = [ret[key], val];
            }

            return ret;
        }, {});
    }

    stringify(obj) {
        return obj ? Object.keys(obj).sort().map((key) => {
            let val = obj[key];

            if (Array.isArray(val)) {
                return val.sort().map((val2) => {
                    return encodeURIComponent(key) + '=' + encodeURIComponent(val2);
                }).join('&');
            }

            return encodeURIComponent(key) + '=' + encodeURIComponent(val);
        }).join('&') : '';
    }
}

export default QueryStringService;
