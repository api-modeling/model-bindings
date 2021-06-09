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
import {ApiModel, DataModel} from "@api-modeling/api-modeling-metadata";
import {ShapeTransformer} from "./api_contract/importer/ShapeTransformer";
import {IDGenerator} from "./api_contract/importer/IDGenerator";
import {EndpointTransformer} from "./api_contract/importer/EndpointTransformer";

const SUPPORTED_FORMATS = [ApiParser.RAML1, ApiParser.OAS3 + ".0", ApiParser.OAS2, ApiParser.AMF_GRAPH, ApiParser.JSON_SCHEMA, ApiParser.ASYNC2, "Async 2.0"];
const SUPPORTED_SYNTAXES = [ApiParser.YAML, ApiParser.JSONLD, ApiParser.JSON]

export class APIContractBindingsPlugin extends BindingsPlugin {

    async initAMF() {
        amf.plugins.document.Vocabularies.register();
        amf.plugins.document.WebApi.register();
        await amf.Core.init();
    }

    findAmf = /\n(\s+)x-amf-union:\n/
    checkAmfInserted(input: string) : string {
      const matchCheck = input.match(this.findAmf)
      if (matchCheck){
        let indent = matchCheck[1].length
        let pre = matchCheck.input!.substring(0,matchCheck.index)
        let remainingText = matchCheck.input!.substring(matchCheck.index! + 1 + matchCheck[0].length - 1)
        for (let indentedLine = remainingText.match(/^(\s+)([^\n]+\n)/); indentedLine && indentedLine[1].length > indent; indentedLine = remainingText.match(/^(\s+)([^\n]+\n)/)){
          remainingText = remainingText.substring(indentedLine[0].length)
        }
        let rest = this.checkAmfInserted(remainingText)
        return pre + '\n' + rest
      } else {
        return input
      }
    }
    iterate(a : any, b : (a: any) => [any,boolean]) : any {
        let end = false
        let rezzy = a
        while (!end){
            let res = b(rezzy)
            rezzy = res[0]
            end = res[1]
        }
        return rezzy
    }
    

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

        const tuple = this.parseConfigurationParameters(configuration);
        const format: string = tuple[0].value;
        const syntax: string = tuple[1].value;
        const formatExtension = this.parseConfigurationFormat(format, syntax);

        const baseUnits =  new APIContractExporter(modules, dataModels, apiModels, bindings, formatExtension).export();
        const maybeResources = baseUnits.map(async (baseUnit) => {
            if (baseUnit instanceof amf.model.document.Document) {
                const generator = new ApiGenerator(baseUnit, format, syntax);
                const text = await generator.generate();
                return {
                    url: baseUnit.location,
                    text: text
                };
            } else if (baseUnit instanceof amf.model.document.Module && (format.indexOf("OAS") > -1 || format.indexOf("ASYNC") > -1)) {
                const generator = new ApiGenerator(baseUnit, ApiParser.JSON_SCHEMA, syntax);
                const text = await generator.generate();
                return {
                    url: baseUnit.location,
                    text: text
                };
            } else {
                const generator = new ApiGenerator(baseUnit, ApiParser.RAML1, syntax);
                const text = await generator.generate();
                return {
                    url: baseUnit.location,
                    text: text
                };
            }

        });
        const generated = await Promise.all(maybeResources);
        if (format === ApiParser.RAML1){
            return generated
        }
        let correct : any = {}
        generated.map(x => x.url).forEach((x : string) => correct[x] = 'file://'+x.substring(x.lastIndexOf('/') + 1))
        const corrected = generated.map(g => {
            return {'url' : correct[g.url],
                    'text': this.iterate([g.text,Object.entries(correct)],
                            (a) =>{
                                if (a[1].length === 0){
                                    return [a[0],true]
                                }
                                let pair = a[1].shift()
                                let newStr = this.iterate([a[0], 0],(b)=>{
                                    let present = b[0].indexOf(pair[0],b[1])
                                    if (present < 0) return [b[0],true]
                                    return [[b[0].replace(pair[0],pair[1]),present + pair[1].length],false]
                                })
                                return [[newStr,a[1]],false]
                            })
                }
        })
        if (syntax === ApiParser.YAML){
            // then we need to compensate for amf inserting 'swagger' into JSON Schema, and 'x-amf' into unions
            const munged =       
            corrected.map(o => {return {url : o.url, text: o.text.startsWith('swagger: "2.0"') ? o.text.substring(15) : o.text}})
            .map(o => {
              return {url: o.url, text: this.checkAmfInserted(o.text)}
            })
            const pairings : any = munged.map(x => [x,x.text.indexOf('x-amf-uses:')])
            const mappies = 
              munged.map(x => [x,x.text.indexOf('x-amf-uses:')]).filter(z => z[1] >= 0).
              map(z => (<any>z[0]).text.substring(<number>z[1] + 12)).
              map(z => z.split('\n').map((q : string) => q.trim()).
              filter((z : string[]) => z.length > 0)).map(z => z.map((a : string) => a.split(": "))).
              reduce((acc, pp) => {
                pp.forEach((p : string[]) => acc[p[0]] = p[1]); 
                return acc;}, {})
            const unused = pairings.map((x : any) => { return {url: x[0].url, text : x[1] < 0 ? x[0].text : x[0].text.substring(0,x[1])} })
            const jsonSchemad = unused.map((x : any) => {
                  return {
                    url: x.url, text: '$id: "'+x.url+'"\n'+Object.entries(mappies).reduce((atext, pair) => {
                      const regex = new RegExp(pair[0]+'.', 'g')
                      return (<string><unknown>atext).replace(regex,<string>pair[1] + "#definitions/")
                    }, x.text)
                  }
                })
            return jsonSchemad
        } else {
            const jtexts = corrected.map(z => [z.url, JSON.parse(z.text)])
            jtexts.forEach(z => delete z[1]['swagger'])
            const mappies = jtexts.map(j => j[1]['x-amf-uses']).filter(z => z).
                   reduce((a, b) => { Object.entries(b).forEach(e => a[e[0]] = e[1]); return a }, {})
            jtexts.forEach(z => delete z[1]['x-amf-uses'])
            jtexts.forEach(j => j[1]['$id'] = j[0])
            let curse = (j : any) => {
                delete j['x-amf-union']
                Object.entries(j).forEach(e => {
                    if (e[0] === '$ref'){
                        const preRef = j['$ref']
                        if (preRef){
                            const split = preRef.indexOf('.')
                            if (split > 0){
                                const prefix = preRef.substring(0,split)
                                const uri = mappies[prefix]
                                j['$ref'] = uri+'#definitions/' + preRef.substring(split + 1)
                            } else {
                                j['$ref'] = "#" + preRef
                            }
                        }        
                    } else if (Array.isArray(e[1])){
                        e[1].forEach(a => curse(a))
                    } else if (e[1] && typeof e[1] === 'object'){
                        curse(e[1])
                    }
                })
            }
            jtexts.forEach(j => curse(j[1]))
            const jsonDocs = jtexts.map(j => {
                return {
                    url: j[0],
                    text: JSON.stringify(j[1], null, 2)
                }
            })
            return jsonDocs
        }
        return generated
    }

    async import(configuration: ConfigurationParameter[], resources: Resource[]): Promise<meta.DialectWrapper[]> {
        const idGenerator = new IDGenerator(); // generator of unique IDs during the import, shared among transformers
        const bindings = new meta.BindingsModel()
        bindings.bindings = [];
        const bindingsWrappers: meta.DialectWrapper[] = []


        if (resources.length !== 1) {
            throw new Error("The APIContract plugin must receive only the root RAML/OAS/AsyncAPI/JSONSchema file from the model to be imported");
        }

        configuration = this.parseConfigurationParameters(configuration)
        const format = configuration[0];
        const syntax = configuration[1];

        // parsing
        const parser = configuration.length > 2 ?
            new ApiParser(resources[0].url, format.value, syntax.value, <amf.resource.ResourceLoader>configuration[2].value) :
            new ApiParser(resources[0].url, format.value, syntax.value)

        try {
            let dataModels: DataModel[];
            let apiModel: ApiModel;
            let baseUnit = await parser.parse();
            const name = baseUnit.id.split("/").pop();
            const module = new meta.Module("Imported spec " + name);
            module.uuid = Md5.hashStr(baseUnit.id + "_module").toString();
            dataModels = new ShapeTransformer(module.id(), baseUnit, idGenerator).transformBaseUnitDataModel()
            dataModels = dataModels.filter((dm) => dm.entities?.length != 0)
            module.dataModels = dataModels.map((dm) => dm.id());

            let apiWrapper: meta.ApiModelDialect[] = []

            if (baseUnit instanceof amf.model.document.Document) {
                const entityMap = this.collectEntities(dataModels);
                const endpointTransformer = new EndpointTransformer(module.id(), baseUnit, idGenerator, entityMap);
                apiModel = endpointTransformer.transformBaseUnitApiModel();
                // @ts-ignore
                apiModel['parsed'] = baseUnit;

                bindings.bindings= bindings.bindings!.concat(endpointTransformer.getBindings());

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

    private parseConfigurationFormat(format: string, syntax: string): string {
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