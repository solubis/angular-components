// import * as angular from 'angular';
var providers = {
    services: [],
    filters: [],
    directives: []
};
var components = [];
var routes = [];
function Service(options) {
    return function decorator(target) {
        options = options ? options : {};
        if (!options.name) {
            throw new Error('@Service() must contain name property!');
        }
        providers.services.push({ name: options.name, fn: target });
    };
}
exports.Service = Service;
function Filter(options) {
    return function decorator(target, key, descriptor) {
        options = options ? options : {};
        if (!options.name) {
            throw new Error('@Filter() must contain name property!');
        }
        providers.filters.push({ name: options.name, fn: descriptor.value });
    };
}
exports.Filter = Filter;
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
function Component(options) {
    return function decorator(target) {
        options = options ? options : {};
        if (!options.selector) {
            throw new Error('@Component() must contain selector property!');
        }
        if (target.$initView) {
            target.$initView(options.selector);
        }
        target.$options = options;
        target.$isComponent = true;
        components.push(target);
    };
}
exports.Component = Component;
function View(options) {
    return function decorator(target) {
        options = options ? options : {};
        if (target.$isComponent) {
            throw new Error('@View() must be placed after @Component()!');
        }
        target.$initView = function (selector) {
            var defaults = {
                templateUrl: options.templateUrl,
                restrict: 'E',
                scope: {},
                bindToController: true,
                controllerAs: 'ctrl'
            };
            var name = toCamelCase(selector);
            options.bindToController = options.bindToController || options.bind || {};
            options.controller = target;
            providers.directives.push({ name: name, fn: function () { return angular.extend(defaults, options); } });
        };
        target.$isView = true;
    };
}
exports.View = View;
function Directive(options) {
    return function decorator(target) {
        var name = toCamelCase(options.selector);
        providers.directives.push({ name: name, fn: target.directiveFactory });
    };
}
exports.Directive = Directive;
function RouteConfig(options) {
    return function decorator(target) {
        routes.push({ name: options.name }, options);
    };
}
exports.RouteConfig = RouteConfig;
function toCamelCase(str) {
    str = str.charAt(0).toLowerCase() + str.substring(1);
    return str.replace(/-([a-z])/ig, function (all, letter) {
        return letter.toUpperCase();
    });
}
function defineModuleForTarget(target, dependencies) {
    var name = toCamelCase(target.$options.selector);
    var module = angular.module(name, [].concat(dependencies || []).concat(target.$options.dependencies || []));
    module.run(target.prototype.run || (function () { }));
    module.config(target.prototype.config || (function () { }));
    return module;
}
function bootstrap(component) {
    angular.element(document).ready(function () {
        var module = defineModuleForTarget(component, ['templates']);
        for (var _i = 0, _a = providers.directives; _i < _a.length; _i++) {
            var directive = _a[_i];
            module.directive(directive.name, directive.fn);
        }
        for (var _b = 0, _c = providers.services; _b < _c.length; _b++) {
            var service = _c[_b];
            module.service(service.name, service.fn);
        }
        for (var _d = 0; _d < components.length; _d++) {
            var target = components[_d];
            if (target.$options.selector !== component.$options.selector) {
                defineModuleForTarget(target);
            }
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
