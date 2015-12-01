import * as angular from 'angular';
import 'reflect-metadata';

let services: any[] = [];
let providers: any[] = [];
let filters: any[] = [];
let values: any[] = [];
let directives: any[] = []
let modules: ITarget[] = [];

export interface IBasicDecoratorOptions {
    name?: string
}

export interface IComponentDecoratorOptions {
    templateUrl?: string;
    template?: string;
    selector?: string;
    name?: string;
    dependencies?: Function[];
}

export interface ITarget extends Function {
    name: string;
}

function Service(name?: string): ClassDecorator {
    return classDecorator('Service', name, services);
}

function Provider(name?: string): ClassDecorator {
    return classDecorator('Provider', name, services);
}

function Filter(name: string): PropertyDecorator {
    return propertyDecorator('Filter', name, filters);
}

function Value(name: string): PropertyDecorator {
    return propertyDecorator('Value', name, values);
}

function Directive(name: string): PropertyDecorator {
    return propertyDecorator('Directive', name, directives);
}

function Component(options: IComponentDecoratorOptions): ClassDecorator {
    let decorator: ClassDecorator;

    decorator = (target: ITarget) => {
        if (!options.selector) {
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

            angular.extend(directive, options);

            directives.push({ name: options.name, fn: () => directive });
        }

        if (isModule(target, options)) {
            setModule(target, options);
        }

        initInjectables(target);

        Reflect.defineMetadata('options', options, target);
    };

    return decorator;
}

function Inject(name: string) {
    let decorator;

    decorator = (target: Function, key: string, index: number) => {
        setInjectable(index, name, target, key);
    };

    return decorator;
}


/**
 * Helper functions
 */


function classDecorator(decoratorName: string, options: IBasicDecoratorOptions, array: any[]): ClassDecorator {
    let decorator: ClassDecorator;

    decorator = (target: ITarget) => {
        let name = options && options.name || target.name;

        array.push({ name, fn: target });

        initInjectables(target);
    };

    return decorator;
}

function propertyDecorator(decoratorName: string, name: string, array: any[]): PropertyDecorator {
    let decorator: PropertyDecorator;

    decorator = (target: ITarget, key?: string, descriptor?: TypedPropertyDescriptor<any>) => {
        if (!name ) {
            throw new Error(`${decoratorName} decorator for ${key} must contain "name"!`);
        }
        
        array.push({ name, fn: (descriptor && descriptor.value) || target[key] });
    };

    return decorator;
}

function initInjectables(target: Function, key?: string) {
    let injectables = getInjectables(target, key);

    if (injectables) {
        return injectables;
    }

    let params = Reflect.getOwnMetadata('design:paramtypes', target, key);
    let names: string[] = params && params.map(param => /function ([^(]*)/.exec(param.toString())[1]);

    setInjectables(names, target, key);

    return names;
}

function setInjectables(names: string[], target: Function, key?: string): void {
    if (key) {
        if (target.prototype && target.prototype[key]) {
            target.prototype[key].$inject = names;
        } else if (target[key]) {
            target[key].$inject = names;
        }
    } else {
        target.$inject = names;
    }
}

function getInjectables(target: Function, key?: string) {
    let injectables = key ? (target.prototype && target.prototype[key] ? target.prototype[key].$inject : target[key] && target[key].$inject) : target.$inject;

    return injectables;
}

function setInjectable(index: number, value: string, target: Function, key?: string) {
    let injectables = getInjectables(target, key) || initInjectables(target, key);

    injectables[index] = value;

    setInjectables(injectables, target, key);
}

function toCamelCase(str: string) {
    str = str.charAt(0).toLowerCase() + str.substring(1);
    return str.replace(/-([a-z])/ig, (all, letter) => letter.toUpperCase());
}

function setModule(target: ITarget, options: IComponentDecoratorOptions): void {
    Reflect.defineMetadata('moduleName', options.name + 'Module', target);

    initInjectables(target, 'run');
    initInjectables(target, 'config');

    modules.push(target);
}

function isModule(target: Function, options: IComponentDecoratorOptions): boolean {
    return <boolean>(options.dependencies ||
        (target.prototype.config && typeof target.prototype.config === 'function') ||
        (target.prototype.run && typeof target.prototype.run === 'function'));
}

function defineModule(target: ITarget, dependencies?: string[]): ng.IModule {
    let name = Reflect.getOwnMetadata('moduleName', target);
    let module = angular.module(name, [].concat(dependencies || []));

    module.run(target.prototype.run || (() => { }));
    module.config(target.prototype.config || (() => { }));

    return module;
}

function bootstrap(component: Function) {
    let options = Reflect.getOwnMetadata('options', component);

    angular.element(document).ready(() => {
        let dependencies: string[] = ['templates'];

        for (let childModule of modules) {
            if (childModule !== component) {
                let dependency = defineModule(childModule);
                dependencies.push(dependency.name);
            }
        }

        let module = defineModule(<ITarget>component, dependencies);

        for (let directive of directives) {
            module.directive(directive.name, directive.fn);
            console.log(`Directive:${directive.name}`);
        }

        for (let service of services) {
            module.service(service.name, service.fn);
            console.log(`Service:${service.name}`);
        }

        for (let provider of providers) {
            module.provider(provider.name, provider.fn);
            console.log(`Provider:${provider.name}`);
        }
        
        for (let value of values) {
            module.value(value.name, value.fn);
            console.log(`Value:${value.name}`);
        }

        try {
            angular.module('templates');
        } catch (e) {
            angular.module('templates', []);
        }

        let selector = document.querySelector(options.selector);

        angular.bootstrap(selector, [module.name], {});
    });
}

export {Component, Inject, Service, Provider, Filter, Directive, Value, bootstrap};
