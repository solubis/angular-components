import {Service, Inject} from '../decorators';
import {ParentService} from './ParentService';

@Service()
class Application {
    
    constructor(
        //private service: ParentService,
        private log: angular.ILogService) {
    }

    run(@Inject() service: ParentService) {
        service.getName(); 
    }
}
