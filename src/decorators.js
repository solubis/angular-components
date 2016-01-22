require('reflect-metadata');
var services = [];
var providers = [];
var filters = [];
var values = [];
var directives = [];
var modules = [];
var targets = [];
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
function ActionHandler(name) {
    var decorator;
    decorator = function (target, key, descriptor) {
        if (!name) {
            throw new Error("@ActionHandler decorator for " + target.constructor['name'] + ":" + key + " must contain Action Name parameter");
        }
        target['handlersMap'] = Object.assign({}, target['handlersMap'], (_a = {}, _a[name] = target[key], _a));
        var _a;
    };
    return decorator;
}
exports.ActionHandler = ActionHandler;
function StoreListener() {
    var decorator;
    decorator = function (target, key, descriptor) {
        var names = getParamTypeNames(target, key);
        // todo for each check if Store if (type.prototype instanceof Store)
        target['storeMap'] = Object.assign({}, target['storeMap'], (_a = {}, _a[names[0]] = target[key], _a));
        var _a;
    };
    return decorator;
}
exports.StoreListener = StoreListener;
function Component(options) {
    var decorator;
    decorator = function (target) {
        if (!options.selector && !options.name) {
            throw new Error("@Component() for " + target.name + " class must contain options object with \"selector\" or \"name\" property!");
        }
        options.name = options.name || toCamelCase(options.selector);
        if (options.selector) {
            var directive = {
                scope: {},
                bindToController: true,
                controller: target,
                controllerAs: 'ctrl',
                link: target.prototype.link || function () { }
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
            initInjectables(target, key);
        };
    }
    return decorator;
}
exports.Inject = Inject;
/**
 * Helper functions
 */
function generateMethodNames(target) {
    var methodNames = getActionMethodNames();
    var className = target.name;
    for (var i = 0; i < methodNames.length; i++) {
        target.prototype[methodNames[i]].$actionName = className + ":" + methodNames[i];
    }
    function getActionMethodNames() {
        return Object.getOwnPropertyNames(target.prototype)
            .filter(function (name) {
            return name !== 'constructor' &&
                typeof target.prototype[name] === 'function';
        });
    }
}
function classDecorator(decoratorName, options, array) {
    var decorator;
    decorator = function (target) {
        var name = options && options.name.replace('Provider', '') || target.name.replace('Provider', '');
        target.name = target.name || name;
        if (typeof target === 'function') {
            target.prototype.name = target.name;
            generateMethodNames(target);
        }
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
        var isTargetConstructor = target.prototype;
        name = name || key;
        if (array) {
            array.push({ name: name, fn: (descriptor && descriptor.value) || target[key] });
        }
        if (isTargetConstructor) {
            initInjectables(target);
        }
    };
    return decorator;
}
function getParamTypes(target, key) {
    return Reflect.getOwnMetadata('design:paramtypes', target, key);
}
function getParamTypeNames(target, key) {
    var params = getParamTypes(target, key);
    var names = params && params.map(function (param) { return /function ([^(]*)/.exec(param.toString())[1]; });
    return names;
}
function initInjectables(target, key) {
    var injectables = getInjectables(target, key);
    if (injectables) {
        return injectables;
    }
    var names = getParamTypeNames(target, key);
    setInjectables(names, target, key);
    targets.push(target);
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
function checkTargets() {
    for (var _i = 0; _i < targets.length; _i++) {
        var target = targets[_i];
        if (target.$inject) {
            for (var _a = 0, _b = target.$inject; _a < _b.length; _a++) {
                var provider = _b[_a];
                if (provider === 'Object' || provider === 'Function') {
                    throw new Error("Check injections for " + target.name + " class (define type or use @Inject)");
                }
            }
        }
    }
}
function setInjectable(index, value, target, key) {
    var injectables = getInjectables(target, key) || initInjectables(target, key);
    injectables[index] = value;
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
    Reflect.defineMetadata('moduleName', options.name + 'Module', component);
    checkTargets();
    angular.element(document).ready(function () {
        var dependencies = ['templates'];
        var selector = document.querySelector(options.selector);
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
        }
        for (var _b = 0; _b < filters.length; _b++) {
            var filter = filters[_b];
            module.filter(filter.name, filter.fn);
        }
        for (var _c = 0; _c < services.length; _c++) {
            var service = services[_c];
            module.service(service.name, service.fn);
        }
        for (var _d = 0; _d < providers.length; _d++) {
            var provider = providers[_d];
            module.provider(provider.name, provider.fn);
        }
        for (var _e = 0; _e < values.length; _e++) {
            var value = values[_e];
            module.value(value.name, value.fn);
        }
        try {
            angular.module('templates');
        }
        catch (e) {
            angular.module('templates', []);
        }
        angular.bootstrap(selector, [module.name], {});
    });
}
exports.bootstrap = bootstrap;
