/**
 * Module with services for error handler, local storage settings and small utils
 */
import {Component, Inject} from './decorators';
import {HttpInterceptor} from './core/HttpInterceptor';

@Component({
    name: 'coreModule',
    dependencies: []
})
class Core {

    @Inject('$httpProvider')
    config($httpProvider: ng.IHttpProvider) {
        $httpProvider.interceptors.push(HttpInterceptor.factory);
    }
}

export * from './core/ConfigService';
export * from './core/HttpInterceptor';
export * from './core/RestService';
export * from './core/SettingsService';
export * from './core/UtilsService';

export {Core};

export default 'core';
