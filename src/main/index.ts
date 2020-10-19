//import {DialectWrapper, ModularityDialect, Module, Entity, Attribute, Association, IntegerScalar, StringScalar, DataModel, DataModelDialect, ModelBindingsDialect, BindingsModel, Binding, BindingArrayValue} from "@api-modeling/api-modeling-metadata";
import {ApiParser} from "./bindings/utils/apiParser";
import { ApiGenerator } from "./bindings/utils/apiGenerator";
import { PluginController } from './bindings/PluginController'
import { CIMBindingsPlugin } from './bindings/CIMBindingsPlugin'
import { APIContractBindingsPlugin } from './bindings/APIContractBindingsPlugin'
const Writer = require('n3').Writer;

const deepEqual = require('deep-equal')
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

const N3Store = require('n3').Store;
const N3Parser = require('n3').Parser;

//import * as fs from 'fs';
import * as jsonld from 'jsonld'

import {JsonLdParser} from "jsonld-streaming-parser";
import { NamedNode, Store, Quad, BlankNode, Term } from 'n3';
import { DataStore } from '@api-modeling/metadata-store'

console.log("abot to create datastore")
const df = DataStore.getDataStore()
console.log("about to startup")

df.startup().then(async () => {
  console.log("started")
  // create project
  //let apiParser = new ApiParser('file:///Users/mfuchs/Documents/webspace/api-mod-grp/model-bindings-pre/src/test/resources/api3.raml',ApiParser.RAML1,ApiParser.YAML)
  let apiParser = new ApiParser('file:///Users/mfuchs/Documents/webspace/api-mod-grp/model-bindings-pre/src/test/resources/raml3-2.jsonld',ApiParser.AMF_GRAPH,ApiParser.JSONLD)
  console.log("HERE")
  try {
  let result = await apiParser.parse()
  let foo = await new ApiGenerator(result, ApiParser.RAML1, ApiParser.JSONLD).generate()
  let bar = JSON.parse(foo)
  const myParser = new JsonLdParser()

  let inputStore = new N3Store()
  myParser
    .on('data', (q) => {
      //console.log("had data")
      inputStore.addQuad(q)
    })
    .on('error', console.error)
    .on('end', async () => {
      console.log('All triples were parsed!');
      let doc = await rdfToJson(inputStore)
      let forFile = JSON.stringify(doc,null,2)
      console.log("doc is "+doc)
  });

  myParser.write(foo)
  myParser.end()

  //let toRamlParse = new ApiParser(foo,ApiParser.RAML1,ApiParser.JSONLD)
  //let result2 = await toRamlParse.parse()
  //let baz = await new ApiGenerator(result, ApiParser.RAML1, ApiParser.YAML).generate()
  //console.log(JSON.stringify(foo, null, 2))
 } catch (error) {
    console.log("blew up "+error)
  }
  console.log("THERE")
})

function rdfToJson(pieces : Store, removeGraph = false) : Promise<any> {
  return new Promise((resolve,reject) => {
    var writer1 = new Writer({ format : 'N-Triples' });
    let quadNo = 0
    pieces.getQuads(null,null,null,null).forEach(quad => {
        writer1.addQuad(quad)
      });
    writer1.end(function (error : any, result : any) {
      jsonld.fromRDF(result, {format: 'application/n-quads'}).then((doc) =>{
        //peeling off json-ld graph stuff for pawel
          resolve(doc)
      });
    })
  })
}


