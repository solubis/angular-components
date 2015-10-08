/// <reference path="../typings/tsd.d.ts" />

/**
 * Module with services for error handler, local storage settings and small utils
 */

import { SettingsServiceProvider, SettingsService } from './core/SettingsService';
import { RestServiceProvider, RestService } from './core/RestService';
import ConfigServiceProvider from './core/ConfigService';
import HttpInterceptor from './core/HttpInterceptor';
import UtilsService from './core/UtilsService';

export let module = angular.module('core', [])

  .value('$dateFormat', 'DD.MM.YYYY HH:mm:ss')

  .filter('dateFormat', ($utils) => (value) => $utils.formatDate(value))

  .config(function($httpProvider) {
  $httpProvider.interceptors.push(HttpInterceptor.factory);
})

  .provider('$rest', RestServiceProvider)

/*
 Utility service
 */

  .provider('$config', ConfigServiceProvider)

/*
 Utility service
 */

  .service('$utils', UtilsService)

/*
 Local storage management
 */

  .provider('$settings', SettingsServiceProvider);

export default module;

export {
UtilsService,
ConfigServiceProvider,
RestService,
RestServiceProvider,
SettingsService,
SettingsServiceProvider,
HttpInterceptor
};
