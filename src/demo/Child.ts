import {Component, Service, Inject } from '../decorators';

@Component({
    selector: 'child'
})
class Child {

    @Inject('$logProvider')
    config(logProvider: angular.ILogProvider) {
        logProvider.debugEnabled(true);
    }

    @Inject('$log', 'childService')
    run(log: angular.ILogService, service: ChildService) {
        log.warn(service.title);
    }
}

@Service({
    name: 'childService'
})
class ChildService {
    title: string;

    constructor() {
        this.title = 'childService';
    }
}
