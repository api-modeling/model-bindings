import {BindingsPlugin, Resource} from "./BindingsPlugin";
import {DialectWrapper, ModularityDialect, Module, Entity, Attribute, Association, IntegerScalar, StringScalar, DataModel, DataModelDialect, ModelBindingsDialect, BindingsModel, Binding} from "api-modeling-metadata";
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

    async import(resources: Resource[]): Promise<DialectWrapper[]> {
        const store = graph.store();
        const promises = resources.map((resource) => {
            return this.parseGlobalFile(resource, store);
        });
        await Promise.all(promises);

        const subjectAreasModules: Module[] = await this.parseSubjectAreas(store);
        const entityGroupsModules: Module[] = await this.parseEntityGroups(store, subjectAreasModules);

        // Modules
        const topLevel = new Module("CIM Distribution");
        topLevel.uuid = "cim_distribution";
        topLevel.nested = [];

        const modularityDialect: DialectWrapper = new ModularityDialect();
        modularityDialect.id = "http://cloudinformationmodel.org/modeling/modules";
        modularityDialect.location = "modules";


        // Data Models
        const dataModels: DataModel[] = entityGroupsModules.map((entityGroup) => {
            const entities = this.parseEntityGroup(store, entityGroup);
            const dataModel = new DataModel(entityGroup.id());
            dataModel.uuid = entityGroup.uuid + "/dataModel";
            dataModel.entities =  entities;
            entityGroup.dataModels = [ dataModel.id() ];
            return dataModel;
        });

        const allModels = dataModels.map(async (dataModel) => {
            const dataModelId = dataModel.id().replace("/dataModel", "").split("/").pop();
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
        const entityGroupsBindings: Binding[] = this.parseEntityGroupsBindings(entityGroupsModules);
        const subjectAreasBindings: Binding[] = this.parseSubjectAreasBindings(subjectAreasModules);
        const bindingsModel: BindingsModel = new BindingsModel();
        bindingsModel.uuid = "cim/bindings/modules";
        bindingsModel.source = topLevel.id();
        bindingsModel.declaration = VOCAB.CIM_BINDINGS_PROFILE;
        bindingsModel.bindings = subjectAreasBindings.concat(entityGroupsBindings);

        const moduleBindings = new ModelBindingsDialect();
        moduleBindings.id = "http://cloudinformationmodel.org/modeling/modules_bindings";
        moduleBindings.location = "modules_bindings";
        await  moduleBindings.encode(bindingsModel);

        return ([modularityDialect]).concat(dataModelDialects).concat([moduleBindings]);
    }

    async export(graphs: DialectWrapper[]): Promise<Resource[]> {
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
        return (new Promise((s,f) => {
            f("Not implemented yet");
        }));
    }

    protected async parseGlobalFile(resource: Resource, store?: n3.N3Store): Promise<n3.N3Store> {
        return await graph.loadGraph(resource.text, store);
    }
}

export interface CIMBindingsPlugin extends CIMImporter, CIMExporter {}
applyMixins(CIMBindingsPlugin, [CIMImporter, CIMExporter]);