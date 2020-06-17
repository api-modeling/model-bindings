import {APIContractBindingsPlugin} from "./bindings/APIContractBindingsPlugin";
import fs from "fs";
import path from "path";

// Small utility to serialize CIM using the modeling tool schemas
const apiContractPlugin = new APIContractBindingsPlugin();
const url = "src/test/resources/library.raml"
const text = fs.readFileSync(url).toString()
apiContractPlugin.import([{url: "file://"+ url, text: text}]).then((parsed) => {
    const base = "out/raml/";
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
