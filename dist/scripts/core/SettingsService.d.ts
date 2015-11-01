/**
 * Saving and loading settings from local storage
 */
declare class SettingsService {
    private $window;
    private config;
    private settings;
    constructor($window: any, config: any);
    getSettings(): {
        debug: boolean;
        path: string;
    };
    saveSettings(): void;
    get(name: any): any;
    put(key: any, value?: any): void;
    set(key: any, value?: any): void;
    remove(key: any): void;
}
declare class SettingsServiceProvider implements ng.IServiceProvider {
    private config;
    /**
     * Configure.
     *
     * @param {object} params - An `object` of params to extend.
     */
    configure(params: any): this;
    $get($window: any): SettingsService;
}
export default SettingsService;
export { SettingsServiceProvider, SettingsService };
