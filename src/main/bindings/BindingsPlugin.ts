import * as meta from "api-modeling-metadata";

/**
 * Some external resource plugins will work with. Just a URL identifying the resource and the text of the resource.
 */
export interface Resource {
    url: string
    text: string
}

/**
 * Common interface for all bindings plugins
 */
export abstract class BindingsPlugin  {
    /**
     * Imports resources into DialectWrappers containing the native model graphs
     * @param resources
     */
    abstract async import(resources: Resource[]): Promise<meta.DialectWrapper[]>

    /**
     * Transforms sets of native model graphs into external resources
     * @param graphs
     */
    abstract async export(graphs: meta.DialectWrapper[]): Promise<Resource[]>
}