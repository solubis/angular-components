/**
 * Module with services for error handler, local storage settings and small utils
 */
import {Component, Inject} from './decorators';
import {HttpInterceptor} from './core/HttpInterceptor';

@Component({
    name: 'coreModule',
    providers: []
})
class Core {

    @Inject('$httpProvider')
    config($httpProvider: ng.IHttpProvider) {
        $httpProvider.interceptors.push(HttpInterceptor.factory);
    }

    @Inject('$rest')
    run($rest) {
        $rest.init();
    }
}

export * from './core/ConfigService';
export * from './core/HttpInterceptor';
export * from './core/RestService';
export * from './core/SettingsService';
export * from './core/UtilsService';

export {Core};

export default 'core';
