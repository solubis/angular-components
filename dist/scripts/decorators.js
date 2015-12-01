var angular = require('angular');
require('reflect-metadata');
var services = [];
var providers = [];
var filters = [];
var values = [];
var directives = [];
var modules = [];
function Service(name) {
    return classDecorator('Service', name, services);
}
exports.Service = Service;
function Provider(name) {
    return classDecorator('Provider', name, services);
}
exports.Provider = Provider;
function Filter(name) {
    return propertyDecorator('Filter', name, filters);
}
exports.Filter = Filter;
function Value(name) {
    return propertyDecorator('Value', name, values);
}
exports.Value = Value;
function Directive(name) {
    return propertyDecorator('Directive', name, directives);
}
exports.Directive = Directive;
function Component(options) {
    var decorator;
    decorator = function (target) {
        if (!options.selector && !options.name) {
            throw new Error("@Component() for " + target.name + " class must contain \"selector\" or \"name\" property!");
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
            angular.extend(directive, options);
            directives.push({ name: options.name, fn: function () { return directive; } });
        }
        if (isModule(target, options)) {
            setModule(target, options);
        }
        initInjectables(target);
        Reflect.defineMetadata('options', options, target);
    };
    return decorator;
}
exports.Component = Component;
function Inject(name) {
    var decorator;
    if (name) {
        decorator = function (target, key, index) {
            setInjectable(index, name, target, key);
        };
    }
    else {
        decorator = function (target, key, descriptor) {
            initInjectables(target);
        };
    }
    return decorator;
}
exports.Inject = Inject;
/**
 * Helper functions
 */
function classDecorator(decoratorName, options, array) {
    var decorator;
    decorator = function (target) {
        var name = options && options.name.replace('Provider', '') || target.name.replace('Provider', '');
        if (array) {
            array.push({ name: name, fn: target });
        }
        initInjectables(target);
    };
    return decorator;
}
function propertyDecorator(decoratorName, name, array) {
    var decorator;
    decorator = function (target, key, descriptor) {
        if (!name) {
            throw new Error(decoratorName + " decorator for " + key + " must contain \"name\"!");
        }
        if (array) {
            array.push({ name: name, fn: (descriptor && descriptor.value) || target[key] });
        }
        initInjectables(target);
    };
    return decorator;
}
function initInjectables(target, key) {
    var injectables = getInjectables(target, key);
    if (injectables) {
        return injectables;
    }
    var params = Reflect.getOwnMetadata('design:paramtypes', target, key);
    var names = params && params.map(function (param) { return /function ([^(]*)/.exec(param.toString())[1]; });
    setInjectables(names, target, key);
    return names;
}
function setInjectables(names, target, key) {
    if (key) {
        if (target.prototype && target.prototype[key]) {
            target.prototype[key].$inject = names;
        }
        else if (target[key]) {
            target[key].$inject = names;
        }
    }
    else {
        target.$inject = names;
    }
}
function getInjectables(target, key) {
    var injectables = key ?
        (target.prototype && target.prototype[key] ?
            target.prototype[key].$inject
            : target[key] && target[key].$inject)
        : target.$inject;
    return injectables;
}
function setInjectable(index, value, target, key) {
    var injectables = getInjectables(target, key) || initInjectables(target, key);
    console.log("@Inject " + getTargetName(target) + " " + key + " [" + index + "] = " + value);
    injectables[index] = value;
}
function getTargetName(target) {
    return typeof target === 'function' ? target.name : target.constructor.name;
}
function toCamelCase(str) {
    str = str.charAt(0).toLowerCase() + str.substring(1);
    return str.replace(/-([a-z])/ig, function (all, letter) { return letter.toUpperCase(); });
}
function setModule(target, options) {
    Reflect.defineMetadata('moduleName', options.name + 'Module', target);
    modules.push(target);
}
function isModule(target, options) {
    return (options.dependencies ||
        (target.prototype.config && typeof target.prototype.config === 'function') ||
        (target.prototype.run && typeof target.prototype.run === 'function'));
}
function defineModule(target, dependencies) {
    var name = Reflect.getOwnMetadata('moduleName', target);
    var options = Reflect.getOwnMetadata('options', target);
    var module = angular.module(name, [].concat(dependencies || []).concat(options.dependencies || []));
    module.run(target.prototype.run || (function () { }));
    module.config(target.prototype.config || (function () { }));
    return module;
}
function bootstrap(component) {
    var options = Reflect.getOwnMetadata('options', component);
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
        for (var _a = 0; _a < directives.length; _a++) {
            var directive = directives[_a];
            module.directive(directive.name, directive.fn);
            console.log("Directive:" + directive.name);
        }
        for (var _b = 0; _b < services.length; _b++) {
            var service = services[_b];
            module.service(service.name, service.fn);
            console.log("Service:" + service.name);
        }
        for (var _c = 0; _c < providers.length; _c++) {
            var provider = providers[_c];
            module.provider(provider.name, provider.fn);
            console.log("Provider:" + provider.name);
        }
        for (var _d = 0; _d < values.length; _d++) {
            var value = values[_d];
            module.value(value.name, value.fn);
            console.log("Value:" + value.name);
        }
        try {
            angular.module('templates');
        }
        catch (e) {
            angular.module('templates', []);
        }
        var selector = document.querySelector(options.selector);
        angular.bootstrap(selector, [module.name], {});
    });
}
exports.bootstrap = bootstrap;
