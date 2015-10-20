import {Component, Service, Inject } from '../decorators';
import IService from './IService';

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
class ChildService implements IService{
    title: string;

    constructor() {
        this.title = 'childService';
    }
    
    getName(){
        return this.title;
    }
}
