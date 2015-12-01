import {Service, Inject} from '../decorators';

@Service()
class ErrorStore  {

	private data: any[] = [];

    constructor( @Inject('$log') private $log) {
    }

	addChangeListener(callback: Function) {
	}
}

export {ErrorStore}