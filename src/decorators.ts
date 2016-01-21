import 'reflect-metadata';

let services: any[] = [];
let providers: any[] = [];
let filters: any[] = [];
let values: any[] = [];
let directives: any[] = [];
let modules: IConstructorTarget[] = [];
let targets: IConstructorTarget[] = [];

export interface IBasicDecoratorOptions {
    name?: string;
}

export interface IComponentDecoratorOptions extends ng.IDirective {
    selector?: string;
    name?: string;
    dependencies?: string[];
}

export interface IConstructorTarget extends Function {
    name: string;
    prototype: any;
}

export interface IPrototypeTarget extends Object {
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

function Value(name?: string): PropertyDecorator {
    return propertyDecorator('Value', name, values);
}

function Directive(name: string): PropertyDecorator {
    return propertyDecorator('Directive', name, directives);
}

function ActionHandler(name: string): PropertyDecorator {
    let decorator: PropertyDecorator;

    decorator = (target: IPrototypeTarget, key?: string, descriptor?: TypedPropertyDescriptor<any>) => {
        if (!name) {
            throw new Error(`@ActionHandler decorator for ${target.constructor['name']}:${key} must contain Action Name parameter`);
        }

        target['handlersMap'] = Object.assign({}, target['handlersMap'], { [name]: target[key] });
    };

    return decorator;
}

function StoreListener() {
    let decorator: PropertyDecorator;

    decorator = (target: IPrototypeTarget, key?: string, descriptor?: TypedPropertyDescriptor<any>) => {
        let names = getParamTypeNames(target, key);

        // todo for each check if Store if (type.prototype instanceof Store)

        target['storeMap'] = Object.assign({}, target['storeMap'], { [names[0]]: target[key] });
    };

    return decorator;
}

function Component(options: IComponentDecoratorOptions): ClassDecorator {
    let decorator: ClassDecorator;

    decorator = (target: IConstructorTarget) => {
        if (!options.selector && !options.name) {
            throw new Error(`@Component() for ${target.name} class must contain options object with "selector" or "name" property!`);
        }

        options.name = options.name || toCamelCase(options.selector);

        if (options.templateUrl || options.template) {
            let directive = {
                restrict: 'E',
                scope: target.prototype.scope || {},
                bindToController: true,
                controller: target,
                controllerAs: 'ctrl',
                link: target.prototype.link || function() { }
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
        decorator = (target: IConstructorTarget, key: string, index: number) => {
            setInjectable(index, name, target, key);
        };
    } else {
        decorator = (target: IConstructorTarget, key?: string, descriptor?: TypedPropertyDescriptor<any>) => {
            initInjectables(target, key);
        };
    }

    return decorator;
}


/**
 * Helper functions
 */

function generateMethodNames(target) {
    let methodNames = getActionMethodNames();
    let className = target.name;

    for (let i = 0; i < methodNames.length; i++) {
        target.prototype[methodNames[i]].$actionName = `${className}:${methodNames[i]}`;
    }


    function getActionMethodNames() {
        return Object.getOwnPropertyNames(target.prototype)
            .filter(name =>
                name !== 'constructor' &&
                typeof target.prototype[name] === 'function'
            );
    }
}

function classDecorator(decoratorName: string, options: IBasicDecoratorOptions, array: any[]): ClassDecorator {
    let decorator: ClassDecorator;

    decorator = (target: IConstructorTarget) => {
        let name = options && options.name.replace('Provider', '') || target.name.replace('Provider', '');

        target.name = target.name || name;

        if (typeof target === 'function') {
            target.prototype.name = target.name;
            generateMethodNames(target);
        }

        if (array) {
            array.push({ name, fn: target });
        }

        initInjectables(target);
    };

    return decorator;
}

function propertyDecorator(decoratorName: string, name: string, array?: any[]): PropertyDecorator {
    let decorator: PropertyDecorator;

    decorator = (target: IPrototypeTarget | IConstructorTarget, key?: string, descriptor?: TypedPropertyDescriptor<any>) => {
        let isTargetConstructor: boolean = (<IConstructorTarget>target).prototype;

        name = name || key;

        if (array) {
            array.push({ name, fn: (descriptor && descriptor.value) || target[key] });
        }

        if (isTargetConstructor) {
            initInjectables(<IConstructorTarget>target);
        }
    };

    return decorator;
}

function getParamTypes(target: IConstructorTarget | IPrototypeTarget, key?: string) {
    return Reflect.getOwnMetadata('design:paramtypes', target, key);
}

function getParamTypeNames(target: IConstructorTarget | IPrototypeTarget, key?: string) {
    let params = getParamTypes(target, key);
    let names: string[] = params && params.map(param => /function ([^(]*)/.exec(param.toString())[1]);

    return names;
}

function initInjectables(target: IConstructorTarget, key?: string) {
    let injectables = getInjectables(target, key);

    if (injectables) {
        return injectables;
    }

    let names = getParamTypeNames(target, key);

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

function setInjectable(index: number, value: string, target: IConstructorTarget, key?: string) {
    let injectables = getInjectables(target, key) || initInjectables(target, key);

    injectables[index] = value;
}

function toCamelCase(str: string) {
    str = str.charAt(0).toLowerCase() + str.substring(1);
    return str.replace(/-([a-z])/ig, (all, letter) => letter.toUpperCase());
}

function setModule(target: IConstructorTarget, options: IComponentDecoratorOptions): void {
    Reflect.defineMetadata('moduleName', options.name + 'Module', target);

    modules.push(target);
}

function isModule(target: Function, options: IComponentDecoratorOptions): boolean {
    return <boolean>(options.dependencies ||
        (target.prototype.config && typeof target.prototype.config === 'function') ||
        (target.prototype.run && typeof target.prototype.run === 'function'));
}

function defineModule(target: IConstructorTarget, dependencies?: string[]): ng.IModule {
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
        let selector = document.querySelector(options.selector);

        for (let childModule of modules) {
            if (childModule !== component) {
                let dependency = defineModule(childModule);
                dependencies.push(dependency.name);
            }
        }

        let module = defineModule(<IConstructorTarget>component, dependencies);

        for (let directive of directives) {
            module.directive(directive.name, directive.fn);
        }

        for (let filter of filters) {
            module.filter(filter.name, filter.fn);
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

        angular.bootstrap(selector, [module.name], {});
    });
}

export {Component, Inject, Service, Provider, Filter, Directive, Value, ActionHandler, StoreListener, bootstrap};
