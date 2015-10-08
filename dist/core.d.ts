/// <reference path="../typings/tsd.d.ts" />
/**
 * Module with services for error handler, local storage settings and small utils
 */
import { SettingsServiceProvider, SettingsService } from './core/SettingsService';
import { RestServiceProvider, RestService } from './core/RestService';
import ConfigServiceProvider from './core/ConfigService';
import HttpInterceptor from './core/HttpInterceptor';
import UtilsService from './core/UtilsService';
export declare let module: ng.IModule;
export default module;
export { UtilsService, ConfigServiceProvider, RestService, RestServiceProvider, SettingsService, SettingsServiceProvider, HttpInterceptor };
