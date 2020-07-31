import {BindingsPlugin, ConfigurationParameter, Resource} from "./BindingsPlugin";
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
            const entities = this.parseEntityGroup(store, entityGroup);
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
                    const entityGroups = entityGroupsDataModels.map((dm) => this.exportEntityGroup(subjectAreaId, dm!, version.value, entityLinkingMap));
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

    protected async parseGlobalFile(resource: Resource, store?: n3.N3Store): Promise<n3.N3Store> {
        return await graph.loadGraph(resource.text, store);
    }

}

export interface CIMBindingsPlugin extends CIMImporter, CIMExporter {
}

applyMixins(CIMBindingsPlugin, [CIMImporter, CIMExporter]);