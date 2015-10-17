/**
 * Small utils
 */
declare class UtilsService {
    private $filter;
    private $dateFormat;
    constructor($filter?: any, $dateFormat?: string);
    formChanges(form: any, model: any): {};
    isReadyToSave(form: any, exclusions: any): boolean;
    isEmpty(obj: any): boolean;
    arrayFilter(array: any, expression: any, flag?: boolean): any[];
    arraySearch(array: any, expression: any, flag?: boolean): any;
    formatDate(date: any): string;
}
export default UtilsService;
