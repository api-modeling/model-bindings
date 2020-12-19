import {BindingsPlugin, ConfigurationParameter, Resource} from "./BindingsPlugin";
import * as meta from "@api-modeling/api-modeling-metadata";
import * as amf from '@api-modeling/amf-client-js';
import {ApiParser} from "./utils/apiParser";
import {APIContractImporter} from "./api_contract/importer";
import {applyMixins} from "./utils/mixins";
import {Md5} from "ts-md5";

import {VOCAB} from "./api_contract/constants";
import {APIContractExporter} from "./api_contract/exporter";
import {ApiGenerator} from "./utils/apiGenerator";
import {ApiModel, Binding, BindingScalarValue, DataModel} from "@api-modeling/api-modeling-metadata";

const SUPPORTED_FORMATS = [ApiParser.RAML1, ApiParser.OAS3 + ".0", ApiParser.OAS2, ApiParser.AMF_GRAPH, ApiParser.JSON_SCHEMA];
const SUPPORTED_SYNTAXES = [ApiParser.YAML, ApiParser.JSONLD, ApiParser.JSON]

export class APIContractBindingsPlugin extends BindingsPlugin {


    async export(configuration: ConfigurationParameter[], graphs: meta.DialectWrapper[]): Promise<Resource[]> {
        const bindings: meta.ModelBindingsDialect[] = [];
        const dataModels: meta.DataModelDialect[] = [];
        const apiModels: meta.ApiModelDialect[] = [];
        const modules: meta.ModularityDialect[] = [];

        graphs.forEach((graph) => {
            if (graph instanceof meta.ModelBindingsDialect) {
                bindings.push(graph);
            } else if (graph instanceof meta.ModularityDialect) {
                modules.push(graph);
            } else if (graph instanceof meta.DataModelDialect && !(graph instanceof meta.ApiModelDialect)) {
                dataModels.push(graph);
            } else if (graph instanceof meta.ApiModelDialect) {
                apiModels.push(graph);
            } else {
                throw new Error(`Unsupported type of model ${graph}`);
            }
        });

        const formatExtension = this.parseConfigurationFormat(configuration);
        const tuple = this.parseConfigurationParameters(configuration);
        const format = tuple[0].value;
        const syntax = tuple[1].value;

        const baseUnits =  new APIContractExporter(modules, dataModels, apiModels, bindings, formatExtension).export();
        const maybeResources = baseUnits.map(async (baseUnit) => {
            const generator = new ApiGenerator(baseUnit, format, syntax);
            const text = await generator.generate();
            return {
                url: baseUnit.location,
                text: text
            };
        });
        return Promise.all(maybeResources);
    }

    async import(configuration: ConfigurationParameter[], resources: Resource[]): Promise<meta.DialectWrapper[]> {
        this.resetAutoGen();

        if (resources.length !== 1) {
            throw new Error("The APIContract plugin must receive only the root RAML/OAS/JSONSchema file from the model to be imported");
        }

        configuration = this.parseConfigurationParameters(configuration)
        const format = configuration[0];
        const syntax = configuration[1];

        // parsing
        if (configuration.length > 2){
            console.log('parsing with '+configuration[2].value)
        }
        const parser = configuration.length > 2 ?
                            new ApiParser(resources[0].url, format.value, syntax.value, <amf.resource.ResourceLoader>configuration[2].value) :
                            new ApiParser(resources[0].url, format.value, syntax.value)

        try {

            const bindings = new meta.BindingsModel()
            bindings.bindings = []; // acc
            const bindingsWrappers: meta.DialectWrapper[] = []
            let dataModels: DataModel[];
            let apiModel: ApiModel;
            let baseUnit = await parser.parse();
            const name = baseUnit.id.split("/").pop();
            const module = new meta.Module("Imported spec " + name);
            module.uuid = Md5.hashStr(baseUnit.id + "_module").toString();
            dataModels = this.parseBaseUnitDataModel(module.id(), baseUnit)
            module.dataModels = dataModels.map((dm) => dm.id());

            let apiWrapper: meta.ApiModelDialect[] = []

            if (baseUnit instanceof amf.model.document.Document) {
                const entityMap = this.collectEntities(dataModels)
                apiModel = this.parseBaseUnitApiModel(module.id(), baseUnit, entityMap, bindings.bindings)
                // @ts-ignore
                apiModel['parsed'] = baseUnit;
                module.dataModels.push(apiModel.id())
                const apiModelDialect: meta.ApiModelDialect = new meta.ApiModelDialect();
                apiModelDialect.id = apiModel.id();
                apiModelDialect.location = "api_model_" + apiModel.uuid // @todo check the extension
                await apiModelDialect.encode(apiModel)
                apiWrapper.push(apiModelDialect);

            }


            // bindings wrapper
            bindings.uuid = Md5.hashStr(module.id() + "_bindings").toString()
            // @ts-ignore
            const allModelsForBindings = dataModels.concat([apiModel]).filter((m) => m != null)
            bindings.bindings = bindings.bindings.concat(allModelsForBindings.map((dataModel : any) => {
                // @ts-ignore
                const baseUnit = dataModel['parsed'];
                return this.parseBaseUnitBindings(baseUnit, dataModel)
            }));
            bindings.source = module.id();
            bindings.declaration = VOCAB.API_CONTRACT_BINDINGS_PROFILE;

            const bindingsDialect: meta.DialectWrapper = new meta.ModelBindingsDialect();
            bindingsDialect.id = module.id() + "_datamodel_bindings"
            bindingsDialect.location = "bindings";
            await bindingsDialect.encode(bindings)
            bindingsWrappers.push(bindingsDialect);

            // modularity wrapper
            const modularityDialect: meta.DialectWrapper = new meta.ModularityDialect();
            modularityDialect.id = module.id();
            modularityDialect.location = "modules";

            await modularityDialect.encode(module)
            const moduleWrapper = [modularityDialect]

            // data models wrappers
            const dataModelWrappersPromises = dataModels.map(async (dm) => {
                const dataModelDialect: meta.DialectWrapper = new meta.DataModelDialect();
                dataModelDialect.id = dm.id();
                dataModelDialect.location = "data_model_" + dm.uuid // @todo check the extension
                await dataModelDialect.encode(dm);
                return dataModelDialect
            });
            const dataModelWrappers = await Promise.all(dataModelWrappersPromises);

            const allWrappers = await Promise.all(bindingsWrappers.concat(moduleWrapper.concat(dataModelWrappers)).concat(apiWrapper));
            return Promise.resolve(allWrappers);
        } catch (e) {
            console.log("ERROR:" + e.message)
            throw e;
        }
    }

    private parseConfigurationParameters(configuration: ConfigurationParameter[]): ConfigurationParameter[] {

        const format = configuration.find((p) => p.name == "format");
        const syntax = configuration.find((p) => p.name == "syntax");
        const loader = configuration.find((p) => p.name == "loader");
        console.log("loader is "+loader)
        if (format == null) {
            throw new Error("A format must be passed as an argument")
        }
        if (syntax == null) {
            throw new Error("A syntax must be passed as an argument")
        }

        if (SUPPORTED_FORMATS.find((p) => p === format.value) == null) {
            throw new Error(`Format ${format.value} not supported`)
        }

        if (SUPPORTED_SYNTAXES.find((p) => p === syntax.value) == null) {
            throw new Error(`Syntax ${syntax.value} not supported`)
        }

        // small adjustment because we are not using the right version of OAS in the parser (3.0 vs 3.0.0)
        if (format.value === ApiParser.OAS3 + ".0") {
            format.value = ApiParser.OAS3
        }

        return loader ? [format, syntax, loader] : [format, syntax];
    }

    private parseConfigurationFormat(configuration: ConfigurationParameter[]): string {
        const tuple = this.parseConfigurationParameters(configuration);
        const format = tuple[0].value;
        const syntax = tuple[1].value;

        if (format == ApiParser.RAML1) {
            return "raml";
        } else if (syntax == ApiParser.YAML) {
            return "yaml"
        } else {
            return "json"
        }
    }

    private collectEntities(dataModels: meta.DataModel[]) {
        const acc: {[id:string]: string} = {};
        dataModels.forEach((dm) => {
            (dm.entities||[]).forEach((e) => {
                acc[e.uuid] = e.name;
            })
        });

        return acc;
    }
}
export interface APIContractBindingsPlugin extends APIContractImporter {}
applyMixins(APIContractBindingsPlugin, [APIContractImporter]);