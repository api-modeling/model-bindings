import {BindingsPlugin, Resource} from "./BindingsPlugin";
import * as meta from "api-modeling-metadata";
import {ApiParser} from "./utils/apiParser";
import {APIContractImporter} from "./api_contract/importer";
import {applyMixins} from "./utils/mixins";
import {Md5} from "ts-md5";

class DialectWrapper {
}

export class APIContractBindingsPlugin extends BindingsPlugin {

    async export(graphs: meta.DialectWrapper[]): Promise<Resource[]> {
        return Promise.resolve([]);
    }

    async import(resources: Resource[]): Promise<meta.DialectWrapper[]> {
        if (resources.length !== 1) {
            throw new Error("The APIContract plugin must receive only the root RAML/OAS/JSONSchema file from the model to be imported");
        }
        const parser = new ApiParser(resources[0].url, ApiParser.RAML1, ApiParser.YAML);
        let baseUnit = await parser.parse();
        const name = baseUnit.id.split("/").pop();
        const module = new meta.Module("Imported spec " + name);
        module.uuid = Md5.hashStr(baseUnit.id + "_module").toString();
        const dataModels = this.parseBaseUnit(module.id(), baseUnit)
        module.dataModels = dataModels.map((dm) => dm.id());


        const modularityDialect: meta.DialectWrapper = new meta.ModularityDialect();
        modularityDialect.id = module.id();
        modularityDialect.location = "modules";

        modularityDialect.encode(module)
        const moduleWrapper = [modularityDialect]
        const dataModelWrappers = dataModels.map((dm) => {
            const dataModelDialect: meta.DialectWrapper = new meta.DataModelDialect();
            dataModelDialect.id = dm.id();
            dataModelDialect.location = "data_model_ "+ dm.uuid // @todo check the extension
            dataModelDialect.encode(dm);
            return dataModelDialect
        })
        const allWrappers = await Promise.all(moduleWrapper.concat(dataModelWrappers));
        return Promise.resolve(allWrappers);
    }

}
export interface APIContractBindingsPlugin extends APIContractImporter {}
applyMixins(APIContractBindingsPlugin, [APIContractImporter]);