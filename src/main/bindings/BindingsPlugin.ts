import * as meta from "@api-modeling/api-modeling-metadata";
import { schPref, DataStore } from '@api-modeling/metadata-store'

import { v4 as uuidv4 } from 'uuid';
import { NamedNode,DataFactory } from 'n3';
const { namedNode, literal } = DataFactory;

const rdfType : NamedNode = namedNode(schPref.rdf + 'type')
const df : DataStore = DataStore.getDataStore()

/**
 * Some external resource plugins will work with. Just a URL identifying the resource and the text of the resource.
 */
export interface Resource {
    url: string
    text?: string
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
    constructor(){}
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

    abstract updateBindings(bindName : string): void
    abstract initBindings(bindUuid: string): string

    private bindName = namedNode(schPref.bind + 'Binding')
    private uuidName = namedNode(schPref.amldata + 'uuid')
    private bdsName = namedNode(schPref.bind + 'bindingDeclarationSource')
    private bsName = namedNode(schPref.bind + 'bindingSource')
    private bbName = namedNode(schPref.bind + 'boundBy')
    private bName = namedNode(schPref.bind + 'binding')
    protected dde = namedNode('http://a.ml/vocabularies/meta#DialectDomainElement')
    protected de = namedNode('http://a.ml/vocabularies/document#DomainElement')

    createBinding(regime: string, bindingDeclSrc: string, source : string){
        let uuid = uuidv4()
        let bindName = 'http://mulesoft.com/modeling/bindings/' + uuid
        let bindNode = namedNode(bindName)
        let sourceNode = namedNode('http://mulesoft.com/modeling/instances/uuid/'+source)
        let graph = namedNode(regime)
        let bindingDeclarationSource = namedNode(bindingDeclSrc)
        let stupid = `file://${process.cwd()}/node_modules/@api-modeling/api-modeling-metadata/model/bindings/schema/modelBindingsDialect.yaml#/declarations/Binding`
        df.store.addQuad(bindNode, rdfType, namedNode(bindName),graph)
        df.store.addQuad(bindNode, rdfType, this.dde,graph)
        df.store.addQuad(bindNode, rdfType, this.de,graph)
        df.store.addQuad(bindNode, rdfType, namedNode(stupid), graph)
        df.store.addQuad(bindNode,this.uuidName, literal(uuid), graph)
        df.store.addQuad(bindNode, this.bsName, sourceNode, graph)
        df.store.addQuad(bindNode, this.bdsName, namedNode(bindingDeclSrc), graph)
        return bindName
      }

}