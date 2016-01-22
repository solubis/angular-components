import {Service} from '../src/decorators';
import {ChildService} from './ChildService';

@Service()
class ParentService {
    title: string;

    constructor(service: ChildService) {
        this.title = service.getName();
    }

    getName() {
        return this.title;
    }
}

export {ParentService}
