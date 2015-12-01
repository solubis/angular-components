/**
 * Module with services for error handler, local storage settings and small utils
 */
import {Component} from './decorators';

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
