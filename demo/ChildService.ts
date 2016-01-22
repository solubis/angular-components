import {Service, Inject } from '../src/decorators';

@Service()
class ChildService {
    title: string;

    constructor(
        @Inject('testValue') testValue: string) {

        this.title = 'childService with injected Value: ' + testValue;
    }

    getName() {
        return this.title;
    }
}

export {ChildService}
