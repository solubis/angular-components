import * as angular from 'angular';

let providers = {
    services: [],
    filters: [],
    directives: []
};

let components = [];

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

        if (options.templateUrl || options.template) {
            let directive = {
                restrict: 'E',
                scope: {},
                bindToController: true,
                controller: target,
                controllerAs: 'ctrl'
            };

            let name = toCamelCase(options.selector);

            providers.directives.push({ name, fn: () => angular.extend(directive, options) });
        }

        target.$options = options;

        components.push(target);
    };
}

function Directive(options) {
    return function decorator(target, key, descriptor) {
        let name = toCamelCase(options.selector);
        providers.directives.push({ name, fn: descriptor.value });
    };
}

function toCamelCase(str: string) {
    str = str.charAt(0).toLowerCase() + str.substring(1);
    return str.replace(/-([a-z])/ig, (all, letter) => letter.toUpperCase());
}

function defineModuleForTarget(target: any, dependencies?: string[]) {
    let name = toCamelCase(target.$options.selector);
    let module = angular.module(name, [].concat(dependencies || []).concat(target.$options.dependencies || []));

    module.run(target.prototype.run || (() => { }));
    module.config(target.prototype.config || (() => { }));

    return module;
}

function bootstrap(component) {
    angular.element(document).ready(() => {
        let module = defineModuleForTarget(component, ['templates']);

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

export {Component, Inject, Service, Filter, Directive, bootstrap};
