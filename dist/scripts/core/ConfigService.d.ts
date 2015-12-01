interface ConfigService {
}
declare class ConfigServiceProvider implements ng.IServiceProvider {
    private config;
    constructor();
    /**
     * Configure.
     *
     * @param {object} params - An `object` of params to extend.
     */
    configure(params: any): this;
    $get(): {};
}
export { ConfigServiceProvider, ConfigService };
