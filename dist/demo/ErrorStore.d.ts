declare class ErrorStore {
    private $log;
    private data;
    constructor($log: any);
    addChangeListener(callback: Function): void;
}
export { ErrorStore };
