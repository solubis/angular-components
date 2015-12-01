import { ChildService } from './ChildService';
declare class ParentService {
    title: string;
    constructor(service: ChildService);
    getName(): string;
}
export { ParentService };
