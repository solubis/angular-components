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
declare function Service(name?: string): ClassDecorator;
declare function Provider(name?: string): ClassDecorator;
declare function Filter(name: string): PropertyDecorator;
declare function Value(name?: string): PropertyDecorator;
declare function Directive(name: string): PropertyDecorator;
declare function ActionHandler(name: string): PropertyDecorator;
declare function StoreListener(): (target: Object, propertyKey: string | symbol) => void;
declare function Component(options: IComponentDecoratorOptions): ClassDecorator;
declare function Inject(name?: string): any;
declare function bootstrap(component: Function): void;
export { Component, Inject, Service, Provider, Filter, Directive, Value, ActionHandler, StoreListener, bootstrap };
