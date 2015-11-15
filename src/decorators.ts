import * as angular from 'angular';

let items = {
    services: [],
    providers: [],
    filters: [],
    values: [],
    directives: []
};

let modules: IComponent[] = [];

export interface IBasicDecoratorOptions {
    name: string;
}

export interface IComponentDecoratorOptions {
    selector?: string;
    name?: string;
    templateUrl?: string;
    template?: string;
    module?: boolean;
    providers?: string[];
}

export interface IModuleDecoratorOptions {
    selector?: string;
    name?: string;
    module?: boolean;
    providers?: string[];
}

export interface IComponent extends Function {
    $options: IComponentDecoratorOptions;
}

function Service(options: IBasicDecoratorOptions): ClassDecorator {
    let decorator: ClassDecorator;

    decorator = (target: IComponent) => {
        if (!options || !options.name) {
            throw new Error('@Service() must contain name property!');
        }
        items.services.push({ name: options.name, fn: target });

        checkModule(target, options);
    };

    return decorator;
}

function Provider(options: IBasicDecoratorOptions) {
    let decorator: ClassDecorator;

    decorator = (target) => {
        if (!options || !options.name) {
            throw new Error('@Provider() must contain name property!');
        }
        items.providers.push({ name: options.name, fn: target });

        checkModule(target, options);
    };

    return decorator;
}

function Filter(options: IBasicDecoratorOptions): PropertyDecorator {
    let decorator: PropertyDecorator;

    decorator = (target: Function, key?: string, descriptor?: TypedPropertyDescriptor<any>) => {
        if (options || !options.name) {
            throw new Error('@Filter() must contain name property!');
        }
        items.filters.push({ name: options.name, fn: descriptor.value });
    };

    return decorator;
}

function Value(options: IBasicDecoratorOptions): PropertyDecorator {
    let decorator: PropertyDecorator;

    decorator = (target: Function, key?: string, descriptor?: TypedPropertyDescriptor<any>) => {
        if (!options || !options.name) {
            throw new Error('@Value() must contain name property!');
        }
        items.values.push({ name: options.name, fn: descriptor.value });
    };

    return decorator;
}

function Component(options: IComponentDecoratorOptions): ClassDecorator {
    let decorator: ClassDecorator;

    decorator = (target: IComponent) => {
        if (!options.selector && !options.name) {
            throw new Error('@Component() must contain "selector" or "name" property!');
        }

        options.name = options.name || toCamelCase(options.selector);

        if (options.templateUrl || options.template) {
            let directive = {
                restrict: 'E',
                scope: {},
                bindToController: true,
                controller: target,
                controllerAs: 'ctrl'
            };

            items.directives.push({ name: options.name, fn: () => angular.extend(directive, options) });
        }

        checkModule(target, options);
    };

    return decorator;
}

function Directive(options: IComponentDecoratorOptions): PropertyDecorator {
    let decorator: ClassDecorator;

    decorator = (target: Function, key?: string, descriptor?: TypedPropertyDescriptor<any>) => {
        let name: string = toCamelCase(options.selector);

        items.directives.push({ name, fn: descriptor.value });
    };

    return decorator;
}

function Inject(...dependencies: string[]) {
    let decorator;

    decorator = (target: Function, key?: string, descriptor?: TypedPropertyDescriptor<any>) => {
        if (descriptor) {
            descriptor.value.$inject = dependencies;
        } else {
            target.$inject = dependencies;
        }
    };

    return decorator;
}

function toCamelCase(str: string) {
    str = str.charAt(0).toLowerCase() + str.substring(1);
    return str.replace(/-([a-z])/ig, (all, letter) => letter.toUpperCase());
}

function checkModule(target: IComponent, options: IModuleDecoratorOptions): void {
    if (isModule(target, options)) {
        target.$options = options;
        target.$options.name = target.$options.name || name;
        modules.push(target);
    }
}

function isModule(target: Function, options: IModuleDecoratorOptions): boolean {
    return <boolean>(options.module ||
        options.providers ||
        (target.prototype.config && typeof target.prototype.config === 'function') ||
        (target.prototype.run && typeof target.prototype.run === 'function'));
}

function defineModule(target: IComponent, dependencies?: string[]): ng.IModule {
    let name = target.$options.name;
    let module = angular.module(name, [].concat(dependencies || []).concat(target.$options.providers || []));

    module.run(target.prototype.run || (() => { }));
    module.config(target.prototype.config || (() => { }));

    return module;
}

function bootstrap(component: Function) {

    angular.element(document).ready(() => {
        let dependencies: string[] = ['templates'];

        for (let childModule of modules) {
            if (childModule !== component) {
                let dependency = defineModule(childModule);
                dependencies.push(dependency.name);
            }
        }

        let module = defineModule(<IComponent>component, dependencies);

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

        let selector = document.querySelector((<IComponent>component).$options.selector);

        angular.bootstrap(selector, [module.name], {});
    });
}

export {Component, Inject, Service, Provider, Filter, Directive, Value, bootstrap};
