import {APIContractBindingsPlugin} from "./bindings/APIContractBindingsPlugin";
import fs from "fs";
import path from "path";
import {ApiParser} from "./bindings/utils/apiParser";

// Small utility to serialize CIM using the modeling tool schemas
const apiContractPlugin = new APIContractBindingsPlugin();
const url = "src/test/resources/stripe.json"
const text = fs.readFileSync(url).toString()
apiContractPlugin.import(
    [{name: "format", value: ApiParser.OAS3 + ".0"}, {name: "syntax", value: ApiParser.JSON}],
    [{url: "file://"+ url, text: text}]).then((parsed
) => {
    const base = "out/stripe/";
    parsed.forEach((dialectInstance) => {
        const location = base + dialectInstance.location;
        const locationDir = path.dirname(location);
        if (!fs.existsSync(locationDir)) {
            fs.mkdirSync(locationDir, {recursive: true});
        }
        dialectInstance.toYaml().then((data) => {
            fs.writeFileSync(location + ".yaml", data);
        });
        dialectInstance.toJsonLd().then((data) => {
            fs.writeFileSync(location + ".jsonld", data);
        });
    });
});
