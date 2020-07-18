import {BindingsPlugin, ConfigurationParameter, Resource} from "./BindingsPlugin";
import {DataModel, DialectWrapper} from "@api-modeling/api-modeling-metadata";
import * as meta from "@api-modeling/api-modeling-metadata";
import {Md5} from "ts-md5";
import {AMLImporter} from "./aml/importer";
import {applyMixins} from "./utils/mixins";
import {AmlParser} from "./utils/amlParser";

export class AMLBindingsPlugin extends BindingsPlugin {
    constructor() {
        super();
    }

    async export(configuration: ConfigurationParameter[], graphs: DialectWrapper[]): Promise<Resource[]> {
        return Promise.resolve([]);
    }

    async import(configuration: ConfigurationParameter[], resources: Resource[]): Promise<DialectWrapper[]> {
        this.resetAutoGen();

        if (resources.length !== 1) {
            throw new Error("The AML plugin must receive only the root AML Dialect / Dialect Library file from the model to be imported");
        }

        // parsing
        try {
            const resource = resources[0];

            const parser = new AmlParser(resource.url, resource.text);
            let baseUnit = await parser.parse();
            const name = baseUnit.id.split("/").pop();
            const module = new meta.Module("Imported spec " + name);
            module.uuid = Md5.hashStr(baseUnit.id + "_module").toString();
            const unitDataModels = this.parseBaseUnit(module.id(), baseUnit)
            module.dataModels = unitDataModels.map((unitDataModel) => {
                return unitDataModel.id();
            });

            // modularity wrapper
            const modularityDialect: meta.DialectWrapper = new meta.ModularityDialect();
            modularityDialect.id = module.id();
            modularityDialect.location = "modules";
            await modularityDialect.encode(module)
            const modularityWrapper = [modularityDialect];


            // data models wrappers
            const dataModelWrappersPromises = unitDataModels.map(async (dm) => {
                const dataModelDialect: meta.DialectWrapper = new meta.DataModelDialect();
                dataModelDialect.id = dm.id();
                dataModelDialect.location = "data_model_" + dm.uuid // @todo check the extension
                await dataModelDialect.encode(dm);
                return dataModelDialect
            });
            const dataModelWrappers = await Promise.all(dataModelWrappersPromises);

            const allWrappers = modularityWrapper.concat(dataModelWrappers);
            return Promise.resolve(allWrappers);

        } catch (e) {
            console.log("ERROR:" + e.message)
            throw e;
        }
    }

}

export interface AMLBindingsPlugin extends AMLImporter {}
applyMixins(AMLBindingsPlugin, [AMLImporter]);