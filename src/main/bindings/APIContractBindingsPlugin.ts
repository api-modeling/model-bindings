import {BindingsPlugin, ConfigurationParameter, Resource} from "./BindingsPlugin";
import * as meta from "@api-modeling/api-modeling-metadata";
import {ApiParser} from "./utils/apiParser";
import {APIContractImporter} from "./api_contract/importer";
import {applyMixins} from "./utils/mixins";
import {Md5} from "ts-md5";
import base = Mocha.reporters.base;
import {VOCAB} from "./api_contract/constants";

const  SUPPORTED_FORMATS = [ApiParser.RAML1, ApiParser.OAS3 + ".0", ApiParser.OAS2, ApiParser.AMF_GRAPH, ApiParser.JSON_SCHEMA];
const SUPPORTED_SYNTAXES = [ApiParser.YAML, ApiParser.JSONLD, ApiParser.JSON]

export class APIContractBindingsPlugin extends BindingsPlugin {


    async export(configuration: ConfigurationParameter[], graphs: meta.DialectWrapper[]): Promise<Resource[]> {
        return Promise.resolve([]);
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
        const parser = new ApiParser(resources[0].url, format.value, syntax.value);
        let baseUnit = await parser.parse();
        const name = baseUnit.id.split("/").pop();
        const module = new meta.Module("Imported spec " + name);
        module.uuid = Md5.hashStr(baseUnit.id + "_module").toString();
        const dataModels = this.parseBaseUnit(module.id(), baseUnit)
        module.dataModels = dataModels.map((dm) => dm.id());

        // bindings wrapper
        const dataModelBindings = new meta.BindingsModel()
        dataModelBindings.uuid = Md5.hashStr(module.id() + "_datamodel_bindings").toString()
        dataModelBindings.bindings = dataModels.map((dataModel) => {
            // @ts-ignore
            const baseUnit = dataModel['parsed'];
            return this.parseBaseUnitBindings(baseUnit, dataModel)
        });
        dataModelBindings.source = module.id();
        dataModelBindings.declaration = VOCAB.API_CONTRACT_BINDINGS_PROFILE;

        const bindingsDialect: meta.DialectWrapper = new meta.ModelBindingsDialect();
        bindingsDialect.id = module.id() + "_datamodel_bindings"
        bindingsDialect.location = "datamodel_bindings";
        bindingsDialect.encode(dataModelBindings)
        const bindingsWrapper = [bindingsDialect];

        // modularity wrapper
        const modularityDialect: meta.DialectWrapper = new meta.ModularityDialect();
        modularityDialect.id = module.id();
        modularityDialect.location = "modules";

        modularityDialect.encode(module)
        const moduleWrapper = [modularityDialect]

        // data models wrappers
        const dataModelWrappers = dataModels.map((dm) => {
            const dataModelDialect: meta.DialectWrapper = new meta.DataModelDialect();
            dataModelDialect.id = dm.id();
            dataModelDialect.location = "data_model_ "+ dm.uuid // @todo check the extension
            dataModelDialect.encode(dm);
            return dataModelDialect
        })
        const allWrappers = await Promise.all(bindingsWrapper.concat(moduleWrapper.concat(dataModelWrappers)));
        return Promise.resolve(allWrappers);
    }

    private parseConfigurationParameters(configuration: ConfigurationParameter[]): ConfigurationParameter[] {

        const format = configuration.find((p) => p.name == "format");
        const syntax = configuration.find((p) => p.name == "syntax");

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

        return [format, syntax];
    }
}
export interface APIContractBindingsPlugin extends APIContractImporter {}
applyMixins(APIContractBindingsPlugin, [APIContractImporter]);