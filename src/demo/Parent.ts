import {Component, Service, Inject } from '../decorators';
import './Child';

@Component({
    selector: 'parent',
    dependencies: ['child']
})
class Parent {
    @Inject('$logProvider')
    config($logProvider: angular.ILogProvider) {
        $logProvider.debugEnabled(true);
    }

    @Inject('$log', 'parentService')
    run($log: angular.ILogService, service: ParentService) {
        $log.info(service.title);
    }
}

@Service({
    name: 'parentService'
})
class ParentService {
    title: string;

    constructor() {
        this.title = 'parentService';
    }
}
