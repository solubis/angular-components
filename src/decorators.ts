import * as angular from 'angular';

let items = {
    services: [],
    providers: [],
    filters: [],
    values: [],
    directives: []
};

let modules = [];

function Service(options) {
    return function decorator(target) {
        options = options ? options : {};
        if (!options.name) {
            throw new Error('@Service() must contain name property!');
        }
        items.services.push({ name: options.name, fn: target });
    };
}

function Provider(options) {
    return function decorator(target) {
        options = options ? options : {};
        if (!options.name) {
            throw new Error('@Provider() must contain name property!');
        }
        items.providers.push({ name: options.name, fn: target });
    };
}

function Filter(options) {
    return function decorator(target, key, descriptor) {
        options = options ? options : {};
        if (!options.name) {
            throw new Error('@Filter() must contain name property!');
        }
        items.filters.push({ name: options.name, fn: descriptor.value });
    };
}

function Value(options) {
    return function decorator(target, key, descriptor) {
        options = options ? options : {};
        if (!options.name) {
            throw new Error('@Value() must contain name property!');
        }
        items.values.push({ name: options.name, fn: descriptor.value });
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

function isModule(target, options) {
    return options.module ||
        options.dependencies ||
        (target.config && typeof target.config === 'function') ||
        (target.run && typeof target.run === 'function');
}

function Component(options) {
    return function decorator(target) {
        let name = options.name || toCamelCase(options.selector);

        options = options ? options : {};

        if (!options.selector && !options.name) {
            throw new Error('@Component() must contain "selector" or "name" property!');
        }

        if (options.templateUrl || options.template) {
            let directive = {
                restrict: 'E',
                scope: {},
                bindToController: true,
                controller: target,
                controllerAs: 'ctrl'
            };

            items.directives.push({ name, fn: () => angular.extend(directive, options) });
        }

        target.$options = options;

        if (isModule(target, options)) {
            target.$options.name = target.$options.name || name;
            modules.push(target);
        }
    };
}

function Directive(options) {
    return function decorator(target, key, descriptor) {
        let name = toCamelCase(options.selector);
        items.directives.push({ name, fn: descriptor.value });
    };
}

function toCamelCase(str: string) {
    str = str.charAt(0).toLowerCase() + str.substring(1);
    return str.replace(/-([a-z])/ig, (all, letter) => letter.toUpperCase());
}

function defineModule(target: any, dependencies?: string[]): ng.IModule {
    let name = target.$options.name;
    let module = angular.module(name, [].concat(dependencies || []).concat(target.$options.dependencies || []));

    module.run(target.prototype.run || (() => { }));
    module.config(target.prototype.config || (() => { }));

    return module;
}

function bootstrap(component) {
    angular.element(document).ready(() => {
        let dependencies = ['templates'];

        for (let childModule of modules) {
            if (childModule !== component) {
                let dependency = defineModule(childModule);
                dependencies.push(dependency.name);
            }
        }

        let module = defineModule(component, dependencies);

        for (let directive of items.directives) {
            module.directive(directive.name, directive.fn);
        }

        for (let service of items.services) {
            module.service(service.name, service.fn);
        }

        for (let provider of items.providers) {
            module.provider(provider.name, provider.fn);
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

export {Component, Inject, Service, Provider, Filter, Directive, Value, bootstrap};
