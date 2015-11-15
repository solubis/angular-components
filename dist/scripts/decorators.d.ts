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
declare function Service(options: IBasicDecoratorOptions): ClassDecorator;
declare function Provider(options: IBasicDecoratorOptions): <TFunction extends Function>(target: TFunction) => TFunction | void;
declare function Filter(options: IBasicDecoratorOptions): PropertyDecorator;
declare function Value(options: IBasicDecoratorOptions): PropertyDecorator;
declare function Component(options: IComponentDecoratorOptions): ClassDecorator;
declare function Directive(options: IComponentDecoratorOptions): PropertyDecorator;
declare function Inject(...dependencies: string[]): any;
declare function bootstrap(component: Function): void;
export { Component, Inject, Service, Provider, Filter, Directive, Value, bootstrap };
