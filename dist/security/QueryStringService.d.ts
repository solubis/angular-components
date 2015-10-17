declare class QueryStringService {
    constructor();
    extract(maybeUrl: any): any;
    parse(str: any): any;
    stringify(obj: any): string;
}
export default QueryStringService;
