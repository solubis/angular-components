import {Component, Service, Inject } from '../decorators';
import IService from './IService';
import './Child';

@Component({
    selector: 'parent',
    providers: ['child']
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
class ParentService implements IService {
    title: string;

    constructor() {
        this.title = 'parentService';
    }

    getName() {
        return this.title;
    }
}
