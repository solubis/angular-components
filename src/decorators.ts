import * as angular from 'angular';

const app = angular.module('components', [
    'ui.router'
]);

function Run() {
    return function decorator(target, key, descriptor) {
        app.run(descriptor.value);
    };
}

function Config() {
    return function decorator(target, key, descriptor) {
        app.config(descriptor.value);
    };
}

function Service(options) {
    return function decorator(target) {
        options = options ? options : {};
        if (!options.name) {
            throw new Error('@Service() must contain name property!');
        }
        app.service(options.name, target);
    };
}

function Filter(filter) {
    return function decorator(target, key, descriptor) {
        filter = filter ? filter : {};
        if (!filter.name) {
            throw new Error('@Filter() must contain name property!');
        }
        app.filter(filter.filterName, descriptor.value);
    };
}

function Inject(...dependencies) {
    return function decorator(target) {
        target.$inject = dependencies;
    };
}

function Component(component) {
    return function decorator(target) {
        component = component ? component : {};
        if (!component.name) {
            throw new Error('@Component() must contain selector property!');
        }

        if (target.$initView) {
            target.$initView(component.name);
        }

        target.$isComponent = true;
    };
}

function View(view) {
    let options = view ? view : {};
    const defaults = {
        templateUrl: options.templateUrl,
        restrict: 'E',
        scope: {},
        bindToController: true,
        controllerAs: 'ctrl'
    };
    return function decorator(target) {
        if (target.$isComponent) {
            throw new Error('@View() must be placed after @Component()!');
        }

        target.$initView = function(name) {
            name = pascalCaseToCamelCase(name);
            name = dashCaseToCamelCase(name);

            options.bindToController = options.bindToController || options.bind || {};

            app.directive(name, function() {
                return Object.assign(defaults, { controller: target }, options);
            });
        };

        target.$isView = true;
    };
}

function Directive(options) {
    return function decorator(target) {
        const directiveName = dashCaseToCamelCase(options.selector);
        app.directive(directiveName, target.directiveFactory);
    };
}

function RouteConfig(stateName, options) {
    return function decorator(target) {
        app.config(['$stateProvider', ($stateProvider) => {
            $stateProvider.state(stateName, Object.assign({
                controller: target,
                controllerAs: 'vm'
            }, options));
        }]);
        app.controller(target.name, target);
    };
}

function pascalCaseToCamelCase(str) {
    return str.charAt(0).toLowerCase() + str.substring(1);
}

function dashCaseToCamelCase(string) {
    return string.replace(/-([a-z])/ig, function(all, letter) {
        return letter.toUpperCase();
    });
}

export default app;
export {Component, View, RouteConfig, Inject, Run, Config, Service, Filter, Directive};
