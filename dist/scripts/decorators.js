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
    return function decorator(target) {
        options = options ? options : {};
        if (!options.name) {
            throw new Error('@Service() must contain name property!');
        }
        items.services.push({ name: options.name, fn: target });
    };
}
exports.Service = Service;
function Provider(options) {
    return function decorator(target) {
        options = options ? options : {};
        if (!options.name) {
            throw new Error('@Provider() must contain name property!');
        }
        items.providers.push({ name: options.name, fn: target });
    };
}
exports.Provider = Provider;
function Filter(options) {
    return function decorator(target, key, descriptor) {
        options = options ? options : {};
        if (!options.name) {
            throw new Error('@Filter() must contain name property!');
        }
        items.filters.push({ name: options.name, fn: descriptor.value });
    };
}
exports.Filter = Filter;
function Value(options) {
    return function decorator(target, key, descriptor) {
        options = options ? options : {};
        if (!options.name) {
            throw new Error('@Value() must contain name property!');
        }
        items.values.push({ name: options.name, fn: descriptor.value });
    };
}
exports.Value = Value;
function Inject() {
    var dependencies = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        dependencies[_i - 0] = arguments[_i];
    }
    return function decorator(target, key, descriptor) {
        if (descriptor) {
            descriptor.value.$inject = dependencies;
        }
        else {
            target.$inject = dependencies;
        }
    };
}
exports.Inject = Inject;
function isModule(target, options) {
    return options.module ||
        options.dependencies ||
        (target.config && typeof target.config === 'function') ||
        (target.run && typeof target.run === 'function');
}
function Component(options) {
    return function decorator(target) {
        var name = options.name || toCamelCase(options.selector);
        options = options ? options : {};
        if (!options.selector && !options.name) {
            throw new Error('@Component() must contain "selector" or "name" property!');
        }
        if (options.templateUrl || options.template) {
            var directive = {
                restrict: 'E',
                scope: {},
                bindToController: true,
                controller: target,
                controllerAs: 'ctrl'
            };
            items.directives.push({ name: name, fn: function () { return angular.extend(directive, options); } });
        }
        target.$options = options;
        if (isModule(target, options)) {
            target.$options.name = target.$options.name || name;
            modules.push(target);
        }
    };
}
exports.Component = Component;
function Directive(options) {
    return function decorator(target, key, descriptor) {
        var name = toCamelCase(options.selector);
        items.directives.push({ name: name, fn: descriptor.value });
    };
}
exports.Directive = Directive;
function toCamelCase(str) {
    str = str.charAt(0).toLowerCase() + str.substring(1);
    return str.replace(/-([a-z])/ig, function (all, letter) { return letter.toUpperCase(); });
}
function defineModule(target, dependencies) {
    var name = target.$options.name;
    var module = angular.module(name, [].concat(dependencies || []).concat(target.$options.dependencies || []));
    module.run(target.prototype.run || (function () { }));
    module.config(target.prototype.config || (function () { }));
    return module;
}
function bootstrap(component) {
    angular.element(document).ready(function () {
        var dependencies = ['templates'];
        for (var _i = 0; _i < modules.length; _i++) {
            var childModule = modules[_i];
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