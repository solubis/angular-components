var angular = require('angular');
var items = {
    services: [],
    providers: [],
    filters: [],
    values: [],
    directives: []
};
var modules = [];
function Service(options) {
    var decorator;
    decorator = function (target) {
        if (!options || !options.name) {
            throw new Error('@Service() must contain name property!');
        }
        items.services.push({ name: options.name, fn: target });
        checkModule(target, options);
    };
    return decorator;
}
exports.Service = Service;
function Provider(options) {
    var decorator;
    decorator = function (target) {
        if (!options || !options.name) {
            throw new Error('@Provider() must contain name property!');
        }
        items.providers.push({ name: options.name, fn: target });
        checkModule(target, options);
    };
    return decorator;
}
exports.Provider = Provider;
function Filter(options) {
    var decorator;
    decorator = function (target, key, descriptor) {
        if (options || !options.name) {
            throw new Error('@Filter() must contain name property!');
        }
        items.filters.push({ name: options.name, fn: descriptor.value });
    };
    return decorator;
}
exports.Filter = Filter;
function Value(options) {
    var decorator;
    decorator = function (target, key, descriptor) {
        if (!options || !options.name) {
            throw new Error('@Value() must contain name property!');
        }
        items.values.push({ name: options.name, fn: descriptor.value });
    };
    return decorator;
}
exports.Value = Value;
function Component(options) {
    var decorator;
    decorator = function (target) {
        if (!options.selector && !options.name) {
            throw new Error('@Component() must contain "selector" or "name" property!');
        }
        options.name = options.name || toCamelCase(options.selector);
        if (options.templateUrl || options.template) {
            var directive = {
                restrict: 'E',
                scope: {},
                bindToController: true,
                controller: target,
                controllerAs: 'ctrl'
            };
            items.directives.push({ name: options.name, fn: function () { return angular.extend(directive, options); } });
        }
        checkModule(target, options);
    };
    return decorator;
}
exports.Component = Component;
function Directive(options) {
    var decorator;
    decorator = function (target, key, descriptor) {
        var name = toCamelCase(options.selector);
        items.directives.push({ name: name, fn: descriptor.value });
    };
    return decorator;
}
exports.Directive = Directive;
function Inject() {
    var dependencies = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        dependencies[_i - 0] = arguments[_i];
    }
    var decorator;
    decorator = function (target, key, descriptor) {
        if (descriptor) {
            descriptor.value.$inject = dependencies;
        }
        else {
            target.$inject = dependencies;
        }
    };
    return decorator;
}
exports.Inject = Inject;
function toCamelCase(str) {
    str = str.charAt(0).toLowerCase() + str.substring(1);
    return str.replace(/-([a-z])/ig, function (all, letter) { return letter.toUpperCase(); });
}
function checkModule(target, options) {
    if (isModule(target, options)) {
        target.$options = options;
        target.$options.name = target.$options.name || name;
        modules.push(target);
    }
}
function isModule(target, options) {
    return (options.module ||
        options.providers ||
        (target.prototype.config && typeof target.prototype.config === 'function') ||
        (target.prototype.run && typeof target.prototype.run === 'function'));
}
function defineModule(target, dependencies) {
    var name = target.$options.name;
    var module = angular.module(name, [].concat(dependencies || []).concat(target.$options.providers || []));
    module.run(target.prototype.run || (function () { }));
    module.config(target.prototype.config || (function () { }));
    return module;
}
function bootstrap(component) {
    angular.element(document).ready(function () {
        var dependencies = ['templates'];
        for (var _i = 0, modules_1 = modules; _i < modules_1.length; _i++) {
            var childModule = modules_1[_i];
            if (childModule !== component) {
                var dependency = defineModule(childModule);
                dependencies.push(dependency.name);
            }
        }
        var module = defineModule(component, dependencies);
        for (var _a = 0, _b = items.directives; _a < _b.length; _a++) {
            var directive = _b[_a];
            module.directive(directive.name, directive.fn);
        }
        for (var _c = 0, _d = items.services; _c < _d.length; _c++) {
            var service = _d[_c];
            module.service(service.name, service.fn);
        }
        for (var _e = 0, _f = items.providers; _e < _f.length; _e++) {
            var provider = _f[_e];
            module.provider(provider.name, provider.fn);
        }
        try {
            angular.module('templates');
        }
        catch (e) {
            angular.module('templates', []);
        }
        var selector = document.querySelector(component.$options.selector);
        angular.bootstrap(selector, [module.name], {});
    });
}
exports.bootstrap = bootstrap;
//# sourceMappingURL=decorators.js.map