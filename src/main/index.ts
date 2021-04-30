export * from './bindings/AMLBindingsPlugin'
export * from './bindings/APIContractBindingsPlugin'
export * from './bindings/BindingsPlugin'
export * from './bindings/CIMBindingsPlugin'

export { ApiParser } from './bindings/utils/apiParser'

import { ApiParser } from './bindings/utils/apiParser'

import * as fs from 'fs';

import * as amf from '@api-modeling/amf-client-js'
import { parentPort } from 'worker_threads'
import { APIContractBindingsPlugin } from './bindings/APIContractBindingsPlugin'
//import { ModelResolver } from 'amf-client-js'
 
console.log("I'm here")

//console.log(amf)


const textUrl = "/Users/matthew.fuchs/Documents/webspace/raml/simple/parametrized.raml";
const textData = fs.readFileSync(textUrl).toString();

const parameters = [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML}]
const resources = [{ url: "file://"+ textUrl, text: <string>''}]

const configuration = [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML}];

async function foo() {
    try {
        console.log("about")
        amf.plugins.document.WebApi.register();
        amf.plugins.features.AMFValidation.register();
        await amf.Core.init();
        const parser = new amf.Raml10Parser() //new ApiParser(resources[0].url, ApiParser.RAML1, ApiParser.YAML)
        const baseUnit = await parser.parseFileAsync(resources[0].url)
        console.log("fpop")
        const mr = new amf.ModelResolver()
        const rezzies = mr.getResourceTypes(baseUnit)
        const traits = mr.getTraits(baseUnit)
        const endies = mr.getEndpoints(baseUnit)
        const idToObj : { [key : string] : any} = {};
        rezzies.forEach(r => idToObj[r.id] = r)
        traits.forEach((r : any) => idToObj[r.id] = r)
        endies.forEach((r : any) => idToObj[r.id] = r)
        console.log("got endpoings")
        //const ep = mr.getResourceTypeAsEndpoint(rezzies,baseUnit)
        const report = await amf.Core.validate(baseUnit, amf.ProfileNames.RAML, amf.MessageStyles.RAML)
        console.log("conforms: "+report.conforms)
        if (report.conforms){
            endies.forEach(e => mr.resolveEndpoint(e,baseUnit))
            //const stuff = await new APIContractBindingsPlugin().importBaseUnit(baseUnit)
            //console.log(stuff)
        } else {
            console.log("non conformant")
        }
    } catch (error) {
        console.log(error)
    }       
}

foo()