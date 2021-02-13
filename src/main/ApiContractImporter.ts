import {APIContractBindingsPlugin} from "./bindings/APIContractBindingsPlugin";
import fs from "fs";
import path from "path";
import {ApiParser} from "./bindings/utils/apiParser";

// Small utility to serialize CIM using the modeling tool schemas
const apiContractPlugin = new APIContractBindingsPlugin();

const stripeUrl = "src/test/resources/stripe.json"
const ramlUrl = "src/test/resources/ecommerce.raml"
const gdriveUrl = "src/test/resources/google-drive-api/google-drive-api.raml"
const url = ramlUrl; // CHANGE ME
const text = fs.readFileSync(url).toString()

const outStripe = "out/stripe/";
const outRaml = "out/ecommerce/"
const outGDrive = "out/gdrive/"
const outBase = outRaml // CHANGE ME

const stripeConfig = [{name: "format", value: ApiParser.OAS3 + ".0"}, {name: "syntax", value: ApiParser.JSON}]
const stripeFile =  [{url: "file://"+ stripeUrl, text: text}]
const ramlConfig = [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML}]
const ramlFile =  [{url: "file://"+ ramlUrl, text: text}]
const gdriveConfig = [{name: "format", value: ApiParser.RAML1}, {name: "syntax", value: ApiParser.YAML}]
const gdriveFile =  [{url: "file://"+ gdriveUrl, text: text}]

const config = ramlConfig; // CHANGE ME
const file = ramlFile; // CHANGE ME

apiContractPlugin.import(config,file).then((parsed) => {
    const base = outBase;
    parsed.forEach((dialectInstance) => {
        const location = base + dialectInstance.location;
        const locationDir = path.dirname(location);
        if (!fs.existsSync(locationDir)) {
            fs.mkdirSync(locationDir, {recursive: true});
        }
        dialectInstance.toYaml().then((data) => {
            console.log("WRITING " + location)
            fs.writeFileSync(location + ".yaml", data);
        });
        dialectInstance.toJsonLd().then((data) => {
            console.log("WRITING " + location)
            fs.writeFileSync(location + ".jsonld", data);
        });
    });
});
