/**
 * Module with services for error handler, local storage settings and small utils
 */
import {Component, Inject} from './decorators';
import {HttpInterceptor} from './core/HttpInterceptor';
import {RestService} from './core/RestService';

@Component({
    name: 'coreModule'
})
class Core {
}

export * from './core/ConfigService';
export * from './core/HttpInterceptor';
export * from './core/RestService';
export * from './core/SettingsService';
export * from './core/UtilsService';

export {Core};

export default 'core';
