import * as angular from 'angular';

let providers = {
    services: [],
    filters: [],
    directives: []
};

let components = [];

let routes = [];

function Service(options) {
    return function decorator(target) {
        options = options ? options : {};
        if (!options.name) {
            throw new Error('@Service() must contain name property!');
        }
        providers.services.push({ name: options.name, fn: target });
    };
}

function Filter(options) {
    return function decorator(target, key, descriptor) {
        options = options ? options : {};
        if (!options.name) {
            throw new Error('@Filter() must contain name property!');
        }
        providers.filters.push({ name: options.name, fn: descriptor.value });
    };
}

function Inject(...dependencies) {
    return function decorator(target, key?, descriptor?) {
        if (descriptor) {
            descriptor.value.$inject = dependencies;
        } else {
            target.$inject = dependencies;
        }
    };
}



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

function View(options) {
    return function decorator(target) {
        options = options ? options : {};

        if (target.$isComponent) {
            throw new Error('@View() must be placed after @Component()!');
        }

        target.$initView = function(selector) {
            const defaults = {
                templateUrl: options.templateUrl,
                restrict: 'E',
                scope: {},
                bindToController: true,
                controllerAs: 'ctrl'
            };

            let name = toCamelCase(selector);

            options.bindToController = options.bindToController || options.bind || {};
            options.controller = target;

            providers.directives.push({ name, fn: () => angular.extend(defaults, options) });
        };

        target.$isView = true;
    };
}

function Directive(options) {
    return function decorator(target) {
        let name = toCamelCase(options.selector);
        providers.directives.push({ name, fn: target.directiveFactory });
    };
}


function RouteConfig(options) {
    return function decorator(target) {
        routes.push({ name: options.name }, options);
    };
}

function toCamelCase(string) {
    string = string.charAt(0).toLowerCase() + string.substring(1);
    return string.replace(/-([a-z])/ig, function(all, letter) {
        return letter.toUpperCase();
    });
}

function defineModuleForTarget(target) {
    let name = toCamelCase(target.$options.selector);
    let module = angular.module(name, target.$options.dependencies || []);

    module.run(target.prototype.run || (() => { }));
    module.config(target.prototype.config || (() => { }));

    return module;
}

function bootstrap(component) {
    angular.element(document).ready(() => {
        let module = defineModuleForTarget(component);

        for (let directive of providers.directives) {
            module.directive(directive.name, directive.fn);
        }

        for (let service of providers.services) {
            module.service(service.name, service.fn);
        }

        for (let target of components) {
            if (target.$options.selector !== component.$options.selector) {
                defineModuleForTarget(target);
            }
        }

        try {
            angular.module('templates');
        } catch (e) {
            angular.module('templates', []);
        }

        let selector = document.querySelector(component.$options.selector);

        angular.bootstrap(selector, [module.name], {});
    });
}

export {Component, View, RouteConfig, Inject, Service, Filter, Directive, bootstrap};
