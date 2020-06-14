import {CIMBindingsPlugin} from "./bindings/CIMBindingsPlugin";
import fs from "fs";
import path from "path";

// Small utility to serialize CIM using the modeling tool schemas
const cimPlugin = new CIMBindingsPlugin();
const url = "src/test/resources/model.jsonld"
const text = fs.readFileSync(url).toString()
cimPlugin.import([{url: "file://"+ url, text: text}]).then((parsed) => {
    const base = "out/cim/";
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
