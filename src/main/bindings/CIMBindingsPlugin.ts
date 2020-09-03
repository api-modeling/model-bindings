import {BindingsPlugin, ConfigurationParameter, Resource} from "./BindingsPlugin";
import { NamedNode,DataFactory } from 'n3';
const { namedNode } = DataFactory;
import { startup, post, store, transitiveGet, get, schPref, literal } from '@api-modeling/metadata-store'

const rdfType : NamedNode = namedNode(schPref.rdf + 'type')

import {
    DialectWrapper,
    ModularityDialect,
    Module,
    DataModel,
    DataModelDialect,
    ModelBindingsDialect,
    BindingsModel,
    Binding, Entity
} from "@api-modeling/api-modeling-metadata";
import * as graph from "./utils/N3Graph";
import * as n3 from "n3";
import {CIMImporter} from "./cim/importer";
import {CIMExporter} from "./cim/exporter";
import {applyMixins} from "./utils/mixins";
import {VOCAB} from "./cim/constants";

export class CIMBindingsPlugin extends BindingsPlugin {

    constructor() {
        super();
    }

    async import(configuration: ConfigurationParameter[], resources: Resource[]): Promise<DialectWrapper[]> {
        const store = graph.store();
        const promises = resources.map((resource) => {
            return this.parseGlobalFile(resource, store);
        });
        await Promise.all(promises);

        const subjectAreasModules: Module[] = await this.parseSubjectAreas(store);
        const entityGroupsDataModels: DataModel[] = await this.parseEntityGroups(store, subjectAreasModules);

        // Modules
        const topLevel = new Module("CIM Distribution");
        topLevel.uuid = "cim_distribution";
        topLevel.nested = [];

        const modularityDialect: DialectWrapper = new ModularityDialect();
        modularityDialect.id = "http://cloudinformationmodel.org/modeling/modules";
        modularityDialect.location = "modules";


        // Data Models
        const dataModels: DataModel[] = entityGroupsDataModels.map((entityGroup) => {
            const entityMap : { [key: string] : Entity} = {}
            const extendsMap : { [key: string] : string } = {}
            const entities = this.parseEntityGroup(store, entityGroup, entityMap, extendsMap);
            Object.entries(extendsMap).forEach(ex => entityMap[ex[0]].extends = entityMap[ex[1]])
            entityGroup.entities = entities;
            return entityGroup;
        });

        const allModels = dataModels.map(async (dataModel) => {
            const dataModelId = dataModel.id().split("/").pop();
            const dataModelDialect = new DataModelDialect();
            dataModelDialect.id = `http://cloudinformationmodel.org/modeling/${dataModelId}`;
            dataModelDialect.location = `data_models/${dataModelId}`;
            await dataModelDialect.encode(dataModel);
            return dataModelDialect;
        });
        const dataModelDialects: DialectWrapper[] = await Promise.all(allModels);

        // encode now the modules with the linked data models
        subjectAreasModules.forEach((module) => {
            topLevel.nested!.push(module);
        });

        await modularityDialect.encode(topLevel);


        // Bindings
        const entityGroupsBindings: Binding[] = this.parseEntityGroupsBindings(entityGroupsDataModels);
        const subjectAreasBindings: Binding[] = this.parseSubjectAreasBindings(subjectAreasModules);
        const bindingsModel: BindingsModel = new BindingsModel();
        bindingsModel.uuid = "cim/bindings/modules";
        bindingsModel.source = topLevel.id();
        bindingsModel.declaration = VOCAB.CIM_BINDINGS_PROFILE;
        bindingsModel.bindings = subjectAreasBindings.concat(entityGroupsBindings);

        const moduleBindings = new ModelBindingsDialect();
        moduleBindings.id = "http://cloudinformationmodel.org/modeling/modules_bindings";
        moduleBindings.location = "modules_bindings";
        await moduleBindings.encode(bindingsModel);

        return ([modularityDialect]).concat(dataModelDialects).concat([moduleBindings]);
    }

    async export(configuration: ConfigurationParameter[], graphs: DialectWrapper[]): Promise<Resource[]> {
        const version = configuration.find((p) => p.name == "cimVersion");
        if (version == null) {
            throw new Error("CIM version to export must be provided")
        }
        const outputFile = configuration.find((p) => p.name == "outputFile");
        if (outputFile == null) {
            throw new Error("Output file for the whole CIM distribution must be provided")
        }

        return (new Promise((s, f) => {
            try {
                // @ts-ignore
                const modules: ModularityDialect[] = graphs.filter((dialectWrapper) => {
                    return (dialectWrapper instanceof ModularityDialect);
                });
                // @ts-ignore
                const dataModels: DataModelDialect[] = graphs.filter((dialectWrapper) => {
                    return (dialectWrapper instanceof DataModelDialect);
                });
                // @ts-ignore
                const bindings: ModelBindingsDialect[] = graphs.filter((dialectWrapper) => {
                    return (dialectWrapper instanceof ModelBindingsDialect);
                });


                const subjectAreas = this.findSubjectAreas(modules, bindings);
                const entityLinkingMap: {[id: string]: Entity} = {}
                dataModels.forEach((dm) => {
                    (dm.encodedDataModel()?.entities || []).forEach((e) => {
                        entityLinkingMap[e.id()] = e;
                    })
                });

                const exportedSubjectAreas = subjectAreas.map((sa) => {
                    const entityGroupsDataModels = (sa.dataModels || []).map(id => {
                        const found = dataModels.find((dm) => dm.encodedDataModel()?.id() == id)
                        if (found != null) {
                            return found
                        } else {
                            throw new Error(`Missing data model ${id} for subject area module ${sa.id()}`)
                        }
                    });
                    let subjectAreaId = this.toId(sa.name);
                    if (sa.uuid.indexOf("cim/subjectarea/") > -1) {
                        subjectAreaId = sa.uuid.split("cim/subjectarea/").pop()!;
                    }
                    const entityGroups = entityGroupsDataModels.map((dm) =>
                        this.exportEntityGroup(subjectAreaId, dm!, version.value, entityLinkingMap)
                        );
                    let json = {
                        "@id": subjectAreaId + "SubjectArea",
                        "@type": "SubjectArea",
                        "version": version,
                        "name": sa.name
                    }

                    if (sa.description) {
                        // @ts-ignore
                        json['description'] = sa.description;
                    }
                    // @ts-ignore
                    json['entityGroups'] = entityGroups

                    return json;
                });

                const finalJson = JSON.stringify({
                    '@context': VOCAB.CONTEXT,
                    'subjectAreas': exportedSubjectAreas
                }, null, 2);


                const resource: Resource = {
                    "url": outputFile.value,
                    "text": finalJson
                };
                s([resource]);
            } catch (e) {
                f(e);
            }
        }));
    }

    protected async parseGlobalFile(resource: Resource, store?: n3.Store): Promise<n3.Store> {
        return await graph.loadGraph(resource.text ? resource.text : '', store);
    }
    private modName : NamedNode= namedNode(schPref.amlm + 'Module')
    private boundName = namedNode(schPref.bind + "boundBy")
    private dmName = namedNode(schPref.amldm + 'DataModel')
    private uuidNN = namedNode(schPref.amldata+'uuid')
    private binding = namedNode('http://a.ml/vocabularies/bindings#binding')

    updateBindings(bindName : string):void{
        //finding who doesn't have a binding
        // get all Modules not "boundBy" bindName
        const rootBind = namedNode(bindName)
        let modsToAnnotate = store.getSubjects(rdfType,this.modName).
        filter((m : any) => store.getObjects(m, this.boundName).
            filter((o : any) => store.countQuads(o,rdfType,null,rootBind) > 0).length === 0)
        modsToAnnotate.forEach((mta : NamedNode) => {
            let uuid = store.getObjects(mta,this.uuidNN)[0].value
            let bindingName = this.createBinding(bindName, 'http://mulesoft.com/modeling/instances/bindings/cim/SubjectAreaBinding', uuid)
            store.addQuad(rootBind, this.binding, namedNode(bindingName), rootBind)
        })
        // get all DataModels not "boundBy" bindname
        let dmsToAnnotate : NamedNode[] = store.getSubjects(rdfType,this.dmName).
        filter((m : NamedNode) => store.getObjects(m, this.boundName).
            filter((o : NamedNode) => store.countQuads(o,rdfType,null,rootBind) > 0).length === 0)
        dmsToAnnotate.forEach((mta : NamedNode) => {
            let uuid = store.getObjects(mta,this.uuidNN)[0].value
            let bindingName = this.createBinding(bindName, 'http://mulesoft.com/modeling/instances/bindings/cim/EntityGroupBinding', uuid)
            store.addQuad(rootBind, this.binding, namedNode(bindingName), rootBind)
        })

    }
    private bindingModel = namedNode('http://a.ml/vocabularies/bindings#BindingModel')
    //private dde = namedNode('http://a.ml/vocabularies/meta#DialectDomainElement')
    //private de = namedNode('http://a.ml/vocabularies/document#DomainElement')
    private bd = namedNode('http://a.ml/vocabularies/bindings#bindingDeclaration')
    private cimNN = namedNode('http://mulesoft.com/modeling/instances/bindings/cim')
    private bs = namedNode('http://a.ml/vocabularies/bindings#bindingSource')
    private cimd = namedNode('http://mulesoft.com/modeling/instances/uuid/cim_distribution')
    initBindings(bindUuid: string): string {
        let bn = namedNode('http://mulesoft.com/modeling/bindings/'+bindUuid)
        store.addQuad(bn, this.uuidNN,bindUuid,bn)
        store.addQuad(bn, rdfType, this.bindingModel,bn)
        let stupid = `file://${process.cwd()}/node_modules/@api-modeling/api-modeling-metadata/model/bindings/schema/modelBindingsDialect.yaml#/declarations/BindingsModel`
        store.addQuad(bn, rdfType, this.dde,bn)
        store.addQuad(bn, rdfType, this.de,bn)
        store.addQuad(bn, rdfType, namedNode(stupid), bn)
        store.addQuad(bn, this.bd, this.cimNN)
        store.addQuad(bn, this.bs, this.cimd)
        return 'http://mulesoft.com/modeling/bindings/'+bindUuid
      }


}

export interface CIMBindingsPlugin extends CIMImporter, CIMExporter {
}

applyMixins(CIMBindingsPlugin, [CIMImporter, CIMExporter]);