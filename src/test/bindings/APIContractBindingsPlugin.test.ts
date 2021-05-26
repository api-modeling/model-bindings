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
function iterate(a : any, b : (a: any) => [any,boolean]) : any {
    let end = false
    let rezzy = a
    while (!end){
        let res = b(rezzy)
        rezzy = res[0]
        end = res[1]
    }
    return rezzy
}
describe('APIBindingsPlugin', function() {
    this.timeout(5000);
    it('should import RAML, convert to/from jsonld, and export RAML', async function() {
        const apiPlugin = new APIContractBindingsPlugin();
        const textUrl = "src/test/resources/api1.raml";
        const textData = fs.readFileSync(textUrl).toString();
        const config = [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML}];
        const parsed = await apiPlugin.import(config,[{ url: "file://"+ textUrl, text: textData}]);

        let proms = parsed.map(async (i) => {
            return await i.toJsonLd()
        });
        let finals = await Promise.all(proms);
        /*
        let new2dm = JSON.parse(finals[2])
        let id2 = new2dm[0]['@id']
        let cutter = id2.lastIndexOf('/')
        let newId = 'data_'+id2.substring(cutter + 1)
        new2dm[0]['@id'] = newId
        new2dm[0]["http://a.ml/vocabularies/document#encodes"][0]['@id'] = newId
        finals[2] = JSON.stringify(new2dm,null,2)
        */
        let mbd = new ModelBindingsDialect();
        await mbd.fromJsonLd(JSON.parse(finals[0])[0]["http://a.ml/vocabularies/document#encodes"][0]['@id'], finals[0]);
        let md = new ModularityDialect();
        await md.fromJsonLd(JSON.parse(finals[1])[0]["http://a.ml/vocabularies/document#encodes"][0]['@id'], finals[1]);
        let dmd0 = new DataModelDialect();
        await dmd0.fromJsonLd(JSON.parse(finals[2])[0]["http://a.ml/vocabularies/document#encodes"][0]['@id'], finals[2]);
        let dmd1 = new DataModelDialect();
        await dmd1.fromJsonLd(JSON.parse(finals[3])[0]["http://a.ml/vocabularies/document#encodes"][0]['@id'], finals[3]);
        let api = new ApiModelDialect();
        await api.fromJsonLd(JSON.parse(finals[4])[0]["http://a.ml/vocabularies/document#encodes"][0]['@id'], finals[4]);
        const g1 = await apiPlugin.export(config,parsed);
        const generated = await apiPlugin.export(config, [mbd,md,dmd0,dmd1,api]);

        try {
            let correct : any = {}
            generated.map(x => x.url).forEach((x : string) => correct[x] = 'file://'+x.substring(x.lastIndexOf('/') + 1))
            const corrected = generated.map(g => {
                return {'url' : correct[g.url],
                        'text': iterate([g.text,Object.entries(correct)],
                                function(a){
                                    if (a[1].length === 0){
                                        return [a[0],true]
                                    }
                                    let pair = a[1].shift()
                                    let newStr = iterate([a[0], 0],(b)=>{
                                        let present = b[0].indexOf(pair[0],pair[1])
                                        if (present < 0) return [b[0],true]
                                        return [[b[0].replace(pair[0],pair[1]),present],false]
                                    })
                                    return [[newStr,a[1]],false]
                                })
                    }
            })
            assert(corrected != null)
        } catch (error){
            console.log(error)
        }
            assert(g1 != null);
            assert(generated != null);
    })

    it('should parse RAML Library specs and generate matching modules', async function () {
        const apiPlugin = new APIContractBindingsPlugin();
        const textUrl = "src/test/resources/library.raml";
        const loader = new AResourceLoader()
        const parsed = await apiPlugin.import(
            [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML},{name:"loader", value: loader}],
            [{ url: textUrl, text: <string><unknown>null}]
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
        assert.equal(allEntities, 8)
        assert.equal(allBindings, dataModels.length)
    });

    it('should parse RAML API specs and generate matching modules', async function () {

        const apiPlugin = new APIContractBindingsPlugin();
        const textUrl = "http://goop.com/src/test/resources/apiMulti/api.raml"
        //"src/test/resources/library.raml";
        //const textData = fs.readFileSync(textUrl).toString();
        const loader = new AResourceLoader()
        const parsed = await apiPlugin.import(
            [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML},{name:"loader", value: loader}],
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
        //assert.equal(allBindings, dataModels.length)
    });

    it('should export API models to RAML Library specs', async function() {
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

    it('should parse RAML API specs and generate matching modules 2', async function () {
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
        assert.equal(allApiEntities.length, 4);
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
            "message::successful",
            "7c3a4f55489cd476bdd39a4d7d46d12a",
            "7c3a4f55489cd476bdd39a4d7d46d12a"
        ]);
        assert.equal(allBindings.length, 27);
    });

    it('should parse Async API specs and generate matching modules', async function () {
        const apiPlugin = new APIContractBindingsPlugin();
        const textUrl = "src/test/resources/async2.yaml";
        const textData = fs.readFileSync(textUrl).toString();
        const config = [{name: "format", value: ApiParser.ASYNC2}, {name: "syntax", value: ApiParser.YAML}];
        const parsed = await apiPlugin.import(
            config,
            [{ url: "file://"+ textUrl, text: textData}]
        );
        //const text = await parsed[3].toYaml()
        //console.log(text)
        assert.equal(parsed.length, 4);
    });

    it.skip('should export ASYNC models to ASYNC API specs', async function() {
        const apiPlugin = new APIContractBindingsPlugin();
        const textUrl = "src/test/resources/async2.yaml";
        const textData = fs.readFileSync(textUrl).toString();
        let config = [{name: "format", value: ApiParser.ASYNC2}, {name: "syntax", value: ApiParser.YAML}];
        const parsed = await apiPlugin.import(config,[{ url: "file://"+ textUrl, text: textData}]);

    
        let futu = parsed.map(async (dm) => {
            return await dm.toYaml()
        });

        let stuff = await Promise.all(futu)

        config = [{name: "format", value: ApiParser.ASYNC2}, {name: "syntax", value: ApiParser.YAML}];
        const generated = await apiPlugin.export(config, parsed);

        /*
        generated.forEach(async (dm) => {
            const txt = await dm.text
            console.log(txt)
        });
        */

        assert.equal(generated.length, 2);
    });

    let aBaseUnit : any = [
        {
          "@id": "http://mulesoft.com/modeling/instances/0557e846-d34c-44ab-828f-8d4c3293e07e",
          "@type": [
            "http://a.ml/vocabularies/meta#DialectInstance",
            "http://a.ml/vocabularies/document#Document",
            "http://a.ml/vocabularies/document#Fragment",
            "http://a.ml/vocabularies/document#Module",
            "http://a.ml/vocabularies/document#Unit"
          ],
          "http://a.ml/vocabularies/meta#definedBy": [
            {
              "@id": "http://anypoint.mulesoft.com/model/modeling/schema/apiModelDialect.yaml"
            }
          ],
          "http://a.ml/vocabularies/document#encodes": [
    {
      "@id": "http://mulesoft.com/modeling/instances/0557e846-d34c-44ab-828f-8d4c3293e07e",
      "http://a.ml/vocabularies/data#uuid": [
        {
          "@value": "0557e846-d34c-44ab-828f-8d4c3293e07e"
        }
      ],
      "http://a.ml/vocabularies/core#name": [
        {
          "@value": "National"
        }
      ],
      "http://a.ml/vocabularies/core#description": [
        {
          "@value": "Praesentium enim et possimus ratione debitis."
        }
      ],
      "http://a.ml/vocabularies/data-model#entities": [
        {
          "@id": "http://mulesoft.com/modeling/instances/40b165dc-8931-4b71-b489-cb77ebb80473",
          "http://a.ml/vocabularies/data#uuid": [
            {
              "@value": "40b165dc-8931-4b71-b489-cb77ebb80473"
            }
          ],
          "http://a.ml/vocabularies/core#name": [
            {
              "@value": "Adapted entity: driver Connecticut"
            }
          ],
          "http://a.ml/vocabularies/data-model#adapts": {
            "@id": "http://mulesoft.com/modeling/instances/d4c36a2b-dafd-41d9-83af-83130cc7f74c",
            "@type": [
              "http://a.ml/vocabularies/data-model#Entity",
              "http://a.ml/vocabularies/meta#DialectDomainElement",
              "http://a.ml/vocabularies/document#DomainElement",
              "http://anypoint.mulesoft.com/model/modeling/schema/dataModelingLibrary.yaml#/declarations/Entity"
            ],
            "http://a.ml/vocabularies/core#name": [
              {
                "@value": "driver Connecticut"
              }
            ],
            "http://a.ml/vocabularies/data#uuid": "d4c36a2b-dafd-41d9-83af-83130cc7f74c"
          },
          "@type": [
            "http://a.ml/vocabularies/data-model#Entity",
            "http://a.ml/vocabularies/meta#DialectDomainElement",
            "http://a.ml/vocabularies/document#DomainElement",
            "http://anypoint.mulesoft.com/model/modeling/schema/dataModelingLibrary.yaml#/declarations/Entity"
          ]
        },
        {
          "@id": "http://mulesoft.com/modeling/instances/e67e7768-5b08-4c2d-835c-c424f5682c73",
          "http://a.ml/vocabularies/data#uuid": [
            {
              "@value": "e67e7768-5b08-4c2d-835c-c424f5682c73"
            }
          ],
          "http://a.ml/vocabularies/core#name": [
            {
              "@value": "Adapted entity: driver Connecticut"
            }
          ],
          "http://a.ml/vocabularies/data-model#adapts": {
            "@id": "http://mulesoft.com/modeling/instances/d4c36a2b-dafd-41d9-83af-83130cc7f74c",
            "@type": [
              "http://a.ml/vocabularies/data-model#Entity",
              "http://a.ml/vocabularies/meta#DialectDomainElement",
              "http://a.ml/vocabularies/document#DomainElement",
              "http://anypoint.mulesoft.com/model/modeling/schema/dataModelingLibrary.yaml#/declarations/Entity"
            ],
            "http://a.ml/vocabularies/core#name": [
              {
                "@value": "driver Connecticut"
              }
            ],
            "http://a.ml/vocabularies/data#uuid": "d4c36a2b-dafd-41d9-83af-83130cc7f74c"
          },
          "@type": [
            "http://a.ml/vocabularies/data-model#Entity",
            "http://a.ml/vocabularies/meta#DialectDomainElement",
            "http://a.ml/vocabularies/document#DomainElement",
            "http://anypoint.mulesoft.com/model/modeling/schema/dataModelingLibrary.yaml#/declarations/Entity"
          ]
        },
        {
          "@id": "http://mulesoft.com/modeling/instances/bd054e32-e583-4ffe-aec1-385be681d456",
          "http://a.ml/vocabularies/data#uuid": [
            {
              "@value": "bd054e32-e583-4ffe-aec1-385be681d456"
            }
          ],
          "http://a.ml/vocabularies/core#name": [
            {
              "@value": "Adapted entity: driver Connecticut"
            }
          ],
          "http://a.ml/vocabularies/data-model#adapts": {
            "@id": "http://mulesoft.com/modeling/instances/d4c36a2b-dafd-41d9-83af-83130cc7f74c",
            "@type": [
              "http://a.ml/vocabularies/data-model#Entity",
              "http://a.ml/vocabularies/meta#DialectDomainElement",
              "http://a.ml/vocabularies/document#DomainElement",
              "http://anypoint.mulesoft.com/model/modeling/schema/dataModelingLibrary.yaml#/declarations/Entity"
            ],
            "http://a.ml/vocabularies/core#name": [
              {
                "@value": "driver Connecticut"
              }
            ],
            "http://a.ml/vocabularies/data#uuid": "d4c36a2b-dafd-41d9-83af-83130cc7f74c"
          },
          "@type": [
            "http://a.ml/vocabularies/data-model#Entity",
            "http://a.ml/vocabularies/meta#DialectDomainElement",
            "http://a.ml/vocabularies/document#DomainElement",
            "http://anypoint.mulesoft.com/model/modeling/schema/dataModelingLibrary.yaml#/declarations/Entity"
          ]
        }
      ],
      "http://a.ml/vocabularies/core#version": [
        {
          "@value": "98130"
        }
      ],
      "http://a.ml/vocabularies/data-model#entrypoint": [
        {
          "@id": "http://mulesoft.com/modeling/instances/49409716-73f8-4351-835f-5085ac7a3f82",
          "http://a.ml/vocabularies/data#uuid": [
            {
              "@value": "49409716-73f8-4351-835f-5085ac7a3f82"
            }
          ],
          "http://a.ml/vocabularies/core#name": [
            {
              "@value": "National"
            }
          ],
          "http://a.ml/vocabularies/data-model#operation": [
            {
              "@id": "http://mulesoft.com/modeling/instances/d2982401-7456-4a37-81dc-fb775b1c9d6d",
              "http://a.ml/vocabularies/data#uuid": [
                {
                  "@value": "d2982401-7456-4a37-81dc-fb775b1c9d6d"
                }
              ],
              "http://a.ml/vocabularies/core#name": [
                {
                  "@value": "Find List of driver Connecticut"
                }
              ],
              "http://a.ml/vocabularies/data-model#output": [
                {
                  "@id": "http://mulesoft.com/modeling/instances/bd2f5e11-8bd7-4d76-8f97-7aef4046b1b9",
                  "http://a.ml/vocabularies/data#uuid": [
                    {
                      "@value": "bd2f5e11-8bd7-4d76-8f97-7aef4046b1b9"
                    }
                  ],
                  "http://a.ml/vocabularies/core#name": [
                    {
                      "@value": "driver Connecticut"
                    }
                  ],
                  "http://a.ml/vocabularies/core#description": [
                    {
                      "@value": "Ipsum repellat adipisci eveniet incidunt itaque at nostrum quaerat et."
                    }
                  ],
                  "http://a.ml/vocabularies/data-model#allowMultiple": [
                    {
                      "@value": "false",
                      "@type": "http://www.w3.org/2001/XMLSchema#boolean"
                    }
                  ],
                  "http://a.ml/vocabularies/data-model#required": [
                    {
                      "@value": "false",
                      "@type": "http://www.w3.org/2001/XMLSchema#boolean"
                    }
                  ],
                  "http://a.ml/vocabularies/data-model#objectRange": {
                    "@id": "http://mulesoft.com/modeling/instances/40b165dc-8931-4b71-b489-cb77ebb80473",
                    "@type": [
                      "http://a.ml/vocabularies/data-model#Entity",
                      "http://a.ml/vocabularies/meta#DialectDomainElement",
                      "http://a.ml/vocabularies/document#DomainElement",
                      "http://anypoint.mulesoft.com/model/modeling/schema/dataModelingLibrary.yaml#/declarations/Entity"
                    ],
                    "http://a.ml/vocabularies/core#name": [
                      {
                        "@value": "Adapted entity: driver Connecticut"
                      }
                    ],
                    "http://a.ml/vocabularies/data#uuid": "40b165dc-8931-4b71-b489-cb77ebb80473"
                  },
                  "@type": [
                    "http://a.ml/vocabularies/data-model#OperationParameter",
                    "http://a.ml/vocabularies/meta#DialectDomainElement",
                    "http://a.ml/vocabularies/document#DomainElement",
                    "http://anypoint.mulesoft.com/model/modeling/schema/apiModelDialect.yaml#/declarations/OperationParameter"
                  ]
                }
              ],
              "http://a.ml/vocabularies/data-model#transition": [
                {
                  "@id": "http://mulesoft.com/modeling/instances/cf6d7ff2-ce14-4cf8-be34-7e1509a7a969",
                  "http://a.ml/vocabularies/data#uuid": [
                    {
                      "@value": "cf6d7ff2-ce14-4cf8-be34-7e1509a7a969"
                    }
                  ],
                  "http://a.ml/vocabularies/core#name": [
                    {
                      "@value": "Find List of driver Connecticut"
                    }
                  ],
                  "http://a.ml/vocabularies/data-model#transitionTarget": {
                    "@id": "http://mulesoft.com/modeling/instances/fe1d9f65-0601-471a-b612-9c64e5b2900c",
                    "@type": [
                      "http://a.ml/vocabularies/data-model#CollectionResource",
                      "http://a.ml/vocabularies/meta#DialectDomainElement",
                      "http://a.ml/vocabularies/document#DomainElement",
                      "http://anypoint.mulesoft.com/model/modeling/schema/apiModelDialect.yaml#/declarations/CollectionResource"
                    ],
                    "http://a.ml/vocabularies/core#name": [
                      {
                        "@value": "List of driver Connecticut"
                      }
                    ],
                    "http://a.ml/vocabularies/data#uuid": "fe1d9f65-0601-471a-b612-9c64e5b2900c"
                  },
                  "@type": [
                    "http://a.ml/vocabularies/data-model#ResourceTransition",
                    "http://a.ml/vocabularies/meta#DialectDomainElement",
                    "http://a.ml/vocabularies/document#DomainElement",
                    "http://anypoint.mulesoft.com/model/modeling/schema/apiModelDialect.yaml#/declarations/ResourceTransition"
                  ]
                }
              ],
              "@type": [
                "http://a.ml/vocabularies/data-model#CustomOperation",
                "http://a.ml/vocabularies/meta#DialectDomainElement",
                "http://a.ml/vocabularies/document#DomainElement",
                "http://anypoint.mulesoft.com/model/modeling/schema/apiModelDialect.yaml#/declarations/CustomOperation"
              ]
            }
          ],
          "@type": [
            "http://a.ml/vocabularies/data-model#Resource",
            "http://a.ml/vocabularies/meta#DialectDomainElement",
            "http://a.ml/vocabularies/document#DomainElement",
            "http://anypoint.mulesoft.com/model/modeling/schema/apiModelDialect.yaml#/declarations/Resource"
          ]
        }
      ],
      "http://a.ml/vocabularies/data-model#resource": [
        {
          "@id": "http://mulesoft.com/modeling/instances/4a5501a2-7c25-4fdd-a789-c0668e3016fc",
          "http://a.ml/vocabularies/data#uuid": [
            {
              "@value": "4a5501a2-7c25-4fdd-a789-c0668e3016fc"
            }
          ],
          "http://a.ml/vocabularies/core#name": [
            {
              "@value": "driver Connecticut"
            }
          ],
          "http://a.ml/vocabularies/data-model#event": [
            {
              "@id": "http://mulesoft.com/modeling/instances/50d44547-9c14-42c9-87a3-d20d93dd430d",
              "http://a.ml/vocabularies/data#uuid": [
                {
                  "@value": "50d44547-9c14-42c9-87a3-d20d93dd430d"
                }
              ],
              "http://a.ml/vocabularies/core#name": [
                {
                  "@value": "driver Connecticut updated"
                }
              ],
              "http://a.ml/vocabularies/data-model#publish": [
                {
                  "@id": "http://mulesoft.com/modeling/instances/e67e7768-5b08-4c2d-835c-c424f5682c73"
                }
              ],
              "http://a.ml/vocabularies/data-model#subscribe": [
                {
                  "@id": "http://mulesoft.com/modeling/instances/e67e7768-5b08-4c2d-835c-c424f5682c73"
                }
              ],
              "@type": [
                "http://a.ml/vocabularies/data-model#Event",
                "http://a.ml/vocabularies/meta#DialectDomainElement",
                "http://a.ml/vocabularies/document#DomainElement",
                "http://anypoint.mulesoft.com/model/modeling/schema/apiModelDialect.yaml#/declarations/Event"
              ]
            }
          ],
          "http://a.ml/vocabularies/data-model#schema": [
            {
              "@id": "http://mulesoft.com/modeling/instances/d4c36a2b-dafd-41d9-83af-83130cc7f74c",
              "http://a.ml/vocabularies/data#uuid": [
                {
                  "@value": "d4c36a2b-dafd-41d9-83af-83130cc7f74c"
                }
              ],
              "http://a.ml/vocabularies/core#name": [
                {
                  "@value": "driver Connecticut"
                }
              ],
              "http://a.ml/vocabularies/core#description": [
                {
                  "@value": "Ipsum repellat adipisci eveniet incidunt itaque at nostrum quaerat et."
                }
              ],
              "@type": [
                "http://a.ml/vocabularies/data-model#Entity",
                "http://a.ml/vocabularies/meta#DialectDomainElement",
                "http://a.ml/vocabularies/document#DomainElement",
                "http://anypoint.mulesoft.com/model/modeling/schema/dataModelingLibrary.yaml#/declarations/Entity"
              ]
            }
          ],
          "@type": [
            "http://a.ml/vocabularies/data-model#Resource",
            "http://a.ml/vocabularies/meta#DialectDomainElement",
            "http://a.ml/vocabularies/document#DomainElement",
            "http://anypoint.mulesoft.com/model/modeling/schema/apiModelDialect.yaml#/declarations/Resource"
          ]
        },
        {
          "@id": "http://mulesoft.com/modeling/instances/fe1d9f65-0601-471a-b612-9c64e5b2900c",
          "http://a.ml/vocabularies/data#uuid": [
            {
              "@value": "fe1d9f65-0601-471a-b612-9c64e5b2900c"
            }
          ],
          "http://a.ml/vocabularies/core#name": [
            {
              "@value": "List of driver Connecticut"
            }
          ],
          "http://a.ml/vocabularies/data-model#member": [
            {
              "@id": "http://mulesoft.com/modeling/instances/4a5501a2-7c25-4fdd-a789-c0668e3016fc"
            }
          ],
          "http://a.ml/vocabularies/data-model#event": [
            {
              "@id": "http://mulesoft.com/modeling/instances/a542b2f1-3823-4952-a953-b557d9f48e69",
              "http://a.ml/vocabularies/data#uuid": [
                {
                  "@value": "a542b2f1-3823-4952-a953-b557d9f48e69"
                }
              ],
              "http://a.ml/vocabularies/core#name": [
                {
                  "@value": "List of driver Connecticut created"
                }
              ],
              "http://a.ml/vocabularies/data-model#publish": [
                {
                  "@id": "http://mulesoft.com/modeling/instances/bd054e32-e583-4ffe-aec1-385be681d456"
                }
              ],
              "http://a.ml/vocabularies/data-model#subscribe": [
                {
                  "@id": "http://mulesoft.com/modeling/instances/bd054e32-e583-4ffe-aec1-385be681d456"
                }
              ],
              "@type": [
                "http://a.ml/vocabularies/data-model#CustomEvent",
                "http://a.ml/vocabularies/meta#DialectDomainElement",
                "http://a.ml/vocabularies/document#DomainElement",
                "http://anypoint.mulesoft.com/model/modeling/schema/apiModelDialect.yaml#/declarations/CustomEvent"
              ]
            }
          ],
          "@type": [
            "http://a.ml/vocabularies/data-model#CollectionResource",
            "http://a.ml/vocabularies/meta#DialectDomainElement",
            "http://a.ml/vocabularies/document#DomainElement",
            "http://anypoint.mulesoft.com/model/modeling/schema/apiModelDialect.yaml#/declarations/CollectionResource"
          ]
        }
      ],
      "@type": [
        "http://a.ml/vocabularies/data-model#ApiModel",
        "http://a.ml/vocabularies/meta#DialectDomainElement",
        "http://a.ml/vocabularies/document#DomainElement",
        "http://anypoint.mulesoft.com/model/modeling/schema/apiModelDialect.yaml#/declarations/ApiModel"
      ]
    }
  ],
          "http://a.ml/vocabularies/document#version": [
            {
              "@value": "2.1.0"
            }
          ],
          "http://a.ml/vocabularies/document#root": [
            {
              "@value": true
            }
          ]
        }
      ];

    it('should export generated async api', async function(){
        const dmd = new ApiModelDialect()
        try {
        await dmd.fromJsonLd("http://mulesoft.com/modeling/instances/0557e846-d34c-44ab-828f-8d4c3293e07e", JSON.stringify(aBaseUnit, null, 2))
        } catch (error) {
            let foo = error
            console.log(error)
        }
        assert.equal((<ApiModel>dmd.encodesWrapper)!.resources!.map(z => z.events).map(z => z ? z[0] : null).filter(z => z).length,2);
    })

    it('should export API models to OAS API specs', async function() {
        const apiPlugin = new APIContractBindingsPlugin();
        const textUrl = "src/test/resources/multiserver.yaml";
        const textData = fs.readFileSync(textUrl).toString();
        let config = [{name: "format", value: ApiParser.OAS3 + ".0"}, {name: "syntax", value: ApiParser.YAML}];
        const parsed = await apiPlugin.import(config,[{ url: "file://"+ textUrl, text: textData}]);

        config = [{name: "format", value: ApiParser.OAS3 + ".0"}, {name: "syntax", value: ApiParser.YAML}];
        const generated = await apiPlugin.export(config, parsed);
        assert(generated.length === 1);
    });

    it('should export API models to OAS API specs', async function() {
        const apiPlugin = new APIContractBindingsPlugin();
        const textUrl = "src/test/resources/multiserver.yaml";
        const textData = fs.readFileSync(textUrl).toString();
        let config = [{name: "format", value: ApiParser.OAS3 + ".0"}, {name: "syntax", value: ApiParser.YAML}];
        const parsed = await apiPlugin.import(config,[{ url: "file://"+ textUrl, text: textData}]);

        config = [{name: "format", value: ApiParser.OAS3 + ".0"}, {name: "syntax", value: ApiParser.YAML}];
        const generated = await apiPlugin.export(config, parsed);
        assert(generated.length === 1);
    });

    it ('should export API models to ASYNC API specs from scratch', async function() {
        const apiPlugin = new APIContractBindingsPlugin();
        await apiPlugin.initAMF();

        const apiModelYaml = fs.readFileSync("src/test/resources/asyncExport/api_model.yaml").toString();
        const dataModelYaml = fs.readFileSync("src/test/resources/asyncExport/data_model.yaml").toString();
        const bindingsYaml = fs.readFileSync("src/test/resources/asyncExport/bindings.yaml").toString();

        const apiModelDialectParser = new ApiModelDialect();
        await apiModelDialectParser.fromYaml("http://test.com/api", apiModelYaml)
        apiModelDialectParser.id = apiModelDialectParser.encodedApiModel()?.id()!

        const dataModelDialectParser = new DataModelDialect();
        await dataModelDialectParser.fromYaml("http://test.com/data", dataModelYaml);
        dataModelDialectParser.id = dataModelDialectParser.encodedDataModel()?.id()!

        const bindingsDialectParser = new ModelBindingsDialect();
        await bindingsDialectParser.fromYaml("http://test.com/bindings", bindingsYaml);
        bindingsDialectParser.id = bindingsDialectParser.encodedBindingsModel()?.id()!

        const parsed = [apiModelDialectParser, dataModelDialectParser, bindingsDialectParser];
        const config = [{name: "format", value: ApiParser.ASYNC2}, {name: "syntax", value: ApiParser.YAML}];
        const generated = await apiPlugin.export(config, parsed);
        assert.equal(generated.length, 2);
    });

});