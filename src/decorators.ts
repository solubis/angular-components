import * as angular from 'angular';
import 'reflect-metadata';

let services: any[] = [];
let providers: any[] = [];
let filters: any[] = [];
let values: any[] = [];
let directives: any[] = [];
let modules: ITarget[] = [];
let targets: ITarget[] = [];

export interface IBasicDecoratorOptions {
    name?: string;
}

export interface IComponentDecoratorOptions {
    templateUrl?: string;
    template?: string;
    selector?: string;
    name?: string;
    dependencies?: string[];
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

function ActionHandler(name: number): PropertyDecorator {
    let decorator: PropertyDecorator;

    decorator = (target: ITarget, key?: string, descriptor?: TypedPropertyDescriptor<any>) => {
        if (!name) {
            throw new Error(`@Action decorator for ${key} must contain "name"!`);
        }

        target['handlersMap'] = Object.assign({}, target['handlersMap'], { [name]: target[key] });
    };

    return decorator;
}

function Component(options: IComponentDecoratorOptions): ClassDecorator {
    let decorator: ClassDecorator;

    decorator = (target: ITarget) => {
        if (!options.selector && !options.name) {
            throw new Error(`@Component() for ${target.name} class must contain "selector" or "name" property!`);
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

function Inject(name?: string) {
    let decorator;

    if (name) {
        decorator = (target: ITarget, key: string, index: number) => {
            setInjectable(index, name, target, key);
        };
    } else {
        decorator = (target: ITarget, key?: string, descriptor?: TypedPropertyDescriptor<any>) => {
            initInjectables(target);
        };
    }

    return decorator;
}


/**
 * Helper functions
 */


function classDecorator(decoratorName: string, options: IBasicDecoratorOptions, array: any[]): ClassDecorator {
    let decorator: ClassDecorator;

    decorator = (target: ITarget) => {
        let name = options && options.name.replace('Provider', '') || target.name.replace('Provider', '');

        if (array) {
            array.push({ name, fn: target });
        }

        initInjectables(target);
    };

    return decorator;
}

function propertyDecorator(decoratorName: string, name: string, array?: any[]): PropertyDecorator {
    let decorator: PropertyDecorator;

    decorator = (target: ITarget, key?: string, descriptor?: TypedPropertyDescriptor<any>) => {
        if (!name) {
            throw new Error(`${decoratorName} decorator for ${key} must contain "name"!`);
        }

        if (array) {
            array.push({ name, fn: (descriptor && descriptor.value) || target[key] });
        }

        initInjectables(target);
    };

    return decorator;
}

function initInjectables(target: ITarget, key?: string) {
    let injectables = getInjectables(target, key);

    if (injectables) {
        return injectables;
    }

    let params = Reflect.getOwnMetadata('design:paramtypes', target, key);

    let names: string[] = params && params.map(param => /function ([^(]*)/.exec(param.toString())[1]);

    setInjectables(names, target, key);

    targets.push(target);

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
    let injectables = key ?
        (target.prototype && target.prototype[key] ?
            target.prototype[key].$inject
            : target[key] && target[key].$inject)
        : target.$inject;

    return injectables;
}

function checkTargets() {
    for (let target of targets) {
        if (target.$inject) {
            for (let provider of target.$inject) {
                if (provider === 'Object' || provider === 'Function') {
                    throw new Error(`Check injections for ${target.name} class (define type or use @Inject)`);
                }
            }
        }
    }
}

function setInjectable(index: number, value: string, target: ITarget, key?: string) {
    let injectables = getInjectables(target, key) || initInjectables(target, key);

    injectables[index] = value;
}

function getTargetName(target) {
    return typeof target === 'function' ? target.name : target.constructor.name;
}

function toCamelCase(str: string) {
    str = str.charAt(0).toLowerCase() + str.substring(1);
    return str.replace(/-([a-z])/ig, (all, letter) => letter.toUpperCase());
}

function setModule(target: ITarget, options: IComponentDecoratorOptions): void {
    Reflect.defineMetadata('moduleName', options.name + 'Module', target);

    modules.push(target);
}

function isModule(target: Function, options: IComponentDecoratorOptions): boolean {
    return <boolean>(options.dependencies ||
        (target.prototype.config && typeof target.prototype.config === 'function') ||
        (target.prototype.run && typeof target.prototype.run === 'function'));
}

function defineModule(target: ITarget, dependencies?: string[]): ng.IModule {
    let name = Reflect.getOwnMetadata('moduleName', target);
    let options = Reflect.getOwnMetadata('options', target);
    let module = angular.module(name, [].concat(dependencies || []).concat(options.dependencies || []));

    module.run(target.prototype.run || (() => { }));
    module.config(target.prototype.config || (() => { }));

    return module;
}

function bootstrap(component: Function) {
    let options = Reflect.getOwnMetadata('options', component);

    Reflect.defineMetadata('moduleName', options.name + 'Module', component);

    checkTargets();

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
        }

        for (let service of services) {
            module.service(service.name, service.fn);
        }

        for (let provider of providers) {
            module.provider(provider.name, provider.fn);
        }

        for (let value of values) {
            module.value(value.name, value.fn);
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

export {Component, Inject, Service, Provider, Filter, Directive, Value, ActionHandler, bootstrap};
