declare module 'angular-components' {

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
    export function Service(name?: string): ClassDecorator;
    export function Provider(name?: string): ClassDecorator;
    export function Filter(name: string): PropertyDecorator;
    export function Value(name?: string): PropertyDecorator;
    export function Directive(name: string): PropertyDecorator;
    export function ActionHandler(name: string): PropertyDecorator;
    export function StoreListener(): PropertyDecorator;
    export function Component(options: IComponentDecoratorOptions): ClassDecorator;
    export function Inject(name?: string): any;
    export function bootstrap(component: Function): void;
}
