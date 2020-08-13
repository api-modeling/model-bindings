import { ConfigurationParameter, Resource, BindingsPlugin } from './bindings/BindingsPlugin';
import { CIMBindingsPlugin } from './bindings/CIMBindingsPlugin'
import { APIContractBindingsPlugin } from './bindings/APIContractBindingsPlugin'
import * as fs from 'fs';
import {DialectWrapper, ModularityDialect, Module, Entity, Attribute, Association, IntegerScalar, StringScalar, DataModel, DataModelDialect, ModelBindingsDialect, BindingsModel, Binding, BindingArrayValue} from "@api-modeling/api-modeling-metadata";
import { startup, post, store, transitiveGet, get, schPref } from '@api-modeling/metadata-store'
import {ApiParser} from "./bindings/utils/apiParser";
import { postBinding } from '@api-modeling/metadata-store/dist/esm/postGet';
const DataFactory = require('n3').DataFactory;
const { namedNode } = DataFactory;
var FileAPI = require('file-api')
  , File = FileAPI.File
  , FileList = FileAPI.FileList
  , FileReader = FileAPI.FileReader
  ;
type PlugInMap = {
  'cim' : CIMBindingsPlugin,
  'api' : APIContractBindingsPlugin,
  'gorp' : Error
}

type GetCon = Record<string,()=>BindingsPlugin>
let pim : GetCon = {
  'cim' : () => {
    return new CIMBindingsPlugin()
  },
  'api' : () => {
    return new APIContractBindingsPlugin();
  }
}

async function loadFile(fname: string){

}
async function pluginExport(plugInName : string, parameters : ConfigurationParameter[], graphs: DialectWrapper[]): Promise<Resource[]> {
  const somePlugin = pim[plugInName]()
  let something = await somePlugin.export(parameters,graphs)
  return something
}

async function pluginImport(plugInName : string, parameters : ConfigurationParameter[], resourceLocs: Resource[]) : Promise<DialectWrapper[]>{
  const somePlugin  = pim[plugInName]();
  let allResources = resourceLocs.map(loc => {
    return (async () => {
      if (loc.text) return loc
      if (loc.url.startsWith('file://')){
        const textData = fs.readFileSync(loc.url.substring(7)).toString();
        //console.log("here?")
        loc.text = textData
        return loc
      } else {
        return loc
      }
    })()
  })
  let resourceList = (await Promise.all(allResources)).map(z => z)
  const parsed = await somePlugin.import(parameters, resourceList );
  return parsed;
}

function makeBaseUnit(dialoc: any, base: string){
  let filer = dialoc['@type'].filter((f : string) => f.startsWith("file:///"))[0]
  //let start = base.indexOf('file:///')
  let end = filer.indexOf('#',8)
  let rebase = filer.substring(0,end)//base.replace(base.substring(start,end),dialoc)
  //console.log("NEW BASE IS : "+JSON.stringify(JSON.parse(rebase),null,2))
  let baseUnit =  `[
  {
    "@id": "file://src/main/resources/test/cim/test/association.yaml",
    "@type": [
      "http://a.ml/vocabularies/meta#DialectInstance",
      "http://a.ml/vocabularies/document#Document",
      "http://a.ml/vocabularies/document#Fragment",
      "http://a.ml/vocabularies/document#Module",
      "http://a.ml/vocabularies/document#Unit"
    ],
    "http://a.ml/vocabularies/meta#definedBy": [
      {
        "@id": "${rebase}"
      }
    ],
    "http://a.ml/vocabularies/document#encodes": ${base},
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
]`
//console.log("BaseUnit is\n"+baseUnit)
return baseUnit
}

let project = `[
  {
    "@id": "http://yaddayaddadingdong.com",
    "@type": [
      "http://a.ml/vocabularies/meta#DialectInstance",
      "http://a.ml/vocabularies/document#Document",
      "http://a.ml/vocabularies/document#Fragment",
      "http://a.ml/vocabularies/document#Module",
      "http://a.ml/vocabularies/document#Unit"
    ],
    "http://a.ml/vocabularies/meta#definedBy": [
      {
        "@id": "http://yaddayaddadingdong.com"
      }
    ],
    "http://a.ml/vocabularies/document#encodes": [
      {
        "@id": "projUUID0",
        "@type": [
          "http://a.ml/vocabularies/project#Project",
          "https://raw.githubusercontent.com/api-modeling/metadata/storage/model/project/schema/projectDialect.yaml#/declarations/Project",
          "http://a.ml/vocabularies/meta#DialectDomainElement",
          "http://a.ml/vocabularies/document#DomainElement"
        ],
        "http://a.ml/vocabularies/project#owner": [
          {
            "@value": "John Smith"
          }
        ],
       "http://a.ml/vocabularies/project#uuid": [
          {
            "@value": "projUUID0"
          }
        ],
        "http://a.ml/vocabularies/core#displayName": [
          {
            "@value": "Project 1"
          }
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
]`

async function loadCim(projId : string, parsed : DialectWrapper[]){
  const modules = parsed.filter((parsed) => parsed instanceof ModularityDialect)
  const dataModels = parsed.filter((parsed) => parsed instanceof DataModelDialect)
  const bindingsModels = parsed.filter((parsed) => parsed instanceof ModelBindingsDialect)
  let json = await modules[0].toJsonLd()
  let jsonld = JSON.parse(json.toString())
  let astore = store
  let nn = namedNode
  let cimModule = await post(jsonld, projId)
  let bindName = '';
  let dataPromises = dataModels.map(dm => {
    return (async () => {
      let jsonString = await dm.toJsonLd()
      let jsonld = JSON.parse(jsonString.toString())

      let modelId = jsonld[0]['http://a.ml/vocabularies/document#encodes'][0]['@id']
      let astore = store
      let nn = namedNode
      let module = store.getSubjects(namedNode('http://a.ml/vocabularies/modularity#dataModels'),namedNode(modelId))[0]
      await post(jsonld, module.value)
    })()
  })
  await Promise.all(dataPromises)
  // storing bindings!

  let bindingPromises = bindingsModels.map(bm => {
    return (async () => {
      let jsonString = await bm.toJsonLd()
      let jsonld = JSON.parse(jsonString.toString())
      bindName = await postBinding(jsonld, projId)
    })()
  })
  await Promise.all(bindingPromises)
  return [bindName,cimModule]
}

let newModule =
{
  "@id": "http://mulesoft.com/uuid/cim/subjectArea/MatthewsSubjectArea",
  "@type": [
    "file:///Users/mfuchs/Documents/webspace/api-mod-grp/model-bindings/node_modules/@api-modeling/api-modeling-metadata/model/modularity/schema/modularDialect.yaml#/declarations/Module",
    "http://a.ml/vocabularies/modularity#Module",
    "http://a.ml/vocabularies/meta#DialectDomainElement",
    "http://a.ml/vocabularies/document#DomainElement"
  ],
  "http://a.ml/vocabularies/data#uuid": [
    {
      "@value": "uuid/cim/subjectArea/MatthewsSubjectArea"
    }
  ],
  "http://a.ml/vocabularies/core#description": [
    {
      "@value": "Example Entities included: Category Theory, Microrecursive script"
    }
  ],
  "http://a.ml/vocabularies/data#name": [
    {
      "@value": "Matthews"
    }
  ]
}

let newDataModel = {
  "@id": "http://mulesoft.com/modeling/instances/cim/entitygroup/MatthewsEntityGroup/dataModel",
  "@type": [
    "file:///Users/mfuchs/Documents/webspace/api-mod-grp/model-bindings/node_modules/@api-modeling/api-modeling-metadata/model/modeling/schema/dataModelDialect.yaml#/declarations/DataModel",
    "http://a.ml/vocabularies/data-model#DataModel",
    "http://a.ml/vocabularies/meta#DialectDomainElement",
    "http://a.ml/vocabularies/document#DomainElement"
  ],
  "http://a.ml/vocabularies/data#uuid": [
    {
      "@value": "cim/entitygroup/MatthewsEntityGroup/dataModel"
    }
  ],
  "http://a.ml/vocabularies/core#name": [
    {
      "@value": "Matthews data model"
    }
  ]
}

let newEntity =
{
  "@id": "http://mulesoft.com/modeling/instances/cim/entity/Matthew",
  "@type": [
    "file:///Users/mfuchs/Documents/webspace/api-mod-grp/model-bindings/node_modules/@api-modeling/api-modeling-metadata/model/modeling/schema/dataModelDialect.yaml#/declarations/Entity",
    "http://a.ml/vocabularies/data-model#Entity",
    "http://a.ml/vocabularies/meta#DialectDomainElement",
    "http://a.ml/vocabularies/document#DomainElement"
  ],
  "http://a.ml/vocabularies/data#uuid": [
    {
      "@value": "cim/entity/Matthew"
    }
  ],
  "http://a.ml/vocabularies/core#name": [
    {
      "@value": "Matthew"
    }
  ],
  "http://a.ml/vocabularies/data-model#attributes": [
    {
      "@id": "http://mulesoft.com/modeling/instances/uuid/cim/entity/Individual/attr/noMatthewReason",
      "@type": [
        "file:///Users/mfuchs/Documents/webspace/api-mod-grp/model-bindings/node_modules/@api-modeling/api-modeling-metadata/model/modeling/schema/dataModelDialect.yaml#/declarations/Attribute",
        "http://a.ml/vocabularies/data-model#AttributeProperty",
        "http://a.ml/vocabularies/meta#DialectDomainElement",
        "http://a.ml/vocabularies/document#DomainElement"
      ],
      "http://a.ml/vocabularies/core#name": [
        {
          "@value": "noMatthewReason"
        }
      ],
      "http://a.ml/vocabularies/data-model#uuid": [
        {
          "@value": "cim/entity/Individual/attr/noMatthewReason"
        }
      ],
      "http://a.ml/vocabularies/data-model#range": [
        {
          "@id": "http://mulesoft.com/modeling/instances/uuid/string",
          "@type": [
            "file:///Users/mfuchs/Documents/webspace/api-mod-grp/model-bindings/node_modules/@api-modeling-tooling/api-modeling-metadata/model/modeling/schema/dataModelDialect.yaml#/declarations/String",
            "http://a.ml/vocabularies/data-model#String",
            "http://a.ml/vocabularies/meta#DialectDomainElement",
            "http://a.ml/vocabularies/document#DomainElement"
          ]
        }
      ]
    },
    {
      "@id": "http://mulesoft.com/modeling/instances/uuid/cim/entity/Individual/attr/exceptionsCount",
      "@type": [
        "file:///Users/mfuchs/Documents/webspace/api-mod-grp/model-bindings/node_modules/@api-modeling/api-modeling-metadata/model/modeling/schema/dataModelDialect.yaml#/declarations/Attribute",
        "http://a.ml/vocabularies/data-model#AttributeProperty",
        "http://a.ml/vocabularies/meta#DialectDomainElement",
        "http://a.ml/vocabularies/document#DomainElement"
      ],
      "http://a.ml/vocabularies/core#name": [
        {
          "@value": "exceptionsCount"
        }
      ],
      "http://a.ml/vocabularies/data-model#uuid": [
        {
          "@value": "cim/entity/Individual/attr/exceptionsCount"
        }
      ],
      "http://a.ml/vocabularies/data-model#range": [
        {
          "@id": "http://mulesoft.com/modeling/instances/uuid/integer",
          "@type": [
            "file:///Users/mfuchs/Documents/webspace/api-mod-grp/model-bindings/node_modules/@api-modeling-tooling/api-modeling-metadata/model/modeling/schema/dataModelDialect.yaml#/declarations/Integer",
            "http://a.ml/vocabularies/data-model#Integer",
            "http://a.ml/vocabularies/meta#DialectDomainElement",
            "http://a.ml/vocabularies/document#DomainElement"
          ]
        }
      ]
    }
  ],
  "http://a.ml/vocabularies/core#description": [
    {
      "@value": "Represent the person you are, or will be, dealing with using the system"
    }
  ]
}

function retrieveByType(typeName : string):any[] {
  return store.getSubjects(namedNode(schPref.rdf + 'type'),namedNode(typeName))
}

function createBinding(source : string, regime: string){
  store.addQuad()
}

startup().then(async () => {
  // create project
  let projId = await post(JSON.parse(project))
  let apiParameters = [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML}]

  pluginImport("cim",[],[{url: "file://src/test/resources/model.jsonld"}]).
  //pluginImport('api',
  //  apiParameters
  // ,[{url: 'file://src/test/resources/library.raml'}]).
  then(async (parsed) =>{
    let vals = await loadCim(projId, parsed)
    let bindName = vals[0]
    let cimModule = vals[1]
    // at this point, it's all been stored

    // add a new subjectarea
    let newModName = await post(newModule, cimModule)
    // add a new datamodel
    let newDMName = await post(newDataModel, newModName)
    // add a new entity
    let newEntityName = await post(newEntity, newDMName)

    //finding who doesn't have a binding
    // get all Modules and filter to who is "boundBy" bindName
    let modsToAnnotate = retrieveByType(schPref.amlm + 'Module').
      filter((m : any) => store.getObjects(m, namedNode(schPref.bind + "boundBy")).
        filter((o : any) => store.countQuads(o,namedNode(schPref.rdf + 'type'),null,namedNode(bindName)) > 0).length === 0)
    let dmsToAnnotate = retrieveByType(schPref.amldm + 'DataModel').
      filter((m : any) => store.getObjects(m, namedNode(schPref.bind + "boundBy")).
        filter((o : any) => store.countQuads(o,namedNode(schPref.rdf + 'type'),null,namedNode(bindName)) > 0).length === 0)


    // time to resuscitate the jsonld
    let astore = store
    let bindingJson = await get(bindName, false)
    let basis = (<any[]>(<any[]>bindingJson)[0]['@graph']).filter(u => u['@id'] === bindName)[0]
    let items = (<any[]>(<any[]>bindingJson)[0]['@graph'])
    let pos = 0
    while (items[pos]['@id'] != bindName) pos++
    let root = items[pos]
    items.splice(pos,1)
    let im : { [index : string] : any} = {}
    items.forEach(i => im[i['@id']] = i)
    let newer = root['http://a.ml/vocabularies/bindings#binding'].map((i : any) => im[i['@id']])
    root['http://a.ml/vocabularies/bindings#binding'] = newer

    //items.unshift(root)
    let bu = makeBaseUnit(basis, JSON.stringify([root], null, 2))
    let bmd = new ModelBindingsDialect()
    await bmd.fromJsonLd(bindName, bu)

    let megaJson : any[] = <any[]> await transitiveGet(cimModule)
    const dataModelListList : string [][] = megaJson.map(m => m['http://a.ml/vocabularies/modularity#dataModels'] ?
        m['http://a.ml/vocabularies/modularity#dataModels'].map((x : any) => x['@id']) : [])
    let dataModelList : string [] = []
    dataModelListList.forEach(l => { dataModelList = dataModelList.concat(l) })

    const moduleDialecti  : DialectWrapper[] = await Promise.all(megaJson.map((dm : any) => {
      return (async () => {
        //let json = await transitiveGet(dm)
        //console.log("Module name: "+dm['@id'])
        let dmd = new ModularityDialect()
        await dmd.fromJsonLd(dm['@id'], makeBaseUnit(dm, JSON.stringify([dm],null, 2)))
        return dmd
      })()
    }))

    const dataModelDialecti = await Promise.all(dataModelList.map((dm : string) => {
      return (async () => {
        let json : any[] = await transitiveGet(dm)
        let texted = JSON.stringify(json,null,2)
        const redo = toTree(json)
        //console.log("DataModel name: "+dm)
        //console.log("TREE:\n"+JSON.stringify(redo,null,2))
        let dmd = new DataModelDialect()
        //console.log("DM is\n"+JSON.stringify(json,null, 2))
        let baseUnit = makeBaseUnit(json[0], JSON.stringify([json[0]],null, 2))
        await dmd.fromJsonLd(dm, baseUnit)
        return dmd
      })()
    }))
    //let allDialects : DialectWrapper[] = bindingsModels.concat(moduleDialecti).concat(dataModelDialecti)
    let allDialects : DialectWrapper[] = [bmd]
    let finalDialects = allDialects.concat(moduleDialecti).concat(dataModelDialecti)
    const generated = await pluginExport('cim',
        [{name:'cimVersion', value:'0.1.0'},{name:'outputFile',value: 'cimfoobar.json'}],
        <DialectWrapper[]>finalDialects)

    console.log("done:\n"+generated[0].text)
  })
})

function toTree(json : any[]){
  let idMap : { [key : string]: any}= {}
  json.forEach(node => idMap[<string>node['@id']] = node)
  return walk(json[0],idMap)
}

function walk(json : any, idMap : { [key : string]: any}): object {
  let keys = Object.keys(json)
  if (keys.length === 1 && keys[0] === '@value')
    return json
  if (keys.length === 1 && keys[0] === '@id'){
    if (idMap[json['@id']]){
      return walk(idMap[json['@id']], idMap)
    } else return json
  }
  keys.forEach(key => {
    if (key === 'http://a.ml/vocabularies/data-model#entities' ||
        key === 'http://a.ml/vocabularies/data-model#associations' ||
        key === 'http://a.ml/vocabularies/data-model#attributes'){
      try {
        json[key] = json[key].map((v : any) => walk(v,idMap))
      } catch (error) {
        console.log("error is "+error)
      }
    }
  })
  return json
}
