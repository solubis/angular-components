declare function Service(options: any): (target: any) => void;
declare function Filter(options: any): (target: any, key: any, descriptor: any) => void;
declare function Inject(...dependencies: any[]): (target: any, key?: any, descriptor?: any) => void;
declare function Component(options: any): (target: any) => void;
declare function View(options: any): (target: any) => void;
declare function Directive(options: any): (target: any) => void;
declare function RouteConfig(options: any): (target: any) => void;
declare function bootstrap(component: any): void;
export { Component, View, RouteConfig, Inject, Service, Filter, Directive, bootstrap };
