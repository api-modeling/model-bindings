import {DialectWrapper, ModularityDialect, Module, Entity, Attribute, Association, IntegerScalar, StringScalar, DataModel, DataModelDialect, ModelBindingsDialect, BindingsModel, Binding, BindingArrayValue} from "@api-modeling/api-modeling-metadata";
import { startup, post, store, transitiveGet, get, schPref, literal } from '@api-modeling/metadata-store'
import {ApiParser} from "./bindings/utils/apiParser";
import { PluginController } from './bindings/PluginController'

//const assert  = require('assert')

const deepEqual = require('deep-equal')
const DataFactory = require('n3').DataFactory;
const { namedNode } = DataFactory;

import * as fs from 'fs';
import * as jsonld from 'jsonld'
//import { assert } from "console";

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

let newModule =
{
  "@id": "http://mulesoft.com/modeling/instances/uuid/cim/subjectarea/MatthewsSubjectArea",
  "@type": [
    "http://anypoint.mulesoft.com/model/modularity/schema/modularDialect.yaml#/declarations/Module",
    "http://a.ml/vocabularies/modularity#Module",
    "http://a.ml/vocabularies/meta#DialectDomainElement",
    "http://a.ml/vocabularies/document#DomainElement"
  ],
  "http://a.ml/vocabularies/data#uuid": [
    {
      "@value": "cim/subjectarea/Matthews"
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
  "@id": "http://mulesoft.com/modeling/instances/cim/entitygroup/MatthewsEntityGroup",
  "@type": [
    "http://anypoint.mulesoft.com/model/modeling/schema/dataModelDialect.yaml#/declarations/DataModel",
    "http://a.ml/vocabularies/data-model#DataModel",
    "http://a.ml/vocabularies/meta#DialectDomainElement",
    "http://a.ml/vocabularies/document#DomainElement"
  ],
  "http://a.ml/vocabularies/data#uuid": [
    {
      "@value": "cim/entitygroup/MatthewsEntityGroup"
    }
  ],
  "http://a.ml/vocabularies/core#name": [
    {
      "@value": "Matthews"
    }
  ]
}

let newEntity =
{
  "@id": "http://mulesoft.com/modeling/instances/cim/entity/Matthew",
  "@type": [
    "http://anypoint.mulesoft.com/model/modeling/schema/dataModelingLibrary.yaml#/declarations/Entity",
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
        "http://anypoint.mulesoft.com/model/modeling/schema/dataModelingLibrary.yaml#/declarations/Attribute",
        "http://a.ml/vocabularies/data-model#AttributeProperty",
        "http://a.ml/vocabularies/meta#DialectDomainElement",
        "http://a.ml/vocabularies/document#DomainElement"
      ],
      "http://a.ml/vocabularies/core#name": [
        {
          "@value": "noMatthewReason"
        }
      ],
      "http://a.ml/vocabularies/data#uuid": [
        {
          "@value": "cim/entity/Individual/attr/noMatthewReason"
        }
      ],
      "http://a.ml/vocabularies/data-model#range": [
        {
          "@id": "http://mulesoft.com/modeling/instances/uuid/string",
          "@type": [
            "http://anypoint.mulesoft.commfuchs/Documents/webspace/api-mod-grp/model-bindings/node_modules/@api-modeling-tooling/api-modeling-metadata/model/modeling/schema/dataModelingLibrary.yaml#/declarations/String",
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
        "http://anypoint.mulesoft.com/model/modeling/schema/dataModelingLibrary.yaml#/declarations/Attribute",
        "http://a.ml/vocabularies/data-model#AttributeProperty",
        "http://a.ml/vocabularies/meta#DialectDomainElement",
        "http://a.ml/vocabularies/document#DomainElement"
      ],
      "http://a.ml/vocabularies/core#name": [
        {
          "@value": "exceptionsCount"
        }
      ],
      "http://a.ml/vocabularies/data#uuid": [
        {
          "@value": "cim/entity/Individual/attr/exceptionsCount"
        }
      ],
      "http://a.ml/vocabularies/data-model#range": [
        {
          "@id": "http://mulesoft.com/modeling/instances/uuid/integer",
          "@type": [
            "http://anypoint.mulesoft.commfuchs/Documents/webspace/api-mod-grp/model-bindings/node_modules/@api-modeling-tooling/api-modeling-metadata/model/modeling/schema/dataModelingLibrary.yaml#/declarations/Integer",
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

let cimOrig = JSON.parse(fs.readFileSync('src/test/resources/model.jsonld').toString())

startup().then(async () => {
  // create project
  let projId = await post(JSON.parse(project))
  let apiParameters = [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML}]
  let start = new Date().getTime()

  let pluginController = new PluginController();
  console.log("start loading CIM at "+(new Date().getTime() - start))
  pluginController.pluginImport("cim",[],[{url: "file://src/test/resources/model.jsonld"}]).
  //pluginImport('api',
  //  apiParameters
  // ,[{url: 'file://src/test/resources/library.raml'}]).
  then(async (parsed) =>{
    console.log("finished reading CIM at "+(new Date().getTime() - start))
    let vals = await pluginController.storeImport(projId, parsed)
    console.log("finished loading CIM at "+(new Date().getTime() - start))
    let bindName = vals[0]
    let cimModule = vals[1]

    //let cimMod = await get(cimModule)
    // add a new subjectarea
    //let newModName = await post(newModule, cimModule)
    // add a new datamodel
    //let newDMName = await post(newDataModel, newModName)
    // add a new entity
    //let newEntityName = await post(newEntity, newDMName)
    console.log("added nodes at "+(new Date().getTime() - start))
    pluginController.updateBindings("cim", bindName)
    console.log("added bindings at "+(new Date().getTime() - start))
    let megaJson : any[] = <any[]> await transitiveGet(cimModule)
    console.log("retrieved everything at "+(new Date().getTime() - start))
    // time to resuscitate the jsonld
    let bmd = await pluginController.modelBinding(bindName)
    let finalDialects = await pluginController.generateDialects(megaJson,bmd)
    console.log("generated dialects at "+(new Date().getTime() - start))
    //let foo = await get(newEntityName)
    //let bar = await get(newDMName)
    //let baz = await get(newModName)
    //let party = await get('http://mulesoft.com/modeling/instances/cim/entity/Party')
    const generated = await pluginController.pluginExport('cim',
        [{name:'cimVersion', value:'0.1.0'},{name:'outputFile',value: 'cimfoobar.json'}],
        <DialectWrapper[]>finalDialects)
    console.log("done at "+(new Date().getTime() - start))
    let cimGen = JSON.parse(<string>generated[0].text)
    let j1 : any = await jsonld.expand(cimGen)
    let j2 : any = await jsonld.expand(cimOrig)
    let props1 : string [] = j1[0]['http://cloudinformationmodel.org/model/subjectArea'][0]['http://cloudinformationmodel.org/model/entityGroup'][4]['http://cloudinformationmodel.org/model/properties'].map((i : any) => i['@id']).sort()
    let props2 : string [] = j2[0]['http://cloudinformationmodel.org/model/subjectArea'][0]['http://cloudinformationmodel.org/model/entityGroup'][4]['http://cloudinformationmodel.org/model/properties'].map((i : any) => i['@id']).sort()
    let diff = props2.filter(x => !props1.includes(x))
    let common = props2.filter(x => props1.includes(x))
    let equiv = deepEqual(j1,j2)
    console.log(equiv)

    //console.log(generated[0].text)
  })
})

