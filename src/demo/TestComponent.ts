import {Component, Service, Inject, bootstrap } from '../decorators';
import IService from './IService';

import './Parent';

@Component({
    selector: 'test-component',
    templateUrl: 'test.html',
    dependencies: ['parent']
})
@Inject('childService', '$http', '$log')
class TestComponent {
    title: string;

    constructor(
        private service: TestService,
        private http: angular.IHttpService,
        private log: angular.ILogService) {

        this.title = service.title;
    }

    @Inject('childService', '$log')
    run(service, log) {
        log.debug('TestComponent with ' + service.title);
    }
}

@Service({
    name: 'myService'
})
class TestService implements IService {
    title: string;

    constructor() {
        this.title = 'myService';
    }

    getName() {
        return this.title;
    }
}

bootstrap(TestComponent);
