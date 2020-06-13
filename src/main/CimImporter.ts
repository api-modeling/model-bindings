import {CIMBindingsPlugin} from "./bindings/CIMBindingsPlugin";
import fs from "fs";
import process from "process"

// Small utility to serialize CIM using the modeling tool schemas
const cimPlugin = new CIMBindingsPlugin();
const url = "file://src/test/resources/model.jsonld"
const text = fs.readFileSync(url).toString()
cimPlugin.import([{url: url, text: text}]).then((parsed) => {
    const base = "out/cim/";
    parsed.forEach((dialectInstance) => {
        const location = base + dialectInstance.location;
        dialectInstance.toYaml().then((data) => {
            fs.writeFileSync(location + ".yaml", data);
        });
        dialectInstance.toJsonLd().then((data) => {
            fs.writeFileSync(location + ".jsonld", data);
        });
    });
});
