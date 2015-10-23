/**
 * Module with services for error handler, local storage settings and small utils
 */
import * as angular from 'angular';
import { SettingsServiceProvider, SettingsService } from './core/SettingsService';
import { RestServiceProvider, RestService } from './core/RestService';
import ConfigServiceProvider from './core/ConfigService';
import HttpInterceptor from './core/HttpInterceptor';
import UtilsService from './core/UtilsService';
export declare let module: angular.IModule;
export default module;
export { UtilsService, ConfigServiceProvider, RestService, RestServiceProvider, SettingsService, SettingsServiceProvider, HttpInterceptor };
