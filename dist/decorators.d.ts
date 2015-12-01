export interface IBasicDecoratorOptions {
    name?: string;
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
declare function Service(name?: string): ClassDecorator;
declare function Provider(name?: string): ClassDecorator;
declare function Filter(name: string): PropertyDecorator;
declare function Value(name: string): PropertyDecorator;
declare function Directive(name: string): PropertyDecorator;
declare function Component(options: IComponentDecoratorOptions): ClassDecorator;
declare function Inject(name: string): any;
declare function bootstrap(component: Function): void;
export { Component, Inject, Service, Provider, Filter, Directive, Value, bootstrap };
