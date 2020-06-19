import * as meta from "@api-modeling/api-modeling-metadata";

/**
 * Some external resource plugins will work with. Just a URL identifying the resource and the text of the resource.
 */
export interface Resource {
    url: string
    text: string
}

/**
 * Configuration parameter for the import or export process
 */
export interface ConfigurationParameter {
    name: string
    value: any
}

/**
 * Common interface for all bindings plugins
 */
export abstract class BindingsPlugin  {
    /**
     * Imports resources into DialectWrappers containing the native model graphs
     * @param configuration
     * @param resources
     */
    abstract async import(configuration: ConfigurationParameter[], resources: Resource[]): Promise<meta.DialectWrapper[]>

    /**
     * Transforms sets of native model graphs into external resources
     * @param configuration
     * @param graphs
     */
    abstract async export(configuration: ConfigurationParameter[], graphs: meta.DialectWrapper[]): Promise<Resource[]>
}