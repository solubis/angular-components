import {Component, Inject, Value, bootstrap } from '../decorators';
import {ParentService} from './ParentService';
import './ChildComponent';

@Component({
    selector: 'test-component',
    templateUrl: 'test.html'
})
class TestComponent {

    @Value('testValue') static test: string = 'TEST VALUE';

    title: string;

    constructor(
        private service: ParentService,
        @Inject('$log') private log: angular.ILogService) {

        this.title = service.title;

        log.debug('CONSTRUCTOR: TestComponent, injected service method response: ' + service.title);
    }

    run(
        service: ParentService,
        @Inject('$log') log) {

        log.debug('RUN: TestComponent, injected service method response: ' + service.title);
    }

    config( @Inject('$logProvider') logProvider) {
        logProvider.debugEnabled(true);
    }
}

bootstrap(TestComponent);
