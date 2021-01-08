import { describe } from 'mocha'
import { assert } from 'chai';
import * as fs from 'fs';
import {APIContractBindingsPlugin} from "../../main/bindings/APIContractBindingsPlugin";
import {
    Operation,
    Module,
    DataModel,
    BindingsModel,
    ModularityDialect,
    DataModelDialect,
    ModelBindingsDialect,
    ApiModel,
    ApiModelDialect
} from "@api-modeling/api-modeling-metadata"
import {ApiParser} from "../../main/bindings/utils/apiParser";
import exp from "constants";
import { DocumentResourceLoader } from '@api-modeling/api-modeling-metadata'
import * as amf from '@api-modeling/amf-client-js';
//import { client } from '@api-modeling/amf-client-js'


export class AResourceLoader extends DocumentResourceLoader {
    fetch(resource: string): Promise<amf.client.remote.Content> {
      //const textUrl =  '../../' + resource.substring(7) //model-bindings/src/test/resources/example.raml'
      const textUrl =  //'src/main/resources/test/' +
          (resource.startsWith('http://goop.com/') ? resource.substring('http://goop.com/'.length) : resource)
      const textData = fs.readFileSync(textUrl).toString();
      const longer = 'file:///Users/mfuchs/Documents/webspace/api-mod-grp/auto-store/metadata-store/'+textUrl
      const fetched = new amf.client.remote.Content(textData, resource)
      return Promise.resolve(fetched)
    }
    accepts(resource: string): boolean {
      return true;
    }
  }


describe('APIBindingsPlugin', function() {
    this.timeout(5000);
    it ('should import RAML, convert to/from jsonld, and export RAML', async function() {
        const apiPlugin = new APIContractBindingsPlugin();
        const textUrl = "src/test/resources/api1.raml";
        const textData = fs.readFileSync(textUrl).toString();
        const config = [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML}];
        const parsed = await apiPlugin.import(config,[{ url: "file://"+ textUrl, text: textData}]);

        let proms = parsed.map(async (i) => {
            return await i.toJsonLd()
        })
        let finals = await Promise.all(proms)

        console.log("here0")
        let mbd = new ModelBindingsDialect()
        await mbd.fromJsonLd(JSON.parse(finals[0])[0]["http://a.ml/vocabularies/document#encodes"][0]['@id'], finals[0])
        console.log("here1")
        let md = new ModularityDialect()
        await md.fromJsonLd(JSON.parse(finals[1])[0]["http://a.ml/vocabularies/document#encodes"][0]['@id'], finals[1])
        console.log("here2")
        let dmd0 = new DataModelDialect()
        await dmd0.fromJsonLd(JSON.parse(finals[2])[0]["http://a.ml/vocabularies/document#encodes"][0]['@id'], finals[2])
        console.log("here3")
        let dmd1 = new DataModelDialect()
        await dmd1.fromJsonLd(JSON.parse(finals[3])[0]["http://a.ml/vocabularies/document#encodes"][0]['@id'], finals[3])
        console.log("here4")
        let api = new ApiModelDialect()
        await api.fromJsonLd(JSON.parse(finals[4])[0]["http://a.ml/vocabularies/document#encodes"][0]['@id'], finals[4])
        console.log("here done")
        const g1 = await apiPlugin.export(config,parsed)
        console.log("g1")
        const generated = await apiPlugin.export(config, [mbd,md,dmd0,dmd1,api]);
        console.log("g2")
        return true;
    })
    it('should parse RAML example and then Connector', async function () {
        const apiPlugin = new APIContractBindingsPlugin();
        const textUrl = //"http://goop.com/src/test/resources/apiMulti/api.raml"
        "file://src/test/resources/example.raml"
        //"src/test/resources/library.raml";
        //const textData = fs.readFileSync(textUrl).toString();
        const loader = new AResourceLoader()
        const parsed = await apiPlugin.import(
            [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML}],
            [{ url: textUrl, text: <string><unknown>null}]
//            [{ url: "file://"+ textUrl, text: textData}]
        );
        assert.equal(parsed.length, 4); // all the models: modules, entities, bindings

        const modules = parsed.filter((parsed) => parsed instanceof ModularityDialect)
        const dataModels = parsed.filter((parsed) => parsed instanceof DataModelDialect)
        const bindingsModels = parsed.filter((parsed) => parsed instanceof ModelBindingsDialect)

        const allModules = modules.map((module) => (<Module>module.encodesWrapper!).dataModels!.length ).reduce((acc, i) => { return acc + i }, 0)
        const allEntities = dataModels.map((module) => (<DataModel>module.encodesWrapper!).entities!.length ).reduce((acc, i) => { return acc + i }, 0)
        const allBindings = bindingsModels.map((module) => (<BindingsModel>module.encodesWrapper!).bindings!.length ).reduce((acc, i) => { return acc + i }, 0)

        assert.equal(allModules, 2)
        assert.equal(dataModels.length, 2)
        assert.equal(allEntities, 3)
        //assert.equal(allEntities, 8)
        assert.equal(allBindings, dataModels.length)
    });


    it ('should export API models to RAML Library specs', async function() {
        const apiPlugin = new APIContractBindingsPlugin();
        const textUrl = "src/test/resources/library2.raml";
        const textData = fs.readFileSync(textUrl).toString();
        const config = [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML}];
        const parsed = await apiPlugin.import(config,[{ url: "file://"+ textUrl, text: textData}]);
        const generated = await apiPlugin.export(config, parsed);

        const parsedLibrary2 = "#%RAML 1.0 Library\n" +
            "types:\n" +
            "  Person:\n" +
            "    description: a human being\n" +
            "    type: library3_raml.Animal\n" +
            "    properties:\n" +
            "      name:\n" +
            "        type: string\n" +
            "      gender:\n" +
            "        type: string\n" +
            "      age:\n" +
            "        type: integer\n" +
            "  Family:\n" +
            "    description: a human molecule\n" +
            "    properties:\n" +
            "      parents:\n" +
            "        items: Person\n" +
            "      children:\n" +
            "        items: Person\n" +
            "  AliveThings:\n" +
            "    type: library3_raml.Animal | library3_raml.Vegetable\n" +
            "uses:\n" +
            "  library3_raml: data_model_7a5862da7f051870bf9f1e65903c49f4.raml\n";

        const parsedLibrary3 = "#%RAML 1.0 Library\n" +
            "types:\n" +
            "  Animal:\n" +
            "    description: not a plant, not a fungus\n" +
            "    properties:\n" +
            "      size:\n" +
            "        type: number\n" +
            "        format: float\n" +
            "      birthDate:\n" +
            "        type: datetime\n" +
            "  Vegetable:\n" +
            "    description: Green organic matter\n" +
            "    properties:\n" +
            "      height:\n" +
            "        type: number\n" +
            "        format: float\n";

        const expected: {[url: string]: string } = {
            "data_model_2b5cfe8bf55d68d44943b00af096f7b4.raml": parsedLibrary2,
            "data_model_7a5862da7f051870bf9f1e65903c49f4.raml": parsedLibrary3
        }
        generated.forEach((g) => {
            const expectedText = expected[g.url];
            assert.isNotNull(expectedText)
            assert.equal(g.text, expectedText)
        });
    });

    it('should parse RAML API specs and generate matching modules', async function () {
        const apiPlugin = new APIContractBindingsPlugin();
        const textUrl = "src/test/resources/api1.raml";
        const textData = fs.readFileSync(textUrl).toString();
        const parsed = await apiPlugin.import(
            [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML}],
            [{ url: "file://"+ textUrl, text: textData}]
        );
        assert.equal(parsed.length, 5); // all the models: modules, entities, bindings

        const modules = parsed.filter((parsed) => parsed instanceof ModularityDialect)
        const dataModels = parsed.filter((parsed) => (parsed instanceof DataModelDialect) && !(parsed instanceof ApiModelDialect))
        const apiModels = parsed.filter((parsed) => parsed instanceof ApiModelDialect)
        const bindingsModels = parsed.filter((parsed) => parsed instanceof ModelBindingsDialect)

        const allModules = modules.map((module) => (<Module>module.encodesWrapper!).dataModels!.length ).reduce((acc, i) => { return acc + i }, 0)
        const allApiResources = apiModels.map((module) => (<ApiModel>module.encodesWrapper!).resources! ).reduce((acc, resources) => acc.concat(resources), [])
        const allOperations = apiModels.map((module) => {
            const apiModel = (<ApiModel>module.encodesWrapper!)
            const resources = apiModel.resources!.concat([apiModel.entryPoint!])
            const operations = resources.map((r) => r.operations!)
            return operations.reduce((a,o)=> a.concat(o), [])
        }).reduce((a,o) => a.concat(o), [])
        const allApiEntities = apiModels.map((module) => (<ApiModel>module.encodesWrapper!).entities! ).reduce((acc, entities) => acc.concat(entities), [])
        const allEntities = dataModels.map((module) => (<DataModel>module.encodesWrapper!).entities! ).reduce((acc, entities) => acc.concat(entities), [])
        const allBindings = bindingsModels.map((module) => (<BindingsModel>module.encodesWrapper!).bindings! ).reduce((acc, bindings) => acc.concat(bindings))

        assert.equal(allModules, 3);
        assert.equal(dataModels.length, 2);
        assert.equal(apiModels.length, 1);
        const entityNames = allEntities.map((e) => e.name).sort();
        assert.deepEqual(entityNames, [
            "CheckLineItem",
            "MonetaryAmount",
            "PaymentMessage",
            "ShoppingCart"
        ]);
        assert.equal(allEntities.length, 4);
        assert.equal(allApiResources.length, 2);
        assert.deepEqual(allApiResources.map((r) => r.name), [
            "Resource /shoppingCarts",
            "Resource /shoppingCarts/{id}"
        ]);
        assert.equal(allOperations.length, 6);
        assert.deepEqual(allOperations.map((o) => {
            // @ts-ignore
            return (<Operation>o).name
        }).sort(), [
            "Create",
            "Create pay",
            "Delete",
            "Find Resource /shoppingCarts",
            "Find Resource /shoppingCarts/{id}",
            "Update"
        ]);
        assert.equal(allApiEntities.length, 7);
        assert.deepEqual(allApiEntities.map((e) => {
            let attrs: string[] = [];
            let assocs: string[] = [];
            if (e.attributes) {
                attrs = e.attributes!.map((a) => a.name);
            } else {
                attrs = [e.adapts!.uuid];
            }
            if (e.associations) {
                assocs = e.associations!.map((a) => a.name);
            }
            return attrs.concat(assocs).sort().join("::");

        }), [
            "7c3a4f55489cd476bdd39a4d7d46d12a",
            "7c3a4f55489cd476bdd39a4d7d46d12a",
            "7c3a4f55489cd476bdd39a4d7d46d12a",
            "fb25932527487e81cb1a72fcbadbcb39",
            "message::successful",
            "7c3a4f55489cd476bdd39a4d7d46d12a",
            "7c3a4f55489cd476bdd39a4d7d46d12a"
        ]);
        assert.equal(allBindings.length, 28);
    });

    it ('should export API models to RAML API specs', async function() {
        const apiPlugin = new APIContractBindingsPlugin();
        const textUrl = "src/test/resources/api2.raml";
        const textData = fs.readFileSync(textUrl).toString();
        let config = [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML}];
        const parsed = await apiPlugin.import(config,[{ url: "file://"+ textUrl, text: textData}]);

        config = [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML}];
        const generated = await apiPlugin.export(config, parsed);
        /*
        generated.forEach((g) => {
            console.log(g.url)
            console.log("------------------")
            console.log(g.text)
            console.log("\n\n")
        })
        */
        assert(generated.length === 3);
    });

    it ('should export API models to OAS API specs', async function() {
        const apiPlugin = new APIContractBindingsPlugin();
        const textUrl = "src/test/resources/multiserver.yaml";
        const textData = fs.readFileSync(textUrl).toString();
        let config = [{name: "format", value: ApiParser.OAS3 + ".0"}, {name: "syntax", value: ApiParser.YAML}];
        const parsed = await apiPlugin.import(config,[{ url: "file://"+ textUrl, text: textData}]);

        config = [{name: "format", value: ApiParser.OAS3 + ".0"}, {name: "syntax", value: ApiParser.YAML}];
        const generated = await apiPlugin.export(config, parsed);
        assert(generated.length === 1);
    });
});