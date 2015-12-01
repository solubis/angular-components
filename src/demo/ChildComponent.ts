import {Component, Inject } from '../decorators';
import {ChildService} from './ChildService';

@Component({
    selector: 'child-component',
    template: '<h1>{{ctrl.title}}</h1>'
})
class ChildComponent {

    title: string;

    constructor(
        private service: ChildService,
        @Inject('$log') private log: angular.ILogService) {

        this.title = service.title;

        log.debug('CONSTRUCTOR: ChildComponent, injected service method response: ' + service.title);
    }

    config(
        @Inject('$logProvider') logProvider: angular.ILogProvider) {
        logProvider.debugEnabled(true);
    }

    run(
        @Inject('$log') log: angular.ILogService, service: ChildService) {

        log.debug('RUN: ChildComponent, injected service method response: ' + service.title);
    }
}
