import {Component, View, Service, Inject, bootstrap } from '../decorators';
import './Parent';

@Component({
    selector: 'test-component',
    dependencies: ['parent']
})
@View({
    templateUrl: 'test.html'
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
class TestService {
    title: string;

    constructor() {
        this.title = 'myService';
    }
}

bootstrap(TestComponent);
